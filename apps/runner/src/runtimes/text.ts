import type { RunContext } from "./types.ts";

/**
 * The text an agent works on: `input.text`, falling back to the job title.
 * Chat jobs carry the earlier messages of the thread in `input.history`.
 */
export function jobText(ctx: RunContext): string {
  const { input, title } = ctx.assignment.job;
  const base = typeof input.text === "string" && input.text.trim() ? input.text : title;
  // data the hub gathered for this job (e.g. the morning briefing's facts): the only facts to use
  const t = input.facts && typeof input.facts === "object" ? `${base}\n\nFacts from the hub (use only these):\n${JSON.stringify(input.facts, null, 1).slice(0, 12_000)}` : base;
  const history = Array.isArray(input.history) ? (input.history as { role?: unknown; text?: unknown }[]) : [];
  const lines = history
    .filter((m) => typeof m.text === "string" && m.text.trim())
    .map((m) => `${m.role === "agent" ? "You" : "Owner"}: ${String(m.text).trim()}`);
  if (!lines.length) return t;
  return `Chat with the owner so far (oldest first):\n${lines.join("\n\n")}\n\nOwner (new message): ${t}`;
}

/**
 * Batches streamed text into `agent.message` chunks (every ~250 ms) so the
 * event log is not flooded with one event per token.
 */
export class MessageStreamer {
  #buffer = "";
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctx: RunContext,
    private readonly messageId: string,
    private readonly flushMs = 250,
  ) {}

  push(text: string): void {
    this.#buffer += text;
    this.#timer ??= setTimeout(() => this.flush(false), this.flushMs);
  }

  flush(final: boolean): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (!this.#buffer && !final) return;
    this.ctx.emit({ type: "agent.message", payload: { message_id: this.messageId, text: this.#buffer, final } });
    this.#buffer = "";
  }
}
