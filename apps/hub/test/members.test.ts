import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { freshFetch } from "@agent-office/shared";
import { RunnerClient } from "../../runner/src/client.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

/** Members (2026-10-19): the owner invites friends; each has their own workspace; shared agents run on the owner's AI. */
const TEAM = "myofis.cloudflareaccess.com";
const AUD = "aud-members-test";
const OWNER = "owner@example.com";
const ALI = "ali@example.com";
const BOB = "bob@example.com";
let key: CryptoKey;
let jwks: ReturnType<typeof Bun.serve>;
let env: TestEnv;
let runner: RunnerClient | null = null;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  key = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  jwks = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ keys: [jwk] }) });
});
afterAll(() => jwks?.stop(true));
afterEach(async () => {
  runner?.stop();
  runner = null;
  await env?.close();
});

const jwt = (email: string) => new SignJWT({ email }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(`https://${TEAM}`).setAudience(AUD).setIssuedAt().setExpirationTime("1h").sign(key);

/** A signed-in person: every call carries their Cloudflare Access JWT. */
async function as(email: string) {
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

async function start() {
  env = await createTestEnv({}, { authMode: "cf-access", cfAccess: { teamDomain: TEAM, aud: AUD, ownerEmail: OWNER, certsUrl: `http://127.0.0.1:${jwks.port}/certs` } });
  const owner = await as(OWNER);
  // pair a runner as the owner (runners are the owner's machines)
  const { body: code } = await owner<{ code: string }>("/api/runners/pairing-code", { method: "POST" });
  const { body: paired } = await owner<{ token: string }>("/api/runners/pair", { body: { code: code.code, name: "pc" } });
  runner = new RunnerClient({ hubUrl: env.hub.url, token: paired.token, name: "pc", workspacesDir: join(env.dir, "workspaces"), log: () => {} });
  await runner.start();
  return owner;
}

describe("members and shared agents", () => {
  test("only invited, enabled members get in; they cannot reach the owner's machinery", async () => {
    const owner = await start();
    expect((await (await as(ALI))("/api/agents")).status).toBe(401); // not invited yet
    const ali = (await owner("/api/members", { body: { email: ALI, name: "Ali" } })).body.member;
    expect(ali).toMatchObject({ email: ALI, name: "Ali", disabled: false });
    expect((await owner("/api/members", { body: { email: ALI } })).status).toBe(409);
    const A = await as(ALI);
    expect((await A("/api/auth/me")).body).toMatchObject({ role: "member", email: ALI, workspace_id: ali.workspace_id });
    for (const path of ["/api/runners", "/api/settings/integrations", "/api/members", "/api/system", "/api/backups", "/api/proposals", "/api/skills/catalog"]) {
      expect([path, (await A(path)).status]).toEqual([path, 403]);
    }
    expect((await A("/api/settings/pause", { body: { paused: true } })).status).toBe(403);
    expect((await A("/api/skills", { body: { content: "---\nname: x\ndescription: y\n---\n" } })).status).toBe(403);
    // the owner's agents are invisible until shared; members only see the tools they may use
    expect((await A("/api/agents")).body.agents).toEqual([]);
    const tools = (await A("/api/tools")).body.tools.map((t: { name: string }) => t.name);
    expect(tools).toContain("save_draft");
    expect(tools).not.toContain("run_command");
    // disabled: out
    await owner(`/api/members/${ali.id}`, { method: "PATCH", body: { disabled: true } });
    expect((await A("/api/auth/me")).status).toBe(401);
  });

  test("workspaces are separate; a shared agent works for a member on the owner's AI, inside the member's workspace", async () => {
    const owner = await start();
    const ali = (await owner("/api/members", { body: { email: ALI, name: "Ali" } })).body.member;
    const bob = (await owner("/api/members", { body: { email: BOB, name: "Bob" } })).body.member;
    const A = await as(ALI);
    const B = await as(BOB);

    // the owner's own work
    const echo = ((await owner("/api/agents")).body.agents as { id: string; slug: string }[]).find((a) => a.slug === "echo")!;
    const ownerJob = (await owner("/api/jobs", { body: { agent_id: echo.id, title: "owner secret", input: { text: "owner secret plan" } } })).body.job;
    await waitFor(() => env.hub.hub.store.state.jobs[ownerJob.id]?.status === "done", 10_000, "owner job");
    const ownerRun = env.hub.hub.store.state.jobs[ownerJob.id]!.run_ids[0]!;
    const ownerProject = (await owner("/api/projects", { body: { slug: "shop", name: "Owner shop" } })).body.project;

    // a member cannot see or touch any of it
    expect((await A(`/api/agents/${echo.id}`)).status).toBe(404);
    expect((await A("/api/jobs", { body: { agent_id: echo.id, title: "x", input: { text: "x" } } })).status).toBe(404);
    expect((await A(`/api/runs/${ownerRun}`)).status).toBe(404);
    expect((await A(`/api/jobs/${ownerJob.id}/cancel`, { method: "POST" })).status).toBe(404);
    expect((await A(`/api/projects/${ownerProject.id}/brief`)).status).toBe(404);
    expect((await A("/api/jobs")).body.jobs).toEqual([]);
    expect(JSON.stringify((await A("/api/events")).body.events)).not.toContain("owner secret");
    expect(Object.keys((await A("/api/state")).body.state.jobs)).toEqual([]);

    // same slug in another workspace is fine
    expect((await A("/api/projects", { body: { slug: "shop", name: "Ali shop" } })).status).toBe(201);

    // share Echo with Ali (not Bob), with a daily limit
    const shared = (await owner(`/api/members/${ali.id}/shares`, { method: "PUT", body: { shares: [{ agent_id: echo.id, daily_token_budget: 20000 }] } })).body.member;
    expect(shared.shares).toMatchObject([{ agent_id: echo.id, agent_name: "Echo", daily_token_budget: 20000 }]);
    expect((await A("/api/agents")).body.agents).toMatchObject([{ id: echo.id, shared: true }]);
    expect((await A(`/api/agents/${echo.id}`, { method: "PATCH", body: { name: "Mine now" } })).status).toBe(404); // read-only
    expect((await B("/api/agents")).body.agents).toEqual([]);

    // Ali chats with the shared Echo: the job is Ali's, the owner does not see it, Bob neither
    const chat = (await A("/api/chat", { body: { agent_id: echo.id, text: "ali private question" } })).body;
    await waitFor(() => env.hub.hub.store.state.jobs[chat.job.id]?.status === "done", 10_000, "ali chat");
    expect((await A(`/api/chat/threads/${chat.thread_id}`)).body.messages[0].reply).toContain("ali private question");
    expect(((await A("/api/jobs")).body.jobs as { id: string }[]).map((j) => j.id)).toEqual([chat.job.id]);
    expect(((await owner("/api/jobs")).body.jobs as { id: string }[]).map((j) => j.id)).not.toContain(chat.job.id);
    expect(JSON.stringify((await owner("/api/events")).body.events)).not.toContain("ali private question");
    expect((await B(`/api/chat/threads/${chat.thread_id}`)).body.messages).toEqual([]);
    expect((await B("/api/chat", { body: { agent_id: echo.id, text: "bob tries" } })).status).toBe(404);
    const aliRun = env.hub.hub.store.state.jobs[chat.job.id]!.run_ids[0]!;
    expect((await B(`/api/runs/${aliRun}`)).status).toBe(404);
    expect((await A(`/api/runs/${aliRun}`)).status).toBe(200);
    // Ali's office has the run; the owner's office does not
    expect((await A("/api/state")).body.state.runs[aliRun]).toBeTruthy();
    expect((await owner("/api/state")).body.state.runs[aliRun]).toBeUndefined();

    // a member's own agent: own provider, safe tools only
    expect((await A("/api/providers", { body: { slug: "mine", name: "My AI", kind: "openai_compatible", base_url: "http://127.0.0.1:1/v1", api_key: "sk-ali-key-123456" } })).status).toBe(201);
    const bad = await A("/api/agents", { body: { slug: "hacker", name: "H", provider: "mine", model: "m", tools: ["run_command"] } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("run_command");
    const mine = await A("/api/agents", { body: { slug: "echo", name: "Ali's writer", provider: "mine", model: "m", tools: ["web_search", "save_draft"] } });
    expect(mine.status).toBe(201);
    expect((await A(`/api/agents/${mine.body.agent.id}`, { method: "PATCH", body: { tools: ["read_file"] } })).status).toBe(400);
    // the owner's provider list does not show Ali's key; Bob cannot use Ali's provider or agent
    expect(((await owner("/api/providers")).body.providers as { slug: string }[]).map((p) => p.slug)).not.toContain("mine");
    expect((await B(`/api/agents/${mine.body.agent.id}`)).status).toBe(404);
    expect((await B("/api/agents", { body: { slug: "b", name: "B", provider: "mine", model: "m", tools: [] } })).status).toBe(400);

    // the owner sees usage per member
    const list = (await owner("/api/members")).body.members as { email: string; tokens_today: number }[];
    expect(list.map((m) => m.email)).toEqual([ALI, BOB]);
  }, 60_000);
});

/** Calls made "inside" a room: the web app keeps the chosen room in the ao_room cookie. */
async function inRoom(email: string, room: string) {
  const token = await jwt(email);
  return async <T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> => {
    const res = await freshFetch(`${env.hub.url}${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: { "cf-access-jwt-assertion": token, cookie: `ao_room=${room}`, "content-type": "application/json", origin: env.hub.url },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      timeoutMs: 30_000,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

describe("rooms", () => {
  test("HQ + a 'Sewa Baju' room shared with a friend: its own agents and projects, on the owner's AI with a daily limit; the owner enters every room", async () => {
    const owner = await start();
    const ali = (await owner("/api/members", { body: { email: ALI, name: "Ali" } })).body.member;
    await owner("/api/members", { body: { email: BOB, name: "Bob" } });

    // the owner's rooms: HQ (everything from before) + the members' personal rooms
    const rooms0 = (await owner("/api/rooms")).body.rooms as { id: string; kind: string; name: string; current: boolean }[];
    expect(rooms0.map((r) => r.kind)).toEqual(["hq", "personal", "personal"]);
    expect(rooms0[0]).toMatchObject({ id: "owner", name: "HQ", current: true });

    // make the room, share it with Ali (not Bob)
    const room = (await owner("/api/rooms", { body: { name: "Sewa Baju", daily_token_budget: 100000 } })).body.room;
    expect((await (await as(ALI))("/api/rooms", { body: { name: "mine" } })).status).toBe(403);
    await owner(`/api/rooms/${room.id}/members`, { method: "PUT", body: { user_ids: [ali.id] } });

    // move HQ's Echo and a project into the room
    const echo = ((await owner("/api/agents")).body.agents as { id: string; slug: string }[]).find((a) => a.slug === "echo")!;
    const proj = (await owner("/api/projects", { body: { slug: "baju", name: "Sewa Baju" } })).body.project;
    expect((await owner(`/api/agents/${echo.id}/move`, { body: { workspace_id: room.id } })).status).toBe(200);
    expect((await owner(`/api/projects/${proj.id}/move`, { body: { workspace_id: room.id } })).status).toBe(200);
    expect(((await owner("/api/agents")).body.agents as { id: string }[]).map((a) => a.id)).not.toContain(echo.id); // HQ no longer has it

    // Ali in the room: sees its agent and project, can chat and edit, on the owner's AI
    const A = await inRoom(ALI, room.id);
    expect((await A("/api/auth/me")).body).toMatchObject({ workspace_id: room.id, home_workspace_id: ali.workspace_id });
    expect((await A("/api/agents")).body.agents).toMatchObject([{ id: echo.id }]);
    expect((await A("/api/projects")).body.projects).toMatchObject([{ id: proj.id }]);
    expect((await A("/api/providers")).body).toMatchObject({ read_only: true });
    expect((await A("/api/providers", { body: { slug: "x", name: "X", kind: "openai_compatible", base_url: "http://127.0.0.1:1/v1" } })).status).toBe(400);
    expect((await A(`/api/agents/${echo.id}`, { method: "PATCH", body: { role: "Baju helper" } })).status).toBe(200);
    expect((await A(`/api/agents/${echo.id}`, { method: "PATCH", body: { tools: ["run_command"] } })).status).toBe(400);
    const chat = (await A("/api/chat", { body: { agent_id: echo.id, text: "baju untuk kenduri" } })).body;
    await waitFor(() => env.hub.hub.store.state.jobs[chat.job.id]?.status === "done", 10_000, "room chat");
    // Ali's personal room is separate; the room's work is not in it
    const Ahome = await as(ALI);
    expect((await Ahome("/api/jobs")).body.jobs).toEqual([]);

    // Bob is not a member: the cookie does not get him in (he stays in his own room)
    const Bin = await inRoom(BOB, room.id);
    expect((await Bin("/api/auth/me")).body.workspace_id).not.toBe(room.id);
    expect((await Bin("/api/agents")).body.agents).toEqual([]);

    // the owner (admin) enters the room and Ali's personal room
    const Oroom = await inRoom(OWNER, room.id);
    expect(((await Oroom("/api/jobs")).body.jobs as { id: string }[]).map((j) => j.id)).toEqual([chat.job.id]);
    const Oali = await inRoom(OWNER, ali.workspace_id);
    expect((await Oali("/api/auth/me")).body.workspace_id).toBe(ali.workspace_id);

    // the room's daily limit on the owner's AI stops its work when used up
    env.hub.hub.db.update((await import("../src/db/schema.ts")).runs).set({ tokens_in: 100000 }).run();
    const rooms1 = (await owner("/api/rooms")).body.rooms as { id: string; left_today: number | null }[];
    expect(rooms1.find((r) => r.id === room.id)!.left_today).toBe(0);
    const held = (await A("/api/chat", { body: { agent_id: echo.id, text: "masih ada?" } })).body.job;
    await Bun.sleep(400);
    expect(env.hub.hub.store.state.jobs[held.id]?.status).toBe("queued");
    await owner(`/api/rooms/${room.id}`, { method: "PATCH", body: { daily_token_budget: 500000 } });
    await waitFor(() => env.hub.hub.store.state.jobs[held.id]?.status === "done", 10_000, "after raising the limit");
  }, 60_000);
});
