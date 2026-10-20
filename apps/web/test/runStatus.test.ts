import { describe, expect, test } from "bun:test";
import { apply, initialState, type AgentEvent, type OfficeState } from "@agent-office/shared";
import { fmtDuration, runStatus, stepLabel } from "../src/runStatus.ts";

let id = 0;
const T0 = Date.parse("2026-10-20T03:00:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
function ev(s: OfficeState, type: string, payload: Record<string, unknown>, sec: number, meta: { run_id?: string; agent_id?: string } = {}) {
  apply(s, { id: ++id, ts: at(sec), type, payload, run_id: meta.run_id ?? null, agent_id: meta.agent_id ?? null, workspace_id: "owner" } as unknown as AgentEvent);
}
const job = (s: OfficeState, jobId: string, agent: string, title: string, sec: number) =>
  ev(s, "job.created", { job_id: jobId, agent_id: agent, project_id: null, title, type: "chat", trigger: "manual", parent_job_id: null }, sec, { agent_id: agent });

describe("run status in plain words", () => {
  test("queued: place in line and who holds the runner", () => {
    const s = initialState();
    ev(s, "runner.online", { runner_id: "r1", name: "main-pc" }, 0);
    job(s, "j1", "editor", "Montage Valorant", 1);
    ev(s, "run.started", { run_id: "u1", job_id: "j1", agent_id: "editor", runner_id: "r1" }, 2, { run_id: "u1", agent_id: "editor" });
    job(s, "j2", "studio", "Edit in OpenChatCut", 60);
    job(s, "j3", "tiktok", "Daily video", 70);
    const st = runStatus(s, "j3", T0 + 200_000);
    expect(st).toMatchObject({ phase: "queued", position: 2, label: "In the queue: number 2", can_stop: true });
    expect(st.detail).toBe('The runner is busy with "Montage Valorant" (3m 18s).');
    expect(runStatus(s, "j2", T0 + 200_000).label).toBe("Next in line");
  });

  test("queued: paused, no runner, over budget explain themselves", () => {
    const s = initialState();
    job(s, "j1", "editor", "x", 0);
    expect(runStatus(s, "j1", T0).detail).toContain("No runner is online");
    ev(s, "runner.online", { runner_id: "r1", name: "main-pc" }, 1);
    ev(s, "system.paused", { paused: true }, 2);
    expect(runStatus(s, "j1", T0).detail).toContain("paused");
  });

  test("running: the current step, steps, time; quiet after 2 minutes without news", () => {
    const s = initialState();
    ev(s, "runner.online", { runner_id: "r1", name: "main-pc" }, 0);
    job(s, "j1", "editor", "Montage", 0);
    ev(s, "run.started", { run_id: "u1", job_id: "j1", agent_id: "editor", runner_id: "r1" }, 1, { run_id: "u1", agent_id: "editor" });
    ev(s, "agent.tool_call", { call_id: "c1", tool: "video_probe", category: "read_docs", args: {} }, 5, { run_id: "u1", agent_id: "editor" });
    expect(runStatus(s, "j1", T0 + 30_000)).toMatchObject({ phase: "running", label: "Looking at the video", steps: 1, seconds: 29 });
    ev(s, "agent.thinking", { summary: "Rendering tiktok_fhd: 40%" }, 40, { run_id: "u1", agent_id: "editor" });
    expect(runStatus(s, "j1", T0 + 50_000).label).toBe("Rendering tiktok_fhd: 40%");
    const quiet = runStatus(s, "j1", T0 + 40_000 + 180_000);
    expect(quiet).toMatchObject({ phase: "quiet", silent_for: 180 });
    expect(quiet.detail).toContain("No news for 3m 00s");
  });

  test("finished: failed shows the error, stopped shows why, both can be retried", () => {
    const s = initialState();
    job(s, "j1", "editor", "x", 0);
    ev(s, "run.started", { run_id: "u1", job_id: "j1", agent_id: "editor", runner_id: "r1" }, 1, { run_id: "u1", agent_id: "editor" });
    ev(s, "run.failed", { run_id: "u1", job_id: "j1", error: "runner restarted and lost the run", tokens_in: 0, tokens_out: 0, cost_usd: 0, cost_unknown: false }, 9, { run_id: "u1" });
    expect(runStatus(s, "j1")).toMatchObject({ phase: "failed", detail: "runner restarted and lost the run", can_retry: true });
    job(s, "j2", "editor", "y", 10);
    ev(s, "job.cancelled", { job_id: "j2", reason: "stopped: the run went over its time limit (60 min)." }, 11);
    expect(runStatus(s, "j2")).toMatchObject({ phase: "cancelled", label: "Stopped", detail: "the run went over its time limit (60 min).", can_retry: true });
  });

  test("labels and durations", () => {
    expect(stepLabel("tool:openchatcut")).toBe("Working in OpenChatCut");
    expect(stepLabel("tool:some_new_tool")).toBe("Using some new tool");
    expect(stepLabel('Working on "x" with canopy-ai')).toBe("Starting");
    expect([fmtDuration(42), fmtDuration(65), fmtDuration(3720)]).toEqual(["42s", "1m 05s", "1h 02m"]);
  });
});
