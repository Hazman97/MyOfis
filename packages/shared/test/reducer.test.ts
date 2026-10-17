import { describe, expect, test } from "bun:test";
import type { AgentEvent, EventBody } from "../src/events.ts";
import { dayKey, initialState, reduce, reduceAll } from "../src/reducer.ts";
import { computeCost } from "../src/pricing.ts";
import { redact, redactString } from "../src/redact.ts";

let nextId = 1;
const ev = (body: EventBody, extra: Partial<AgentEvent> = {}, ts = "2026-10-16T01:00:00.000Z"): AgentEvent =>
  ({ id: nextId++, ts, run_id: null, agent_id: null, ...body, ...extra }) as AgentEvent;

function happyPath(): AgentEvent[] {
  nextId = 1;
  return [
    ev({ type: "runner.online", payload: { runner_id: "rn1", name: "pc" } }),
    ev({
      type: "job.created",
      payload: { job_id: "j1", agent_id: "a1", project_id: null, type: "task", title: "t", trigger: "manual", parent_job_id: null },
    }),
    ev({ type: "job.queued", payload: { job_id: "j1" } }),
    ev({ type: "run.started", payload: { run_id: "r1", job_id: "j1", agent_id: "a1", runner_id: "rn1" } }, { run_id: "r1", agent_id: "a1" }),
    ev({ type: "agent.thinking", payload: { summary: "reading" } }, { run_id: "r1", agent_id: "a1" }),
    ev({ type: "agent.message", payload: { message_id: "m1", text: "Hello ", final: false } }, { run_id: "r1", agent_id: "a1" }),
    ev({ type: "agent.message", payload: { message_id: "m1", text: "world", final: true } }, { run_id: "r1", agent_id: "a1" }),
    ev(
      {
        type: "run.finished",
        payload: { run_id: "r1", job_id: "j1", status: "done", tokens_in: 100, tokens_out: 50, cost_usd: 0.25, cost_unknown: false },
      },
      { run_id: "r1", agent_id: "a1" },
    ),
  ];
}

