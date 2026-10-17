import { z } from "zod";
import { ToolDenied, defineTool } from "./types.ts";

export const handoffTool = defineTool({
  name: "handoff",
  description:
    "Give a follow-up job to another agent (e.g. Tester -> Coder with reproduction steps). " +
    "Include everything they need in `details`: what is wrong, where, how to reproduce, what you expected.",
  category: "notify",
  input: z.object({
    to_agent: z.string().min(1).describe("Slug of the agent to hand off to"),
    title: z.string().min(3).max(200),
    details: z.string().min(1).max(20_000),
    reason: z.string().min(1).max(500).describe("One line: why this needs the other agent"),
  }),
  risk: () => "safe",
  describe: (i) => `hand off to ${i.to_agent}: ${i.title}`,
  async execute(i, ctx) {
    const target = ctx.handoffTargets.find((t) => t.slug === i.to_agent);
    if (!target) {
      const names = ctx.handoffTargets.map((t) => t.slug).join(", ") || "none";
      throw new ToolDenied(`unknown or disabled agent "${i.to_agent}". Available: ${names}`);
    }
    ctx.handoff({ to_agent: target.slug, title: i.title, input: { text: i.details, from_agent: ctx.agent.slug }, reason: i.reason, project_id: ctx.projectId });
    return { ok: true, summary: `handed off to ${target.name}`, output: { queued: true, to: target.slug } };
  },
});
