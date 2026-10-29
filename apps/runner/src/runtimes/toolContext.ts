import type { ToolContext } from "@agent-office/tools";
import { describeImages } from "./vision.ts";
import type { RunContext } from "./types.ts";

/** The ToolContext our own tools run with, built from a run. Shared by every runtime. */
export function makeToolContext(ctx: RunContext): ToolContext {
  const { agent } = ctx.assignment;
  // clip_library adds files to this list while the run works
  const attachments = attachmentsOf(ctx.assignment.job.input);
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
    // a copy: the memory tool updates it as the run goes, the assignment stays the frozen snapshot
    memoryStores: { memory: [...ctx.assignment.memory.memory], user: [...ctx.assignment.memory.user] },
    memoryWriteApproval: ctx.assignment.memory_write_approval,
    saveMemory: (target, ops) => ctx.saveMemory(target, ops),
    skills: ctx.assignment.skills,
    proposeSkill: (p) => ctx.proposeSkill(p),
    searchSessions: (q, all) => ctx.searchSessions(q, all),
    webSearch: (q, n) => ctx.webSearch(q, n),
    consult: (to, q, ms) => ctx.consult(to, q, ms),
    attachments,
    clipAttach: async (path, name, type, uploadId) => {
      const a = await ctx.clipAttach(path, name, type, uploadId);
      if (!attachments.some((x) => x.id === a.id)) attachments.push({ id: a.id, name: a.name, content_type: a.content_type });
      return { ...a, number: attachments.findIndex((x) => x.id === a.id) + 1 };
    },
    describeImages: (paths, prompt) => describeImages(ctx, paths, prompt),
    downloadAttachment: (id, dest) => ctx.downloadUpload(id, dest),
    uploadVideo: (path, name, render) => ctx.uploadVideo(path, name, render),
    renders: [],
    projectData: (action, params) => ctx.projectData(action, params),
    videoData: (action, params) => ctx.videoData(action, params),
    siteData: (p, r, params) => ctx.siteData(p, r, params),
    webPost: (a, id, edits) => ctx.webPost(a, id, edits),
    tts: (text, voice) => ctx.tts(text, voice),
  };
}

/** Photos and videos the owner sent with a chat message (`input.attachments`, set by the hub). */
export function attachmentsOf(input: Record<string, unknown>): { id: string; name: string; content_type: string; doc_id?: string; pages?: number }[] {
  if (!Array.isArray(input.attachments)) return [];
  return input.attachments.filter(
    (a): a is { id: string; name: string; content_type: string; doc_id?: string; pages?: number } =>
      !!a && typeof a === "object" && typeof (a as { id?: unknown }).id === "string" && typeof (a as { content_type?: unknown }).content_type === "string",
  );
}
