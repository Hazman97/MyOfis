import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { freshFetch, redactString, type AgentEvent } from "@agent-office/shared";
import type { Hub } from "./core.ts";
import { approvals, projects } from "./db/schema.ts";
import type { Integrations } from "./integrations.ts";
import { getAgent, getJob, getRun } from "./repo.ts";

const POLL_TIMEOUT_S = 25;
const MESSAGE_MAX = 3500;
/** Job types whose finished report is sent to the owner (Pak Guard's morning report, the nightly smoke test). */
const REPORT_JOB_TYPES = new Set(["health_check", "smoke_test"]);

interface TgUpdate {
  update_id: number;
  message?: { chat: { id: number }; from?: { id: number }; text?: string };
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { message_id: number; chat: { id: number } } };
}

/**
 * Telegram bot for the owner (spec §12): approvals with inline Approve / Reject
 * buttons, morning reports, failures, new drafts. Uses long polling, so the hub
 * needs no public URL. Only the configured owner chat is ever answered, and
 * every button carries an HMAC so a forged callback cannot decide anything.
 */
export class TelegramBot {
  #abort: AbortController | null = null;
  #offset = 0;
  #unsubscribe: (() => void) | null = null;
  /** approval id -> the message with its buttons (so a web decision can update it). */
  readonly #approvalMessages = new Map<string, { chat: string; message_id: number }>();
  /** run id -> drafts saved, announced once the run ends. */
  readonly #draftsByRun = new Map<string, { count: number; project_id: string }>();

  constructor(
    private readonly hub: Hub,
    private readonly integrations: Integrations,
    private readonly apiBase: string,
    private readonly secretsKey: string,
  ) {}

