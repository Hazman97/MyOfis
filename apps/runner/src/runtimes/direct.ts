import { DIRECT_JOBS, VIDEO_TYPES } from "@agent-office/shared";
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
    } else {
      const out = await runTool(def, job.input.plan, toolCtx);
      if (!out.ok) throw new Error(out.summary);
      msg.push(`Done: ${out.summary}. The new video is in the Video Studio${job.input.draft_id ? " and on the draft" : ""}.`);
    }
    msg.flush(true);
    return { tokens_in: 0, tokens_out: 0 };
  },
};
