import { afterEach, describe, expect, test } from "bun:test";
import type { AgentEvent } from "@agent-office/shared";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

const agent = async (e: TestEnv, slug: string, model: string, tools: string[] = []) =>
  (await e.api("/api/agents", { body: { slug, name: slug, provider: "mock", model, tools, config: { self_review: false } } })).body.agent.id as string;

async function runJob(e: TestEnv, agentId: string, script: unknown[]) {
  const { body } = await e.api("/api/jobs", { body: { agent_id: agentId, title: "t", input: { script } } });
  await waitFor(() => ["done", "failed"].includes(e.hub.hub.store.state.jobs[body.job.id]?.status ?? ""), 15_000, "run end");
  const job = e.hub.hub.store.state.jobs[body.job.id]!;
  const events = (await e.api(`/api/runs/${job.run_ids[0]}`)).body.events as AgentEvent[];
  return { job, results: events.filter((x) => x.type === "agent.tool_result").map((x) => x.payload as { ok: boolean; summary: string; output?: unknown }) };
}

describe("consult_agent", () => {
  test("asks a colleague and gets the answer back, even on a one-slot runner", async () => {
    env = await createTestEnv();
    await env.pairRunner(); // max_concurrent_runs = 1
    const asker = await agent(env, "asker", "mock-script", ["consult_agent"]);
    await agent(env, "helper", "mock-echo");
    const { job, results } = await runJob(env, asker, [{ tool: "consult_agent", input: { to_agent: "helper", question: "What is the rental price for the A7IV?" } }, { text: "thanks" }]);
    expect(job.status).toBe("done");
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.summary).toStartWith("helper answered");
    // the question ran as a consult job for the helper, linked to the asking job; its reply is the answer
    const consult = Object.values(env.hub.hub.store.state.jobs).find((j) => j.type === "consult")!;
    expect(consult).toMatchObject({ status: "done", parent_job_id: job.id });
    expect(env.hub.hub.store.state.runs[consult.run_ids[0]!]!.output).toContain("rental price for the A7IV");
  });

  test("one level only, and unknown agents are refused", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const asker = await agent(env, "asker2", "mock-script", ["consult_agent"]);
    const { results } = await runJob(env, asker, [
      { tool: "consult_agent", input: { to_agent: "nobody", question: "Are you there, anyone at all?" } },
      { tool: "consult_agent", input: { to_agent: "asker2", question: "Can I ask myself something?" } },
      { text: "ok" },
    ]);
    expect(results[0]!.ok).toBe(false);
    expect(results[1]!.ok).toBe(false);
    // a consult job never gets consult_agent or handoff
    const helper = await agent(env, "helper2", "mock-echo", ["consult_agent", "handoff"]);
    const sent: string[][] = [];
    for (const conn of env.hub.hub.conns.values()) {
      const orig = conn.send.bind(conn);
      conn.send = (m) => {
        if (m.type === "run.assign" && m.assignment.job.type === "consult") sent.push(m.assignment.agent.tools);
        orig(m);
      };
    }
    const asker3 = await agent(env, "asker3", "mock-script", ["consult_agent"]);
    await runJob(env, asker3, [{ tool: "consult_agent", input: { to_agent: "helper2", question: "Quick question for you please?" } }, { text: "ok" }]);
    expect(helper).toBeTruthy();
    expect(sent).toEqual([[]]);
  });
});

describe("consult_team (Ketua)", () => {
  test("asks several colleagues at once and gets every answer, even on a one-slot runner", async () => {
    env = await createTestEnv();
    await env.pairRunner(); // max_concurrent_runs = 1: the consults take turns, the waiting asker does not block them
    const ketua = await agent(env, "boss", "mock-script", ["consult_team"]);
    await agent(env, "research", "mock-echo");
    await agent(env, "build", "mock-echo");
    const { job, results } = await runJob(env, ketua, [
      {
        tool: "consult_team",
        input: {
          questions: [
            { to_agent: "research", question: "Is there demand for camera rental bookings online?" },
            { to_agent: "build", question: "How long to build a booking page for cameras?" },
          ],
        },
      },
      { tool: "consult_team", input: { questions: [{ to_agent: "nobody", question: "Anyone out there to answer this?" }] } },
      { text: "summary" },
    ]);
    expect(job.status).toBe("done");
    expect(results[0]).toMatchObject({ ok: true, summary: "2/2 colleagues answered" });
    expect(results[1]!.ok).toBe(false);
    // both questions ran as consult jobs under Ketua's job (the office shows them in the meeting room)
    const s = env.hub.hub.store.state;
    const consults = Object.values(s.jobs).filter((j) => j.type === "consult");
    expect(consults.map((c) => c.parent_job_id)).toEqual([job.id, job.id]);
    const outputs = consults.map((c) => s.runs[c.run_ids[0]!]!.output ?? "").join(" | ");
    expect(outputs).toContain("demand for camera rental");
    expect(outputs).toContain("booking page for cameras");
  }, 30_000);
});
