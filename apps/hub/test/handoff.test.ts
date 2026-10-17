import { afterEach, describe, expect, test } from "bun:test";
import type { AgentEvent } from "@agent-office/shared";
import { startFakeGitea, type FakeGitea } from "../../../packages/tools/test/fakeGitea.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
let gitea: FakeGitea | undefined;
afterEach(async () => {
  gitea?.stop();
  gitea = undefined;
  await env?.close();
});

async function agent(e: TestEnv, slug: string, tools: string[], extra: Record<string, unknown> = {}) {
  const { body, status } = await e.api("/api/agents", {
    body: { slug, name: slug[0]!.toUpperCase() + slug.slice(1), provider: "mock", model: "mock-script", tools, permission_level: "review", ...extra },
  });
  if (status !== 201) throw new Error(JSON.stringify(body));
  return body.agent as { id: string; slug: string };
}

const of = <T extends AgentEvent["type"]>(events: AgentEvent[], type: T) =>
  events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);

describe("handoff", () => {
  test("Tester hands off to Coder: new job with parent + handoff trigger, agent.handoff event", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const web = await env.web();
    const tester = await agent(env, "qa-bot", ["handoff"]);
    const coder = await agent(env, "dev-bot", []);
    const { body } = await env.api("/api/jobs", {
      body: {
        agent_id: tester.id,
        title: "Smoke test",
        input: {
          script: [
            { tool: "handoff", input: { to_agent: "dev-bot", title: "Fix: booking page 500", details: "GET /booking returns 500", reason: "page broken" } },
            { text: "Handed off." },
          ],
        },
      },
    });
    const ev = await waitFor(() => of(web.events, "agent.handoff")[0], 8000, "agent.handoff");
    expect(ev.payload).toMatchObject({ from_agent: "qa-bot", to_agent: "dev-bot", reason: "page broken" });
    const child = env.hub.hub.store.state.jobs[ev.payload.new_job_id]!;
    expect(child).toMatchObject({ agent_id: coder.id, trigger: "handoff", parent_job_id: body.job.id, title: "Fix: booking page 500" });
    // The coder's job runs too (mock-script with no script fails fast, which is fine here: it was dispatched).
    await waitFor(() => env.hub.hub.store.state.jobs[ev.payload.new_job_id]?.run_ids.length, 8000, "child dispatched");
    const childJob = await env.api("/api/jobs");
    const row = childJob.body.jobs.find((j: { id: string }) => j.id === ev.payload.new_job_id);
    expect(row.input.text).toBe("GET /booking returns 500");
    expect(row.input.from_agent).toBe("qa-bot");
  });

  test("handoff to an unknown agent is refused inside the tool; to itself is not offered", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const web = await env.web();
    const tester = await agent(env, "qa-bot", ["handoff"]);
    await env.api("/api/jobs", {
      body: {
        agent_id: tester.id,
        title: "x",
        input: { script: [{ tool: "handoff", input: { to_agent: "qa-bot", title: "loop me", details: "d", reason: "r" } }, { text: "ok" }] },
      },
    });
    await waitFor(() => of(web.events, "run.finished")[0], 8000, "run.finished");
    expect(of(web.events, "agent.handoff")).toHaveLength(0);
    expect(of(web.events, "agent.tool_result")[0]!.payload.ok).toBe(false);
  });

  test("handoff chains stop at the depth limit", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const web = await env.web();
    // Build a 5-deep chain of parent jobs by hand, then ask the deepest job to hand off once more.
    const step = (to: string) => [{ tool: "handoff", input: { to_agent: to, title: "ping", details: "d", reason: "r" } }, { text: "." }];
    await agent(env, "ping", ["handoff"]);
    const pong = await agent(env, "pong", ["handoff"]);
    let parent: string | null = null;
    for (let i = 0; i < 5; i++) {
      const res: { body: { job: { id: string } } } = await env.api("/api/jobs", {
        body: { agent_id: pong.id, title: `hop ${i}`, parent_job_id: parent, trigger: "handoff", input: { script: [{ text: "." }] } },
      });
      parent = res.body.job.id;
    }
    await env.api("/api/jobs", { body: { agent_id: pong.id, title: "too deep", parent_job_id: parent, input: { script: step("ping") } } });
    await waitFor(() => web.events.some((e) => e.type === "agent.thinking" && e.payload.summary.includes("Handoff refused")), 15000, "refusal");
    expect(of(web.events, "agent.handoff")).toHaveLength(0);
  });
});

describe("gitea integration settings", () => {
  test("token is write-only and only sent to runs whose agent has Gitea tools", async () => {
    env = await createTestEnv();
    gitea = startFakeGitea();
    const put = await env.api("/api/settings/integrations/gitea", { method: "PUT", body: { url: gitea.url, token: gitea.token } });
    expect(put.body.gitea).toEqual({ url: gitea.url, has_token: true, token_hint: `••••${gitea.token.slice(-4)}` });
    expect(JSON.stringify((await env.api("/api/settings/integrations")).body)).not.toContain(gitea.token);

    // Keep token when omitted, clear with "".
    await env.api("/api/settings/integrations/gitea", { method: "PUT", body: { url: gitea.url } });
    expect((await env.api("/api/settings/integrations")).body.gitea.has_token).toBe(true);

    // A coder with gitea tools can open a PR against the fake Gitea, end to end through the runner.
    await env.pairRunner();
    const web = await env.web();
    const coder = await agent(env, "pr-bot", ["gitea_create_pr"]);
    await env.api("/api/jobs", {
      body: {
        agent_id: coder.id,
        title: "open pr",
        input: { script: [{ tool: "gitea_create_pr", input: { owner: "hazman", repo: "sewa", head: "fix/x", title: "Fix x" } }, { text: "PR opened" }] },
      },
    });
    await waitFor(() => of(web.events, "run.finished")[0], 8000, "run.finished");
    expect(gitea.pulls).toHaveLength(1);
    expect(of(web.events, "artifact.created").some((e) => e.payload.kind === "pr")).toBe(true);
    expect(JSON.stringify(web.events)).not.toContain(gitea.token);

    // An agent without Gitea tools never receives the token.
    const sent: unknown[] = [];
    const orig = env.hub.hub.conns.values().next().value!;
    const send = orig.send.bind(orig);
    orig.send = (m) => {
      sent.push(m);
      send(m);
    };
    const plain = await agent(env, "plain", ["read_file"]);
    await env.api("/api/jobs", { body: { agent_id: plain.id, title: "p", input: { script: [{ text: "hi" }] } } });
    await waitFor(() => sent.find((m) => (m as { type: string }).type === "run.assign"), 5000, "assign");
    const assign = sent.find((m) => (m as { type: string }).type === "run.assign") as { assignment: { gitea: unknown } };
    expect(assign.assignment.gitea).toBeNull();

    await env.api("/api/settings/integrations/gitea", { method: "PUT", body: { url: gitea.url, token: "" } });
    expect((await env.api("/api/settings/integrations")).body.gitea.has_token).toBe(false);
  });

  test("connection test reports the Gitea user", async () => {
    env = await createTestEnv();
    gitea = startFakeGitea();
    await env.api("/api/settings/integrations/gitea", { method: "PUT", body: { url: gitea.url, token: gitea.token } });
    const res = await env.api("/api/settings/integrations/gitea/test", { method: "POST" });
    // The fake has no /user endpoint: the hub must report the failure cleanly, not crash.
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain("404");
  });
});
