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
  video_hd: "ffmpeg",
  motion_render: "hyperframes",
  clip_find: "ffmpeg",
  clip_render: "ffmpeg",
  explainer_render: "ffmpeg",
  clip_library: "ffmpeg",
  music_beats: "ffmpeg",
  montage_plan: "ffmpeg",
  openchatcut: "openchatcut",
  openchatcut_import: "openchatcut",
  git_clone: "git",
  git_status: "git",
  git_branch: "git",
  git_commit: "git",
  git_diff: "git",
  git_push: "git",
  browser_check: "node",
  design_render: "node",
  image_generate: "comfyui",
};

/** The tools a job runs: a Video Studio job only its one tool, otherwise every tool of the agent. */
export function jobTools(input: { tools: readonly string[]; job_type?: string }): string[] {
  const direct = input.job_type ? DIRECT_JOBS[input.job_type] : undefined;
  return direct ? [direct] : [...input.tools];
}

/**
 * Whether a runner's code has every tool: true / false from its reported list, null for an old
 * runner that reports none (unknown).
 */
export function runnerKnowsTools(reported: readonly string[] | undefined | null, tools: readonly string[]): boolean | null {
  if (!reported) return null;
  return tools.every((t) => reported.includes(t));
}

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
