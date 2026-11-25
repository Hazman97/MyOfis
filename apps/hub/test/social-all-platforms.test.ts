import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WebPost, freshFetch, placementCheck, type ContentDraft } from "@agent-office/shared";
import { agents, contentDrafts, projects, schedules, uploads } from "../src/db/schema.ts";
import { TOKEN, createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

const KEY_MAIN = "zk_042_main_123456789";
const KEY_ALT = "zk_042_alt_987654321";

interface FakeState {
  posts: Record<string, unknown>[];
  presigned: string[];
  failNext207: boolean;
  returnNullUrl: boolean;
  needsReconnectId: string | null;
  metaCalls: string[];
}
const state: FakeState = {
  posts: [],
  presigned: [],
  failNext207: false,
  returnNullUrl: false,
  needsReconnectId: null,
  metaCalls: [],
};

let fakeZernio: ReturnType<typeof Bun.serve>;
let fakeMeta: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  fakeZernio = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const base = `http://127.0.0.1:${fakeZernio.port}`;
      if (url.pathname.startsWith("/upload/")) {
        await req.arrayBuffer();
        return new Response(null, { status: 200 });
      }
      const auth = req.headers.get("authorization");
      if (auth === `Bearer ${KEY_ALT}` && url.pathname === "/api/v1/accounts") {
        return Response.json({
          accounts: [
            { _id: "acc_ig_2", platform: "instagram", username: "second.ig", displayName: "Second IG", followersCount: 50, needsReconnection: false, isActive: true },
          ],
        });
      }
      if (auth !== `Bearer ${KEY_MAIN}` && auth !== `Bearer ${KEY_ALT}`) {
        return Response.json({ error: "Invalid API key" }, { status: 401 });
      }
      if (url.pathname === "/api/v1/accounts") {
        const accs = [
          { _id: "acc_tt", platform: "tiktok", username: "myofis.tt", displayName: "MyOfis TT", followersCount: 100, needsReconnection: state.needsReconnectId === "acc_tt", isActive: true },
          { _id: "acc_ig", platform: "instagram", username: "myofis.ig", displayName: "MyOfis IG", followersCount: 200, needsReconnection: state.needsReconnectId === "acc_ig", isActive: true },
          { _id: "acc_fb", platform: "facebook", username: "myofis.fb", displayName: "MyOfis FB", followersCount: 300, needsReconnection: state.needsReconnectId === "acc_fb", isActive: true },
          { _id: "acc_th", platform: "threads", username: "myofis.th", displayName: "MyOfis TH", followersCount: 400, needsReconnection: state.needsReconnectId === "acc_th", isActive: true },
          { _id: "acc_yt", platform: "youtube", username: "myofis.yt", displayName: "MyOfis YT", followersCount: 500, needsReconnection: state.needsReconnectId === "acc_yt", isActive: true },
        ];
        const plat = url.searchParams.get("platform");
        return Response.json({ accounts: plat ? accs.filter((a) => a.platform === plat) : accs });
      }
      if (url.pathname === "/api/v1/media/presign" && req.method === "POST") {
        const b = (await req.json()) as { filename: string };
        state.presigned.push(b.filename);
        const key = `${state.presigned.length}_${b.filename}`;
        return Response.json({ uploadUrl: `${base}/upload/${key}`, publicUrl: `${base}/public/${key}`, key, expiresIn: 3600 });
      }
      if (url.pathname.endsWith("/tiktok/creator-info")) {
        return Response.json({ privacyLevels: [{ value: "PUBLIC_TO_EVERYONE" }] });
      }
      if (url.pathname === "/api/v1/posts" && req.method === "POST") {
        const body = (await req.json()) as Record<string, unknown>;
        state.posts.push(body);
        if (state.failNext207) {
          state.failNext207 = false;
          return Response.json(
            { post: { _id: "p_207", status: "failed", platforms: [{ status: "failed", errorMessage: "Platform rejected media" }] } },
            { status: 207 },
          );
        }
        const plat = ((body.platforms as { platform: string }[])?.[0]?.platform) ?? "instagram";
        const postUrl = state.returnNullUrl ? null : `https://example.social/${plat}/${state.posts.length}`;
        state.returnNullUrl = false;
        return Response.json(
          { post: { _id: `post_${state.posts.length}`, status: "published", platforms: [{ platform: plat, status: "published", platformPostUrl: postUrl }] } },
          { status: 201 },
        );
      }
      if (url.pathname.startsWith("/api/v1/posts/")) {
        const id = url.pathname.split("/").pop();
        return Response.json({ post: { platforms: [{ status: "published", platformPostUrl: `https://resolved.social/post/${id}` }] } });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });

  fakeMeta = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      state.metaCalls.push(`${req.method} ${url.pathname}`);
      if (url.pathname.endsWith("/feed")) return Response.json({ id: "fb_legacy_999" });
      if (url.pathname.endsWith("/photos")) return Response.json({ post_id: "fb_photo_888" });
      return Response.json({ name: "Legacy Page" });
    },
  });
});

