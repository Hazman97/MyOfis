import type { OcEvent, OpenCodeServer } from "./server.ts";

export interface PermissionAsk {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
}

export interface ToolPart {
  callID: string;
  tool: string;
  status: "pending" | "running" | "completed" | "error";
  input: Record<string, unknown>;
  output?: string;
  error?: string;
  title?: string;
}

export interface SessionHooks {
  /** Decide a permission request. Never returns "always": every ask is decided once. */
  onPermission(ask: PermissionAsk): Promise<"once" | "reject">;
  onToolStart?(t: ToolPart): void;
  onToolEnd?(t: ToolPart): void;
  onTextDelta?(partId: string, delta: string): void;
  onTextFinal?(partId: string, text: string): void;
  onStep?(n: number): void;
}

export interface SessionResult {
  tokensIn: number;
  tokensOut: number;
  finalText: string;
  steps: number;
  error: string | null;
}

const errText = (e: unknown): string => {
  if (!e) return "unknown error";
  if (typeof e === "string") return e;
  const o = e as { name?: string; data?: { message?: string }; message?: string };
  return o.data?.message ?? o.message ?? o.name ?? JSON.stringify(e).slice(0, 300);
};

/**
 * Run one prompt in a fresh OpenCode session and follow its event bus until the
 * session goes idle. Child sessions (OpenCode's sub-agents) are followed too, so
 * their permission requests reach the owner as well.
 */