describe("reducer", () => {
  test("happy path builds expected state", () => {
    const s = reduceAll(happyPath());
    expect(s.last_event_id).toBe(8);
    expect(s.runners.rn1?.online).toBe(true);
    expect(s.jobs.j1?.status).toBe("done");
    expect(s.jobs.j1?.run_ids).toEqual(["r1"]);
    const run = s.runs.r1!;
    expect(run.status).toBe("done");
    expect(run.output).toBe("Hello world");
    expect(run.tokens_in).toBe(100);
    expect(run.cost_usd).toBe(0.25);
    expect(run.event_count).toBe(5);
    expect(s.agents.a1?.activity).toBe("idle");
    expect(s.agents.a1?.tokens_by_day["2026-10-16"]).toBe(150);
    expect(s.cost_by_day["2026-10-16"]).toBe(0.25);
  });

  test("agent is working mid-run", () => {
    const s = reduceAll(happyPath().slice(0, 6));
    expect(s.agents.a1?.activity).toBe("working");
    expect(s.agents.a1?.current_run_id).toBe("r1");
    expect(s.jobs.j1?.status).toBe("running");
  });

  test("replaying the same events is idempotent", () => {
    const events = happyPath();
    const once = reduceAll(events);
    const twice = reduceAll(events, once);
    expect(twice).toEqual(once);
  });

  test("resume from a partial state equals full replay", () => {
    const events = happyPath();
    const partial = reduceAll(events.slice(0, 4));
    const resumed = reduceAll(events.slice(4), partial);
    expect(resumed).toEqual(reduceAll(events));
  });

  test("reduce does not mutate its input", () => {
    const s0 = initialState();
    const [first] = happyPath();
    const s1 = reduce(s0, first!);
    expect(s0.last_event_id).toBe(0);
    expect(s1.last_event_id).toBe(1);
  });

  test("failed run marks job failed with error", () => {
    const events = happyPath().slice(0, 5);
    events.push(
      ev(
        {
          type: "run.failed",
          payload: { run_id: "r1", job_id: "j1", error: "boom", tokens_in: 1, tokens_out: 0, cost_usd: 0, cost_unknown: false },
        },
        { run_id: "r1", agent_id: "a1" },
      ),
    );
    const s = reduceAll(events);
    expect(s.jobs.j1?.status).toBe("failed");
    expect(s.runs.r1?.error).toBe("boom");
    expect(s.agents.a1?.activity).toBe("idle");
  });

  test("cancelled run cancels the job", () => {
    const events = happyPath().slice(0, 5);
    events.push(
      ev(
        {
          type: "run.finished",
          payload: { run_id: "r1", job_id: "j1", status: "cancelled", tokens_in: 0, tokens_out: 0, cost_usd: 0, cost_unknown: false },
        },
        { run_id: "r1", agent_id: "a1" },
      ),
    );
    expect(reduceAll(events).jobs.j1?.status).toBe("cancelled");
  });

  test("pause flag and runner offline", () => {
    nextId = 1;
    const s = reduceAll([
      ev({ type: "runner.online", payload: { runner_id: "rn1", name: "pc" } }),
      ev({ type: "system.paused", payload: { paused: true } }),
      ev({ type: "runner.offline", payload: { runner_id: "rn1", name: "pc" } }),
    ]);
    expect(s.paused).toBe(true);
    expect(s.runners.rn1?.online).toBe(false);
  });

  test("approval lifecycle: request -> decided clears pending and resumes job", () => {
    const events = happyPath().slice(0, 4);
    const meta = { run_id: "r1", agent_id: "a1" };
    events.push(ev({ type: "agent.needs_approval", payload: { approval_id: "ap1", action: "run: rm x", risk_level: "dangerous" } }, meta));
    let s = reduceAll(events);
    expect(s.pending_approvals.ap1?.action).toBe("run: rm x");
    expect(s.jobs.j1?.status).toBe("waiting_approval");
    expect(s.agents.a1?.activity).toBe("waiting_approval");
    s = reduceAll([ev({ type: "approval.decided", payload: { approval_id: "ap1", decision: "approved", via: "web" } }, meta)], s);
    expect(s.pending_approvals).toEqual({});
    expect(s.jobs.j1?.status).toBe("running");
    expect(s.agents.a1?.activity).toBe("working");
  });

  test("two pending approvals: job stays waiting until both are decided", () => {
    const events = happyPath().slice(0, 4);
    const meta = { run_id: "r1", agent_id: "a1" };
    events.push(ev({ type: "agent.needs_approval", payload: { approval_id: "ap1", action: "a", risk_level: "review" } }, meta));
    events.push(ev({ type: "agent.needs_approval", payload: { approval_id: "ap2", action: "b", risk_level: "review" } }, meta));
    events.push(ev({ type: "approval.decided", payload: { approval_id: "ap1", decision: "rejected", via: "web" } }, meta));
    const s = reduceAll(events);
    expect(Object.keys(s.pending_approvals)).toEqual(["ap2"]);
    expect(s.jobs.j1?.status).toBe("waiting_approval");
  });

  test("run ending drops its pending approvals", () => {
    const events = happyPath().slice(0, 4);
    const meta = { run_id: "r1", agent_id: "a1" };
    events.push(ev({ type: "agent.needs_approval", payload: { approval_id: "ap1", action: "a", risk_level: "dangerous" } }, meta));
    events.push(
      ev(
        { type: "run.finished", payload: { run_id: "r1", job_id: "j1", status: "cancelled", tokens_in: 0, tokens_out: 0, cost_usd: 0, cost_unknown: false } },
        meta,
      ),
    );
    expect(reduceAll(events).pending_approvals).toEqual({});
  });

  test("thinking note is set while busy and cleared by tool calls, messages and the run end", () => {
    const events = happyPath();
    expect(reduceAll(events.slice(0, 5)).agents.a1?.thinking).toBe("reading");
    expect(reduceAll(events.slice(0, 6)).agents.a1?.thinking).toBeNull();
    const tool = ev({ type: "agent.tool_call", payload: { call_id: "c1", tool: "read_file", category: "read_docs", args: {} } }, { run_id: "r1", agent_id: "a1" });
    const s = reduceAll([...events.slice(0, 5), tool]);
    expect(s.agents.a1?.thinking).toBeNull();
    expect(s.agents.a1?.last_tool_category).toBe("read_docs");
  });

  test("moments: delivered, failed, handoff and PR opened, each tagged with its event", () => {
    const done = reduceAll(happyPath());
    expect(done.agents.a1?.moment).toEqual({ kind: "delivered", event_id: 8, at: "2026-10-16T01:00:00.000Z", to_agent: null });

    const base = happyPath().slice(0, 4);
    const meta = { run_id: "r1", agent_id: "a1" };
    const handoff = ev({ type: "agent.handoff", payload: { from_agent: "qa", to_agent: "dev", new_job_id: "j2", reason: "fix it" } }, meta);
    const pr = ev({ type: "artifact.created", payload: { kind: "pr", title: "#1 fix", url: "http://g/pr/1" } }, meta);
    const shot = ev({ type: "artifact.created", payload: { kind: "screenshot", title: "home" } }, meta);
    const afterHandoff = reduceAll([...base, handoff]);
    expect(afterHandoff.agents.a1?.moment).toMatchObject({ kind: "handoff", to_agent: "dev", event_id: handoff.id });
    expect(reduceAll([...base, handoff, pr]).agents.a1?.moment).toMatchObject({ kind: "pr_opened", event_id: pr.id });
    // screenshots are not a moment: the handoff stays the latest one
    expect(reduceAll([...base, handoff, shot]).agents.a1?.moment?.kind).toBe("handoff");

    const failed = ev(
      { type: "run.failed", payload: { run_id: "r1", job_id: "j1", error: "boom", tokens_in: 0, tokens_out: 0, cost_usd: 0, cost_unknown: false } },
      meta,
    );
    expect(reduceAll([...base, failed]).agents.a1?.moment?.kind).toBe("failed");
    const cancelled = ev(
      { type: "run.finished", payload: { run_id: "r1", job_id: "j1", status: "cancelled", tokens_in: 0, tokens_out: 0, cost_usd: 0, cost_unknown: false } },
      meta,
    );
    expect(reduceAll([...base, cancelled]).agents.a1?.moment).toBeNull();
  });

  test("day key uses Malaysia time", () => {
    // 2026-10-16 17:00 UTC is 2026-10-17 01:00 in Kuala Lumpur
    expect(dayKey("2026-10-16T17:00:00.000Z")).toBe("2026-10-17");
  });
});

