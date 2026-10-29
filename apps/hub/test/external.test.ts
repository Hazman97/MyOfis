import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { freshFetch } from "@agent-office/shared";
import { EXTERNAL_RUNNER_ID } from "../src/core.ts";
import { hashToken } from "../src/crypto.ts";
import { mapHookPayload, sendActivity, summarizeToolInput } from "../../../scripts/external-agent-hook.ts";
import { createTestEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

async function postActivity(url: string, token: string | null, body: unknown, rawBody?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const res = await freshFetch(`${url}/api/external/activity`, {
    method: "POST",
    headers,
    body: rawBody ?? JSON.stringify(body),
    timeoutMs: 10_000,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("external agents (hub)", () => {
  test("creates an external agent without provider/model, hashes its token, and blocks hub job dispatch", async () => {
    env = await createTestEnv();

    // Built-in seeded agents are never external
    const initial = await env.api("/api/agents");
    expect(initial.body.agents.every((a: any) => !a.config.external && a.kind === "builtin")).toBe(true);

    // Create external agent via kind: "external"
    const created = await env.api("/api/agents", {
      body: { slug: "canopy-worker-1", name: "Canopy Worker 1", role: "Canopy worker · Qwen 27B", kind: "external" },
    });
    expect(created.status).toBe(201);
    const agent = created.body.agent;
    expect(agent.config.external).toBe(true);
    expect(agent.kind).toBe("external");
    expect(agent.provider).toBe("external");
    expect(agent.model).toBe("external");
    expect(agent.external_token_hint).toBeNull();

    // Non-external agents cannot issue an external token
    const builtinId = initial.body.agents[0].id;
    expect((await env.api(`/api/agents/${builtinId}/external-token`, { method: "POST" })).status).toBe(400);

    // Issue external token once; only its SHA-256 hash is stored in DB
    const tokRes = await env.api(`/api/agents/${agent.id}/external-token`, { method: "POST" });
    expect(tokRes.status).toBe(200);
    const token = tokRes.body.token as string;
    expect(token.length).toBeGreaterThan(30);
    expect(tokRes.body.token_hint).toBe(`••••${token.slice(-4)}`);

    const rawSettings = JSON.stringify(env.hub.hub.db.query.settings.findMany().sync());
    expect(rawSettings).not.toContain(token);
    expect(rawSettings).toContain(hashToken(token));

    // Hint shows on GET /api/agents, never the plaintext token or hash
    const afterList = await env.api("/api/agents");
    const listed = afterList.body.agents.find((a: any) => a.id === agent.id);
    expect(listed.external_token_hint).toBe(`••••${token.slice(-4)}`);
    expect(JSON.stringify(afterList.body)).not.toContain(token);
    expect(JSON.stringify(afterList.body)).not.toContain(hashToken(token));

    // External agents cannot be given jobs, chats, or schedules from the hub
    expect((await env.api("/api/jobs", { body: { agent_id: agent.id, title: "Manual task" } })).status).toBe(400);
    expect((await env.api("/api/chat", { body: { agent_id: agent.id, text: "Hello" } })).status).toBe(400);
    expect(
      (
        await env.api("/api/schedules", {
          body: { agent_id: agent.id, cron: "0 8 * * *", job_template: { title: "Daily" } },
        })
      ).status,
    ).toBe(400);

    // Deleting the external agent removes it and invalidates its token
    expect((await env.api(`/api/agents/${agent.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await postActivity(env.hub.url, token, { session_id: "s1", event: "start" })).status).toBe(401);
  });

  test("rejects missing, wrong, or rotated tokens and attributes activity to the token's own agent", async () => {
    env = await createTestEnv();
    const a1 = (await env.api("/api/agents", { body: { slug: "ext-1", name: "Ext 1", kind: "external" } })).body.agent;
    const a2 = (await env.api("/api/agents", { body: { slug: "ext-2", name: "Ext 2", kind: "external" } })).body.agent;
    const t1 = (await env.api(`/api/agents/${a1.id}/external-token`, { method: "POST" })).body.token as string;
    const t2 = (await env.api(`/api/agents/${a2.id}/external-token`, { method: "POST" })).body.token as string;

    expect((await postActivity(env.hub.url, null, { session_id: "s1", event: "start" })).status).toBe(401);
    expect((await postActivity(env.hub.url, "wrong-token", { session_id: "s1", event: "start" })).status).toBe(401);

    // Rotate a1's token -> old t1 is immediately rejected
    const t1New = (await env.api(`/api/agents/${a1.id}/external-token`, { method: "POST" })).body.token as string;
    expect((await postActivity(env.hub.url, t1, { session_id: "s1", event: "start" })).status).toBe(401);

    // Using t2 attributes the job & run to a2, never a1
    const res2 = await postActivity(env.hub.url, t2, { session_id: "s-a2", event: "start", title: "Work by Ext 2" });
    expect(res2.status).toBe(200);
    const job2 = env.hub.hub.store.state.jobs[res2.body.job_id];
    expect(job2?.agent_id).toBe(a2.id);
    expect(env.hub.hub.store.state.agents[a1.id]).toBeUndefined();
    expect(env.hub.hub.store.state.agents[a2.id]?.activity).toBe("working");

    // t1New works for a1
    const res1 = await postActivity(env.hub.url, t1New, { session_id: "s-a1", event: "start", title: "Work by Ext 1" });
    expect(res1.status).toBe(200);
    expect(env.hub.hub.store.state.jobs[res1.body.job_id]?.agent_id).toBe(a1.id);
  });

  test("full session start -> thinking -> tool -> tool_result -> done drives reducer state and hides pseudo-runner", async () => {
    env = await createTestEnv();
    const agent = (await env.api("/api/agents", { body: { slug: "canopy-w1", name: "Canopy W1", kind: "external" } })).body.agent;
    const { token } = (await env.api(`/api/agents/${agent.id}/external-token`, { method: "POST" })).body;

    // 1. start
    const started = await postActivity(env.hub.url, token, {
      session_id: "sess-full",
      event: "start",
      title: "Fix login race condition",
    });
    expect(started.status).toBe(200);
    const { job_id, run_id } = started.body;
    expect(env.hub.hub.store.state.jobs[job_id]).toMatchObject({
      id: job_id,
      agent_id: agent.id,
      type: "external",
      title: "Fix login race condition",
      status: "running",
    });
    expect(env.hub.hub.store.state.runs[run_id]).toMatchObject({
      id: run_id,
      job_id,
      agent_id: agent.id,
      runner_id: EXTERNAL_RUNNER_ID,
      status: "running",
    });
    expect(env.hub.hub.store.state.agents[agent.id]?.activity).toBe("working");

    // Pseudo-runner must NOT appear on GET /api/runners or in state.runners
    const runnersRes = await env.api("/api/runners");
    expect(runnersRes.body.runners.some((r: any) => r.id === EXTERNAL_RUNNER_ID)).toBe(false);
    expect(env.hub.hub.store.state.runners[EXTERNAL_RUNNER_ID]).toBeUndefined();

    // 2. thinking
    await postActivity(env.hub.url, token, {
      session_id: "sess-full",
      event: "thinking",
      summary: "Inspecting auth middleware",
    });
    expect(env.hub.hub.store.state.agents[agent.id]?.activity).toBe("working");
    expect(env.hub.hub.store.state.agents[agent.id]?.thinking).toBe("Inspecting auth middleware");

    // 3. tool (Edit -> category "code")
    await postActivity(env.hub.url, token, {
      session_id: "sess-full",
      event: "tool",
      tool: "Edit",
      input_summary: "apps/hub/src/auth.ts",
    });
    expect(env.hub.hub.store.state.agents[agent.id]?.activity).toBe("working");
    expect(env.hub.hub.store.state.agents[agent.id]?.last_tool).toBe("Edit");
    expect(env.hub.hub.store.state.agents[agent.id]?.last_tool_category).toBe("code");

    // 4. tool_result
    await postActivity(env.hub.url, token, {
      session_id: "sess-full",
      event: "tool_result",
      tool: "Edit",
      ok: true,
      summary: "Edit apps/hub/src/auth.ts (ok)",
    });
    expect(env.hub.hub.store.state.agents[agent.id]?.activity).toBe("working");

    // 5. done
    const done = await postActivity(env.hub.url, token, {
      session_id: "sess-full",
      event: "done",
      output: "Patched race condition in auth middleware and added unit test.",
    });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("done");
    expect(env.hub.hub.store.state.jobs[job_id]?.status).toBe("done");
    expect(env.hub.hub.store.state.runs[run_id]?.status).toBe("done");
    expect(env.hub.hub.store.state.runs[run_id]?.output).toContain("Patched race condition in auth middleware");
    expect(env.hub.hub.store.state.agents[agent.id]?.activity).toBe("idle");
    expect(env.hub.hub.store.state.agents[agent.id]?.moment?.kind).toBe("delivered");

    const runDetail = await env.api(`/api/runs/${run_id}`);
    expect(runDetail.status).toBe(200);
    const types = runDetail.body.events.map((e: any) => e.type);
    expect(types).toEqual([
      "run.started",
      "agent.thinking",
      "agent.tool_call",
      "agent.tool_result",
      "agent.message",
      "run.finished",
    ]);
  });

  test("implicitly starts an unknown session_id on a non-start event and fails stale sessions after 30 min", async () => {
    env = await createTestEnv({ sweepMs: 60_000 });
    const agent = (await env.api("/api/agents", { body: { slug: "canopy-w2", name: "Canopy W2", kind: "external" } })).body.agent;
    const { token } = (await env.api(`/api/agents/${agent.id}/external-token`, { method: "POST" })).body;

    // Non-start event on unknown session_id -> starts implicitly with title "(external work)"
    const res = await postActivity(env.hub.url, token, {
      session_id: "implicit-sess",
      event: "tool",
      tool: "Bash",
      input_summary: "bun test",
    });
    expect(res.status).toBe(200);
    const { job_id, run_id } = res.body;
    expect(env.hub.hub.store.state.jobs[job_id]?.title).toBe("(external work)");
    expect(env.hub.hub.store.state.jobs[job_id]?.status).toBe("running");
    expect(env.hub.hub.store.state.agents[agent.id]?.last_tool_category).toBe("shell");

    // At 25 minutes of silence, sweep() does NOT cancel or fail the external run
    env.hub.hub.sweep(Date.now() + 25 * 60_000);
    expect(env.hub.hub.store.state.runs[run_id]?.status).toBe("running");

    // After 30 minutes of silence, sweep() fails the run with "lost contact"
    env.hub.hub.sweep(Date.now() + 31 * 60_000);
    expect(env.hub.hub.store.state.runs[run_id]?.status).toBe("failed");
    expect(env.hub.hub.store.state.runs[run_id]?.error).toBe("lost contact");
    expect(env.hub.hub.store.state.jobs[job_id]?.status).toBe("failed");
    expect(env.hub.hub.store.state.agents[agent.id]?.activity).toBe("idle");
    expect(env.hub.hub.store.state.agents[agent.id]?.moment?.kind).toBe("failed");
  });

  test("enforces 16 KB body limit and 20 events/s per-token rate limit", async () => {
    env = await createTestEnv();
    const agent = (await env.api("/api/agents", { body: { slug: "canopy-w3", name: "Canopy W3", kind: "external" } })).body.agent;
    const { token } = (await env.api(`/api/agents/${agent.id}/external-token`, { method: "POST" })).body;

    // Body > 16 KB -> 400
    const oversize = JSON.stringify({ session_id: "s-big", event: "thinking", summary: "x".repeat(17_000) });
    const bigRes = await postActivity(env.hub.url, token, null, oversize);
    expect(bigRes.status).toBe(400);
    expect(bigRes.body.error).toContain("body too large");

    // 20 events in the same second succeed; the 21st returns 429
    for (let i = 0; i < 20; i++) {
      const r = await postActivity(env.hub.url, token, { session_id: "s-rate", event: "thinking", summary: `step ${i}` });
      expect(r.status).toBe(200);
    }
    const limited = await postActivity(env.hub.url, token, { session_id: "s-rate", event: "thinking", summary: "overflow" });
    expect(limited.status).toBe(429);
  });
});

describe("external agents workspace isolation & cf-access compatibility", () => {
  const TEAM = "myofis.cloudflareaccess.com";
  const AUD = "aud-external-test";
  const OWNER = "owner@example.com";
  const MEMBER = "ali@example.com";
  let key: CryptoKey;
  let jwks: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    jwks = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ keys: [jwk] }) });
  });
  afterAll(() => jwks?.stop(true));

  const jwt = (email: string) =>
    new SignJWT({ email })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);

  async function clientAs(email: string) {
    const token = await jwt(email);
    return async <T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> => {
      const res = await freshFetch(`${env.hub.url}${path}`, {
        method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
        headers: { "cf-access-jwt-assertion": token, "content-type": "application/json", origin: env.hub.url },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        timeoutMs: 30_000,
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
  }

  test("activity route works without CF Access user JWT, is owner-only to manage, and isolates workspace events", async () => {
    env = await createTestEnv(
      {},
      { authMode: "cf-access", cfAccess: { teamDomain: TEAM, aud: AUD, ownerEmail: OWNER, certsUrl: `http://127.0.0.1:${jwks.port}/certs` } },
    );
    const owner = await clientAs(OWNER);
    await owner("/api/members", { body: { email: MEMBER, name: "Ali" } });
    const ali = await clientAs(MEMBER);

    // Member cannot create an external agent
    expect((await ali("/api/agents", { body: { slug: "ali-ext", name: "Ali Ext", kind: "external" } })).status).toBe(403);

    // Owner creates an external agent and token
    const created = await owner("/api/agents", { body: { slug: "owner-ext", name: "Owner Ext", kind: "external" } });
    expect(created.status).toBe(201);
    const agentId = created.body.agent.id;
    const { token } = (await owner(`/api/agents/${agentId}/external-token`, { method: "POST" })).body;

    // Member cannot issue token or delete agent
    expect((await ali(`/api/agents/${agentId}/external-token`, { method: "POST" })).status).toBe(403);
    expect((await ali(`/api/agents/${agentId}`, { method: "DELETE" })).status).toBe(403);

    // Activity route works without any CF Access header (only Bearer external token)
    const act = await postActivity(env.hub.url, token, {
      session_id: "cf-sess-1",
      event: "start",
      title: "Owner confidential task",
    });
    expect(act.status).toBe(200);

    // Owner sees the job and events; member Ali does NOT
    const ownerState = await owner("/api/state");
    expect(ownerState.body.state.jobs[act.body.job_id]?.title).toBe("Owner confidential task");

    const aliState = await ali("/api/state");
    expect(aliState.body.state.jobs[act.body.job_id]).toBeUndefined();
    const aliEvents = await ali("/api/events");
    expect(aliEvents.body.events.some((e: any) => e.agent_id === agentId)).toBe(false);
  });
});

describe("external-agent-hook payload mapping", () => {
  test("maps SessionStart, PreToolUse, PostToolUse, and Stop and strips file contents and secrets", () => {
    const start = mapHookPayload({
      session_id: "claude-sess-42",
      hook_event_name: "SessionStart",
      cwd: "C:\\Users\\Hazman\\.canopy-worker\\task-025",
    });
    expect(start).toEqual({
      session_id: "claude-sess-42",
      event: "start",
      title: "Claude Code · Hazman/.canopy-worker/task-025",
    });

    // PreToolUse on Edit: includes short file path, never old_string or new_string file contents
    const preEdit = mapHookPayload({
      session_id: "claude-sess-42",
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: {
        file_path: "/home/dev/repo/apps/hub/src/core.ts",
        old_string: "const SUPER_SECRET_CONTENT = 'sk-ant-api03-1234567890abcdef';",
        new_string: "const NEW_FILE_BODY = 'never-store-this-in-events';",
      },
    });
    expect(preEdit).toEqual({
      session_id: "claude-sess-42",
      event: "tool",
      tool: "Edit",
      input_summary: "hub/src/core.ts",
    });
    expect(JSON.stringify(preEdit)).not.toContain("SUPER_SECRET_CONTENT");
    expect(JSON.stringify(preEdit)).not.toContain("NEW_FILE_BODY");
    expect(JSON.stringify(preEdit)).not.toContain("sk-ant-");

    // PreToolUse on Bash: redacts inline env secrets and tokens
    const preBash = mapHookPayload({
      session_id: "claude-sess-42",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: "API_KEY=sk-secret123456789 bun test apps/hub/test/external.test.ts",
      },
    });
    expect(preBash).toEqual({
      session_id: "claude-sess-42",
      event: "tool",
      tool: "Bash",
      input_summary: "bun test apps/hub/test/external.test.ts",
    });
    expect(JSON.stringify(preBash)).not.toContain("sk-secret");

    // PostToolUse: never includes stdout/file content from tool_response
    const postRead = mapHookPayload({
      session_id: "claude-sess-42",
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/repo/packages/shared/src/entities.ts" },
      tool_response: { content: "FULL FILE CONTENTS THAT MUST NEVER BE SENT" },
    });
    expect(postRead).toEqual({
      session_id: "claude-sess-42",
      event: "tool_result",
      tool: "Read",
      ok: true,
      summary: "Read shared/src/entities.ts (ok)",
    });
    expect(JSON.stringify(postRead)).not.toContain("FULL FILE CONTENTS");

    // PostToolUseFailure -> ok: false
    const postFail = mapHookPayload({
      session_id: "claude-sess-42",
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: { command: "bun run typecheck" },
      tool_response: { exit_code: 1, stderr: "error TS2322" },
    });
    expect(postFail?.ok).toBe(false);
    expect(postFail?.summary).toBe("Bash bun run typecheck (failed)");

    // Stop -> done
    const stop = mapHookPayload({
      session_id: "claude-sess-42",
      hook_event_name: "Stop",
      stop_hook_active: false,
    });
    expect(stop).toEqual({
      session_id: "claude-sess-42",
      event: "done",
      output: "Session finished",
    });

    // WebFetch URL strips query string and credentials
    expect(summarizeToolInput("WebFetch", { url: "https://user:pass@example.com/api/data?token=secret123" })).toBe(
      "example.com/api/data",
    );
  });

  test("sendActivity posts to /api/external/activity and swallows network errors without throwing", async () => {
    env = await createTestEnv();
    const agent = (await env.api("/api/agents", { body: { slug: "hook-bot", name: "Hook Bot", kind: "external" } })).body.agent;
    const { token } = (await env.api(`/api/agents/${agent.id}/external-token`, { method: "POST" })).body;

    const payload = mapHookPayload({
      session_id: "hook-live-1",
      hook_event_name: "SessionStart",
      cwd: "/work/.canopy-worker/branch-a",
    })!;
    const ok = await sendActivity(payload, { url: env.hub.url, token });
    expect(ok).toBe(true);
    expect(env.hub.hub.store.state.agents[agent.id]?.activity).toBe("working");

    // Unreachable port -> returns false, never throws
    const failed = await sendActivity(payload, { url: "http://127.0.0.1:1", token, timeoutMs: 200 });
    expect(failed).toBe(false);
  });
});
