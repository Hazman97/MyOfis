import { readFile } from "node:fs/promises";
import { generateText } from "ai";
import { modelCandidates } from "@agent-office/shared";
import { activeModels, languageModel } from "./aiSdk.ts";
import type { RunContext } from "./types.ts";

/** Tokens spent on picture descriptions during a run (added to the run's total by the AI SDK runtime). */
export const visionUsage = new WeakMap<RunContext, { in: number; out: number }>();

/**
 * Ask the run's own model what some pictures show (clip_library describes each new clip once from
 * three thumbnails). canopy-ai (Gemma on the L4) reads images. Returns "" when the model cannot see,
 * or with the mock provider (tests), so callers just go on without a description.
 */
export async function describeImages(ctx: RunContext, paths: string[], prompt: string): Promise<string> {
  const { provider, agent, job } = ctx.assignment;
  if (provider.kind === "mock" || !paths.length) return "";
  try {
    const images = await Promise.all(paths.slice(0, 4).map(async (p) => ({ type: "file" as const, data: new Uint8Array(await readFile(p)), mediaType: "image/jpeg" })));
    const r = await generateText({
      model: languageModel(provider, activeModels.get(ctx) ?? modelCandidates(agent.model, provider.models)[0] ?? agent.model, job.input),
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...images] }],
      maxOutputTokens: 600,
      abortSignal: ctx.signal,
    });
    const u = visionUsage.get(ctx) ?? { in: 0, out: 0 };
    visionUsage.set(ctx, { in: u.in + (r.totalUsage.inputTokens ?? 0), out: u.out + (r.totalUsage.outputTokens ?? 0) });
    return r.text.trim().slice(0, 1200);
  } catch {
    return "";
  }
}
