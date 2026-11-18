import type { JobStatus, JobView, RunView } from "@agent-office/shared";
import type { ChatAttachment, ChatMessage } from "../api/http.ts";

/** OpenChatCut editor links in a reply, cleaned to the exact project URL. */
export const OCC_LINK =
  /https?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}\/#\/editor\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export const extractOccLinks = (text: string): string[] => [...new Set(text.match(OCC_LINK) ?? [])];

/**
 * Escape raw HTML, then render lightweight safe markdown (bold, inline code, bullets)
 * and LaTeX-style arrows that some models generate.
 */
export function formatLiteMarkdown(text: string): string {
  if (!text) return "";
  const esc = text
    .replace(/\$\\(?:rightarrow|to|Rightarrow|longrightarrow)\$/g, "→")
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return esc
    .replace(/^\s*[*-]\s+/gm, "• ")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
}

/** The part worth reading aloud: the coach's conversational reply, not the correction notes. */
export function extractSpeakableText(text: string): string {
  if (!text) return "";
  return text.split(/\n\s*(?:\*\*)?(?:More natural|Useful phrase)\b/i)[0]!.trim();
}

/** Attachment type helpers */
export const isVideoAttachment = (a: { content_type: string }): boolean => a.content_type.startsWith("video/");
export const isAudioAttachment = (a: { content_type: string }): boolean => a.content_type.startsWith("audio/");
export const isDocAttachment = (a: { content_type: string }): boolean =>
  !isVideoAttachment(a) && !isAudioAttachment(a) && !a.content_type.startsWith("image/");

/** Checks if an agent can be chatted with (enabled and not an external runner agent). */
export function isChattableAgent(a: { enabled: boolean; config?: { external?: boolean } }): boolean {
  return a.enabled && !a.config?.external;
}

export interface LiveMessageResult {
  reply: string;
  status: JobStatus;
  error: string | null;
  runId: string | null;
  isThinking: boolean;
}

/** Live reply for a message: the run's streamed text from the event store. */
export function liveMessageState(
  jobs: Record<string, JobView | undefined>,
  runs: Record<string, RunView | undefined>,
  m: ChatMessage,
): LiveMessageResult {
  const job = jobs[m.job_id];
  const runId = job?.run_ids.at(-1) ?? m.run_id;
  const run = runId ? runs[runId] : undefined;
  const status: JobStatus = job?.status ?? m.status;
  const reply = run?.output?.trim() || m.reply || "";
  const error = run?.error ?? null;
  const isThinking = status === "running" && !reply;
  return { reply, status, error, runId, isThinking };
}

/**
 * Strips markdown and clean trims text for office speech bubbles (~60 characters).
 */
export function clipSpeechBubble(text: string, maxChars = 60): string {
  if (!text) return "";
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars - 1).trimEnd()}…`;
}

/** Read a boolean flag ("true" / "false") from storage safely. */
export function readStoredBool(
  storage: Pick<Storage, "getItem"> | null | undefined,
  key: string,
): boolean | null {
  try {
    const v = storage?.getItem(key);
    if (v === "true") return true;
    if (v === "false") return false;
    return null;
  } catch {
    return null;
  }
}

/** Resolve initial open state: explicit prop wins when defined, else stored value, else false. */
export function resolveInitialDockOpen(propOpen: boolean | undefined, storedOpen: boolean | null): boolean {
  return propOpen ?? storedOpen ?? false;
}

/**
 * Fetch messages for a thread, apply them to state, and invoke `onReady` strictly AFTER
 * messages are applied (so scroll-to-bottom sees the loaded messages).
 */
export async function fetchAndOpenThread(
  id: string | null,
  fetchThread: (id: string) => Promise<ChatMessage[]>,
  apply: (messages: ChatMessage[]) => void,
  onReady?: (id: string | null) => void,
): Promise<string | null> {
  if (!id) {
    apply([]);
    onReady?.(id);
    return null;
  }
  try {
    const msgs = await fetchThread(id);
    apply(msgs);
    return null;
  } catch (e) {
    apply([]);
    return (e as Error).message;
  } finally {
    onReady?.(id);
  }
}

export interface ReplySnapshot {
  threadKey: string;
  replies: Record<string, string>;
}

/**
 * Detect whether a real reply arrived for an existing user message in the same thread,
 * without triggering false unread indicators on initial load or agent/thread switches.
 */
export function detectNewReply(
  prev: ReplySnapshot | null,
  threadKey: string,
  items: { job_id: string; reply: string }[],
  loading: boolean,
): { next: ReplySnapshot | null; hasNewReply: boolean } {
  if (loading) return { next: prev, hasNewReply: false };
  const replies: Record<string, string> = {};
  for (const item of items) {
    replies[item.job_id] = item.reply.trim();
  }
  const next: ReplySnapshot = { threadKey, replies };
  if (!prev || prev.threadKey !== threadKey) {
    return { next, hasNewReply: false };
  }
  for (const item of items) {
    const curr = replies[item.job_id]!;
    const old = prev.replies[item.job_id];
    if (curr && old === "") {
      return { next, hasNewReply: true };
    }
  }
  return { next, hasNewReply: false };
}

