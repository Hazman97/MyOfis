import { CONTENT_TOOLS, addFeatureNoteTool } from "./content.ts";
import { editFileTool, listDirTool, readFileTool, writeFileTool } from "./fs.ts";
import { GIT_TOOLS } from "./git.ts";
import { GITEA_TOOLS } from "./gitea.ts";
import { consultTool, handoffTool } from "./handoff.ts";
import { LEARNING_TOOLS } from "./memory.ts";
import { runCommandTool } from "./shell.ts";
import { WEB_TOOLS } from "./web.ts";
import { RESEARCH_TOOLS } from "./research.ts";
import { VIDEO_TOOLS } from "./video.ts";
import type { ToolDef } from "./types.ts";

export * from "./types.ts";
export * from "./safety.ts";
export { runTool, sanitizeArgs } from "./run.ts";
export { execArgv } from "./shell.ts";
export { GiteaClient } from "./gitea.ts";
export { checkUrl } from "./web.ts";
export { htmlToText, isPrivateAddress } from "./research.ts";
export { gitDefaultBranch, giteaRepoOf } from "./git.ts";
export { buildEditArgs, captionsAss, clipLengths, parseProbe, EditPlan } from "./video.ts";

/** Every tool an agent can be granted, by name. Agents list the names they may use in `agents.tools`. */
export const TOOL_REGISTRY: Record<string, ToolDef> = Object.fromEntries(
  [
    readFileTool,
    listDirTool,
    writeFileTool,
    editFileTool,
    runCommandTool,
    ...GIT_TOOLS,
    ...GITEA_TOOLS,
    handoffTool,
    consultTool,
    ...WEB_TOOLS,
    ...CONTENT_TOOLS,
    addFeatureNoteTool,
    ...LEARNING_TOOLS,
    ...RESEARCH_TOOLS,
    ...VIDEO_TOOLS,
  ].map((t) => [t.name, t as unknown as ToolDef]),
);

/** Tools that need the Gitea token (git push/clone to Gitea, Gitea API). */
export const NEEDS_GITEA = new Set(["git_clone", "git_push", ...GITEA_TOOLS.map((t) => t.name)]);

/** Tools that read briefs / feature log / past drafts: the hub sends project context only to agents that have one. */
export const NEEDS_PROJECT_CONTEXT = new Set(CONTENT_TOOLS.map((t) => t.name));

/** A `feature_note` job runs with exactly these tools, whatever the agent normally has (check CI, then write the note). */
export const FEATURE_NOTE_TOOLS = ["gitea_ci_status", "add_feature_note"];
