import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { accountError, modelCandidates, modelGroup, rankModels } from "@agent-office/shared";
import { startFakeOpenAI, type FakeOpenAI } from "../../runner/test/fakeOpenAI.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

test("models are ranked for agent work; auto tries the best few", () => {
  const ids = ["kc/poolside/laguna-xs-2.1:free", "cl/openai/gpt-5.4", "kc/nvidia/nemotron-3-ultra-550b-a55b:free", "cl/anthropic/claude-sonnet-4.6", "cl/anthropic/claude-opus-4.7", "kc/liquid/lfm-2.5-2.6b:free"];
  expect(rankModels(ids).slice(0, 4)).toEqual(["cl/anthropic/claude-opus-4.7", "cl/anthropic/claude-sonnet-4.6", "cl/openai/gpt-5.4", "kc/nvidia/nemotron-3-ultra-550b-a55b:free"]);
  expect(modelCandidates("cl/openai/gpt-5.4", ids)).toEqual(["cl/openai/gpt-5.4"]);
  expect(modelCandidates("auto", ids)).toHaveLength(6);
  // an account error (no credit) means: skip every model of that upstream
  expect(modelGroup("cl/anthropic/claude-opus-4.7")).toBe("cl");
  expect(modelGroup("gpt-5.4")).toBe("");
  expect(accountError('[cline/x] [402]: {"error":{"code":"insufficient_credits"}}')).toBe(true);
  expect(accountError("No active credentials for provider: kiro")).toBe(true);
  expect(accountError("Rate limit exceeded, try again in 20 s")).toBe(false);
  expect(accountError("used 4021 tokens")).toBe(false);
  expect(accountError("HTTP 402: payment")).toBe(true);
  expect(modelCandidates("auto", [])).toEqual([]);
});

/** The best model is out of credits (429); the next one answers through the scripted fake. */
let fake: FakeOpenAI;
let gateway: ReturnType<typeof Bun.serve>;
const asked: string[] = [];
beforeAll(() => {
  fake = startFakeOpenAI([{ text: "Hello from the second model." }], "gw-key");
  gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = await req.text();
      const model = (JSON.parse(body || "{}") as { model?: string }).model ?? "";
      asked.push(model);
      if (model === "claude-opus-busy") return Response.json({ error: { message: "Rate limit exceeded: free tier used up" } }, { status: 429 });
      return fetch(`${fake.url.replace(/\/v1$/, "")}${url.pathname}`, { method: req.method, headers: req.headers, body });
    },
  });
});
afterAll(() => {
  fake.stop();
  gateway.stop(true);
});

test("an auto agent moves on to the next model when the best one is out of credits", async () => {
  env = await createTestEnv();
  await env.pairRunner();
  await env.api("/api/providers", {
    body: { slug: "gw", name: "Gateway", kind: "openai_compatible", base_url: `http://127.0.0.1:${gateway.port}/v1`, api_key: "gw-key", models: ["small-lite", "gpt-5-good", "claude-opus-busy"] },
  });
  const agent = (await env.api("/api/agents", { body: { slug: "auto-bot", name: "Auto", provider: "gw", model: "auto", tools: [], config: { self_review: false } } })).body.agent;
  const job = (await env.api("/api/jobs", { body: { agent_id: agent.id, title: "hi", input: { text: "Say hello" } } })).body.job;
  await waitFor(() => ["done", "failed"].includes(env.hub.hub.store.state.jobs[job.id]?.status ?? ""), 30_000, "run end");
  expect(env.hub.hub.store.state.jobs[job.id]?.status).toBe("done");
  const runId = env.hub.hub.store.state.jobs[job.id]!.run_ids[0]!;
  // the fake answers requests without tools with a fixed text
  expect(env.hub.hub.store.state.runs[runId]?.output).toBe("Fake title");
  // best first (opus), then the next best (gpt-5); the weakest was never needed
  expect(asked.filter((m) => m !== "")).toEqual(expect.arrayContaining(["claude-opus-busy", "gpt-5-good"]));
  expect(asked).not.toContain("small-lite");
  const notes = (await env.api(`/api/runs/${runId}`)).body.events.filter((e: { type: string }) => e.type === "agent.thinking").map((e: { payload: { summary: string } }) => e.payload.summary);
  expect(notes.some((n: string) => n.includes("claude-opus-busy did not work") && n.includes("trying gpt-5-good"))).toBe(true);
}, 60_000);
