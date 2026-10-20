import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent } from "@agent-office/shared";
import { eq } from "drizzle-orm";
import { approvals, jobs, runs } from "../src/db/schema.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

/** A tool-using agent driven by the deterministic `mock-script` model. */
async function scriptedAgent(e: TestEnv, opts: { permission?: "safe" | "review"; allow?: string[] } = {}) {
  const { body, status } = await e.api("/api/agents", {
    body: {
      slug: `bot-${Math.random().toString(36).slice(2, 8)}`,
      name: "Bot",
      provider: "mock",
      model: "mock-script",
      tools: ["run_command", "write_file", "read_file"],
      permission_level: opts.permission ?? "safe",
      config: { shell_allowlist: opts.allow ?? [] },
    },
  });
  if (status !== 201) throw new Error(JSON.stringify(body));
  return { id: body.agent.id as string, slug: body.agent.slug as string };
}

const job = (e: TestEnv, agentId: string, script: unknown[]) =>
  e.api("/api/jobs", { body: { agent_id: agentId, title: "scripted", input: { script } } });

const find = <T extends AgentEvent["type"]>(events: AgentEvent[], type: T) =>
  events.find((e): e is Extract<AgentEvent, { type: T }> => e.type === type);

describe("run time limit", () => {
  test("a run over its minutes is stopped; time waiting for the owner's approval does not count", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const web = await env.web();
    const { id: agentId } = await scriptedAgent(env);
    await env.api(`/api/agents/${agentId}`, { method: "PATCH", body: { config: { max_run_minutes: 5 } } });
    const { body } = await job(env, agentId, [{ tool: "run_command", input: { command: "bun --print 1+1" } }, { text: "ok" }]);
    const ask = await waitFor(() => find(web.events, "agent.needs_approval"), 8000, "needs_approval");
    const runId = ask.run_id!;

    // waiting for the owner: never stopped, however long
    env.hub.hub.enforceTimeLimits(Date.now() + 60 * 60_000);
    expect(env.hub.hub.store.state.runs[runId]?.status).toBe("running");

    // the owner decided 10 minutes ago and the run is still busy: over its 5 minutes → stopped
    const ago = new Date(Date.now() - 10 * 60_000).toISOString();
    env.hub.hub.db.update(approvals).set({ status: "approved", decided_at: ago }).where(eq(approvals.id, ask.payload.approval_id)).run();

    // a colleague answered a consult 1 minute ago: the wait for it does not count either
    const run = env.hub.hub.db.select().from(runs).where(eq(runs.id, runId)).get()!;
    const minuteAgo = new Date(Date.now() - 60_000).toISOString();
    env.hub.hub.db.insert(jobs).values({ id: "job_consult_t", agent_id: agentId, project_id: null, type: "consult", title: "ask", input: { parent_run_id: runId }, trigger: "manual", status: "done" }).run();
    env.hub.hub.db.insert(runs).values({ id: "run_consult_t", job_id: "job_consult_t", agent_id: agentId, runner_id: run.runner_id, status: "done", started_at: ago, ended_at: minuteAgo }).run();
    env.hub.hub.enforceTimeLimits(Date.now());
    expect(env.hub.hub.store.state.runs[runId]?.status).toBe("running");

    env.hub.hub.enforceTimeLimits(Date.now() + 6 * 60_000);
    await waitFor(() => env.hub.hub.store.state.jobs[body.job.id]?.status === "cancelled", 15_000, "time limit cancel");
    const cancelled = await waitFor(() => find(web.events, "job.cancelled"), 5000, "job.cancelled");
    expect(cancelled.payload.reason).toContain("time limit (5 min)");
    expect(env.hub.hub.store.state.runs[runId]?.status).toBe("cancelled");
  });
});

