import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { reduceAll, type Agent, type AgentEvent } from "@agent-office/shared";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

async function echoAgent(e: TestEnv, model?: string): Promise<Agent> {
  const { body } = await e.api<{ agents: Agent[] }>("/api/agents");
  const agent = body.agents.find((a) => a.slug === "echo")!;
  if (model) await e.api(`/api/agents/${agent.id}`, { method: "PATCH", body: { model } });
  return agent;
}

const ofType = (events: AgentEvent[], type: AgentEvent["type"]) => events.filter((e) => e.type === type);

describe("phase 1 core loop", () => {
  test("job -> runner -> live events -> finished with tokens; reconnect restores state", async () => {
    env = await createTestEnv();
    const web = await env.web();
    await waitFor(() => web.snapshot, 2000, "snapshot");
    await env.pairRunner();
    const agent = await echoAgent(env);

    const created = await env.api<{ job: { id: string } }>("/api/jobs", {
      body: { agent_id: agent.id, title: "Summarize", input: { text: "Sewa kamera ZV-E10 untuk content creator" } },
    });
    expect(created.status).toBe(201);
    const jobId = created.body.job.id;

    const finished = await waitFor(() => web.events.find((e) => e.type === "run.finished"), 5000, "run.finished");
    const types = web.events.map((e) => e.type);
    for (const t of ["runner.online", "job.created", "job.queued", "run.started", "agent.thinking", "agent.message", "artifact.created", "run.finished", "agent.idle"]) {
      expect(types).toContain(t as AgentEvent["type"]);
    }
    // Events arrive in id order with no gaps for this client.
    const ids = web.events.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));

    if (finished.type !== "run.finished") throw new Error("unreachable");
    expect(finished.payload.status).toBe("done");
    expect(finished.payload.tokens_in).toBeGreaterThan(0);
    expect(finished.payload.tokens_out).toBeGreaterThan(0);

    const runId = finished.run_id!;
    const run = await env.api(`/api/runs/${runId}`);
    expect(run.body.run.status).toBe("done");
    expect(run.body.run.tokens_in).toBe(finished.payload.tokens_in);
    expect(run.body.events.length).toBeGreaterThan(3);

    const state = env.hub.hub.store.state;
    expect(state.jobs[jobId]?.status).toBe("done");
    expect(state.runs[runId]?.output).toBe("Echo: Sewa kamera ZV-E10 untuk content creator");

    // Run workspace and log were written.
    expect(existsSync(join(env.dir, "workspaces", "echo", runId, "output.md"))).toBe(true);
    await env.hub.hub.store.flushLogs();
    const log = readFileSync(join(env.dir, "files", "runs", `${runId}.ndjson`), "utf8").trim().split("\n");
    expect(log.length).toBe(run.body.events.length);

    // Browser "refresh": fresh connection gets a snapshot equal to the hub state.
    const fresh = await env.web();
    const snap = await waitFor(() => fresh.snapshot, 2000, "fresh snapshot");
    expect(snap).toEqual(state);

    // Resume from a known event id: partial state + resumed events == full state.
    const cut = web.events[3]!.id;
    const partial = reduceAll(web.events.filter((e) => e.id <= cut), web.snapshot!);
    const resumed = await env.web(cut);
    await waitFor(() => resumed.events.length && resumed.events.at(-1)!.id === state.last_event_id, 2000, "resume");
    expect(reduceAll(resumed.events, partial)).toEqual(state);
  });

  test("cancel a running job", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const agent = await echoAgent(env, "mock-slow");
    const web = await env.web();
    const { body } = await env.api("/api/jobs", {
      body: { agent_id: agent.id, title: "slow", input: { text: "one two three four five six seven eight nine ten" } },
    });
    const started = await waitFor(() => web.events.find((e) => e.type === "run.started"), 3000, "run.started");
    await env.api(`/api/jobs/${body.job.id}/cancel`, { method: "POST" });
    const done = await waitFor(() => web.events.find((e) => e.type === "run.finished"), 3000, "run.finished");
    if (done.type !== "run.finished") throw new Error("unreachable");
    expect(done.payload.status).toBe("cancelled");
    expect(ofType(web.events, "job.cancelled").length).toBe(1);
    expect(env.hub.hub.store.state.jobs[body.job.id]?.status).toBe("cancelled");
    expect(env.hub.hub.store.state.agents[agent.id]?.activity).toBe("idle");
    expect(started.run_id).toBe(done.run_id);
  });

  test("runner connection drop mid-run loses no events and makes no duplicates", async () => {
    env = await createTestEnv();
    const runner = await env.pairRunner();
    const agent = await echoAgent(env, "mock-slow");
    const web = await env.web();
    await env.api("/api/jobs", { body: { agent_id: agent.id, title: "blip", input: { text: "a b c d e f" } } });
    await waitFor(() => web.events.find((e) => e.type === "agent.message"), 3000, "first chunk");
    runner.dropConnection();
    const done = await waitFor(() => web.events.find((e) => e.type === "run.finished"), 8000, "run.finished after reconnect");
    if (done.type !== "run.finished") throw new Error("unreachable");
    expect(done.payload.status).toBe("done");
    const out = env.hub.hub.store.state.runs[done.run_id!]!.output;
    expect(out).toBe("Echo: a b c d e f");
    expect(ofType(web.events, "runner.offline").length).toBe(1);
    expect(ofType(web.events, "runner.online").length).toBe(1); // first online happened before this web client connected
  });

  test("failed run is recorded", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const agent = await echoAgent(env, "mock-fail");
    const web = await env.web();
    await env.api("/api/jobs", { body: { agent_id: agent.id, title: "fail", input: { text: "a b c d" } } });
    const failed = await waitFor(() => web.events.find((e) => e.type === "run.failed"), 3000, "run.failed");
    if (failed.type !== "run.failed") throw new Error("unreachable");
    expect(failed.payload.error).toContain("on purpose");
  });

  test("queued jobs wait for a runner and for unpause", async () => {
    env = await createTestEnv();
    const agent = await echoAgent(env);
    await env.api("/api/settings/pause", { body: { paused: true } });
    const { body } = await env.api("/api/jobs", { body: { agent_id: agent.id, title: "later", input: { text: "hi" } } });
    await env.pairRunner();
    await Bun.sleep(200);
    expect(env.hub.hub.store.state.jobs[body.job.id]?.status).toBe("queued");
    await env.api("/api/settings/pause", { body: { paused: false } });
    await waitFor(() => env.hub.hub.store.state.jobs[body.job.id]?.status === "done", 3000, "job done after unpause");
  });

  test("pause cancels running runs", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const agent = await echoAgent(env, "mock-slow");
    const { body } = await env.api("/api/jobs", { body: { agent_id: agent.id, title: "x", input: { text: "a b c d e f g h" } } });
    await waitFor(() => env.hub.hub.store.state.jobs[body.job.id]?.status === "running", 3000, "running");
    await env.api("/api/settings/pause", { body: { paused: true } });
    await waitFor(() => env.hub.hub.store.state.jobs[body.job.id]?.status === "cancelled", 3000, "cancelled by pause");
  });

  test("hub restart rebuilds state from events", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const agent = await echoAgent(env);
    await env.api("/api/jobs", { body: { agent_id: agent.id, title: "persist", input: { text: "hello" } } });
    await waitFor(() => Object.values(env.hub.hub.store.state.runs).some((r) => r.status === "done"), 3000, "done");
    const before = structuredClone(env.hub.hub.store.state);
    env.hub.hub.store.rebuild();
    expect(env.hub.hub.store.state).toEqual(before);
  });
});
