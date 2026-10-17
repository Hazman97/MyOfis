import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { AgentEvent } from "@agent-office/shared";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
let fake: ReturnType<typeof Bun.serve>;
const seen: { key: string | null; q: string | null }[] = [];

beforeAll(() => {
  // a fake Brave Search API
  fake = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      seen.push({ key: req.headers.get("x-subscription-token"), q: url.searchParams.get("q") });
      return Response.json({ web: { results: [{ title: "Sewa <b>kamera</b> KL", url: "https://sewa.example.my", description: "Dari RM80 sehari" }] } });
    },
  });
});
afterAll(() => fake.stop(true));
afterEach(async () => {
  await env?.close();
});

async function searchJob(e: TestEnv) {
  const { body: agent } = await e.api("/api/agents", { body: { slug: "rs", name: "Researcher", provider: "mock", model: "mock-script", tools: ["web_search"], config: { self_review: false } } });
  const { body } = await e.api("/api/jobs", { body: { agent_id: agent.agent.id, title: "t", input: { script: [{ tool: "web_search", input: { query: "sewa kamera KL" } }, { text: "done" }] } } });
  await waitFor(() => ["done", "failed"].includes(e.hub.hub.store.state.jobs[body.job.id]?.status ?? ""), 8000, "run end");
  const runId = e.hub.hub.store.state.jobs[body.job.id]!.run_ids[0]!;
  return (await e.api(`/api/runs/${runId}`)).body.events.find((x: AgentEvent) => x.type === "agent.tool_result").payload;
}

describe("web search through the hub", () => {
  test("not set up: the tool explains what the owner must do", async () => {
    env = await createTestEnv({}, { webSearchApiBase: `http://127.0.0.1:${fake.port}` });
    await env.pairRunner();
    const result = await searchJob(env);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("Settings → Integrations");
  });

  test("the key stays in the hub; the runner gets clean results", async () => {
    env = await createTestEnv({}, { webSearchApiBase: `http://127.0.0.1:${fake.port}` });
    await env.pairRunner();
    const saved = await env.api("/api/settings/integrations/web-search", { method: "PUT", body: { provider: "brave", api_key: "BSA-secret-key-123456" } });
    expect(saved.body.web_search).toEqual({ provider: "brave", has_key: true, key_hint: expect.any(String) });
    expect(JSON.stringify((await env.api("/api/settings/integrations")).body)).not.toContain("BSA-secret-key-123456");

    const result = await searchJob(env);
    expect(result).toMatchObject({ tool: "web_search", ok: true });
    expect(seen.at(-1)).toEqual({ key: "BSA-secret-key-123456", q: "sewa kamera KL" });
    // the run's events never carry the key
    expect(JSON.stringify(env.hub.hub.store.state)).not.toContain("BSA-secret-key-123456");
  });
});