  start(): void {
    this.#unsubscribe = this.hub.store.subscribe((e) => void this.#onEvent(e).catch((err) => console.error("[telegram] notify failed:", redactString(String(err)))));
    this.integrations.onTelegramChange(() => this.#restartPolling());
    this.#restartPolling();
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#abort?.abort();
    this.#abort = null;
  }

  // ---------------------------------------------------------------- Bot API

  async #call<T>(token: string, method: string, body: Record<string, unknown>, timeoutMs = 15_000, signal?: AbortSignal): Promise<T> {
    const res = await freshFetch(`${this.apiBase}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs,
      signal,
    });
    const json = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string } | null;
    if (!json?.ok) throw new Error(`Telegram ${method} failed: ${json?.description ?? res.status}`);
    return json.result as T;
  }

  /** Send a text to the owner. Returns false when Telegram is not set up. */
  async notify(text: string, extra: Record<string, unknown> = {}): Promise<{ message_id: number } | null> {
    const cfg = this.integrations.telegram();
    if (!cfg?.chatId) return null;
    return this.#call<{ message_id: number }>(cfg.token, "sendMessage", { chat_id: cfg.chatId, text: clip(text), disable_web_page_preview: true, ...extra });
  }

  /** "Test" button in Settings. */
  async test(): Promise<void> {
    const sent = await this.notify("✅ Agent Office is connected. Approvals, morning reports and failures will come here.");
    if (!sent) throw new Error("set the bot token and your chat id first");
  }

  // ---------------------------------------------------------------- signing

  #sign(approvalId: string, d: "y" | "n"): string {
    return createHmac("sha256", this.secretsKey).update(`tg:${approvalId}:${d}`).digest("base64url").slice(0, 12);
  }

  /** `a:<approval id>:<y|n>:<sig>` → decision, or null when malformed or forged. */
  parseCallback(data: string): { approvalId: string; decision: "approved" | "rejected" } | null {
    const m = data.match(/^a:([A-Za-z0-9_-]{8,40}):([yn]):([A-Za-z0-9_-]{12})$/);
    if (!m) return null;
    const [, id, d, sig] = m as unknown as [string, string, "y" | "n", string];
    const want = Buffer.from(this.#sign(id, d));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    return { approvalId: id, decision: d === "y" ? "approved" : "rejected" };
  }

  callbackData(approvalId: string, d: "y" | "n"): string {
    return `a:${approvalId}:${d}:${this.#sign(approvalId, d)}`;
  }

  // ---------------------------------------------------------------- outgoing

  async #onEvent(e: AgentEvent): Promise<void> {
    if (!this.integrations.telegram()) return;
    const agentName = () => (e.agent_id ? (getAgent(this.hub.db, e.agent_id)?.name ?? "An agent") : "An agent");
    const jobTitle = () => {
      const run = e.run_id ? getRun(this.hub.db, e.run_id) : undefined;
      return run ? (getJob(this.hub.db, run.job_id)?.title ?? "") : "";
    };
    switch (e.type) {
      case "agent.needs_approval": {
        const p = e.payload;
        const icon = p.risk_level === "dangerous" ? "⚠️" : "🔔";
        const sent = await this.notify(`${icon} ${agentName()} needs your OK (${p.risk_level})\n\n${p.action}\n\nJob: ${jobTitle()}`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Approve", callback_data: this.callbackData(p.approval_id, "y") },
                { text: "❌ Reject", callback_data: this.callbackData(p.approval_id, "n") },
              ],
            ],
          },
        });
        const cfg = this.integrations.telegram();
        if (sent && cfg) this.#approvalMessages.set(p.approval_id, { chat: cfg.chatId, message_id: sent.message_id });
        return;
      }
      case "approval.decided": {
        // decided on the web (Telegram decisions edit their own message): take the buttons away
        const msg = this.#approvalMessages.get(e.payload.approval_id);
        this.#approvalMessages.delete(e.payload.approval_id);
        if (!msg || e.payload.via === "telegram") return;
        const cfg = this.integrations.telegram();
        if (!cfg) return;
        await this.#call(cfg.token, "editMessageReplyMarkup", { chat_id: msg.chat, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
        await this.notify(`${e.payload.decision === "approved" ? "✅ Approved" : "❌ Rejected"} on the web.`, { reply_to_message_id: msg.message_id });
        return;
      }
      case "draft.created": {
        if (!e.run_id) return;
        const cur = this.#draftsByRun.get(e.run_id) ?? { count: 0, project_id: e.payload.project_id };
        cur.count++;
        this.#draftsByRun.set(e.run_id, cur);
        return;
      }
      case "run.failed": {
        this.#draftsByRun.delete(e.payload.run_id);
        await this.notify(`❌ ${agentName()} failed: ${jobTitle()}\n\n${e.payload.error}`);
        return;
      }
      case "run.finished": {
        const drafts = this.#draftsByRun.get(e.payload.run_id);
        this.#draftsByRun.delete(e.payload.run_id);
        if (e.payload.status !== "done") return;
        if (drafts) {
          const project = this.hub.db.select({ name: projects.name }).from(projects).where(eq(projects.id, drafts.project_id)).get();
          await this.notify(`📝 ${agentName()} wrote ${drafts.count} draft${drafts.count > 1 ? "s" : ""}${project ? ` for ${project.name}` : ""}. Review them in Agent Office → Drafts.`);
        }
        const job = getJob(this.hub.db, e.payload.job_id);
        if (job && REPORT_JOB_TYPES.has(job.type)) {
          const out = this.hub.store.state.runs[e.payload.run_id]?.output?.trim();
          if (out) await this.notify(`📋 ${agentName()}: ${job.title}\n\n${out}`);
        }
        return;
      }
      case "budget.exceeded":
        await this.notify(`💤 ${agentName()} used today's token budget (${e.payload.used.toLocaleString("en")} / ${e.payload.budget.toLocaleString("en")}) and went home. Jobs wait until tomorrow or a higher budget.`);
        return;
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- incoming (long polling)

  #restartPolling(): void {
    this.#abort?.abort();
    this.#abort = null;
    const cfg = this.integrations.telegram();
    if (!cfg) return;
    const abort = new AbortController();
    this.#abort = abort;
    void this.#poll(cfg.token, abort.signal);
  }

  async #poll(token: string, signal: AbortSignal): Promise<void> {
    let backoff = 2000;
    while (!signal.aborted) {
      try {
        const updates = await this.#call<TgUpdate[]>(
          token,
          "getUpdates",
          { offset: this.#offset, timeout: POLL_TIMEOUT_S, allowed_updates: ["message", "callback_query"] },
          (POLL_TIMEOUT_S + 10) * 1000,
          signal,
        );
        backoff = 2000;
        for (const u of updates) {
          this.#offset = Math.max(this.#offset, u.update_id + 1);
          await this.handleUpdate(token, u).catch((err) => console.error("[telegram] update failed:", redactString(String(err))));
        }
      } catch (err) {
        if (signal.aborted) return;
        console.error("[telegram] polling:", redactString(String(err)));
        await Bun.sleep(backoff);
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  async handleUpdate(token: string, u: TgUpdate): Promise<void> {
    const owner = this.integrations.telegram()?.chatId ?? "";
    if (u.message?.text) {
      const chat = String(u.message.chat.id);
      const cmd = u.message.text.trim().split(/\s+/)[0]!.toLowerCase();
      // Anyone may ask for their chat id (needed for setup); nothing else is answered for strangers.
      if (cmd === "/start" || cmd === "/id") {
        await this.#call(token, "sendMessage", { chat_id: chat, text: `Your chat id is ${chat}. Paste it in Agent Office → Settings → Integrations → Telegram.` });
        return;
      }
      if (chat !== owner) return;
      if (cmd === "/status") await this.notify(this.#statusText());
      return;
    }
    const cq = u.callback_query;
    if (!cq?.data) return;
    const fromOwner = String(cq.from.id) === owner && (!cq.message || String(cq.message.chat.id) === owner);
    const parsed = fromOwner ? this.parseCallback(cq.data) : null;
    if (!parsed) {
      await this.#call(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Not allowed." }).catch(() => {});
      return;
    }
    let reply: string;
    try {
      this.hub.decideApproval(parsed.approvalId, parsed.decision, "telegram");
      reply = parsed.decision === "approved" ? "✅ Approved" : "❌ Rejected";
    } catch (err) {
      reply = `Not changed: ${(err as Error).message}`;
    }
    this.#approvalMessages.delete(parsed.approvalId);
    await this.#call(token, "answerCallbackQuery", { callback_query_id: cq.id, text: reply }).catch(() => {});
    if (cq.message) {
      const action = this.hub.db.select({ action: approvals.action }).from(approvals).where(eq(approvals.id, parsed.approvalId)).get()?.action ?? "";
      await this.#call(token, "editMessageText", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: clip(`${reply} (Telegram)\n\n${action}`) }).catch(() => {});
    }
  }

  #statusText(): string {
    const s = this.hub.store.state;
    const agents = Object.values(s.agents);
    const busy = agents.filter((a) => a.activity === "working").length;
    const waiting = Object.keys(s.pending_approvals).length;
    const drafts = Object.keys(s.pending_drafts).length;
    return `🏢 Agent Office${s.paused ? " (PAUSED)" : ""}\nWorking: ${busy}\nWaiting for you: ${waiting} approval${waiting === 1 ? "" : "s"}, ${drafts} draft${drafts === 1 ? "" : "s"}`;
  }
}

const clip = (s: string) => (s.length > MESSAGE_MAX ? `${s.slice(0, MESSAGE_MAX)}…` : s);
