import { randomUUID } from "node:crypto";
import { arch, platform } from "node:os";
import { join } from "node:path";
import {
  HEARTBEAT_INTERVAL_MS,
  HubToRunner,
  freshFetch,
  PROTOCOL_VERSION,
  parseMessage,
  type RunAssignment,
  type RunnerRunMessage,
  type RunnerToHub,
  UPLOAD_PART_BYTES,
} from "@agent-office/shared";
import { aiSdkRuntime } from "./runtimes/aiSdk.ts";
import { mockRuntime } from "./runtimes/mock.ts";
import type { ApprovalRequest, ConsultAnswer } from "@agent-office/tools";
import { RunError, type AgentRuntime } from "./runtimes/types.ts";
import { resolveOpenCode } from "./opencode/binary.ts";
import { opencodeRuntime } from "./opencode/runtime.ts";
import { describeError } from "./runtimes/errors.ts";
import { createWorkspace } from "./workspace.ts";

export const RUNNER_VERSION = "0.2.0";

/** Mock echo models skip the LLM entirely; everything else (incl. `mock-script`) runs the AI SDK tool loop. */
export const pickRuntime = (a: RunAssignment): AgentRuntime => {
  // feature notes are a short text job: never spin up OpenCode for them
  if (a.agent.config.runtime === "opencode" && a.job.type !== "feature_note") return opencodeRuntime;
  return a.provider.kind === "mock" && a.agent.model !== "mock-script" ? mockRuntime : aiSdkRuntime;
};

type Unsequenced<T> = T extends unknown ? Omit<T, "seq" | "run_id"> : never;

interface ActiveRun {
  abort: AbortController;
  seq: number;
  /** Sent but not yet acked by the hub; re-sent after reconnect. */
  outbox: Map<number, RunnerRunMessage>;
  done: boolean;
}

export interface RunnerClientOptions {
  hubUrl: string;
  token: string;
  name: string;
  workspacesDir: string;
  /** Runner-private data folder (screenshot baselines). Never inside a workspace. */
  dataDir?: string;
  maxConcurrentRuns?: number;
  /** Sent with every request to the hub (e.g. Cloudflare Access service token headers). */
  extraHeaders?: Record<string, string>;
  /** Override runtime selection (tests). */
  pickRuntime?: (a: RunAssignment) => AgentRuntime;
  log?: (msg: string) => void;
}

/**
 * Dials OUT to the hub (no inbound ports), keeps the connection alive, and
 * executes assigned runs. Every run message carries a per-run sequence number
 * and stays in an outbox until the hub acks it, so a dropped connection never
 * loses events.
 */
export class RunnerClient {
  readonly #opts: RunnerClientOptions;
  readonly #runs = new Map<string, ActiveRun>();
  /** approval_id -> waiting tool call. */
  readonly #approvals = new Map<string, { runId: string; resolve: (ok: boolean) => void }>();
  readonly #consults = new Map<string, { runId: string; resolve: (a: ConsultAnswer) => void }>();
  #ws: WebSocket | null = null;
  #ready = false;
  #stopped = false;
  #backoff = 1000;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #reconnect: ReturnType<typeof setTimeout> | null = null;
  readonly #log: (msg: string) => void;
  /** Resolves each time the hub sends `welcome`. */
  #onWelcome: (() => void) | null = null;

  constructor(opts: RunnerClientOptions) {
    this.#opts = opts;
    this.#log = opts.log ?? ((m) => console.log(`[runner] ${m}`));
  }

