import type { ToolContext } from "@agent-office/tools";
import type { RunContext } from "./types.ts";

/** The ToolContext our own tools run with, built from a run. Shared by every runtime. */
export function makeToolContext(ctx: RunContext): ToolContext {
  const { agent } = ctx.assignment;
  return {
    workspace: ctx.workspace,
    config: agent.config,
    permissionLevel: agent.permission_level,
    signal: ctx.signal,
    requestApproval: (req) => ctx.requestApproval(req),
    emit: ctx.emit,
    agent: { slug: agent.slug, name: agent.name },
    gitea: ctx.assignment.gitea,
    handoffTargets: ctx.assignment.handoff_targets,
    handoff: (req) => ctx.handoff(req),
    projectId: ctx.assignment.job.project_id,
    baselineDir: ctx.baselineDir,
    uploadArtifact: (name, data, type) => ctx.uploadArtifact(name, data, type),
    projectContext: ctx.assignment.project_context,
    saveDraft: (d) => ctx.saveDraft(d),
    addFeatureNote: (f) => ctx.addFeatureNote(f),
  };
}
