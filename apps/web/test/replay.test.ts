import { describe, expect, test } from "bun:test";
import type { AgentEvent, EventBody } from "@agent-office/shared";
import { MAX_GAP_MS, Replay, idsForTimeRange, offsets, windowOf } from "../src/office/replay.ts";

let id = 1;
const t0 = Date.parse("2026-10-17T01:00:00.000Z");
const ev = (atMs: number, body: EventBody, extra: Partial<AgentEvent> = {}): AgentEvent =>
  ({ id: id++, ts: new Date(t0 + atMs).toISOString(), run_id: null, agent_id: null, ...body, ...extra }) as AgentEvent;

function story() {
  id = 1;
  return [
    ev(0, { type: "runner.online", payload: { runner_id: "rn", name: "pc" } }),
    ev(1000, { type: "job.created", payload: { job_id: "j1", agent_id: "a1", project_id: null, type: "task", title: "t", trigger: "manual", parent_job_id: null } }),
    ev(1200, { type: "run.started", payload: { run_id: "r1", job_id: "j1", agent_id: "a1", runner_id: "rn" } }, { run_id: "r1", agent_id: "a1" }),
    ev(2200, { type: "agent.thinking", payload: { summary: "hmm" } }, { run_id: "r1", agent_id: "a1" }),
    // a long wait (e.g. for an approval) is squeezed to MAX_GAP_MS
    ev(600_000, { type: "run.finished", payload: { run_id: "r1", job_id: "j1", status: "done", tokens_in: 1, tokens_out: 1, cost_usd: 0, cost_unknown: false } }, { run_id: "r1", agent_id: "a1" }),
  ];
}

describe("replay", () => {
  test("offsets keep real spacing but cap long gaps", () => {
    expect(offsets(story())).toEqual([0, 1000, 1200, 2200, 2200 + MAX_GAP_MS]);
  });

  test("starts from the state before the window and re-applies the window over time", () => {
    const all = story();
    const { before, events } = windowOf(all, 3, 5); // from run.started to run.finished
    const r = new Replay(before, events);
    expect(r.state.jobs.j1?.status).toBe("queued");
    expect(r.state.runners.rn?.online).toBe(true);
    expect(r.advanceTo(0).map((e) => e.type)).toEqual(["run.started"]);
    expect(r.state.agents.a1?.activity).toBe("working");
    expect(r.advanceTo(1000).map((e) => e.type)).toEqual(["agent.thinking"]);
    expect(r.state.agents.a1?.thinking).toBe("hmm");
    expect(r.done).toBe(false);
    r.advanceTo(r.duration);
    expect(r.done).toBe(true);
    expect(r.state.agents.a1?.activity).toBe("idle");
    expect(r.advanceTo(r.duration + 1)).toEqual([]); // never applies twice
  });

  test("time range picks the events inside it", () => {
    const all = story();
    expect(idsForTimeRange(all, new Date(t0 + 900).toISOString(), new Date(t0 + 2500).toISOString())).toEqual({ fromId: 2, toId: 4 });
    expect(idsForTimeRange(all, new Date(t0 + 700_000).toISOString(), new Date(t0 + 800_000).toISOString())).toBeNull();
  });
});