afterAll(() => {
  fakeZernio.stop(true);
  fakeMeta.stop(true);
});

const selfCheck = { facts_match_brief: true, only_released_features: true, no_overclaims: true, tone_and_language_match: true, notes: "" };

function addUpload(e: TestEnv, id: string, name: string, contentType: string, ws = "owner") {
  const dir = join(e.dir, "files");
  mkdirSync(dir, { recursive: true });
  const rel = `${id}_${name}`;
  writeFileSync(join(dir, rel), new Uint8Array(64).fill(1));
  e.hub.hub.db
    .insert(uploads)
    .values({ id, workspace_id: ws, name, content_type: contentType, size: 64, path: rel })
    .run();
}

function addDraft(
  e: TestEnv,
  opts: {
    id: string;
    projectId: string;
    agentId: string;
    platform: string;
    kind?: string;
    title: string;
    body: string;
    meta?: Partial<WebPost>;
    status?: "draft" | "approved";
    ws?: string;
  },
) {
  const meta = WebPost.parse({ post_type: "social", ...(opts.meta ?? {}) });
  e.hub.hub.db
    .insert(contentDrafts)
    .values({
      id: opts.id,
      workspace_id: opts.ws ?? "owner",
      project_id: opts.projectId,
      agent_id: opts.agentId,
      run_id: null,
      feature_id: null,
      platform: opts.platform,
      kind: opts.kind ?? "caption",
      title: opts.title,
      body: opts.body,
      original_body: opts.body,
      status: opts.status ?? "approved",
      self_check: selfCheck,
      meta,
    })
    .run();
}

