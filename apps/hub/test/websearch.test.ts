import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { AgentEvent } from "@agent-office/shared";
import { parseDuckDuckGoLite } from "../src/websearch.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

/** Shape of DuckDuckGo's lite page: an ad row, then organic results. */
const LITE = `<table>
<tr class="result-sponsored"><td><a rel="nofollow" href="https://duckduckgo.com/y.js?ad_domain=kayak.com.my" class='result-link'>Car Rental KL</a>
(<a href="https://duckduckgo.com/y.js?x=1" rel="nofollow" class="result-link">more info</a>)</td></tr>
<tr><td><a rel="nofollow" href="https://www.rentism.com.my/" class='result-link'>RENTISM - Sewa Kamera DSLR</a></td></tr>
<tr><td class='result-snippet'>Sewa kamera <b>DSLR</b> &amp; lensa dari RM50 sehari.</td></tr>
<tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rentaru.my%2Fp%2Fquicklist.html&rut=x" class='result-link'>Senarai Harga Sewa</a></td></tr>
<tr><td class='result-snippet'>Harga sewa kamera dan lensa.</td></tr>
</table>`;

let env: TestEnv;
let fake: ReturnType<typeof Bun.serve>;
let ddgMode: "ok" | "captcha" = "ok";
const seen: { path: string; key: string | null; q: string | null }[] = [];

beforeAll(() => {
  // fakes for DuckDuckGo lite, a SearXNG instance and the Brave API
  fake = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/lite/") {
        const q = new URLSearchParams(await req.text()).get("q");
        seen.push({ path: "ddg", key: null, q });
        return new Response(ddgMode === "ok" ? LITE : "<html><script src='/anomaly.js'></script></html>", { headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/search") {
        seen.push({ path: "searxng", key: null, q: url.searchParams.get("q") });
        return Response.json({ results: [{ title: "Sewa kamera (SearXNG)", url: "https://sx.example.my", content: "dari SearXNG" }] });
      }
      seen.push({ path: "brave", key: req.headers.get("x-subscription-token"), q: url.searchParams.get("q") });
      return Response.json({ web: { results: [{ title: "Sewa <b>kamera</b> KL", url: "https://sewa.example.my", description: "Dari RM80 sehari" }] } });
    },
  });
});
afterAll(() => fake.stop(true));
afterEach(async () => {
  await env?.close();
});

async function searchJob(e: TestEnv) {
  const { body: agent } = await e.api("/api/agents", { body: { slug: `rs${seen.length}`, name: "Researcher", provider: "mock", model: "mock-script", tools: ["web_search"], config: { self_review: false } } });
  const { body } = await e.api("/api/jobs", { body: { agent_id: agent.agent.id, title: "t", input: { script: [{ tool: "web_search", input: { query: "sewa kamera KL" } }, { text: "done" }] } } });
  await waitFor(() => ["done", "failed"].includes(e.hub.hub.store.state.jobs[body.job.id]?.status ?? ""), 8000, "run end");
  const runId = e.hub.hub.store.state.jobs[body.job.id]!.run_ids[0]!;
  return (await e.api(`/api/runs/${runId}`)).body.events.find((x: AgentEvent) => x.type === "agent.tool_result").payload;
}

describe("DuckDuckGo lite parsing", () => {
  test("keeps organic results, drops ads, unwraps redirect links", () => {
    expect(parseDuckDuckGoLite(LITE, 5)).toEqual([
      { title: "RENTISM - Sewa Kamera DSLR", url: "https://www.rentism.com.my/", snippet: "Sewa kamera DSLR & lensa dari RM50 sehari." },
      { title: "Senarai Harga Sewa", url: "https://www.rentaru.my/p/quicklist.html", snippet: "Harga sewa kamera dan lensa." },
    ]);
    expect(() => parseDuckDuckGoLite("<script src='/anomaly.js'></script>", 5)).toThrow("CAPTCHA");
  });
});

describe("web search through the hub", () => {
  test("works with no setup at all (DuckDuckGo)", async () => {
    env = await createTestEnv({}, { webSearchApiBase: `http://127.0.0.1:${fake.port}` });
    await env.pairRunner();
    ddgMode = "ok";
    expect((await env.api("/api/settings/integrations")).body.web_search).toMatchObject({ provider: "duckduckgo", order: ["duckduckgo"] });
    const result = await searchJob(env);
    expect(result).toMatchObject({ tool: "web_search", ok: true, summary: expect.stringContaining("2 web results") });
    expect(seen.at(-1)).toEqual({ path: "ddg", key: null, q: "sewa kamera KL" });
  });

  test("DuckDuckGo blocked → SearXNG takes over; nothing usable → the agent is told to use web_fetch", async () => {
    env = await createTestEnv({}, { webSearchApiBase: `http://127.0.0.1:${fake.port}` });
    await env.pairRunner();
    ddgMode = "captcha";
    const failed = await searchJob(env);
    expect(failed.ok).toBe(false);
    expect(failed.summary).toContain("web_fetch");

    const saved = await env.api("/api/settings/integrations/web-search", { method: "PUT", body: { provider: "duckduckgo", searxng_url: `http://127.0.0.1:${fake.port}` } });
    expect(saved.body.web_search.order).toEqual(["duckduckgo", "searxng"]);
    const r = await searchJob(env);
    expect(r.ok).toBe(true);
    expect(seen.slice(-2).map((s) => s.path)).toEqual(["ddg", "searxng"]);
    const test = (await env.api("/api/settings/integrations/web-search/test", { method: "POST" })).body;
    expect(test).toMatchObject({ ok: true, provider: "searxng" });
  });

  test("a paid key stays in the hub", async () => {
    env = await createTestEnv({}, { webSearchApiBase: `http://127.0.0.1:${fake.port}` });
    await env.pairRunner();
    const saved = await env.api("/api/settings/integrations/web-search", { method: "PUT", body: { provider: "brave", key_provider: "brave", api_key: "BSA-secret-key-123456" } });
    expect(saved.body.web_search).toMatchObject({ provider: "brave", key_provider: "brave", has_key: true, order: ["brave", "duckduckgo"] });
    expect(JSON.stringify((await env.api("/api/settings/integrations")).body)).not.toContain("BSA-secret-key-123456");
    const result = await searchJob(env);
    expect(result).toMatchObject({ tool: "web_search", ok: true });
    expect(seen.at(-1)).toEqual({ path: "brave", key: "BSA-secret-key-123456", q: "sewa kamera KL" });
    expect(JSON.stringify(env.hub.hub.store.state)).not.toContain("BSA-secret-key-123456");
  });
});
