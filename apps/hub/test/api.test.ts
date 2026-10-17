import { afterEach, describe, expect, test } from "bun:test";
import { Secrets } from "../src/crypto.ts";
import { TOKEN, createTestEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

describe("auth (local mode)", () => {
  test("rejects missing or wrong token", async () => {
    env = await createTestEnv();
    expect((await env.api("/api/agents", { auth: null })).status).toBe(401);
    expect((await env.api("/api/agents", { auth: "nope" })).status).toBe(401);
    expect((await env.api("/api/agents")).status).toBe(200);
    expect((await env.api("/api/health", { auth: null })).status).toBe(200);
  });

  test("login sets a cookie that authenticates, wrong token does not", async () => {
    env = await createTestEnv();
    const bad = await fetch(`${env.hub.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "wrong" }),
    });
    expect(bad.status).toBe(401);
    const ok = await fetch(`${env.hub.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN }),
    });
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const me = await fetch(`${env.hub.url}/api/auth/me`, { headers: { cookie: cookie.split(";")[0]! } });
    expect(me.status).toBe(200);
    const forged = await fetch(`${env.hub.url}/api/auth/me`, { headers: { cookie: "ao_session=99999999999999.abc" } });
    expect(forged.status).toBe(401);
  });

  test("web socket requires auth", async () => {
    env = await createTestEnv();
    const res = await fetch(`${env.hub.url}/ws/web`);
    expect(res.status).toBe(401);
    const runner = await fetch(`${env.hub.url}/ws/runner`, { headers: { authorization: "Bearer junk" } });
    expect(runner.status).toBe(401);
  });

  test("cross-origin POST is blocked", async () => {
    env = await createTestEnv();
    const res = await fetch(`${env.hub.url}/api/settings/pause`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example", authorization: `Bearer ${TOKEN}` },
      body: "paused=true",
    });
    expect(res.status).toBe(403);
  });
});

describe("pairing", () => {
  test("code is single use", async () => {
    env = await createTestEnv();
    const { body } = await env.api("/api/runners/pairing-code", { method: "POST" });
    expect(body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const first = await env.api("/api/runners/pair", { body: { code: body.code.toLowerCase(), name: "a" }, auth: null });
    expect(first.status).toBe(200);
    expect(first.body.token.length).toBeGreaterThan(30);
    const second = await env.api("/api/runners/pair", { body: { code: body.code, name: "b" }, auth: null });
    expect(second.status).toBe(401);
    const bogus = await env.api("/api/runners/pair", { body: { code: "AAAA-BBBB", name: "c" }, auth: null });
    expect(bogus.status).toBe(401);
  });

  test("revoked runner is disconnected and cannot reconnect", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const { body } = await env.api("/api/runners");
    const id = body.runners[0].id;
    await env.api(`/api/runners/${id}/revoke`, { method: "POST" });
    expect(env.hub.hub.conns.size).toBe(0);
    expect(env.hub.hub.store.state.runners[id]?.online).toBe(false);
  });
});

describe("providers", () => {
  test("API key is write-only and encrypted at rest", async () => {
    env = await createTestEnv();
    const created = await env.api("/api/providers", {
      body: { slug: "anthropic", name: "Anthropic", kind: "anthropic", api_key: "sk-ant-api03-secretsecretsecret1234" },
    });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain("secretsecret");
    expect(created.body.provider.has_api_key).toBe(true);
    expect(created.body.provider.api_key_hint).toBe("••••1234");

    const list = await env.api("/api/providers");
    expect(JSON.stringify(list.body)).not.toContain("secretsecret");

    const row = env.hub.hub.db.query.providers.findFirst({ where: (p, { eq }) => eq(p.slug, "anthropic") }).sync()!;
    expect(row.api_key_enc).not.toContain("secret");
    expect(new Secrets("test-secrets-key-0123456789abcdef0123456789").decrypt(row.api_key_enc!)).toBe(
      "sk-ant-api03-secretsecretsecret1234",
    );
  });

  test("custom OpenAI-compatible provider needs a base URL; in-use provider cannot be deleted", async () => {
    env = await createTestEnv();
    const noUrl = await env.api("/api/providers", { body: { slug: "mine", name: "Mine", kind: "openai_compatible" } });
    expect(noUrl.status).toBe(400);
    const ok = await env.api("/api/providers", {
      body: { slug: "mine", name: "Mine", kind: "openai_compatible", base_url: "http://127.0.0.1:1234/v1", models: ["qwen"] },
    });
    expect(ok.status).toBe(201);
    const { body } = await env.api("/api/providers");
    const mock = body.providers.find((p: { slug: string }) => p.slug === "mock");
    expect((await env.api(`/api/providers/${mock.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await env.api(`/api/providers/${ok.body.provider.id}`, { method: "DELETE" })).status).toBe(200);
  });

  test("presets list ends with Custom", async () => {
    env = await createTestEnv();
    const { body } = await env.api("/api/providers/presets");
    expect(body.presets[0].id).toBe("anthropic");
    expect(body.presets.at(-1).id).toBe("custom");
  });
});

describe("validation", () => {
  test("bad job input returns 400 with issues", async () => {
    env = await createTestEnv();
    const res = await env.api("/api/jobs", { body: { title: "" } });
    expect(res.status).toBe(400);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  test("agent patch only changes sent fields", async () => {
    env = await createTestEnv();
    const { body } = await env.api("/api/agents");
    const echo = body.agents[0];
    const res = await env.api(`/api/agents/${echo.id}`, { method: "PATCH", body: { name: "Echo 2" } });
    expect(res.body.agent.name).toBe("Echo 2");
    expect(res.body.agent.system_prompt).toBe(echo.system_prompt);
    expect(res.body.agent.daily_token_budget).toBe(echo.daily_token_budget);
  });
});

describe("office assets", () => {
  test("serves map art from MAPS_DIR behind auth, flat names only", async () => {
    env = await createTestEnv();
    const map = await env.api("/api/office/assets/office.tmj");
    expect(map.status).toBe(200);
    expect(map.body.type).toBe("map");
    expect((await env.api("/api/office/assets/office.tmj", { auth: null })).status).toBe(401);
    expect((await env.api("/api/office/assets/nope.png")).status).toBe(404);
    for (const bad of ["..%2F.env", "%2E%2E%5Csecret.json", ".hidden.json", "x.svg", "office.tmj.html"]) {
      expect((await env.api(`/api/office/assets/${bad}`)).status).toBeOneOf([400, 404]);
    }
  });
});
