import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import { VIDEO_TYPES, freshFetch, redactString, type AgentEvent } from "@agent-office/shared";
import type { Hub } from "./core.ts";
import { agents, approvals, contentDrafts, projects, settings } from "./db/schema.ts";
import type { Integrations } from "./integrations.ts";
import { getAgent, getJob, getRun } from "./repo.ts";

const POLL_TIMEOUT_S = 25;
const MESSAGE_MAX = 3500;
/** Job types whose finished report is sent to the owner (Pak Guard's morning report, the nightly smoke test). */
const REPORT_JOB_TYPES = new Set(["health_check", "smoke_test", "bookings_report"]);
/** Photos sent as an album arrive as separate messages: wait this long for the rest. */
const ALBUM_WAIT_MS = 1500;
/** At most this many draft cards per run; the rest are summarised. */
const DRAFT_CARDS_PER_RUN = 5;
const CHAT_KEY = "telegram.chat";

interface TgPhoto {
  file_id: string;
  file_size?: number;
  width?: number;
  height?: number;
}
/** A video or file sent as a "document". */
interface TgFile {
  file_id: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
}
/** One file to hand to the agent: the photo's largest size, or the video. */
interface InFile {
  file_id: string;
  file_size?: number;
  name: string;
  type: string;
}
/** Telegram bots may download files up to 20 MB and send up to 50 MB. */
const TG_DOWNLOAD_MAX = 20 * 1024 * 1024;
const TG_SEND_MAX = 50 * 1024 * 1024;

interface TgMessage {
  message_id?: number;
  chat: { id: number };
  from?: { id: number };
  text?: string;
  caption?: string;
  photo?: TgPhoto[];
  video?: TgFile;
  document?: TgFile;
  media_group_id?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { message_id: number; chat: { id: number } } };
}

/** Which agent the owner is chatting with from Telegram, and the thread (stored in `settings`). */
interface TgChat {
  agent_id: string | null;
  thread_id: string | null;
  project_id: string | null;
}

/**
 * Telegram bot for the owner (spec §12, extended):
 * - approvals with inline Approve / Reject buttons;
 * - every new draft as a card with Approve / Reject (approving a website post publishes it);
 * - chatting with an agent (Publisher by default): text and photos go to the agent, its answer
 *   comes back here. /agent, /project and /new switch who and what;
 * - morning reports, failures, budgets.
 * Long polling, so the hub needs no public URL. Only the configured owner chat is answered
 * (except /id for setup), and every button carries an HMAC so a forged callback decides nothing.
 */
export class TelegramBot {
  #abort: AbortController | null = null;
  #offset = 0;
  #unsubscribe: (() => void) | null = null;
  /** approval id -> the message with its buttons (so a web decision can update it). */
  readonly #approvalMessages = new Map<string, { chat: string; message_id: number }>();
  /** run id -> drafts saved, sent as cards once the run ends. */
  readonly #draftsByRun = new Map<string, string[]>();
  /** media_group_id -> photos and caption collected so far. */
  readonly #albums = new Map<string, { files: InFile[]; caption: string; timer: ReturnType<typeof setTimeout> }>();

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
    for (const a of this.#albums.values()) clearTimeout(a.timer);
    this.#albums.clear();
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

  /** Send a video file to the owner (multipart upload). */
  async #sendVideo(path: string, name: string, caption: string): Promise<void> {
    const cfg = this.integrations.telegram();
    if (!cfg?.chatId) return;
    const form = new FormData();
    form.set("chat_id", cfg.chatId);
    form.set("caption", caption.slice(0, 1000));
    form.set("supports_streaming", "true");
    form.set("video", Bun.file(path), name);
    const res = await freshFetch(`${this.apiBase}/bot${cfg.token}/sendVideo`, { method: "POST", body: form, timeoutMs: 5 * 60_000 });
    const json = (await res.json().catch(() => null)) as { ok: boolean; description?: string } | null;
    if (!json?.ok) throw new Error(`Telegram sendVideo failed: ${json?.description ?? res.status}`);
  }

  /** Send a text to the owner. Returns false when Telegram is not set up. */
  async notify(text: string, extra: Record<string, unknown> = {}): Promise<{ message_id: number } | null> {
    const cfg = this.integrations.telegram();
    if (!cfg?.chatId) return null;
    return this.#call<{ message_id: number }>(cfg.token, "sendMessage", { chat_id: cfg.chatId, text: clip(text), disable_web_page_preview: true, ...extra });
  }

