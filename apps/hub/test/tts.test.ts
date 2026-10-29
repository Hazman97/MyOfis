import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { RunnerClient } from "../../runner/src/client.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";
import { join } from "node:path";

let env: TestEnv;
let fakeTts: ReturnType<typeof Bun.serve>;
let lastAuthHeader: string | null = null;
let lastBody: unknown = null;

beforeAll(() => {
  fakeTts = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/v1/audio/speech" && req.method === "POST") {
        lastAuthHeader = req.headers.get("authorization");
        lastBody = await req.json();
        // Return 1024 bytes of dummy audio data
        const dummyAudio = new Uint8Array(1024);
        return new Response(dummyAudio, {
          headers: { "content-type": "audio/mpeg" },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  });
});

afterAll(() => fakeTts.stop(true));
afterEach(async () => {
  await env?.close();
});

describe("Hub TTS Integration (Task 029)", () => {
  test("settings save, mask secret key, and return hint", async () => {
    env = await createTestEnv();

    const initial = await env.api("/api/settings/integrations");
    expect(initial.status).toBe(200);
    expect(initial.body.tts).toBeDefined();
    expect(initial.body.tts.has_key).toBe(false);

    // Save TTS settings
    const saveRes = await env.api("/api/settings/integrations/tts", {
      method: "PUT",
      body: {
        base_url: `http://127.0.0.1:${fakeTts.port}`,
        api_key: "sk-canopy-secret-9999",
        voice: "af_sarah",
        speed: 1.0,
      },
    });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.tts.has_key).toBe(true);
    expect(saveRes.body.tts.key_hint).toContain("9999");
    expect(JSON.stringify(saveRes.body)).not.toContain("sk-canopy-secret");

    // Fetch integrations again to ensure secret is masked
    const getRes = await env.api("/api/settings/integrations");
    expect(getRes.body.tts.has_key).toBe(true);
    expect(getRes.body.tts.key_hint).toContain("9999");
    expect(JSON.stringify(getRes.body)).not.toContain("sk-canopy-secret");
  });

  test("test route invokes endpoint and returns audio stats", async () => {
    env = await createTestEnv();

    await env.api("/api/settings/integrations/tts", {
      method: "PUT",
      body: {
        base_url: `http://127.0.0.1:${fakeTts.port}`,
        api_key: "sk-canopy-secret-9999",
        voice: "af_sarah",
        speed: 1.0,
      },
    });

    const testRes = await env.api("/api/settings/integrations/tts/test", {
      method: "POST",
      body: { text: "Ujian suara MyOfis." },
    });

    expect(testRes.status).toBe(200);
    expect(testRes.body.ok).toBe(true);
    expect(testRes.body.bytes).toBe(1024);
    expect(lastAuthHeader).toBe("Bearer sk-canopy-secret-9999");
    expect((lastBody as any)?.input).toBe("Ujian suara penjelas teknologi MyOfis.");
  });

  test("runner route /api/runner/tts requires authentication and gates by agent tool", async () => {
    env = await createTestEnv();

    // Pair runner explicitly to keep the token
    const { body: code } = await env.api<{ code: string }>("/api/runners/pairing-code", { method: "POST" });
    const { body: pair } = await env.api<{ token: string }>("/api/runners/pair", { body: { code: code.code, name: "tts-runner" }, auth: null });
    const runnerToken = pair.token;

    const runner = new RunnerClient({
      hubUrl: env.hub.url,
      token: runnerToken,
      name: "tts-runner",
      workspacesDir: join(env.dir, "workspaces"),
      log: () => {},
    });
    await runner.start();

    // 1. Unauthenticated runner
    const unauth = await fetch(`${env.hub.url}/api/runner/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run_id: "run_test", text: "Hai" }),
    });
    expect(unauth.status).toBe(401);

    // Create an agent WITHOUT explainer_render
    const { body: normalAgent } = await env.api("/api/agents", {
      body: {
        slug: "normal-bot",
        name: "Normal Bot",
        provider: "mock",
        model: "mock-script",
        tools: ["web_search"],
      },
    });

    // Create job & run for normal agent
    const { body: normalJob } = await env.api("/api/jobs", {
      body: {
        agent_id: normalAgent.agent.id,
        title: "Normal task",
        input: { script: [{ text: "done" }] },
      },
    });

    // Let the run be created
    await waitFor(() => Object.values(env.hub.hub.store.state.runs).some((r) => r.agent_id === normalAgent.agent.id), 4000);
    const normalRun = Object.values(env.hub.hub.store.state.runs).find((r) => r.agent_id === normalAgent.agent.id);
    expect(normalRun).toBeDefined();

    // 2. Normal agent without explainer_render is denied (403)
    const denied = await fetch(`${env.hub.url}/api/runner/tts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${runnerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ run_id: normalRun!.id, text: "Hai" }),
    });
    expect(denied.status).toBe(403);

    // Create an agent WITH explainer_render
    const { body: cikguAgent } = await env.api("/api/agents", {
      body: {
        slug: "cikgu-test",
        name: "Cikgu Test",
        provider: "mock",
        model: "mock-script",
        tools: ["explainer_render"],
      },
    });

    const { body: cikguJob } = await env.api("/api/jobs", {
      body: {
        agent_id: cikguAgent.agent.id,
        title: "Cikgu task",
        input: { script: [{ text: "done" }] },
      },
    });

    await waitFor(() => Object.values(env.hub.hub.store.state.runs).some((r) => r.agent_id === cikguAgent.agent.id), 4000);
    const cikguRun = Object.values(env.hub.hub.store.state.runs).find((r) => r.agent_id === cikguAgent.agent.id);
    expect(cikguRun).toBeDefined();

    // Configure TTS
    await env.api("/api/settings/integrations/tts", {
      method: "PUT",
      body: {
        base_url: `http://127.0.0.1:${fakeTts.port}`,
        api_key: "sk-canopy-secret-9999",
      },
    });

    // 3. Cikgu run allowed (200)
    const allowed = await fetch(`${env.hub.url}/api/runner/tts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${runnerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ run_id: cikguRun!.id, text: "WiFi 8 sangat pantas." }),
    });
    expect(allowed.status).toBe(200);
    const audioData = await allowed.arrayBuffer();
    expect(audioData.byteLength).toBe(1024);

    runner.stop();
  });
});