describe("tool loop + approvals", () => {
  test("allowlisted command runs without asking", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const web = await env.web();
    const { id: agentId } = await scriptedAgent(env, { allow: ["bun --print"] });
    await job(env, agentId, [{ tool: "run_command", input: { command: "bun --print 6*7" } }, { text: "The answer is 42." }]);
    const done = await waitFor(() => find(web.events, "run.finished"), 8000, "run.finished");
    expect(done.payload.status).toBe("done");
    expect(find(web.events, "agent.needs_approval")).toBeUndefined();
    const result = find(web.events, "agent.tool_result")!;
    expect(result.payload.ok).toBe(true);
    expect(find(web.events, "agent.tool_call")!.payload.category).toBe("shell");
    expect(env.hub.hub.store.state.runs[done.run_id!]!.output).toContain("The answer is 42.");
  });

  test("dangerous command waits for approval, then runs when approved", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const web = await env.web();
    const { id: agentId } = await scriptedAgent(env);
    const { body } = await job(env, agentId, [{ tool: "run_command", input: { command: "bun --print 1+1" } }, { text: "ok" }]);

    const ask = await waitFor(() => find(web.events, "agent.needs_approval"), 8000, "needs_approval");
    expect(ask.payload.risk_level).toBe("dangerous");
    expect(ask.payload.action).toBe("run: bun --print 1+1");
    const state = env.hub.hub.store.state;
    expect(state.jobs[body.job.id]?.status).toBe("waiting_approval");
    expect(state.agents[agentId]?.activity).toBe("waiting_approval");
    expect(Object.keys(state.pending_approvals)).toEqual([ask.payload.approval_id]);

    // Nothing executes while waiting.
    await Bun.sleep(150);
    expect(find(web.events, "agent.tool_result")).toBeUndefined();

    const inbox = await env.api("/api/approvals");
    expect(inbox.body.approvals).toHaveLength(1);
    expect(inbox.body.approvals[0].details.tool).toBe("run_command");

    expect((await env.api(`/api/approvals/${ask.payload.approval_id}/decide`, { body: { decision: "approved" } })).status).toBe(200);
    const done = await waitFor(() => find(web.events, "run.finished"), 8000, "run.finished");
    expect(done.payload.status).toBe("done");
    expect(find(web.events, "agent.tool_result")!.payload.ok).toBe(true);
    expect(find(web.events, "approval.decided")!.payload).toEqual({ approval_id: ask.payload.approval_id, decision: "approved", via: "web" });
    expect(env.hub.hub.store.state.pending_approvals).toEqual({});

    // Deciding twice is refused.
    expect((await env.api(`/api/approvals/${ask.payload.approval_id}/decide`, { body: { decision: "rejected" } })).status).toBe(409);
  });

  test("rejected action is not executed and the run continues", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const web = await env.web();
    const { id: agentId, slug } = await scriptedAgent(env);
    await job(env, agentId, [{ tool: "write_file", input: { path: "hack.txt", content: "x" } }, { text: "fine, skipped" }]);
    const ask = await waitFor(() => find(web.events, "agent.needs_approval"), 8000, "needs_approval");
    expect(ask.payload.risk_level).toBe("review");
    await env.api(`/api/approvals/${ask.payload.approval_id}/decide`, { body: { decision: "rejected" } });
    const done = await waitFor(() => find(web.events, "run.finished"), 8000, "run.finished");
    expect(done.payload.status).toBe("done");
    expect(find(web.events, "agent.tool_result")!.payload.summary).toBe("rejected by owner");
    expect(existsSync(join(env.dir, "workspaces", slug, done.run_id!, "job.json"))).toBe(true); // right folder
    expect(existsSync(join(env.dir, "workspaces", slug, done.run_id!, "hack.txt"))).toBe(false);
  });

  test("cancelling while waiting expires the approval", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const web = await env.web();
    const { id: agentId } = await scriptedAgent(env);
    const { body } = await job(env, agentId, [{ tool: "run_command", input: { command: "bun --version" } }]);
    const ask = await waitFor(() => find(web.events, "agent.needs_approval"), 8000, "needs_approval");
    await env.api(`/api/jobs/${body.job.id}/cancel`, { method: "POST" });
    const done = await waitFor(() => find(web.events, "run.finished"), 8000, "run.finished");
    expect(done.payload.status).toBe("cancelled");
    expect(env.hub.hub.store.state.pending_approvals).toEqual({});
    const all = await env.api("/api/approvals?status=all");
    expect(all.body.approvals[0].status).toBe("expired");
    expect((await env.api(`/api/approvals/${ask.payload.approval_id}/decide`, { body: { decision: "approved" } })).status).toBe(409);
  });

  test("approval given while the runner is offline is delivered after reconnect", async () => {
    env = await createTestEnv();
    const runner = await env.pairRunner();
    const web = await env.web();
    const { id: agentId } = await scriptedAgent(env);
    await job(env, agentId, [{ tool: "run_command", input: { command: "bun --print 2+3" } }, { text: "five" }]);
    const ask = await waitFor(() => find(web.events, "agent.needs_approval"), 8000, "needs_approval");
    runner.dropConnection();
    await waitFor(() => find(web.events, "runner.offline"), 3000, "runner.offline");
    await env.api(`/api/approvals/${ask.payload.approval_id}/decide`, { body: { decision: "approved" } });
    const done = await waitFor(() => find(web.events, "run.finished"), 10_000, "run.finished after reconnect");
    expect(done.payload.status).toBe("done");
    expect(find(web.events, "agent.tool_result")!.payload.ok).toBe(true);
    // Exactly one approval request recorded, despite the reconnect.
    expect(web.events.filter((e) => e.type === "agent.needs_approval")).toHaveLength(1);
  });

  test("agent with permission_level=review writes without asking", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const web = await env.web();
    const { id: agentId, slug } = await scriptedAgent(env, { permission: "review" });
    await job(env, agentId, [{ tool: "write_file", input: { path: "notes/a.md", content: "hi" } }, { text: "written" }]);
    const done = await waitFor(() => find(web.events, "run.finished"), 8000, "run.finished");
    expect(find(web.events, "agent.needs_approval")).toBeUndefined();
    expect(existsSync(join(env.dir, "workspaces", slug, done.run_id!, "notes", "a.md"))).toBe(true);
  });

  test("unknown tool names are rejected when saving an agent", async () => {
    env = await createTestEnv();
    const res = await env.api("/api/agents", {
      body: { slug: "x", name: "X", provider: "mock", model: "mock-script", tools: ["launch_missiles"] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("launch_missiles");
  });
});
