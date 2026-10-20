import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { createTestEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

/** An OpenAI-compatible server: "smart" calls the tool, "chatty" only talks, a wrong key is refused. */
let server: ReturnType<typeof Bun.serve>;
const seenKeys: (string | null)[] = [];
beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      seenKeys.push(req.headers.get("authorization"));
      if (req.headers.get("authorization") !== "Bearer good-key") return Response.json({ error: { message: "Invalid API key" } }, { status: 401 });
      if (path === "/v1/models") return Response.json({ object: "list", data: [{ id: "smart" }, { id: "chatty" }, { id: "smart" }] });
      const body = (await req.json()) as { model: string; tools?: unknown[] };
      expect(body.tools).toHaveLength(1);
      // like 9Router: a non-streaming answer followed by a stray "data: [DONE]"
      if (body.model === "smart")
        return new Response(
          `${JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_time", arguments: '{"city":"Kuala Lumpur"}' } }] } }] })}

data: [DONE]`,
          { headers: { "content-type": "application/json" } },
        );
      return Response.json({ choices: [{ message: { content: "It is probably afternoon." } }] });
    },
  });
});
afterAll(() => server.stop(true));

test("load a provider's models and test which ones really call tools; keys stay on the hub", async () => {
  env = await createTestEnv();
  const base = `http://127.0.0.1:${server.port}/v1`;
  const p = (await env.api("/api/providers", { body: { slug: "router", name: "Router", kind: "openai_compatible", base_url: base, api_key: "good-key", models: [] } })).body.provider;

  const listed = (await env.api(`/api/providers/${p.id}/models`, { body: { save: true } })).body;
  expect(listed.models).toEqual(["chatty", "smart"]);
  expect((await env.api("/api/providers")).body.providers.find((x: { id: string }) => x.id === p.id).models).toEqual(["chatty", "smart"]);

  const smart = (await env.api(`/api/providers/${p.id}/test`, { body: { model: "smart" } })).body.test;
  expect(smart).toMatchObject({ ok: true, tool_calls: true, error: null, reply: 'get_time({"city":"Kuala Lumpur"})' });
  const chatty = (await env.api(`/api/providers/${p.id}/test`, { body: { model: "chatty" } })).body.test;
  expect(chatty).toMatchObject({ ok: true, tool_calls: false, reply: "It is probably afternoon." });

  // check before saving (outside endpoints too), and a scan that keeps only the models that call tools
  expect((await env.api("/api/providers/check", { body: { kind: "openai_compatible", base_url: base, api_key: "good-key" } })).body.check).toEqual({ ok: true, models: 2, error: null });
  expect((await env.api("/api/providers/check", { body: { kind: "openai_compatible", base_url: "http://127.0.0.1:1/v1", api_key: null } })).body.check.ok).toBe(false);
  // editing without retyping the key uses the saved one
  expect((await env.api("/api/providers/check", { body: { kind: "openai_compatible", base_url: base, api_key: null, provider_id: p.id } })).body.check.ok).toBe(true);
  const scan = (await env.api(`/api/providers/${p.id}/scan`, { method: "POST" })).body;
  expect(scan.working).toEqual(["smart"]);
  expect(scan.results.map((r: { model: string; tool_calls: boolean }) => [r.model, r.tool_calls])).toEqual([["smart", true], ["chatty", false]]);
  expect((await env.api("/api/providers")).body.providers.find((x: { id: string }) => x.id === p.id).models).toEqual(["smart"]);

  // a wrong key: a clear error, not a crash; the key never shows up in answers
  await env.api(`/api/providers/${p.id}`, { method: "PATCH", body: { api_key: "bad-key" } });
  const bad = (await env.api(`/api/providers/${p.id}/test`, { body: { model: "smart" } })).body.test;
  expect(bad).toMatchObject({ ok: false, tool_calls: false, error: "Invalid API key" });
  const badList = await env.api(`/api/providers/${p.id}/models`, { body: {} });
  expect(badList.status).toBe(400);
  expect(JSON.stringify(badList.body)).toContain("401");
  expect(JSON.stringify([listed, smart, chatty, bad, badList.body])).not.toContain("good-key");
});
