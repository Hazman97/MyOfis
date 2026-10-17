import { describe, expect, test } from "bun:test";
import { AgentEvent, EVENT_TYPES, EventBody, RunnerEventBody } from "../src/events.ts";
import { HubToRunner, RunnerToHub, parseMessage } from "../src/protocol.ts";

const env = { id: 1, ts: "2026-10-16T01:00:00.000Z", run_id: null, agent_id: null };

describe("event schema", () => {
  test("covers every event type from the spec", () => {
    const required = [
      "runner.online", "runner.offline", "job.created", "job.queued", "job.cancelled",
      "run.started", "run.finished", "run.failed", "agent.thinking", "agent.message",
      "agent.tool_call", "agent.tool_result", "agent.needs_approval", "approval.decided",
      "agent.handoff", "artifact.created", "feature.released", "draft.created",
      "draft.decided", "budget.exceeded", "agent.idle",
    ];
    for (const t of required) expect(EVENT_TYPES).toContain(t as never);
  });

  test("accepts a valid event", () => {
    const e = AgentEvent.parse({
      ...env,
      type: "agent.tool_call",
      payload: { call_id: "c1", tool: "read_file", category: "read_docs", args: { path: "a.md" } },
    });
    expect(e.type).toBe("agent.tool_call");
  });

  test("rejects unknown type", () => {
    expect(AgentEvent.safeParse({ ...env, type: "agent.dance", payload: {} }).success).toBe(false);
  });

  test("rejects bad payload", () => {
    const bad = { type: "agent.tool_call", payload: { call_id: "c1", tool: "x", category: "juggling", args: {} } };
    expect(EventBody.safeParse(bad).success).toBe(false);
  });

  test("rejects missing envelope fields", () => {
    expect(AgentEvent.safeParse({ type: "agent.idle", payload: { agent_id: "a" } }).success).toBe(false);
  });

  test("thinking summary is length-capped", () => {
    const long = { type: "agent.thinking", payload: { summary: "x".repeat(501) } };
    expect(EventBody.safeParse(long).success).toBe(false);
  });

  test("runner may not emit lifecycle events", () => {
    const ok = { type: "agent.message", payload: { message_id: "m", text: "hi" } };
    const notOk = {
      type: "run.finished",
      payload: { run_id: "r", job_id: "j", status: "done", tokens_in: 1, tokens_out: 1, cost_usd: 0 },
    };
    expect(RunnerEventBody.safeParse(ok).success).toBe(true);
    expect(RunnerEventBody.safeParse(notOk).success).toBe(false);
  });
});

describe("protocol", () => {
  test("parses runner hello", () => {
    const msg = parseMessage(
      RunnerToHub,
      JSON.stringify({
        type: "hello",
        protocol: 1,
        name: "pc",
        version: "0.1.0",
        capabilities: { os: "win32", arch: "x64", runtimes: ["mock"], max_concurrent_runs: 1 },
        active_runs: [],
      }),
    );
    expect(msg?.type).toBe("hello");
  });

  test("run.event wraps only runner-allowed bodies", () => {
    const raw = JSON.stringify({
      type: "run.event",
      run_id: "r",
      seq: 1,
      event: { type: "system.paused", payload: { paused: true } },
    });
    expect(parseMessage(RunnerToHub, raw)).toBeNull();
  });

  test("returns null on garbage", () => {
    expect(parseMessage(HubToRunner, "{not json")).toBeNull();
    expect(parseMessage(HubToRunner, JSON.stringify({ type: "nope" }))).toBeNull();
  });
});
