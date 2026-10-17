import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { freshFetch } from "@agent-office/shared";
import { TOKEN, createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

const PAGE = "1234567890";
const PAGE_TOKEN = "EAA-page-token";
const THREADS_TOKEN = "THQ-threads-token";
const SECRET = "site-secret-xyz";
let env: TestEnv;
let fake: ReturnType<typeof Bun.serve>;
const posted: { path: string; params: Record<string, string> }[] = [];
let refreshWorks = true;

beforeAll(() => {
  // one fake server: /fb = Graph API (Page + Instagram), /th = Threads API, /site = the website endpoint
  fake = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;
      if (p === "/site") {
        const body = await req.text();
        const ts = req.headers.get("x-ao-timestamp") ?? "";
        const ok = req.headers.get("x-ao-signature") === `v1=${createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")}`;
        if (!ok) return Response.json({ error: "bad signature" }, { status: 401 });
        if (req.method === "GET") return Response.json({ site_name: "SmashPoint", post_types: ["news"] });
        const data = JSON.parse(body);
        if (data.action === "upload_media") return Response.json({ url: `https://storage.example.my/${data.name}` });
        return Response.json({ id: "x" });
      }
      const params: Record<string, string> = {};
      if (req.method === "POST") new URLSearchParams(await req.text()).forEach((v, k) => (params[k] = v));
      if (req.method === "POST") posted.push({ path: p, params });
      // Graph API
      if (p === `/fb/${PAGE}` && url.searchParams.get("fields")?.startsWith("instagram_business_account")) return Response.json({ instagram_business_account: { id: "1784", username: "smashpoint.my" } });
      if (p === "/fb/1784/media") return Response.json({ id: "c1" });
      if (p === "/fb/c1") return Response.json({ status_code: "FINISHED" });
      if (p === "/fb/1784/media_publish") return Response.json({ id: "m1" });
      if (p === "/fb/m1") return Response.json({ permalink: "https://www.instagram.com/p/abc/" });
      // Threads API (refresh lives at the root, without the version)
      if (p === "/th/refresh_access_token") {
        if (!refreshWorks) return Response.json({ error: { message: "Session has expired" } }, { status: 400 });
        return url.searchParams.get("grant_type") === "th_refresh_token" ? Response.json({ access_token: "THQ-renewed", expires_in: 60 * 86400 }) : Response.json({ error: { message: "bad grant" } }, { status: 400 });
      }
      if (p === "/th/me") return url.searchParams.get("access_token") === THREADS_TOKEN ? Response.json({ id: "t1", username: "smashpoint.my" }) : Response.json({ error: { message: "Invalid token" } }, { status: 400 });
      if (p === "/th/t1/threads") return Response.json({ id: "tc1" });
      if (p === "/th/tc1") return Response.json({ status: "FINISHED" });
      if (p === "/th/t1/threads_publish") return Response.json({ id: "tp1" });
      if (p === "/th/tp1") return Response.json({ permalink: "https://www.threads.net/@smashpoint.my/post/xyz" });
      return Response.json({ error: { message: `unexpected ${req.method} ${p}` } }, { status: 404 });
    },
  });
});
afterAll(() => fake.stop(true));
afterEach(async () => {
  await env?.close();
});

const check = { facts_match_brief: true, only_released_features: true, no_overclaims: true, tone_and_language_match: true, notes: "" };