  /** "Test" button in Settings. */
  async test(): Promise<void> {
    const sent = await this.notify("✅ Agent Office is connected. Approvals, drafts, morning reports and failures will come here. Send a message or a photo to chat with an agent.");
    if (!sent) throw new Error("set the bot token and your chat id first");
  }

  // ---------------------------------------------------------------- signing

  #sign(subject: string, d: "y" | "n"): string {
    return createHmac("sha256", this.secretsKey).update(`tg:${subject}:${d}`).digest("base64url").slice(0, 12);
  }

  #verify(subject: string, d: "y" | "n", sig: string): boolean {
    const want = Buffer.from(this.#sign(subject, d));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  /**
   * `a:<approval id>:<y|n>:<sig>` (an approval) or `d:<draft id>:<y|n>:<sig>` (a draft) → decision,
   * or null when malformed or forged.
   */
  parseCallback(data: string): { kind: "approval" | "draft"; id: string; yes: boolean } | null {
    const m = data.match(/^([ad]):([A-Za-z0-9_-]{8,40}):([yn]):([A-Za-z0-9_-]{12})$/);
    if (!m) return null;
    const [, k, id, d, sig] = m as unknown as [string, "a" | "d", string, "y" | "n", string];
    const subject = k === "a" ? id : `d:${id}`;
    if (!this.#verify(subject, d, sig)) return null;
    return { kind: k === "a" ? "approval" : "draft", id, yes: d === "y" };
  }

  callbackData(approvalId: string, d: "y" | "n"): string {
    return `a:${approvalId}:${d}:${this.#sign(approvalId, d)}`;
  }

  draftCallbackData(draftId: string, d: "y" | "n"): string {
    return `d:${draftId}:${d}:${this.#sign(`d:${draftId}`, d)}`;
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
        this.#draftsByRun.set(e.run_id, [...(this.#draftsByRun.get(e.run_id) ?? []), e.payload.draft_id]);
        return;
      }
      case "run.failed": {
        this.#draftsByRun.delete(e.payload.run_id);
        const job = getJob(this.hub.db, e.payload.job_id);
        if (job?.input.source === "telegram") {
          await this.notify(`❌ ${agentName()} could not answer: ${e.payload.error}`);
          return;
        }
        // a failed web chat message already shows in the chat itself
        if (job?.type === "chat") return;
        await this.notify(`❌ ${agentName()} failed: ${jobTitle()}\n\n${e.payload.error}`);
        return;
      }
      case "run.finished": {
        const drafts = this.#draftsByRun.get(e.payload.run_id) ?? [];
        this.#draftsByRun.delete(e.payload.run_id);
        if (e.payload.status !== "done") return;
        const job = getJob(this.hub.db, e.payload.job_id);
        // the agent's answer to a message sent from Telegram goes back to Telegram
        if (job?.input.source === "telegram") {
          const out = this.hub.store.state.runs[e.payload.run_id]?.output?.trim();
          await this.notify(`${agentName()}: ${out || "(no answer)"}`);
        }
        for (const id of drafts.slice(0, DRAFT_CARDS_PER_RUN)) await this.#sendDraftCard(id, agentName());
        if (drafts.length > DRAFT_CARDS_PER_RUN) await this.notify(`📝 …and ${drafts.length - DRAFT_CARDS_PER_RUN} more drafts in Agent Office → Drafts.`);
        if (job && REPORT_JOB_TYPES.has(job.type)) {
          const out = this.hub.store.state.runs[e.payload.run_id]?.output?.trim();
          if (out) await this.notify(`📋 ${agentName()}: ${job.title}\n\n${out}`);
        }
        return;
      }
      case "skill.proposed":
        await this.notify(`🧠 ${agentName()} wants to ${e.payload.action} the skill "${e.payload.name}". Review it in Agent Office → Skills.`);
        return;
      case "budget.exceeded":
        await this.notify(`💤 ${agentName()} used today's token budget (${e.payload.used.toLocaleString("en")} / ${e.payload.budget.toLocaleString("en")}) and went home. Jobs wait until tomorrow or a higher budget.`);
        return;
      default:
        return;
    }
  }

  /** One draft with Approve / Reject. Approving a website post publishes it. */
  async #sendDraftCard(draftId: string, agentName: string): Promise<void> {
    const d = this.hub.db.select().from(contentDrafts).where(eq(contentDrafts.id, draftId)).get();
    if (!d || d.status !== "draft") return;
    const project = this.hub.db.select({ name: projects.name }).from(projects).where(eq(projects.id, d.project_id)).get();
    const web = d.kind === "web_post";
    const social = !web && this.hub.social.configured(d.platform, d.project_id) ? d.platform : null;
    const head = web ? `🌐 ${agentName} drafted a website post for ${project?.name ?? "a project"}` : `📝 ${agentName} drafted a ${d.platform} ${d.kind.replace(/_/g, " ")} for ${project?.name ?? "a project"}`;
    const meta = d.meta;
    const details = web && meta ? [meta.post_type, meta.event_date, meta.event_time, meta.location].filter(Boolean).join(" · ") : "";
    const text = [
      head,
      "",
      `「${d.title}」${details ? `\n${details}` : ""}${web && meta?.cover_upload_id ? "\n📷 with cover photo" : ""}`,
      "",
      d.body.length > 1500 ? `${d.body.slice(0, 1500)}…\n(full text in Agent Office → Drafts)` : d.body,
    ].join("\n");
    const video = meta?.video_upload_id ? this.hub.publisher.uploadFile(meta.video_upload_id) : null;
    if (video && video.row.size <= TG_SEND_MAX) await this.#sendVideo(video.file, video.row.name, `🎬 ${d.title}`).catch((err) => console.error("[telegram] video failed:", redactString(String(err))));
    else if (video) await this.notify(`🎬 The video is ${Math.round(video.row.size / 1024 ** 2)} MB, too big for Telegram (50 MB): watch it in Agent Office → Drafts.`);
    await this.notify(text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: web ? "✅ Approve & publish" : social ? `✅ Approve & post to ${social[0]!.toUpperCase()}${social.slice(1)}` : "✅ Approve", callback_data: this.draftCallbackData(draftId, "y") },
            { text: "❌ Reject", callback_data: this.draftCallbackData(draftId, "n") },
          ],
        ],
      },
    });
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
    if (u.message) {
      const msg = u.message;
      const chat = String(msg.chat.id);
      const text = (msg.text ?? msg.caption ?? "").trim();
      const cmd = text.startsWith("/") ? text.split(/\s+/)[0]!.toLowerCase().replace(/@\w+$/, "") : "";
      // Anyone may ask for their chat id (needed for setup); nothing else is answered for strangers.
      if (cmd === "/start" || cmd === "/id") {
        await this.#call(token, "sendMessage", { chat_id: chat, text: `Your chat id is ${chat}. Paste it in Agent Office → Settings → Integrations → Telegram.` });
        return;
      }
      if (chat !== owner) return;
      if (cmd) return this.#command(cmd, text.slice(cmd.length).trim());
      const file = fileOf(msg);
      if (file && msg.media_group_id) return this.#collectAlbum(token, msg, file);
      if (file || text) await this.#toAgent(token, text, file ? [file] : []);
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
    if (parsed.kind === "draft") return this.#decideDraft(token, cq.id, cq.message, parsed.id, parsed.yes);
    let reply: string;
    try {
      this.hub.decideApproval(parsed.id, parsed.yes ? "approved" : "rejected", "telegram");
      reply = parsed.yes ? "✅ Approved" : "❌ Rejected";
    } catch (err) {
      reply = `Not changed: ${(err as Error).message}`;
    }
    this.#approvalMessages.delete(parsed.id);
    await this.#call(token, "answerCallbackQuery", { callback_query_id: cq.id, text: reply }).catch(() => {});
    if (cq.message) {
      const action = this.hub.db.select({ action: approvals.action }).from(approvals).where(eq(approvals.id, parsed.id)).get()?.action ?? "";
      await this.#call(token, "editMessageText", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: clip(`${reply} (Telegram)\n\n${action}`) }).catch(() => {});
    }
  }

  async #decideDraft(token: string, callbackId: string, message: { message_id: number; chat: { id: number } } | undefined, draftId: string, yes: boolean): Promise<void> {
    let reply: string;
    try {
      const draft = this.hub.content.decideDraft(draftId, yes ? { decision: "approve" } : { decision: "reject" });
      if (!yes) reply = "❌ Rejected";
      else {
        // website posts are published, Facebook captions posted (when a Page is connected)
        const after = await this.hub.afterApprove(draft);
        if (after.published_url?.startsWith("http")) reply = `✅ Published: ${after.published_url}`;
        else if (after.publish_error) reply = `⚠️ Approved, but not published: ${after.publish_error}. Use "Publish again" in Agent Office → Drafts.`;
        else reply = "✅ Approved (copy it from Agent Office → Drafts)";
      }
    } catch (err) {
      reply = `Not changed: ${(err as Error).message}`;
    }
    await this.#call(token, "answerCallbackQuery", { callback_query_id: callbackId, text: reply.slice(0, 190) }).catch(() => {});
    if (message) {
      await this.#call(token, "editMessageReplyMarkup", { chat_id: message.chat.id, message_id: message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      await this.notify(reply, { reply_to_message_id: message.message_id });
    }
  }

  // ---------------------------------------------------------------- chatting with an agent

  #chatState(): TgChat {
    const row = this.hub.db.select().from(settings).where(eq(settings.key, CHAT_KEY)).get();
    const v = (row?.value ?? {}) as Partial<TgChat>;
    return { agent_id: v.agent_id ?? null, thread_id: v.thread_id ?? null, project_id: v.project_id ?? null };
  }

  #setChatState(next: TgChat): void {
    this.hub.db.insert(settings).values({ key: CHAT_KEY, value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next } }).run();
  }

  /** The agent to talk to: the chosen one, else Publisher, else the first enabled agent. */
  #agent(state: TgChat) {
    const enabled = this.hub.db.select().from(agents).where(eq(agents.enabled, true)).all();
    return enabled.find((a) => a.id === state.agent_id) ?? enabled.find((a) => a.slug === "publisher") ?? enabled[0] ?? null;
  }

  /** The project for this chat: the chosen one, else the only project whose website accepts posts. */
  #project(state: TgChat): string | null {
    if (state.project_id) return state.project_id;
    const withSite = this.hub.db.select({ id: projects.id, publish: projects.publish }).from(projects).where(eq(projects.enabled, true)).all().filter((p) => p.publish?.info);
    return withSite.length === 1 ? withSite[0]!.id : null;
  }

  async #command(cmd: string, arg: string): Promise<void> {
    const state = this.#chatState();
    const list = () => this.hub.db.select({ slug: agents.slug, name: agents.name, role: agents.role }).from(agents).where(eq(agents.enabled, true)).all();
    switch (cmd) {
      case "/status":
        await this.notify(this.#statusText());
        return;
      case "/new":
        this.#setChatState({ ...state, thread_id: null });
        await this.notify(`🆕 New conversation with ${this.#agent(state)?.name ?? "no agent"}.`);
        return;
      case "/agents":
        await this.notify(`Agents (switch with /agent <slug>):\n${list().map((a) => `• ${a.slug}: ${a.name}${a.role ? ` (${a.role})` : ""}`).join("\n")}`);
        return;
      case "/agent": {
        const a = this.hub.db.select().from(agents).where(and(eq(agents.slug, arg.toLowerCase()), eq(agents.enabled, true))).get();
        if (!a) {
          await this.notify(`No agent "${arg}". ${list().map((x) => x.slug).join(", ")}`);
          return;
        }
        this.#setChatState({ ...state, agent_id: a.id, thread_id: null });
        await this.notify(`💬 Now talking to ${a.name}. Send text or photos.`);
        return;
      }
      case "/project": {
        const all = this.hub.db.select({ id: projects.id, slug: projects.slug, name: projects.name }).from(projects).where(eq(projects.enabled, true)).all();
        const p = all.find((x) => x.slug === arg.toLowerCase());
        if (!p) {
          await this.notify(`Projects: ${all.map((x) => x.slug).join(", ") || "none"}. Use /project <slug>.`);
          return;
        }
        this.#setChatState({ ...state, project_id: p.id });
        await this.notify(`📁 Project set to ${p.name}.`);
        return;
      }
      default: {
        const a = this.#agent(state);
        await this.notify(
          [
            `💬 You are talking to ${a?.name ?? "no agent"}. Send text or photos (an album works too).`,
            "/agent <slug>: talk to another agent  ·  /agents: list them",
            "/project <slug>: which project posts are for",
            "/new: start a new conversation",
            "/status: what the office is doing",
          ].join("\n"),
        );
      }
    }
  }

  #collectAlbum(token: string, msg: TgMessage, file: InFile): void {
    const id = msg.media_group_id!;
    const cur = this.#albums.get(id);
    if (cur) clearTimeout(cur.timer);
    const album = cur ?? { files: [], caption: "", timer: setTimeout(() => {}, 0) };
    album.files.push(file);
    if (msg.caption) album.caption = msg.caption.trim();
    album.timer = setTimeout(() => {
      this.#albums.delete(id);
      void this.#toAgent(token, album.caption, album.files).catch((err) => console.error("[telegram] album failed:", redactString(String(err))));
    }, ALBUM_WAIT_MS);
    this.#albums.set(id, album);
  }

  /** Download the photos and videos, then send the message to the agent as a chat. */
  async #toAgent(token: string, text: string, files: InFile[]): Promise<void> {
    const state = this.#chatState();
    const agent = this.#agent(state);
    if (!agent) {
      await this.notify("No agent is enabled.");
      return;
    }
    try {
      const attachments: string[] = [];
      for (const f of files.slice(0, 10)) {
        if ((f.file_size ?? 0) > TG_DOWNLOAD_MAX) {
          await this.notify(`⚠️ ${f.name} is over 20 MB, and Telegram does not let bots download bigger files. Send it in Agent Office → Chat instead (up to 2 GB).`);
          continue;
        }
        const file = await this.#call<{ file_path?: string }>(token, "getFile", { file_id: f.file_id });
        if (!file.file_path) continue;
        const res = await freshFetch(`${this.apiBase}/file/bot${token}/${file.file_path}`, { timeoutMs: 5 * 60_000 });
        if (!res.ok) throw new Error(`could not download ${f.name} (${res.status})`);
        if (f.type.startsWith("image/")) {
          attachments.push(this.hub.publisher.saveUpload(file.file_path.split("/").pop() ?? f.name, f.type, new Uint8Array(await res.arrayBuffer())).id);
        } else {
          const tmp = join(this.hub.config.filesDir, "uploads", `tg-${randomUUID()}.part`);
          mkdirSync(dirname(tmp), { recursive: true });
          await Bun.write(tmp, res);
          attachments.push(this.hub.publisher.adoptUpload(f.name, f.type, tmp).id);
        }
      }
      if (!attachments.length && !text) return;
      const { thread_id } = this.hub.chat({
        agent_id: agent.id,
        text: text || (attachments.length ? "(sent files)" : ""),
        thread_id: state.thread_id,
        project_id: this.#project(state),
        attachments,
        source: "telegram",
      });
      if (thread_id !== state.thread_id) this.#setChatState({ ...state, agent_id: agent.id, thread_id });
      const cfg = this.integrations.telegram();
      if (cfg) await this.#call(token, "sendChatAction", { chat_id: cfg.chatId, action: "typing" }).catch(() => {});
    } catch (err) {
      await this.notify(`Could not send that to ${agent.name}: ${(err as Error).message}`);
    }
  }

  #statusText(): string {
    const s = this.hub.store.state;
    const all = Object.values(s.agents);
    const busy = all.filter((a) => a.activity === "working").length;
    const waiting = Object.keys(s.pending_approvals).length;
    const drafts = Object.keys(s.pending_drafts).length;
    const talking = this.#agent(this.#chatState());
    return `🏢 Agent Office${s.paused ? " (PAUSED)" : ""}\nWorking: ${busy}\nWaiting for you: ${waiting} approval${waiting === 1 ? "" : "s"}, ${drafts} draft${drafts === 1 ? "" : "s"}\nChatting with: ${talking?.name ?? "nobody"}`;
  }
}

/** The file in a message: a photo (largest size), a video, or a photo/video sent as a document. */
function fileOf(msg: TgMessage): InFile | null {
  if (msg.photo?.length) {
    const best = [...msg.photo].sort((a, b) => (b.file_size ?? b.width ?? 0) - (a.file_size ?? a.width ?? 0))[0]!;
    return { file_id: best.file_id, file_size: best.file_size, name: "photo.jpg", type: "image/jpeg" };
  }
  const f = msg.video ?? msg.document;
  const type = f?.mime_type ?? (msg.video ? "video/mp4" : "");
  if (!f || !(VIDEO_TYPES[type] || ["image/jpeg", "image/png", "image/webp"].includes(type))) return null;
  return { file_id: f.file_id, file_size: f.file_size, name: f.file_name ?? (type.startsWith("video/") ? `video.${VIDEO_TYPES[type]}` : "photo.jpg"), type };
}

const clip = (s: string) => (s.length > MESSAGE_MAX ? `${s.slice(0, MESSAGE_MAX)}…` : s);
