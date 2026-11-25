import { DIRECT_JOBS, HD_TARGETS, VIDEO_TYPES, type HdTarget } from "@agent-office/shared";
import { TOOL_REGISTRY, runTool } from "@agent-office/tools";
import { MessageStreamer } from "./text.ts";
import { makeToolContext } from "./toolContext.ts";
import type { AgentRuntime, RunContext, RunResult } from "./types.ts";

/**
 * No LLM: the Video Studio's buttons run one tool with the owner's input. 0 tokens.
 * - `video_render` (input `{ plan, attachments }`): video_edit renders the plan exactly as edited,
 *   uploads the result and the hub swaps it into the draft.
 * - `video_transcribe` (input `{ attachments }`): video_transcribe runs whisper on every video.
 */
export const directRuntime: AgentRuntime = {
  id: "direct",
  async execute(ctx: RunContext): Promise<RunResult> {
    const { job, agent } = ctx.assignment;
    const tool = DIRECT_JOBS[job.type];
    const def = tool ? TOOL_REGISTRY[tool] : undefined;
    if (!tool || !def || !agent.tools.includes(tool)) throw new Error(`this job needs the ${tool ?? "?"} tool`);
    const toolCtx = makeToolContext(ctx);
    const msg = new MessageStreamer(ctx, "m1");
    if (tool === "video_transcribe") {
      const done: string[] = [];
      for (const [i, a] of toolCtx.attachments.entries()) {
        if (!VIDEO_TYPES[a.content_type]) continue;
        const out = await runTool(def, { video: i + 1 }, toolCtx);
        if (!out.ok) throw new Error(out.summary);
        done.push(out.summary);
      }
      if (!done.length) throw new Error("no video to transcribe");
      msg.push(`Transcribed: ${done.join("; ")}.`);
    } else if (tool === "video_hd" || tool === "video_tiktok_hd") {
      const n = toolCtx.attachments.findIndex((a) => !!VIDEO_TYPES[a.content_type]);
      if (n < 0) throw new Error("no video to prepare");
      const target: HdTarget = tool === "video_tiktok_hd" ? "tiktok" : ((job.input.target as HdTarget | undefined) ?? "tiktok");
      const args = tool === "video_hd" ? { video: n + 1, target, mode: job.input.mode ?? "auto" } : { video: n + 1, mode: job.input.mode ?? "auto" };
      const out = await runTool(def, args, toolCtx);
      if (!out.ok) throw new Error(out.summary);
      const o = out.output as {
        mode: string;
        reasons: string[];
        warnings?: string[];
        files?: { part?: number; parts?: number }[];
        before: { size: string; fps: number; mb: number };
        after: { size: string; fps: number; mb: number };
      };
      const label = HD_TARGETS[target].label;
      const partNote = o.files && o.files.length > 1 ? ` (${o.files.length} parts)` : "";
      const how =
        target === "tiktok"
          ? o.mode === "remux"
            ? "No re-encode: the picture is untouched, only the file was cleaned up for TikTok."
            : `Re-encoded once to TikTok's spec because: ${o.reasons.join("; ")}.`
          : o.mode === "remux"
            ? `Ready for ${label}${partNote} (no re-encode: the picture is untouched).`
            : `Ready for ${label}${partNote} (re-encoded once because: ${o.reasons.join("; ")}).`;
      const warnLine = o.warnings?.length ? `\nWarnings: ${o.warnings.join("; ")}` : "";
      msg.push(`${how}\nBefore: ${o.before.size}, ${o.before.fps} fps, ${o.before.mb} MB. After: ${o.after.size}, ${o.after.fps} fps, ${o.after.mb} MB.${warnLine}`);
    } else if (tool === "design_render" || tool === "image_generate") {
      const out = await runTool(def, job.input.params ?? job.input, toolCtx);
      if (!out.ok) throw new Error(out.summary);
      msg.push(JSON.stringify(out.output));
    } else {
      const out = await runTool(def, job.input.plan, toolCtx);
      if (!out.ok) throw new Error(out.summary);
      msg.push(`Done: ${out.summary}. The new video is in the Video Studio${job.input.draft_id ? " and on the draft" : ""}.`);
    }
    msg.flush(true);
    return { tokens_in: 0, tokens_out: 0 };
  },
};
