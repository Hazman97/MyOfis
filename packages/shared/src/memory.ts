import { z } from "zod";
import { redactString } from "./redact.ts";

/**
 * Agent memory, modelled on Hermes Agent: two bounded stores that are injected
 * into the prompt at the start of every run (a frozen snapshot).
 * - "memory": the agent's own notes (environment facts, lessons). One per agent.
 * - "user": the owner's profile (preferences, style). Shared by every agent.
 * Agents add, patch and remove entries; when a store is full they must
 * consolidate (shorten or merge) in one batch. Nothing is auto-summarised.
 */
export const MEMORY_LIMITS = { memory: 2200, user: 1375 } as const;
export type MemoryTarget = keyof typeof MEMORY_LIMITS;
export const ENTRY_SEPARATOR = "\n§\n";

export const MemoryOp = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), content: z.string().trim().min(3).max(1000) }),
  z.object({
    action: z.literal("patch"),
    old_text: z.string().min(1).max(1000).describe("A span that occurs exactly once in one entry"),
    content: z.string().max(1000).describe("What replaces old_text (may be empty)"),
  }),
  z.object({ action: z.literal("remove"), old_text: z.string().min(1).max(1000).describe("A unique substring of the entry to delete") }),
]);
export type MemoryOp = z.infer<typeof MemoryOp>;

export const usedChars = (entries: string[]) => entries.reduce((n, e) => n + e.length, 0) + Math.max(0, entries.length - 1) * ENTRY_SEPARATOR.length;

const INJECTION = [
  /ignore (all |any )?(previous|prior|above) (instructions|rules)/i,
  /disregard (the|your) (system|previous) (prompt|instructions)/i,
  /you are now /i,
  /system prompt/i,
  /<\/?(system|assistant|instructions)>/i,
];
// zero-width and bidi control characters hide text from the owner
const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿]/;

/** Why `text` may not be stored, or null when it is fine. */
export function memoryContentProblem(text: string): string | null {
  if (INVISIBLE.test(text)) return "contains invisible characters";
  if (INJECTION.some((r) => r.test(text))) return "looks like an instruction to the model (prompt injection)";
  if (redactString(text) !== text) return "looks like it contains a secret (token, key or password)";
  if (/https?:\/\/[^\s]*[?&](token|key|secret|sig|password)=/i.test(text)) return "contains a URL with credentials";
  return null;
}

export type MemoryResult = { ok: true; entries: string[] } | { ok: false; error: string; entries: string[]; used: number; limit: number };

/**
 * Apply a batch of operations. All or nothing: any failing op, or a result
 * over the limit, leaves `entries` unchanged and explains why (with the
 * current entries, so the agent can consolidate in its next call).
 */
export function applyMemoryOps(entries: string[], ops: MemoryOp[], limit: number): MemoryResult {
  const next = [...entries];
  const fail = (error: string): MemoryResult => ({ ok: false, error, entries, used: usedChars(entries), limit });
  for (const op of ops) {
    if (op.action === "add") {
      const content = op.content.trim();
      const problem = memoryContentProblem(content);
      if (problem) return fail(`not saved: ${problem}`);
      if (next.includes(content)) return fail("that exact entry already exists");
      next.push(content);
      continue;
    }
    const hits = next.map((e, i) => [e, i] as const).filter(([e]) => e.includes(op.old_text));
    if (hits.length === 0) return fail(`no entry contains "${op.old_text.slice(0, 60)}"`);
    if (hits.length > 1) return fail(`"${op.old_text.slice(0, 60)}" matches ${hits.length} entries; use a longer, unique span`);
    const [entry, i] = hits[0]!;
    if (op.action === "remove") {
      next.splice(i, 1);
      continue;
    }
    if (entry.split(op.old_text).length !== 2) return fail("old_text must occur exactly once in the entry");
    const patched = entry.replace(op.old_text, op.content).trim();
    const problem = memoryContentProblem(patched);
    if (problem) return fail(`not saved: ${problem}`);
    if (patched) next[i] = patched;
    else next.splice(i, 1);
  }
  const used = usedChars(next);
  if (used > limit) {
    return fail(`over the limit: ${used}/${limit} characters. In ONE call, remove or shorten old entries (merge related ones) and add the new one.`);
  }
  return { ok: true, entries: next };
}

/** The frozen snapshot as it appears in the system prompt. */
export function memoryPromptSection(title: string, entries: string[], limit: number): string {
  const used = usedChars(entries);
  const pct = Math.round((used / limit) * 100);
  const body = entries.length ? entries.join(ENTRY_SEPARATOR) : "(empty)";
  return `## ${title} [${pct}% — ${used}/${limit} chars]\n${body}`;
}