describe("pricing", () => {
  test("known model", () => {
    const c = computeCost({ kind: "anthropic", base_url: null, model: "claude-haiku-5-5", tokens_in: 1_000_000, tokens_out: 1_000_000 });
    expect(c).toEqual({ cost_usd: 0.6, cost_unknown: false });
  });
  test("override wins", () => {
    const c = computeCost({
      kind: "openai_compatible",
      base_url: "https://x.example",
      model: "m",
      tokens_in: 2_000_000,
      tokens_out: 0,
      overrides: { m: { input_per_mtok: 1, output_per_mtok: 2 } },
    });
    expect(c.cost_usd).toBe(2);
  });
  test("local and mock are free, unknown remote is flagged", () => {
    expect(computeCost({ kind: "openai_compatible", base_url: "http://127.0.0.1:11434/v1", model: "llama", tokens_in: 10, tokens_out: 10 }).cost_unknown).toBe(false);
    expect(computeCost({ kind: "mock", base_url: null, model: "x", tokens_in: 10, tokens_out: 10 }).cost_unknown).toBe(false);
    expect(computeCost({ kind: "openai", base_url: null, model: "who-knows", tokens_in: 10, tokens_out: 10 }).cost_unknown).toBe(true);
  });
});

describe("redaction", () => {
  test("masks common token shapes", () => {
    const s = redactString("key sk-ant-api03-abcdefghijklmnop and ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(s).not.toContain("sk-ant-api03");
    expect(s).not.toContain("ghp_");
  });
  test("keeps keyword, masks value", () => {
    expect(redactString("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toBe("Authorization: Bearer [REDACTED]");
    expect(redactString('password="hunter2hunter2hunter2"')).toContain("[REDACTED]");
  });
  test("leaves normal text alone", () => {
    expect(redactString("Sewa kamera ZV-E10 RM50 sehari")).toBe("Sewa kamera ZV-E10 RM50 sehari");
  });
  test("deep redact", () => {
    expect(redact({ a: ["sk-ant-api03-xxxxxxxxxxxxxxxx"], n: 1 })).toEqual({ a: ["[REDACTED]"], n: 1 });
  });
});