describe("Instagram and Threads posting", () => {
  test("Instagram goes through the Page token and a public photo URL; Threads through its own token", async () => {
    env = await createTestEnv({}, { facebookGraphBase: `http://127.0.0.1:${fake.port}/fb`, threadsGraphBase: `http://127.0.0.1:${fake.port}/th` });
    await env.pairRunner();
    const project = (await env.api("/api/projects", { body: { slug: "sp", name: "SmashPoint" } })).body.project;
    await env.api(`/api/projects/${project.id}/publish`, { method: "PUT", body: { url: `http://127.0.0.1:${fake.port}/site`, secret: SECRET } });
    await env.api(`/api/projects/${project.id}/publish/test`, { method: "POST" });

    // Instagram needs the Facebook Page first
    expect((await env.api(`/api/projects/${project.id}/instagram/connect`, { method: "POST" })).status).toBe(400);
    await env.api(`/api/projects/${project.id}/facebook`, { method: "PUT", body: { page_id: PAGE, token: PAGE_TOKEN } });
    expect((await env.api(`/api/projects/${project.id}/instagram/connect`, { method: "POST" })).body.instagram).toMatchObject({ connected: true, enabled: true, username: "smashpoint.my" });
    // Threads: a bad token is refused, a good one is checked and saved
    expect((await env.api(`/api/projects/${project.id}/threads`, { method: "PUT", body: { token: "nope" } })).status).toBe(400);
    const th = (await env.api(`/api/projects/${project.id}/threads`, { method: "PUT", body: { token: THREADS_TOKEN } })).body.threads;
    expect(th).toMatchObject({ has_token: true, user_id: "t1", username: "smashpoint.my" });
    expect(JSON.stringify(th)).not.toContain(THREADS_TOKEN);

    // the agents are told where approved captions go
    expect(env.hub.hub.social.connected(project.id)).toEqual(["facebook", "instagram", "threads"]);

    const up = await freshFetch(`${env.hub.url}/api/uploads?name=court.jpg`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "image/jpeg" }, body: new Uint8Array([255, 216, 255, 0]) });
    const photo = ((await up.json()) as { upload: { id: string } }).upload.id;
    const agent = (await env.api("/api/agents", { body: { slug: "mk", name: "Marketing", provider: "mock", model: "mock-script", tools: ["save_draft"], config: { self_review: false } } })).body.agent;
    const caption = (platform: string, title: string, extra = {}) => ({ tool: "save_draft", input: { project: "sp", platform, kind: "caption", title, body: `${title}: tournament this Saturday!`, self_check: check, ...extra } });
    const job = (
      await env.api("/api/jobs", {
        body: {
          agent_id: agent.id,
          project_id: project.id,
          title: "captions",
          input: { attachments: [{ id: photo, name: "court.jpg", content_type: "image/jpeg" }], script: [caption("instagram", "IG", { cover_photo: 1 }), caption("instagram", "IG no photo"), caption("threads", "TH"), { text: "ok" }] },
        },
      })
    ).body.job;
    await waitFor(() => env.hub.hub.store.state.jobs[job.id]?.status === "done", 8000, "captions");
    const drafts = (await env.api("/api/drafts?status=pending")).body.drafts as { id: string; title: string }[];
    const approve = async (title: string) => (await env.api(`/api/drafts/${drafts.find((d) => d.title === title)!.id}/decide`, { body: { decision: "approve" } })).body.draft;

    expect(await approve("IG")).toMatchObject({ status: "published", published_url: "https://www.instagram.com/p/abc/" });
    expect(posted.find((x) => x.path === "/fb/1784/media")!.params).toMatchObject({ image_url: "https://storage.example.my/court.jpg", caption: "IG: tournament this Saturday!" });

    const noPhoto = await approve("IG no photo");
    expect(noPhoto.status).toBe("approved");
    expect(noPhoto.publish_error).toContain("need a photo");

    expect(await approve("TH")).toMatchObject({ status: "published", published_url: "https://www.threads.net/@smashpoint.my/post/xyz" });
    expect(posted.find((x) => x.path === "/th/t1/threads")!.params).toMatchObject({ media_type: "TEXT", text: "TH: tournament this Saturday!" });
  }, 30_000);

  test("token health: Threads renews weekly, a broken Facebook token or failed renewal is reported", async () => {
    env = await createTestEnv({}, { facebookGraphBase: `http://127.0.0.1:${fake.port}/fb`, threadsGraphBase: `http://127.0.0.1:${fake.port}/th` });
    const project = (await env.api("/api/projects", { body: { slug: "sp", name: "SmashPoint" } })).body.project;
    await env.api(`/api/projects/${project.id}/threads`, { method: "PUT", body: { token: THREADS_TOKEN } });
    // Page "999" is unknown to the fake Graph API: its token check fails
    await env.api(`/api/projects/${project.id}/facebook`, { method: "PUT", body: { page_id: "99999", token: PAGE_TOKEN } });
    const social = env.hub.hub.social;
    const day = 86_400_000;

    // just saved: nothing to renew yet, only Facebook is reported
    let problems = await social.checkTokens(new Date());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("SmashPoint: the Facebook Page token no longer works");

    // a week later the Threads token is renewed for 60 more days
    const before = (await env.api(`/api/projects/${project.id}/threads`)).body.threads;
    const later = new Date(Date.now() + 8 * day);
    problems = await social.checkTokens(later);
    expect(problems.some((p) => p.includes("Threads"))).toBe(false);
    const th = (await env.api(`/api/projects/${project.id}/threads`)).body.threads;
    expect(th.token_hint).not.toBe(before.token_hint);
    expect(Date.parse(th.expires_at) - later.getTime()).toBeGreaterThan(59 * day);
    expect(JSON.stringify(th)).not.toContain("THQ-renewed");

    // when renewing fails, the owner is told how many days are left
    refreshWorks = false;
    problems = await social.checkTokens(new Date(later.getTime() + 50 * day));
    expect(problems.find((p) => p.includes("Threads"))).toMatch(/could not be renewed \(Session has expired\); it stops working in \d+ day/);
    refreshWorks = true;
  }, 30_000);
});
