import { TOOL_REGISTRY, runTool } from "@agent-office/tools";
import { MessageStreamer } from "./text.ts";
import { makeToolContext } from "./toolContext.ts";
import type { AgentRuntime, RunContext, RunResult } from "./types.ts";

/**
 * No LLM: runs one tool with the input the owner gave. Used by the Video Studio's "Render again"
 * (job type `video_render`, input `{ plan, attachments }`): the video_edit tool renders the plan
 * exactly as edited, uploads the result and the hub swaps it into the draft. 0 tokens.
 */
export const directRuntime: AgentRuntime = {
  id: "direct",
  async execute(ctx: RunContext): Promise<RunResult> {
    const def = TOOL_REGISTRY.video_edit;
    if (!def || !ctx.assignment.agent.tools.includes("video_edit")) throw new Error("this job needs the video_edit tool");
    const out = await runTool(def, ctx.assignment.job.input.plan, makeToolContext(ctx));
    if (!out.ok) throw new Error(out.summary);
    const msg = new MessageStreamer(ctx, "m1");
    msg.push(`Done: ${out.summary}. The new video is in the Video Studio${ctx.assignment.job.input.draft_id ? " and on the draft" : ""}.`);
    msg.flush(true);
    return { tokens_in: 0, tokens_out: 0 };
  },
};