  get activeRunIds(): string[] {
    return [...this.#runs.keys()];
  }

  start(): Promise<void> {
    this.#stopped = false;
    const welcomed = new Promise<void>((resolve) => (this.#onWelcome = resolve));
    this.#connect();
    return welcomed;
  }

  stop(): void {
    this.#stopped = true;
    if (this.#reconnect) clearTimeout(this.#reconnect);
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    for (const r of this.#runs.values()) r.abort.abort(new Error("runner stopping"));
    this.#ws?.close(1000, "runner stopping");
    this.#ws = null;
  }

  /** Drop the socket without stopping (tests: simulate a network blip). */
  dropConnection(): void {
    this.#ws?.close(4999, "simulated drop");
  }

  #connect(): void {
    const url = new URL("/ws/runner", this.#opts.hubUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    // Bun's WebSocket accepts headers; the token never goes in the URL.
    const ws = new WebSocket(url.toString(), { headers: { ...this.#opts.extraHeaders, Authorization: `Bearer ${this.#opts.token}` } } as never);
    this.#ws = ws;

    ws.onopen = () => {
      this.#backoff = 1000;
      this.#sendRaw({
        type: "hello",
        protocol: PROTOCOL_VERSION,
        name: this.#opts.name,
        version: RUNNER_VERSION,
        capabilities: {
          os: platform(),
          arch: arch(),
          runtimes: [mockRuntime.id, aiSdkRuntime.id, ...(resolveOpenCode() ? [opencodeRuntime.id] : [])],
          max_concurrent_runs: this.#opts.maxConcurrentRuns ?? 1,
          programs: detectPrograms(),
        },
        active_runs: this.activeRunIds,
      });
    };
    ws.onmessage = (ev) => this.#handle(String(ev.data));
    ws.onclose = (ev) => {
      if (this.#ws === ws) this.#ws = null;
      this.#ready = false;
      if (this.#heartbeat) clearInterval(this.#heartbeat);
      this.#heartbeat = null;
      if (this.#stopped) return;
      if (ev.code === 4003) {
        this.#log("hub revoked this runner's token; pair again with a new PAIRING_CODE");
        this.#stopped = true;
        return;
      }
      this.#log(`disconnected (${ev.code} ${ev.reason || ""}), retrying in ${this.#backoff / 1000}s`);
      this.#reconnect = setTimeout(() => this.#connect(), this.#backoff);
      this.#backoff = Math.min(this.#backoff * 2, 30_000);
    };
    ws.onerror = () => {
      /* onclose follows and handles retry */
    };
  }

  #handle(raw: string): void {
    const msg = parseMessage(HubToRunner, raw);
    if (!msg) return this.#log("dropped invalid message from hub");
    switch (msg.type) {
      case "welcome": {
        this.#ready = true;
        this.#log(`connected to hub as ${msg.runner_id}`);
        this.#heartbeat = setInterval(
          () => this.#sendRaw({ type: "heartbeat", active_runs: this.activeRunIds }),
          msg.heartbeat_interval_ms || HEARTBEAT_INTERVAL_MS,
        );
        // Re-send anything the hub has not acked yet, in order.
        for (const run of this.#runs.values()) {
          for (const m of [...run.outbox.values()].sort((a, b) => a.seq - b.seq)) this.#sendRaw(m);
        }
        // A decision may have been sent while we were offline.
        if (this.#approvals.size) this.#sendRaw({ type: "approval.poll", approval_ids: [...this.#approvals.keys()] });
        this.#onWelcome?.();
        this.#onWelcome = null;
        return;
      }
      case "run.assign":
        void this.#execute(msg.assignment);
        return;
      case "run.cancel": {
        const run = this.#runs.get(msg.run_id);
        if (run && !run.done) {
          this.#log(`cancelling ${msg.run_id}`);
          run.abort.abort(new Error("cancelled by hub"));
        }
        return;
      }
      case "ack": {
        const run = this.#runs.get(msg.run_id);
        if (!run) return;
        for (const seq of run.outbox.keys()) if (seq <= msg.seq) run.outbox.delete(seq);
        if (run.done && run.outbox.size === 0) this.#runs.delete(msg.run_id);
        return;
      }
      case "consult.answer": {
        const waiting = this.#consults.get(msg.consult_id);
        if (!waiting || waiting.runId !== msg.run_id) return;
        this.#consults.delete(msg.consult_id);
        waiting.resolve({ ok: msg.ok, answer: msg.answer, ...(msg.error ? { error: msg.error } : {}) });
        return;
      }
      case "approval.decision": {
        const waiting = this.#approvals.get(msg.approval_id);
        if (!waiting || waiting.runId !== msg.run_id) return;
        this.#approvals.delete(msg.approval_id);
        this.#log(`approval ${msg.approval_id}: ${msg.decision}`);
        waiting.resolve(msg.decision === "approved");
        return;
      }
      case "error":
        this.#log(`hub error: ${msg.message}`);
        return;
    }
  }

  #sendRaw(msg: RunnerToHub): void {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(msg));
  }

  #sendRun(runId: string, body: Unsequenced<RunnerRunMessage>): void {
    const run = this.#runs.get(runId);
    if (!run) return;
    const msg = { ...body, run_id: runId, seq: run.seq++ } as RunnerRunMessage;
    run.outbox.set(msg.seq, msg);
    if (this.#ready) this.#sendRaw(msg);
  }

  async #upload(runId: string, name: string, data: Uint8Array, contentType: string): Promise<string> {
    const url = new URL(`/api/runner/artifacts/${encodeURIComponent(runId)}/${encodeURIComponent(name)}`, this.#opts.hubUrl);
    const res = await freshFetch(url, {
      method: "POST",
      timeoutMs: 60_000,
      headers: { ...this.#opts.extraHeaders, authorization: `Bearer ${this.#opts.token}`, "content-type": contentType },
      body: data,
    });
    if (!res.ok) throw new Error(`artifact upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return ((await res.json()) as { path: string }).path;
  }

  async #search(runId: string, query: string, allAgents: boolean) {
    const res = await freshFetch(new URL("/api/runner/search", this.#opts.hubUrl), {
      method: "POST",
      timeoutMs: 20_000,
      headers: { ...this.#opts.extraHeaders, authorization: `Bearer ${this.#opts.token}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: runId, query, all_agents: allAgents }),
    });
    if (!res.ok) throw new Error(`search failed (${res.status})`);
    return ((await res.json()) as { results: Awaited<ReturnType<import("@agent-office/tools").ToolContext["searchSessions"]>> }).results;
  }

  async #siteData(runId: string, projectId: string, resource: string, params: Record<string, string>): Promise<unknown> {
    const res = await freshFetch(new URL("/api/runner/site-data", this.#opts.hubUrl), {
      method: "POST",
      timeoutMs: 45_000,
      headers: { ...this.#opts.extraHeaders, authorization: `Bearer ${this.#opts.token}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: runId, project_id: projectId, resource, params }),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: unknown; error?: string };
    if (!res.ok) throw new Error(body.error ?? `site data failed (${res.status})`);
    return body.data;
  }

  async #webPost(runId: string, action: string, draftId: string, edits: Record<string, unknown>): Promise<unknown> {
    const res = await freshFetch(new URL("/api/runner/web-post", this.#opts.hubUrl), {
      method: "POST",
      timeoutMs: 90_000,
      headers: { ...this.#opts.extraHeaders, authorization: `Bearer ${this.#opts.token}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: runId, action, draft_id: draftId, edits }),
    });
    const body = (await res.json().catch(() => ({}))) as { draft?: unknown; error?: string };
    if (!res.ok) throw new Error(body.error ?? `website change failed (${res.status})`);
    return body.draft;
  }

  async #fetchUpload(runId: string, id: string): Promise<Uint8Array> {
    const url = new URL(`/api/runner/uploads/${encodeURIComponent(id)}`, this.#opts.hubUrl);
    url.searchParams.set("run_id", runId);
    const res = await freshFetch(url, { timeoutMs: 60_000, headers: { ...this.#opts.extraHeaders, authorization: `Bearer ${this.#opts.token}` } });
    if (!res.ok) throw new Error(`photo download failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Stream an attached file (a video) to disk. */
  async #downloadUpload(runId: string, id: string, dest: string): Promise<void> {
    const url = new URL(`/api/runner/uploads/${encodeURIComponent(id)}`, this.#opts.hubUrl);
    url.searchParams.set("run_id", runId);
    const res = await freshFetch(url, { timeoutMs: 30 * 60_000, headers: { ...this.#opts.extraHeaders, authorization: `Bearer ${this.#opts.token}` } });
    if (!res.ok) throw new Error(`video download failed (${res.status})`);
    await Bun.write(dest, res);
  }

  /** Send a finished video to the hub in parts (Cloudflare refuses bodies over 100 MB). */
  async #uploadVideo(runId: string, path: string, name: string): Promise<{ id: string; size: number }> {
    const file = Bun.file(path);
    const total = file.size;
    const key = randomUUID().replace(/-/g, "");
    let offset = 0;
    for (;;) {
      const part = new Uint8Array(await file.slice(offset, offset + UPLOAD_PART_BYTES).arrayBuffer());
      const url = new URL(`/api/runner/uploads/parts/${key}`, this.#opts.hubUrl);
      for (const [k, v] of Object.entries({ run_id: runId, name, total: String(total), offset: String(offset) })) url.searchParams.set(k, v);
      const res = await freshFetch(url, {
        method: "PUT",
        timeoutMs: 10 * 60_000,
        headers: { ...this.#opts.extraHeaders, authorization: `Bearer ${this.#opts.token}`, "content-type": "video/mp4" },
        body: part,
      });
      const body = (await res.json().catch(() => ({}))) as { received?: number; upload?: { id: string; size: number }; error?: string };
      if (!res.ok) throw new Error(`video upload failed (${res.status}): ${body.error ?? ""}`);
      if (body.upload) return { id: body.upload.id, size: body.upload.size };
      offset = body.received ?? offset + part.length;
    }
  }

  async #webSearch(runId: string, query: string, count: number) {
    const res = await freshFetch(new URL("/api/runner/web-search", this.#opts.hubUrl), {
      method: "POST",
      timeoutMs: 30_000,
      headers: { ...this.#opts.extraHeaders, authorization: `Bearer ${this.#opts.token}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: runId, query, count }),
    });
    const body = (await res.json().catch(() => ({}))) as { results?: import("@agent-office/tools").WebSearchResult[]; error?: string };
    if (!res.ok) throw new Error(body.error ?? `web search failed (${res.status})`);
    return body.results ?? [];
  }

  /** Ask another agent through the hub and wait for its answer (or the timeout / cancel). */
  #consult(runId: string, toAgent: string, question: string, timeoutMs: number, signal: AbortSignal): Promise<ConsultAnswer> {
    const consultId = randomUUID();
    return new Promise((resolve) => {
      const done = (a: ConsultAnswer) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        this.#consults.delete(consultId);
        resolve(a);
      };
      const onAbort = () => done({ ok: false, answer: "", error: "the run was cancelled" });
      const timer = setTimeout(() => done({ ok: false, answer: "", error: `no answer within ${Math.round(timeoutMs / 60_000)} minutes` }), timeoutMs);
      signal.addEventListener("abort", onAbort, { once: true });
      this.#consults.set(consultId, { runId, resolve: done });
      this.#sendRun(runId, { type: "run.consult", consult_id: consultId, to_agent: toAgent, question });
    });
  }

  #requestApproval(runId: string, req: ApprovalRequest, signal: AbortSignal): Promise<boolean> {
    const approvalId = randomUUID();
    return new Promise<boolean>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const onAbort = () => {
        this.#approvals.delete(approvalId);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#approvals.set(approvalId, {
        runId,
        resolve: (ok) => {
          signal.removeEventListener("abort", onAbort);
          resolve(ok);
        },
      });
      this.#log(`run ${runId} waiting for approval: ${req.action}`);
      this.#sendRun(runId, { type: "run.approval_request", approval_id: approvalId, ...req });
    });
  }

  async #execute(a: RunAssignment): Promise<void> {
    if (this.#runs.has(a.run_id)) return; // duplicate assignment
    const run: ActiveRun = { abort: new AbortController(), seq: 0, outbox: new Map(), done: false };
    this.#runs.set(a.run_id, run);
    this.#sendRun(a.run_id, { type: "run.accepted" });
    this.#log(`run ${a.run_id} started (${a.agent.slug} / ${a.provider.slug}:${a.agent.model})`);

    let tokens = { tokens_in: 0, tokens_out: 0 };
    try {
      const workspace = await createWorkspace(this.#opts.workspacesDir, a);
      const runtime = this.#opts.pickRuntime?.(a) ?? pickRuntime(a);
      tokens = await runtime.execute({
        assignment: a,
        workspace,
        signal: run.abort.signal,
        emit: (event) => this.#sendRun(a.run_id, { type: "run.event", event }),
        requestApproval: (req) => this.#requestApproval(a.run_id, req, run.abort.signal),
        handoff: (req) => this.#sendRun(a.run_id, { type: "run.handoff", ...req }),
        uploadArtifact: (name, data, type) => this.#upload(a.run_id, name, data, type),
        saveDraft: (d) => this.#sendRun(a.run_id, { type: "run.draft", ...d }),
        addFeatureNote: (f) => this.#sendRun(a.run_id, { type: "run.feature_note", ...f }),
        saveMemory: (target, ops) => this.#sendRun(a.run_id, { type: "run.memory", target, ops }),
        proposeSkill: (p) => this.#sendRun(a.run_id, { type: "run.skill", ...p }),
        searchSessions: (query, allAgents) => this.#search(a.run_id, query, allAgents),
        webSearch: (query, count) => this.#webSearch(a.run_id, query, count),
        fetchUpload: (id) => this.#fetchUpload(a.run_id, id),
        downloadUpload: (id, dest) => this.#downloadUpload(a.run_id, id, dest),
        uploadVideo: (path, name) => this.#uploadVideo(a.run_id, path, name),
        siteData: (projectId, resource, params) => this.#siteData(a.run_id, projectId, resource, params),
        webPost: (action, draftId, edits) => this.#webPost(a.run_id, action, draftId, edits),
        consult: (toAgent, question, timeoutMs) => this.#consult(a.run_id, toAgent, question, timeoutMs, run.abort.signal),
        baselineDir: this.#opts.dataDir ? join(this.#opts.dataDir, "baselines", a.agent.slug) : null,
      });
      if (run.abort.signal.aborted) throw run.abort.signal.reason;
      this.#sendRun(a.run_id, { type: "run.done", status: "done", ...tokens });
      this.#log(`run ${a.run_id} done`);
    } catch (err) {
      const cancelled = run.abort.signal.aborted;
      if (err instanceof RunError) tokens = err.tokens;
      const error = cancelled ? (err instanceof Error ? err.message : String(err)) : describeError(err);
      this.#sendRun(a.run_id, { type: "run.done", status: cancelled ? "cancelled" : "failed", error, ...tokens });
      this.#log(`run ${a.run_id} ${cancelled ? "cancelled" : `failed: ${error}`}`);
    } finally {
      run.done = true;
      if (run.outbox.size === 0) this.#runs.delete(a.run_id);
    }
  }
}

/** Programs agents may want on this machine; reported once per connection. */
const PROGRAMS = ["git", "node", "npx", "python", "ffmpeg", "openscad", "blender", "pandoc", "soffice", "gh"];
export const detectPrograms = (): string[] => PROGRAMS.filter((p) => Bun.which(p));