export async function runSession(
  server: OpenCodeServer,
  opts: { title: string; prompt: string; system?: string; model: { providerID: string; modelID: string }; maxSteps: number; signal: AbortSignal },
  hooks: SessionHooks,
): Promise<SessionResult> {
  const session = await server.request<{ id: string }>("POST", "/session", { title: opts.title });
  const ours = new Set([session.id]);
  const partTypes = new Map<string, string>();
  const pendingDeltas = new Map<string, string>();
  const tools = new Map<string, ToolPart>();
  const started = new Set<string>();
  const ended = new Set<string>();
  const stepParts = new Set<string>();
  const counted = new Set<string>();
  const texts = new Map<string, string>();
  const res: SessionResult = { tokensIn: 0, tokensOut: 0, finalText: "", steps: 0, error: null };

  const stop = new AbortController();
  const onAbort = () => {
    void server.request("POST", `/session/${session.id}/abort`).catch(() => {});
    stop.abort();
  };
  opts.signal.addEventListener("abort", onAbort, { once: true });

  let connected!: () => void;
  const isConnected = new Promise<void>((r) => (connected = r));
  let finished!: () => void;
  const isFinished = new Promise<void>((r) => (finished = r));
  const fail = (msg: string) => {
    res.error ??= msg;
    void server.request("POST", `/session/${session.id}/abort`).catch(() => {});
    finished();
  };

  const loop = (async () => {
    for await (const ev of server.events(stop.signal)) {
      handle(ev);
      if (stop.signal.aborted) break;
    }
  })().catch((e) => fail(`event stream failed: ${errText(e)}`));

  function handle(ev: OcEvent): void {
    const p = ev.properties ?? {};
    if (ev.type === "server.connected") return connected();
    if (ev.type === "session.created") {
      const info = p.info as { id?: string; parentID?: string } | undefined;
      if (info?.id && info.parentID && ours.has(info.parentID)) ours.add(info.id);
      return;
    }
    const sid = p.sessionID;
    if (!sid || !ours.has(sid)) return;

    switch (ev.type) {
      case "message.part.delta": {
        if (p.field !== "text") return;
        const partId = String(p.partID);
        const type = partTypes.get(partId);
        if (type === "text") hooks.onTextDelta?.(partId, String(p.delta));
        else if (type === undefined) pendingDeltas.set(partId, (pendingDeltas.get(partId) ?? "") + String(p.delta));
        return;
      }
      case "message.part.updated": {
        const part = p.part as Record<string, unknown> & { id: string; type: string };
        partTypes.set(part.id, part.type);
        if (part.type === "text") {
          const buffered = pendingDeltas.get(part.id);
          if (buffered) {
            pendingDeltas.delete(part.id);
            hooks.onTextDelta?.(part.id, buffered);
            texts.set(part.id, "streamed");
          }
          const time = part.time as { end?: number } | undefined;
          if (time?.end && typeof part.text === "string") {
            if (!texts.has(part.id)) hooks.onTextDelta?.(part.id, part.text);
            texts.set(part.id, part.text);
            hooks.onTextFinal?.(part.id, part.text);
            if (sid === session.id) res.finalText = part.text;
          } else if (typeof part.text === "string" && !texts.has(part.id)) {
            texts.set(part.id, "streamed");
          }
        } else if (part.type === "reasoning") {
          pendingDeltas.delete(part.id);
        } else if (part.type === "step-start") {
          if (!stepParts.has(part.id)) {
            stepParts.add(part.id);
            res.steps++;
            hooks.onStep?.(res.steps);
            if (res.steps > opts.maxSteps) fail(`stopped: more than ${opts.maxSteps} steps (agent max_steps)`);
          }
        } else if (part.type === "step-finish") {
          if (!counted.has(part.id)) {
            counted.add(part.id);
            const t = part.tokens as { input?: number; output?: number; reasoning?: number } | undefined;
            res.tokensIn += t?.input ?? 0;
            res.tokensOut += (t?.output ?? 0) + (t?.reasoning ?? 0);
          }
        } else if (part.type === "tool") {
          const state = part.state as { status: ToolPart["status"]; input?: Record<string, unknown>; output?: string; error?: string; title?: string };
          const t: ToolPart = {
            callID: String(part.callID),
            tool: String(part.tool),
            status: state.status,
            input: state.input ?? {},
            output: state.output,
            error: state.error,
            title: state.title,
          };
          tools.set(t.callID, t);
          if ((t.status === "running" || t.status === "completed" || t.status === "error") && !started.has(t.callID)) {
            started.add(t.callID);
            hooks.onToolStart?.(t);
          }
          if ((t.status === "completed" || t.status === "error") && !ended.has(t.callID)) {
            ended.add(t.callID);
            hooks.onToolEnd?.(t);
          }
        }
        return;
      }
      case "permission.asked": {
        const ask: PermissionAsk = {
          id: String(p.id),
          sessionID: sid,
          permission: String(p.permission),
          patterns: (p.patterns as string[]) ?? [],
          metadata: (p.metadata as Record<string, unknown>) ?? {},
        };
        void hooks
          .onPermission(ask)
          .catch(() => "reject" as const)
          .then((response) => server.request("POST", `/session/${sid}/permissions/${ask.id}`, { response }))
          .catch(() => {
            /* the run may be ending */
          });
        return;
      }
      case "session.error":
        if (sid === session.id) fail(errText(p.error));
        return;
      case "message.updated": {
        const info = p.info as { role?: string; error?: unknown } | undefined;
        if (info?.role === "assistant" && info.error && sid === session.id) fail(errText(info.error));
        return;
      }
      case "session.idle":
        if (sid === session.id) finished();
        return;
    }
  }

  try {
    await Promise.race([isConnected, Bun.sleep(15_000).then(() => Promise.reject(new Error("OpenCode event stream did not connect")))]);
    await server.request("POST", `/session/${session.id}/prompt_async`, {
      model: opts.model,
      ...(opts.system ? { system: opts.system } : {}),
      parts: [{ type: "text", text: opts.prompt }],
    });
    await Promise.race([isFinished, new Promise<void>((r) => opts.signal.addEventListener("abort", () => r(), { once: true }))]);
  } finally {
    opts.signal.removeEventListener("abort", onAbort);
    stop.abort();
    await loop;
  }
  if (opts.signal.aborted) throw opts.signal.reason ?? new Error("cancelled");
  return res;
}
