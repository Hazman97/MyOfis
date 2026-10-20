import type { OfficeState } from "@agent-office/shared";

/**
 * What a job is doing right now, in plain words, from the office state (owner request: "not just
 * 'pending' — show if it is queued, running, stuck or failed, and why"). Pure, so it is tested.
 */
export type RunPhase = "queued" | "running" | "waiting_approval" | "quiet" | "done" | "failed" | "cancelled";

export interface RunStatus {
  phase: RunPhase;
  /** One short line for the owner, e.g. "Rendering tiktok_fhd: 40%". */
  label: string;
  /** More detail when useful: why it waits, who holds the runner, the error. */
  detail: string | null;
  /** Place in the queue (1 = next) while queued. */
  position: number | null;
  /** Seconds since the run started (running) or since the job was created (queued). */
  seconds: number;
  /** Tool calls so far (running). */
  steps: number;
  /** Seconds since the run last sent anything (running). */
  silent_for: number;
  run_id: string | null;
  /** The owner can stop it. */
  can_stop: boolean;
  /** The owner can send it again. */
  can_retry: boolean;
}

/** A running job that sends nothing for this long is shown as "quiet" (maybe stuck). */
export const QUIET_AFTER_S = 120;

/** Friendly names for tools while they run. */
const TOOL_LABEL: Record<string, string> = {
  video_probe: "Looking at the video",
  video_transcribe: "Transcribing the speech",
  video_edit: "Rendering the video",
  suggest_edits: "Preparing edit options",
  clip_library: "Picking clips",
  openchatcut: "Working in OpenChatCut",
  openchatcut_import: "Importing into OpenChatCut",
  save_draft: "Saving the draft",
  draft_web_post: "Writing the website post",
  web_search: "Searching the web",
  web_fetch: "Reading a web page",
  read_brief: "Reading the brief",
  read_past_drafts: "Reading past drafts",
  doc_read: "Reading a document",
  docs_search: "Searching documents",
  consult_agent: "Asking a colleague",
  consult_team: "Asking the team",
  memory: "Updating its notes",
  skill_view: "Reading a skill",
  run_command: "Running a command",
  read_file: "Reading a file",
  write_file: "Writing a file",
  browser_check: "Checking in the browser",
};

const secs = (from: string | undefined, now: number) => (from ? Math.max(0, Math.round((now - Date.parse(from)) / 1000)) : 0);

/** "1m 05s", "42s", "1h 02m". */
export function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

export function stepLabel(step: string | null | undefined): string {
  if (!step) return "Thinking";
  if (step.startsWith("tool:")) {
    const t = step.slice(5);
    return TOOL_LABEL[t] ?? `Using ${t.replace(/_/g, " ")}`;
  }
  return step.replace(/^Working on ".*" with .*$/, "Starting");
}

export function runStatus(state: OfficeState, jobId: string, now = Date.now()): RunStatus {
  const job = state.jobs[jobId];
  const base = { position: null, seconds: 0, steps: 0, silent_for: 0, run_id: null, can_stop: false, can_retry: false };
  if (!job) return { ...base, phase: "queued", label: "Sending…", detail: null };
  const runId = job.run_ids.at(-1) ?? null;
  const run = runId ? state.runs[runId] : undefined;

  if (job.status === "queued") {
    const queued = Object.values(state.jobs)
      .filter((j) => j.status === "queued")
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    const position = queued.findIndex((j) => j.id === jobId) + 1 || null;
    const online = Object.values(state.runners).filter((r) => r.online);
    const busy = Object.values(state.runs).filter((r) => r.status === "running");
    let detail: string;
    if (state.paused) detail = "All agents are paused. Resume them in the sidebar.";
    else if (!online.length) detail = "No runner is online. Start it on your PC: bun run dev:runner";
    else if (state.agents[job.agent_id]?.activity === "away") detail = "This agent has used today's token budget: it waits until tomorrow (or raise its budget).";
    else if (busy.length) {
      const b = busy.sort((a, c) => a.started_at.localeCompare(c.started_at))[0]!;
      const holder = state.jobs[b.job_id];
      detail = `The runner is busy with "${holder?.title.slice(0, 50) ?? "another job"}" (${fmtDuration(secs(b.started_at, now))}).`;
    } else detail = "Starting soon.";
    return { ...base, phase: "queued", label: position && position > 1 ? `In the queue: number ${position}` : "Next in line", detail, position, seconds: secs(job.created_at, now), can_stop: true };
  }

  if (job.status === "running" || job.status === "waiting_approval") {
    const steps = run?.tool_calls ?? 0;
    const seconds = secs(run?.started_at, now);
    const silent = secs(run?.last_event_at ?? run?.started_at, now);
    const common = { ...base, seconds, steps, silent_for: silent, run_id: runId, can_stop: true };
    if (job.status === "waiting_approval") return { ...common, phase: "waiting_approval", label: "Waiting for your approval", detail: "Approve or reject it in Approvals (or on Telegram)." };
    const label = stepLabel(run?.step);
    if (silent >= QUIET_AFTER_S)
      return { ...common, phase: "quiet", label, detail: `No news for ${fmtDuration(silent)}. A long step (render, big download) can take a while; press Stop if it looks stuck.` };
    return { ...common, phase: "running", label, detail: null };
  }

  if (job.status === "failed") return { ...base, phase: "failed", label: "Could not finish", detail: run?.error ?? "the run failed", run_id: runId, seconds: secs(run?.started_at, now), can_retry: true };
  if (job.status === "cancelled") {
    const why = job.cancel_reason ?? run?.error ?? null;
    return { ...base, phase: "cancelled", label: "Stopped", detail: why ? why.replace(/^stopped: /i, "") : null, run_id: runId, can_retry: true };
  }
  return { ...base, phase: "done", label: "Done", detail: null, run_id: runId, seconds: run?.ended_at ? Math.round((Date.parse(run.ended_at) - Date.parse(run.started_at)) / 1000) : 0 };
}