describe("Task 042 Step 2 & 3: Generic Zernio posting, routing, pending links, post sets & room scoping", () => {
  test("IG carousel (order kept), IG Story (img+vid), IG Reel, FB Reel+Story, Threads (text+img), YouTube Short, 207 fail, pending link resolve, checkTokens", async () => {
    state.posts = [];
    state.presigned = [];
    state.needsReconnectId = null;

    env = await createTestEnv({}, { zernioApiBase: `http://127.0.0.1:${fakeZernio.port}/api/v1` });
    const project = (await env.api("/api/projects", { body: { slug: "demo", name: "Demo" } })).body.project;
    const agent = (await env.api("/api/agents", { body: { slug: "sm", name: "SM", provider: "mock", model: "mock", tools: ["save_draft"] } })).body.agent;

    // Connect Zernio key -> lists all 5 platforms
    const conn = (await env.api("/api/social-accounts/zernio", { body: { label: "All Platforms", api_key: KEY_MAIN } })).body.connection;
    expect(conn.accounts.map((a: { platform: string }) => a.platform).sort()).toEqual(["facebook", "instagram", "threads", "tiktok", "youtube"]);

    addUpload(env, "img_1", "slide1.png", "image/png");
    addUpload(env, "img_2", "slide2.png", "image/png");
    addUpload(env, "img_3", "slide3.png", "image/png");
    addUpload(env, "vid_1", "reel.mp4", "video/mp4");

    // 1) IG Carousel (order kept)
    addDraft(env, { id: "drf_caro", projectId: project.id, agentId: agent.id, platform: "instagram", title: "Carousel", body: "Slide 1-3", meta: { placement: "ig_carousel", images: ["img_2", "img_1", "img_3"] } });
    const rCaro = await env.hub.hub.social.post("drf_caro");
    expect(rCaro.status).toBe("published");
    const pCaro = state.posts.at(-1) as { mediaItems: { type: string; url: string }[]; platforms: { platform: string; accountId: string }[] };
    expect(pCaro.platforms[0]).toEqual({ platform: "instagram", accountId: "acc_ig" });
    expect(pCaro.mediaItems.map((m) => m.url.split("_").pop())).toEqual(["slide2.png", "slide1.png", "slide3.png"]);

    // 2) IG Story (image) & IG Story (video)
    addDraft(env, { id: "drf_igs_img", projectId: project.id, agentId: agent.id, platform: "instagram", title: "IG Story Img", body: "Story 1", meta: { placement: "ig_story", cover_upload_id: "img_1" } });
    await env.hub.hub.social.post("drf_igs_img");
    expect(state.posts.at(-1)).toMatchObject({
      mediaItems: [{ type: "image" }],
      platforms: [{ platform: "instagram", accountId: "acc_ig", platformSpecificData: { contentType: "story" } }],
    });

    addDraft(env, { id: "drf_igs_vid", projectId: project.id, agentId: agent.id, platform: "instagram", kind: "video", title: "IG Story Vid", body: "Story 2", meta: { placement: "ig_story", video_upload_id: "vid_1" } });
    await env.hub.hub.social.post("drf_igs_vid");
    expect(state.posts.at(-1)).toMatchObject({
      mediaItems: [{ type: "video" }],
      platforms: [{ platform: "instagram", accountId: "acc_ig", platformSpecificData: { contentType: "story" } }],
    });

    // 3) IG Reel
    addDraft(env, { id: "drf_igr", projectId: project.id, agentId: agent.id, platform: "instagram", kind: "video", title: "IG Reel", body: "Watch", meta: { placement: "ig_reels", video_upload_id: "vid_1" } });
    await env.hub.hub.social.post("drf_igr");
    expect(state.posts.at(-1)).toMatchObject({
      mediaItems: [{ type: "video" }],
      platforms: [{ platform: "instagram", accountId: "acc_ig", platformSpecificData: { contentType: "reel", shareToFeed: true } }],
    });

    // 4) FB Reel & FB Story
    addDraft(env, { id: "drf_fbr", projectId: project.id, agentId: agent.id, platform: "facebook", kind: "video", title: "FB Reel", body: "FB Reel", meta: { placement: "fb_reels", video_upload_id: "vid_1" } });
    await env.hub.hub.social.post("drf_fbr");
    expect(state.posts.at(-1)).toMatchObject({
      platforms: [{ platform: "facebook", accountId: "acc_fb", platformSpecificData: { contentType: "reel" } }],
    });

    addDraft(env, { id: "drf_fbs", projectId: project.id, agentId: agent.id, platform: "facebook", title: "FB Story", body: "FB Story", meta: { placement: "fb_story", cover_upload_id: "img_1" } });
    await env.hub.hub.social.post("drf_fbs");
    expect(state.posts.at(-1)).toMatchObject({
      platforms: [{ platform: "facebook", accountId: "acc_fb", platformSpecificData: { contentType: "story" } }],
    });

    // 5) Threads text & Threads image
    addDraft(env, { id: "drf_th_txt", projectId: project.id, agentId: agent.id, platform: "threads", title: "Threads txt", body: "Santai je hari ni.", meta: { placement: "threads" } });
    await env.hub.hub.social.post("drf_th_txt");
    expect(state.posts.at(-1)).toEqual({
      content: "Santai je hari ni.",
      platforms: [{ platform: "threads", accountId: "acc_th" }],
      publishNow: true,
    });

    addDraft(env, { id: "drf_th_img", projectId: project.id, agentId: agent.id, platform: "threads", title: "Threads img", body: "Gambar baru!", meta: { placement: "threads", cover_upload_id: "img_1" } });
    await env.hub.hub.social.post("drf_th_img");
    expect(state.posts.at(-1)).toMatchObject({
      content: "Gambar baru!",
      mediaItems: [{ type: "image" }],
      platforms: [{ platform: "threads", accountId: "acc_th" }],
    });

    // 6) YouTube Short (title sent)
    addDraft(env, { id: "drf_yt", projectId: project.id, agentId: agent.id, platform: "youtube", kind: "video", title: "3 Tip Kamera Vlog", body: "Deskripsi video", meta: { placement: "yt_shorts", video_upload_id: "vid_1" } });
    await env.hub.hub.social.post("drf_yt");
    expect(state.posts.at(-1)).toMatchObject({
      content: "Deskripsi video",
      mediaItems: [{ type: "video" }],
      platforms: [{ platform: "youtube", accountId: "acc_yt", platformSpecificData: { title: "3 Tip Kamera Vlog", visibility: "public" } }],
    });

    // 7) HTTP 207 -> failed
    state.failNext207 = true;
    addDraft(env, { id: "drf_207", projectId: project.id, agentId: agent.id, platform: "instagram", title: "Fail 207", body: "Fail", meta: { placement: "ig_feed", cover_upload_id: "img_1" } });
    const r207 = await env.hub.hub.social.post("drf_207");
    expect(r207.status).toBe("approved");
    expect(r207.publish_error).toContain("Platform rejected media");

    // 8) Pending link resolved later (for non-TikTok too!)
    state.returnNullUrl = true;
    addDraft(env, { id: "drf_pend", projectId: project.id, agentId: agent.id, platform: "youtube", kind: "video", title: "Pending YT", body: "Desc", meta: { placement: "yt_shorts", video_upload_id: "vid_1" } });
    const rPend = await env.hub.hub.social.post("drf_pend");
    expect(rPend.status).toBe("published");
    expect(rPend.published_url).toBe("posted");
    const resolved = await env.hub.hub.social.resolvePendingLinks();
    expect(resolved.some((x) => x.draft_id === "drf_pend" && x.url.startsWith("https://resolved.social/post/"))).toBe(true);
    expect(env.hub.hub.content.draft("drf_pend")?.published_url).toMatch(/^https:\/\/resolved\.social\/post\//);

    // 9) checkTokens covers every enabled account across platforms
    state.needsReconnectId = "acc_yt";
    const probs = await env.hub.hub.social.checkTokens();
    expect(probs.some((p) => p.includes("Youtube") && p.includes("@myofis.yt"))).toBe(true);
  });

  test("routing (draft account, only account, switched-off account never swapped, Meta fallback), Lulus semua idempotency, and room scoping", async () => {
    state.posts = [];
    state.metaCalls = [];

    env = await createTestEnv({}, { zernioApiBase: `http://127.0.0.1:${fakeZernio.port}/api/v1`, facebookGraphBase: `http://127.0.0.1:${fakeMeta.port}` });
    const project = (await env.api("/api/projects", { body: { slug: "route", name: "Route" } })).body.project;
    const agent = (await env.api("/api/agents", { body: { slug: "sm2", name: "SM2", provider: "mock", model: "mock", tools: ["save_draft"] } })).body.agent;

    // 1) Direct Meta fallback for FB feed text when no Zernio account exists
    await env.api(`/api/projects/${project.id}/facebook`, { method: "PUT", body: { page_id: "12345678", token: "fb_tok_123" } });
    addDraft(env, { id: "drf_fb_meta", projectId: project.id, agentId: agent.id, platform: "facebook", title: "FB Meta", body: "Halo FB", meta: { placement: "fb_feed" } });
    expect(env.hub.hub.social.canPost(env.hub.hub.content.draft("drf_fb_meta")!)).toBe(true);
    const rMeta = await env.hub.hub.social.post("drf_fb_meta");
    expect(rMeta.status).toBe("published");
    expect(rMeta.published_url).toBe("https://www.facebook.com/fb_legacy_999");

    // 2) Connect two Zernio connections (2 IG accounts: acc_ig & acc_ig_2)
    const c1 = (await env.api("/api/social-accounts/zernio", { body: { label: "Main", api_key: KEY_MAIN } })).body.connection;
    const c2 = (await env.api("/api/social-accounts/zernio", { body: { label: "Alt", api_key: KEY_ALT } })).body.connection;
    addUpload(env, "img_r", "r.png", "image/png");

    // Draft with explicit social_account = acc_ig_2 posts to acc_ig_2
    addDraft(env, { id: "drf_exp", projectId: project.id, agentId: agent.id, platform: "instagram", title: "Explicit", body: "Hi", meta: { placement: "ig_feed", cover_upload_id: "img_r", social_account: "acc_ig_2" } });
    await env.hub.hub.social.post("drf_exp");
    expect((state.posts.at(-1) as { platforms: { accountId: string }[] }).platforms[0]!.accountId).toBe("acc_ig_2");

    // Switch off acc_ig_2 -> draft pinned to acc_ig_2 is NEVER swapped to acc_ig
    await env.api(`/api/social-accounts/${c2.id}`, { method: "PATCH", body: { accounts: { acc_ig_2: { enabled: false } } } });
    addDraft(env, { id: "drf_off", projectId: project.id, agentId: agent.id, platform: "instagram", title: "Off", body: "Hi", meta: { placement: "ig_feed", cover_upload_id: "img_r", social_account: "acc_ig_2" } });
    expect(env.hub.hub.social.canPost(env.hub.hub.content.draft("drf_off")!)).toBe(false);
    const postsBefore = state.posts.length;
    const rOff = await env.hub.hub.social.post("drf_off");
    expect(state.posts.length).toBe(postsBefore);
    expect(rOff.status).toBe("approved");
    expect(rOff.publish_error).toContain("switched off");

    // Now only acc_ig is enabled -> draft without social_account routes to the only enabled account (acc_ig)
    addDraft(env, { id: "drf_only", projectId: project.id, agentId: agent.id, platform: "instagram", title: "Only", body: "Only", meta: { placement: "ig_feed", cover_upload_id: "img_r" } });
    await env.hub.hub.social.post("drf_only");
    expect((state.posts.at(-1) as { platforms: { accountId: string }[] }).platforms[0]!.accountId).toBe("acc_ig");

    // 3) Lulus semua on a post set posts every draft once; retry does NOT double-post
    const setId = "set_launch_01";
    addDraft(env, { id: "drf_s1", projectId: project.id, agentId: agent.id, platform: "instagram", title: "Set IG", body: "IG post", status: "draft", meta: { placement: "ig_feed", cover_upload_id: "img_r", set_id: setId } });
    addDraft(env, { id: "drf_s2", projectId: project.id, agentId: agent.id, platform: "threads", title: "Set TH", body: "Threads post", status: "draft", meta: { placement: "threads", set_id: setId } });

    const beforeSet = state.posts.length;
    const dec1 = await env.api(`/api/drafts/sets/${setId}/decide`, { body: { decision: "approve" } });
    expect(dec1.status).toBe(200);
    expect(dec1.body.decided_count).toBe(2);
    expect(state.posts.length).toBe(beforeSet + 2);
    expect((dec1.body.drafts as ContentDraft[]).every((d) => d.status === "published")).toBe(true);

    // Retry Lulus semua -> 0 new posts!
    const dec2 = await env.api(`/api/drafts/sets/${setId}/decide`, { body: { decision: "approve" } });
    expect(dec2.status).toBe(200);
    expect(dec2.body.decided_count).toBe(0);
    expect(state.posts.length).toBe(beforeSet + 2);

    // 4) Member room scoping: member's room cannot see or decide owner's set (404)
    const room = (await env.api("/api/rooms", { body: { name: "Guest Room", daily_token_budget: 10000 } })).body.room;
    const crossRoom = await freshFetch(`${env.hub.url}/api/drafts/sets/${setId}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", cookie: `ao_room=${room.id}` },
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(crossRoom.status).toBe(404);
    const crossProj = await freshFetch(`${env.hub.url}/api/projects/${project.id}/social-accounts`, {
      method: "GET",
      headers: { authorization: `Bearer ${TOKEN}`, cookie: `ao_room=${room.id}` },
    });
    expect(crossProj.status).toBe(404);
    expect(c1.id).toBeTruthy();
  });

  test("Pengurus Sosial agent is seeded with content_week schedule (off), and a mock-provider content_week run creates a valid post set", async () => {
    env = await createTestEnv({}, { zernioApiBase: `http://127.0.0.1:${fakeZernio.port}/api/v1` });
    await env.pairRunner();
    const project = (await env.api("/api/projects", { body: { slug: "kamera", name: "Sewa Kamera MY" } })).body.project;
    addUpload(env, "img_w1", "w1.png", "image/png");
    addUpload(env, "img_w2", "w2.png", "image/png");
    addUpload(env, "vid_w1", "w1.mp4", "video/mp4");

    // Verify seeded agent and Sunday 20:00 disabled schedule
    const allAgents = env.hub.hub.db.select().from(agents).all();
    const sm = allAgents.find((a) => a.slug === "pengurus-sosial");
    expect(sm).toBeTruthy();
    const smSched = env.hub.hub.db.select().from(schedules).all().find((s) => s.agent_id === sm!.id && (s.job_template as { type?: string }).type === "content_week");
    expect(smSched).toBeTruthy();
    expect(smSched!.cron).toBe("0 20 * * 0");
    expect(smSched!.enabled).toBe(false);

    // Run a mock-script content_week job on Pengurus Sosial creating a multi-platform set
    await env.api(`/api/agents/${sm!.id}`, { method: "PATCH", body: { provider: "mock", model: "mock-script" } });
    const setId = "set_week_01";
    const script = [
      {
        tool: "save_draft",
        input: {
          project: "kamera",
          platform: "instagram",
          kind: "caption",
          title: "Carousel Tip Kamera",
          body: "3 tip mudah untuk pencahayaan natural.\n\nSimpan pos ini!",
          placement: "ig_carousel",
          set_id: setId,
          images: ["img_w1", "img_w2"],
          proposed_publish_at: "2026-12-01T12:00:00+08:00",
          self_check: selfCheck,
        },
      },
      {
        tool: "save_draft",
        input: {
          project: "kamera",
          platform: "threads",
          kind: "caption",
          title: "Threads Tip Kamera",
          body: "Audio yang jelas lagi penting daripada kamera mahal. Setuju tak?",
          placement: "threads",
          set_id: setId,
          proposed_publish_at: "2026-12-01T12:00:00+08:00",
          self_check: selfCheck,
        },
      },
      {
        tool: "save_draft",
        input: {
          project: "kamera",
          platform: "youtube",
          kind: "video",
          title: "3 Tip Cahaya Natural",
          body: "Trik ringkas rakam video kemas. #shorts",
          placement: "yt_shorts",
          set_id: setId,
          video: "vid_w1",
          proposed_publish_at: "2026-12-01T12:00:00+08:00",
          self_check: selfCheck,
        },
      },
      { text: "Pelan mingguan siap (3 draf dalam 1 set)." },
    ];

    const job = (
      await env.api("/api/jobs", {
        body: {
          agent_id: sm!.id,
          project_id: project.id,
          type: "content_week",
          title: "Pelan Mingguan",
          input: {
            script,
            attachments: [
              { id: "img_w1", name: "w1.png", content_type: "image/png" },
              { id: "img_w2", name: "w2.png", content_type: "image/png" },
              { id: "vid_w1", name: "w1.mp4", content_type: "video/mp4" },
            ],
          },
        },
      })
    ).body.job;

    await waitFor(() => env.hub.hub.store.state.jobs[job.id]?.status === "done", 30_000, "content_week job");
    const saved = ((await env.api("/api/drafts?status=pending")).body.drafts as ContentDraft[]).filter((d) => d.meta?.set_id === setId);
    expect(saved.length).toBe(3);
    for (const d of saved) {
      expect(placementCheck(d)).toEqual([]);
    }

    // Also verify Telegram set callback signing & verification
    const cb = env.hub.telegram.setCallbackData(setId, "y");
    expect(env.hub.telegram.parseCallback(cb)).toEqual({ kind: "set", id: setId, yes: true });
    expect(env.hub.telegram.parseCallback(`${cb.slice(0, -1)}X`)).toBeNull();
  });
});
