import { DIRECT_JOBS } from "./video.ts";

/**
 * Which helper programs a job needs on the runner PC, worked out from the agent's tools.
 * The hub sends such a job to a runner that reported them (`capabilities.programs`).
 */
const TOOL_PROGRAMS: Record<string, string> = {
  video_probe: "ffmpeg",
  video_index: "ffmpeg",
  video_review: "ffmpeg",
  video_transcribe: "whisper",
  meeting_transcribe: "whisper",
  video_edit: "ffmpeg",
  video_tiktok_hd: "ffmpeg",
  motion_render: "hyperframes",
  clip_library: "ffmpeg",
  openchatcut: "openchatcut",
  openchatcut_import: "openchatcut",
  git_clone: "git",
  git_status: "git",
  git_branch: "git",
  git_commit: "git",
  git_diff: "git",
  git_push: "git",
  browser_check: "node",
};

export function requiredPrograms(input: { tools: readonly string[]; runtime?: string; job_type?: string }): string[] {
  // a Video Studio job (render, transcribe) runs only its one tool
  const direct = input.job_type ? DIRECT_JOBS[input.job_type] : undefined;
  const tools = direct ? [direct] : input.tools;
  const need = new Set(tools.map((t) => TOOL_PROGRAMS[t]).filter((p): p is string => !!p));
  if (input.runtime === "opencode" && input.job_type !== "feature_note" && !direct) need.add("opencode");
  // transcribing reads the sound out with ffmpeg first; motion_render also uses ffmpeg
  if (need.has("whisper") || need.has("hyperframes")) need.add("ffmpeg");
  return [...need].sort();
}
