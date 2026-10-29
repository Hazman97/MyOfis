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

