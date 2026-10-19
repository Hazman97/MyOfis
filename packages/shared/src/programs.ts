/**
 * Which helper programs a job needs on the runner PC, worked out from the agent's tools.
 * The hub sends such a job to a runner that reported them (`capabilities.programs`).
 */
const TOOL_PROGRAMS: Record<string, string> = {
  video_probe: "ffmpeg",
  video_edit: "ffmpeg",
  git_clone: "git",
  git_status: "git",
  git_branch: "git",
  git_commit: "git",
  git_diff: "git",
  git_push: "git",
  browser_check: "node",
};

export function requiredPrograms(input: { tools: readonly string[]; runtime?: string; job_type?: string }): string[] {
  // a Video Studio re-render runs only video_edit
  const tools = input.job_type === "video_render" ? ["video_edit"] : input.tools;
  const need = new Set(tools.map((t) => TOOL_PROGRAMS[t]).filter((p): p is string => !!p));
  if (input.runtime === "opencode" && input.job_type !== "feature_note" && input.job_type !== "video_render") need.add("opencode");
  return [...need].sort();
}
