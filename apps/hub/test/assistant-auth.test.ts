import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { freshFetch } from "@agent-office/shared";
import { RunnerClient } from "../../runner/src/client.ts";
import { ASSISTANT_DENY_RULES, isAssistantDenied } from "../src/auth.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

const TEAM = "myofis.cloudflareaccess.com";
const AUD = "aud-assistant-test";
const OWNER = "owner@example.com";
const SERVICE_CLIENT_ID = "e367826f93b8d71185e03fe518aff3b4.access";
const UNKNOWN_CLIENT_ID = "99999999999999999999999999999999.access";

let key: CryptoKey;
let wrongKey: CryptoKey;
let jwks: ReturnType<typeof Bun.serve>;
let env: TestEnv;
let runner: RunnerClient | null = null;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  key = pair.privateKey;
  const wrongPair = await generateKeyPair("RS256");
  wrongKey = wrongPair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  jwks = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ keys: [jwk] }) });
});

afterAll(() => jwks?.stop(true));

afterEach(async () => {
  runner?.stop();
  runner = null;
  await env?.close();
});

const signToken = (claims: Record<string, unknown>, opts?: { aud?: string; iss?: string; signKey?: CryptoKey }) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts?.iss ?? `https://${TEAM}`)
    .setAudience(opts?.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(opts?.signKey ?? key);

async function clientWithToken(token: string | null) {
  return async <T = any>(path: string, init: { method?: string; body?: unknown; rawBody?: Uint8Array; contentType?: string } = {}): Promise<{ status: number; body: T }> => {
    const headers: Record<string, string> = {
      "content-type": init.contentType ?? "application/json",
      origin: env.hub.url,
    };
    if (token) headers["cf-access-jwt-assertion"] = token;
    const res = await freshFetch(`${env.hub.url}${path}`, {
      method: init.method ?? (init.body !== undefined || init.rawBody !== undefined ? "POST" : "GET"),
      headers,
      body: init.rawBody ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      timeoutMs: 30_000,
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  };
}

async function start(ownerServiceTokens: string[] = [SERVICE_CLIENT_ID]) {
  env = await createTestEnv(
    {},
    {
      authMode: "cf-access",
      cfAccess: {
        teamDomain: TEAM,
        aud: AUD,
        ownerEmail: OWNER,
        certsUrl: `http://127.0.0.1:${jwks.port}/certs`,
        ownerServiceTokens,
      },
    },
  );
  const owner = await clientWithToken(await signToken({ email: OWNER }));
  const assistant = await clientWithToken(await signToken({ type: "app", common_name: SERVICE_CLIENT_ID, sub: "" }));
  return { owner, assistant };
}

describe("Task 027: owner assistant Cloudflare Access service token", () => {
  test("JWT verification: owner email, allowed service token, unknown client ID, missing/bad JWT, and feature off", async () => {
    const { owner, assistant } = await start([SERVICE_CLIENT_ID]);

    // Owner email JWT works as before
    const meOwner = await owner("/api/auth/me");
    expect(meOwner.status).toBe(200);
    expect(meOwner.body).toMatchObject({ ok: true, role: "owner", email: OWNER, workspace_id: "owner" });
    expect(meOwner.body.actor).toBeUndefined();
    expect(meOwner.body.via).toBeUndefined();

    // Configured service token (no email, matching common_name) -> owner + assistant marker
    const meAssistant = await assistant("/api/auth/me");
    expect(meAssistant.status).toBe(200);
    expect(meAssistant.body).toMatchObject({
      ok: true,
      role: "owner",
      email: OWNER,
      workspace_id: "owner",
      via: "service_token",
      actor: "assistant",
    });

    // Unknown service token client ID -> 401
    const unknownAssistant = await clientWithToken(await signToken({ type: "app", common_name: UNKNOWN_CLIENT_ID, sub: "" }));
    expect((await unknownAssistant("/api/auth/me")).status).toBe(401);

    // Token with neither email nor common_name -> 401
    const emptyClaims = await clientWithToken(await signToken({ type: "app", sub: "" }));
    expect((await emptyClaims("/api/auth/me")).status).toBe(401);

    // No token (even on localhost) -> 401
    const noToken = await clientWithToken(null);
    expect((await noToken("/api/auth/me")).status).toBe(401);

    // Wrong AUD -> 401
    const wrongAud = await clientWithToken(await signToken({ common_name: SERVICE_CLIENT_ID }, { aud: "wrong-aud" }));
    expect((await wrongAud("/api/auth/me")).status).toBe(401);

    // Wrong issuer -> 401
    const wrongIss = await clientWithToken(await signToken({ common_name: SERVICE_CLIENT_ID }, { iss: "https://evil.cloudflareaccess.com" }));
    expect((await wrongIss("/api/auth/me")).status).toBe(401);

    // Invalid signature -> 401
    const badSig = await clientWithToken(await signToken({ common_name: SERVICE_CLIENT_ID }, { signKey: wrongKey }));
    expect((await badSig("/api/auth/me")).status).toBe(401);

    // Feature off when OWNER_SERVICE_TOKENS is empty
    await env.close();
    const off = await start([]);
    expect((await off.owner("/api/auth/me")).status).toBe(200);
    expect((await off.assistant("/api/auth/me")).status).toBe(401);
  });

  test("every deny-list route returns 403 for the assistant and is allowed for the owner", async () => {
    const { owner, assistant } = await start([SERVICE_CLIENT_ID]);

    // Owner Settings -> Integrations shows Assistant access: on (token …access)
    const intRes = await owner("/api/settings/integrations");
    expect(intRes.status).toBe(200);
    expect(intRes.body.assistant).toEqual({ enabled: true, tokens: [`…${SERVICE_CLIENT_ID.slice(-6)}`] });

    // Create fixture project & draft as owner so route checks hit the guard, not 404
    const prj = (await owner("/api/projects", { body: { slug: "demo", name: "Demo" } })).body.project;
    const echo = ((await owner("/api/agents")).body.agents as { id: string; slug: string }[]).find((a) => a.slug === "echo")!;
    const prv = ((await owner("/api/providers")).body.providers as { id: string }[])[0]!;

    const deniedCalls: { method: string; path: string; body?: unknown }[] = [
      // Members
      { method: "GET", path: "/api/members" },
      { method: "POST", path: "/api/members", body: { email: "friend@example.com", name: "Friend" } },
      { method: "PATCH", path: "/api/members/usr_123", body: { disabled: true } },
      { method: "PUT", path: "/api/members/usr_123/shares", body: { shares: [] } },
      // Rooms create/update/members & move
      { method: "POST", path: "/api/rooms", body: { name: "Room 2" } },
      { method: "PATCH", path: "/api/rooms/rm_123", body: { name: "Room 2b" } },
      { method: "PUT", path: "/api/rooms/rm_123/members", body: { user_ids: [] } },
      { method: "POST", path: `/api/agents/${echo.id}/move`, body: { workspace_id: "owner" } },
      { method: "POST", path: `/api/projects/${prj.id}/move`, body: { workspace_id: "owner" } },
      // Pause & Integrations / Secrets
      { method: "POST", path: "/api/settings/pause", body: { paused: true } },
      { method: "GET", path: "/api/settings/integrations" },
      { method: "PUT", path: "/api/settings/integrations/web-search", body: { provider: "duckduckgo" } },
      { method: "POST", path: "/api/settings/integrations/web-search/test", body: {} },
      { method: "PUT", path: "/api/settings/integrations/telegram", body: { token: "123:abc", chat_id: "99" } },
      { method: "POST", path: "/api/settings/integrations/telegram/test", body: {} },
      { method: "PUT", path: "/api/settings/integrations/gitea", body: { url: "https://git.example.com", token: "tok" } },
      { method: "POST", path: "/api/settings/integrations/gitea/test", body: {} },
      // Social accounts & project social/publish secrets
      { method: "GET", path: "/api/social-accounts" },
      { method: "POST", path: "/api/social-accounts/zernio", body: { label: "Z", api_key: "zk" } },
      { method: "POST", path: "/api/social-accounts/z1/refresh", body: {} },
      { method: "PATCH", path: "/api/social-accounts/z1", body: { label: "Z2" } },
      { method: "DELETE", path: "/api/social-accounts/z1" },
      { method: "GET", path: `/api/projects/${prj.id}/publish` },
      { method: "PUT", path: `/api/projects/${prj.id}/publish`, body: { url: "https://example.com", secret: "sec" } },
      { method: "POST", path: `/api/projects/${prj.id}/publish/test`, body: {} },
      { method: "GET", path: `/api/projects/${prj.id}/facebook` },
      { method: "PUT", path: `/api/projects/${prj.id}/facebook`, body: { page_id: "1", token: "t" } },
      { method: "POST", path: `/api/projects/${prj.id}/facebook/test`, body: {} },
      { method: "GET", path: `/api/projects/${prj.id}/tiktok` },
      { method: "PUT", path: `/api/projects/${prj.id}/tiktok`, body: { api_key: "t" } },
      { method: "POST", path: `/api/projects/${prj.id}/tiktok/test`, body: {} },
      { method: "GET", path: `/api/projects/${prj.id}/instagram` },
      { method: "POST", path: `/api/projects/${prj.id}/instagram/connect`, body: {} },
      { method: "PUT", path: `/api/projects/${prj.id}/instagram`, body: { enabled: true } },
      { method: "GET", path: `/api/projects/${prj.id}/threads` },
      { method: "PUT", path: `/api/projects/${prj.id}/threads`, body: { token: "t" } },
      // Memory settings write
      { method: "PUT", path: "/api/memory/settings", body: { write_approval: false } },
      // Providers write/scan/test/models/check
      { method: "POST", path: "/api/providers", body: { slug: "p2", name: "P2", kind: "openai", api_key: "sk-123" } },
      { method: "PATCH", path: `/api/providers/${prv.id}`, body: { name: "Edited" } },
      { method: "DELETE", path: `/api/providers/${prv.id}` },
      { method: "POST", path: `/api/providers/${prv.id}/models`, body: { save: true } },
      { method: "POST", path: `/api/providers/${prv.id}/test`, body: { model: "m" } },
      { method: "POST", path: `/api/providers/${prv.id}/scan`, body: {} },
      { method: "POST", path: "/api/providers/check", body: { kind: "openai", base_url: null, api_key: "sk-1" } },
      // Runners pairing-code & revoke
      { method: "POST", path: "/api/runners/pairing-code", body: {} },
      { method: "POST", path: "/api/runners/rnr_123/revoke", body: {} },
      // Backups & storage/open
      { method: "GET", path: "/api/backups" },
      { method: "POST", path: "/api/backups", body: {} },
      { method: "POST", path: "/api/storage/open", body: { key: "files" } },
      // Skills catalog / import / delete / assign & proposal decide
      { method: "GET", path: "/api/skills/catalog" },
      { method: "POST", path: "/api/skills/catalog/install", body: { source: "anthropic", path: "x" } },
      { method: "POST", path: "/api/skills", body: { content: "---\nname: s\ndescription: d\n---\nbody" } },
      { method: "DELETE", path: "/api/skills/s" },
      { method: "PUT", path: "/api/skills/s/agents", body: { agent_ids: [] } },
      { method: "PUT", path: `/api/agents/${echo.id}/skills`, body: { skills: "all" } },
      { method: "POST", path: "/api/proposals/prp_123/decide", body: { decision: "approve" } },
      // Drafts approve/publish/schedule/account/takedown & tool approvals
      { method: "POST", path: "/api/drafts/drf_123/decide", body: { decision: "approve" } },
      { method: "POST", path: "/api/drafts/drf_123/publish", body: {} },
      { method: "POST", path: "/api/drafts/drf_123/schedule", body: { publish_at: null } },
      { method: "PATCH", path: "/api/drafts/drf_123/account", body: { account: null } },
      { method: "POST", path: "/api/drafts/drf_123/update-published", body: { title: "x" } },
      { method: "POST", path: "/api/drafts/drf_123/take-down", body: {} },
      { method: "POST", path: "/api/approvals/apr_123/decide", body: { decision: "approved" } },
      // Agent create/delete/external-token
      { method: "POST", path: "/api/agents", body: { slug: "new-a", name: "New", kind: "external" } },
      { method: "DELETE", path: `/api/agents/${echo.id}` },
      { method: "POST", path: `/api/agents/${echo.id}/external-token`, body: {} },
      // Schedules (a recurring job can post on its own)
      { method: "POST", path: "/api/schedules", body: { agent_id: echo.id, cron: "0 20 * * *", job_type: "tiktok_post" } },
      { method: "PATCH", path: "/api/schedules/sch_123", body: { enabled: true } },
      { method: "DELETE", path: "/api/schedules/sch_123" },
      { method: "POST", path: "/api/schedules/sch_123/run-now", body: {} },
    ];

    expect(ASSISTANT_DENY_RULES.length).toBeGreaterThanOrEqual(19);
    for (const call of deniedCalls) {
      expect(isAssistantDenied(call.method, call.path)).toBeTruthy();
      const res = await assistant(call.path, { method: call.method, body: call.body });
      expect([call.method, call.path, res.status]).toEqual([call.method, call.path, 403]);
    }
  });

  test("assistant allowed actions: chat, jobs with created_by marker, uploads, reads, restricted agent patch, and cancelling only its own runs", async () => {
    const { owner, assistant } = await start([SERVICE_CLIENT_ID]);
    const { body: code } = await owner<{ code: string }>("/api/runners/pairing-code", { method: "POST" });
    const { body: paired } = await owner<{ token: string }>("/api/runners/pair", { body: { code: code.code, name: "pc" } });
    runner = new RunnerClient({ hubUrl: env.hub.url, token: paired.token, name: "pc", workspacesDir: join(env.dir, "workspaces"), log: () => {} });
    await runner.start();

    const echo = ((await assistant("/api/agents")).body.agents as { id: string; slug: string }[]).find((a) => a.slug === "echo")!;
    expect(echo).toBeDefined();

    // 1. Upload file as assistant
    const up = await assistant("/api/uploads?name=test.png", {
      method: "POST",
      rawBody: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      contentType: "image/png",
    });
    expect(up.status).toBe(201);
    expect((await assistant(`/api/uploads/${up.body.upload.id}`)).status).toBe(200);

    // 2. Create chat and job as assistant -> carry created_by: "assistant"
    const chatRes = await assistant("/api/chat", { body: { agent_id: echo.id, text: "Hello from Claude assistant" } });
    expect(chatRes.status).toBe(201);
    expect(chatRes.body.job.created_by).toBe("assistant");
    await waitFor(() => env.hub.hub.store.state.jobs[chatRes.body.job.id]?.status === "done", 10_000, "assistant chat");

    const thread = await assistant(`/api/chat/threads/${chatRes.body.thread_id}`);
    expect(thread.status).toBe(200);
    expect(thread.body.messages[0].created_by).toBe("assistant");

    const stateRes = await assistant("/api/state");
    expect(stateRes.status).toBe(200);
    expect(stateRes.body.state.jobs[chatRes.body.job.id]?.created_by).toBe("assistant");

    // 3. Cancel job/run: assistant can cancel its own job, but NOT a job started by the owner
    runner.stop();
    runner = null;
    const ownerJob = (await owner("/api/jobs", { body: { agent_id: echo.id, title: "owner job", input: { text: "wait" } } })).body.job;
    expect(ownerJob.created_by).toBeUndefined();
    const asstJob = (await assistant("/api/jobs", { body: { agent_id: echo.id, title: "asst job", input: { text: "wait" } } })).body.job;
    expect(asstJob.created_by).toBe("assistant");

    expect((await assistant(`/api/jobs/${ownerJob.id}/cancel`, { method: "POST" })).status).toBe(403);
    expect((await assistant(`/api/jobs/${asstJob.id}/cancel`, { method: "POST" })).status).toBe(200);

    // 4. PATCH /api/agents/:id: assistant may edit prompt/role/temperature, but NOT auto_publish, runner_id, tools, provider, permission_level
    const okPatch = await assistant(`/api/agents/${echo.id}`, {
      method: "PATCH",
      body: { role: "Updated by assistant", system_prompt: "Be concise.", config: { temperature: 0.3, max_steps: 6 } },
    });
    expect(okPatch.status).toBe(200);
    expect(okPatch.body.agent.role).toBe("Updated by assistant");
    // sending the whole config back unchanged (arrays included) is not a change
    const full = okPatch.body.agent.config;
    expect((await assistant(`/api/agents/${echo.id}`, { method: "PATCH", body: { config: { ...full, max_steps: 7 } } })).status).toBe(200);

    for (const forbidden of [
      { provider: "mock" },
      { runner_id: null },
      { tools: ["save_draft"] },
      { permission_level: "auto" },
      { config: { auto_publish: true } },
      { config: { clip_folder: "/tmp" } },
      { config: { runtime: "opencode" } },
      { config: { auto_publish_daily_max: 50 } },
      { config: { tiktok_account: "acc_9" } },
      { config: { shell_allowlist: ["rm"] } },
      { config: { read_paths: ["C:\\"] } },
      { config: { http_allowlist: ["169.254.169.254"] } },
    ]) {
      const res = await assistant(`/api/agents/${echo.id}`, { method: "PATCH", body: forbidden });
      expect([forbidden, res.status]).toEqual([forbidden, 403]);
    }

    // 5. Read routes allowed for the assistant
    for (const path of ["/api/events", "/api/runs", "/api/drafts", "/api/videos", "/api/projects", "/api/runners", "/api/providers", "/api/skills", "/api/approvals", "/api/settings", "/api/rooms", "/api/tools", "/api/system", "/api/storage"]) {
      const res = await assistant(path);
      expect([path, res.status]).toEqual([path, 200]);
    }
  });
});

