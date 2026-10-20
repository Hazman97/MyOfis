import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, isNull } from "drizzle-orm";
import type { ContentDraft } from "@agent-office/shared";
import { jobs, uploads } from "../src/db/schema.ts";
import { freshFetch } from "@agent-office/shared";
import { TOKEN, createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

/** A stand-in for Zernio: accounts, presign + upload, creator info, posts (207 on request), post status. */
const KEY = "zk_test_123456789";
const KEY2 = "zk_second_987654321";
const zernio = { posts: [] as Record<string, unknown>[], uploaded: 0, failNext: false };
let fake: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  fake = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const base = `http://127.0.0.1:${fake.port}`;
      if (url.pathname.startsWith("/upload/")) {
        zernio.uploaded = (await req.arrayBuffer()).byteLength;
        return new Response(null, { status: 200 });
      }
      // a second Zernio workspace with its own TikTok account (Settings → Social accounts)
      if (req.headers.get("authorization") === `Bearer ${KEY2}` && url.pathname === "/api/v1/accounts")
        return Response.json({ accounts: [{ _id: "acc_2", platform: "tiktok", username: "quotes.my", displayName: "Quotes MY", followersCount: 5, needsReconnection: false, isActive: true }] });
      if (req.headers.get("authorization") !== `Bearer ${KEY}` && req.headers.get("authorization") !== `Bearer ${KEY2}`) return Response.json({ error: "Invalid API key" }, { status: 401 });
      if (url.pathname === "/api/v1/accounts")
        return Response.json({ accounts: [{ _id: "acc_1", platform: "tiktok", username: "healing.my", displayName: "Healing MY", followersCount: 12, needsReconnection: false, isActive: true }, { _id: "acc_ig", platform: "instagram", username: "x" }] });
      if (url.pathname === "/api/v1/media/presign") return Response.json({ uploadUrl: `${base}/upload/abc`, publicUrl: `${base}/public/abc.mp4`, key: "abc", expiresIn: 3600 });
      if (url.pathname === "/api/v1/accounts/acc_1/tiktok/creator-info") return Response.json({ privacyLevels: [{ value: "SELF_ONLY" }, { value: "PUBLIC_TO_EVERYONE" }] });
      if (url.pathname === "/api/v1/posts" && req.method === "POST") {
        zernio.posts.push((await req.json()) as Record<string, unknown>);
        if (zernio.failNext) {
          zernio.failNext = false;
          return Response.json({ post: { _id: "post_bad", status: "failed", platforms: [{ status: "failed", errorMessage: "Video must be at least 3 seconds" }] } }, { status: 207 });
        }
        return Response.json({ message: "ok", post: { _id: `post_${zernio.posts.length}`, status: "published", platforms: [{ platform: "tiktok", status: "published", platformPostUrl: null }] } }, { status: 201 });
      }
      if (url.pathname.startsWith("/api/v1/posts/")) return Response.json({ post: { platforms: [{ status: "published", platformPostUrl: "https://www.tiktok.com/@healing.my/video/777" }] } });
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
});
afterAll(() => fake.stop(true));

const check = { facts_match_brief: true, only_released_features: true, no_overclaims: true, tone_and_language_match: true, notes: "" };
const ffmpeg = Bun.which("ffmpeg");

describe.skipIf(!ffmpeg || !Bun.which("ffprobe"))("TikTok agent: clip folder → video → auto-post through Zernio", () => {
  let dir: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ao-clips-"));
    mkdirSync(join(dir, "music"));
    const make = (args: string[]) => Bun.spawn([ffmpeg!, "-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: dir }).exited;
    expect(await make(["-f", "lavfi", "-i", "testsrc=size=360x640:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "pantai.mp4"])).toBe(0);
    expect(await make(["-f", "lavfi", "-i", "smptebars=size=640x360:rate=30:duration=3", "-f", "lavfi", "-i", "sine=duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "jalan.mp4"])).toBe(0);
    expect(await make(["-f", "lavfi", "-i", "sine=frequency=330:duration=6", "-c:a", "aac", join("music", "calm.m4a")])).toBe(0);
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("connect Zernio, pick clips, render with hook + music, post without approval, link resolved; limits and failures", async () => {
    env = await createTestEnv({}, { zernioApiBase: `http://127.0.0.1:${fake.port}/api/v1` });
    await env.pairRunner();
    const project = (await env.api("/api/projects", { body: { slug: "healing", name: "Healing MY" } })).body.project;

    // connect: a wrong key is refused; the right one lists the TikTok account and picks it
    expect((await env.api(`/api/projects/${project.id}/tiktok`, { method: "PUT", body: { api_key: "wrong" } })).status).toBe(400);
    const tt = (await env.api(`/api/projects/${project.id}/tiktok`, { method: "PUT", body: { api_key: KEY } })).body.tiktok;
    expect(tt).toMatchObject({ has_key: true, account_id: "acc_1", username: "healing.my", accounts: [{ id: "acc_1", followers: 12 }] });
    expect(JSON.stringify(tt)).not.toContain(KEY);

    const agent = (
      await env.api("/api/agents", {
        body: { slug: "tt", name: "TikTok", provider: "mock", model: "mock-script", tools: ["clip_library", "video_edit", "save_draft"], config: { self_review: false, clip_folder: dir, auto_publish: true, auto_publish_daily_max: 1 } },
      })
    ).body.agent;
    const posted: ContentDraft[] = [];
    env.hub.hub.onAutoPublish = (d) => posted.push(d);
    const script = (name: string) => [
      { tool: "clip_library", input: { action: "pick", count: 2, theme: "pantai" } },
      { tool: "video_edit", input: { clips: [{ video: 1 }, { video: 2 }], captions: [{ text: "Untuk kau yang penat", start: 0, end: 6, position: "middle" }], music: { track: "calm.m4a" }, name } },
      { tool: "save_draft", input: { project: "healing", platform: "tiktok", kind: "video", title: "Untuk kau yang penat", body: "Rehat dulu. #fypmalaysia #healing", self_check: check, video: "last" } },
      { text: "siap" },
    ];
    const run = async (name: string) => {
      const job = (await env.api("/api/jobs", { body: { agent_id: agent.id, project_id: project.id, title: name, input: { script: script(name) } } })).body.job;
      await waitFor(() => ["done", "failed"].includes(env.hub.hub.store.state.jobs[job.id]?.status ?? ""), 120_000, "tiktok run");
      expect(env.hub.hub.store.state.jobs[job.id]?.status).toBe("done");
      return job.id as string;
    };

    // 1st: posted at once
    const job1 = await run("first");
    await waitFor(() => posted.length === 1, 60_000, "auto-post");
    expect(posted[0]).toMatchObject({ platform: "tiktok", status: "published", owner_feedback: "auto-published", published_url: "posted" });
    expect(zernio.uploaded).toBeGreaterThan(10_000);
    expect(zernio.posts[0]).toMatchObject({
      content: "Rehat dulu. #fypmalaysia #healing",
      platforms: [{ platform: "tiktok", accountId: "acc_1" }],
      publishNow: true,
      tiktokSettings: { privacy_level: "PUBLIC_TO_EVERYONE", content_preview_confirmed: true, express_consent_given: true },
    });
    // the clips went on the job (uploaded once), and the index remembers them
    const attached = env.hub.hub.db.select().from(jobs).where(eq(jobs.id, job1)).get()!.input.attachments as { name: string }[];
    expect(attached.map((a: { name: string }) => a.name).sort()).toEqual(["jalan.mp4", "pantai.mp4"]);
    const index = JSON.parse(readFileSync(join(dir, ".myofis-clips.json"), "utf8"));
    expect(Object.values(index.clips).map((c) => (c as { uses: number; upload_id: string }).uses)).toEqual([1, 1]);
    // the TikTok link arrives later
    await env.hub.hub.social.resolveTikTokLinks();
    expect((await env.api("/api/drafts?status=decided")).body.drafts[0].published_url).toBe("https://www.tiktok.com/@healing.my/video/777");

    // 2nd: over the daily limit (1) → waits for approval; the clips are reused from the hub, not uploaded again
    const ownClips = () => env.hub.hub.db.select().from(uploads).where(isNull(uploads.run_id)).all().length;
    const uploadsBefore = ownClips();
    await run("second");
    const pending = (await env.api("/api/drafts?status=pending")).body.drafts;
    expect(pending).toHaveLength(1);
    expect(zernio.posts).toHaveLength(1);
    expect(ownClips()).toBe(uploadsBefore);

    // approving it by hand posts it; a 207 from Zernio keeps the error on the draft for Publish again
    zernio.failNext = true;
    // a video posts in the background (it can take longer than Cloudflare's 100 s): the answer comes at once
    const approved = (await env.api(`/api/drafts/${pending[0].id}/decide`, { body: { decision: "approve" } })).body;
    expect(approved).toMatchObject({ posting: true, draft: { status: "approved" } });
    const failed = await waitFor(() => {
      const d = env.hub.hub.content.draft(pending[0].id);
      return d?.publish_error ? d : null;
    }, 30_000, "tiktok post result");
    expect(failed.publish_error).toContain("Video must be at least 3 seconds");
    const again = (await env.api(`/api/drafts/${pending[0].id}/publish`, { method: "POST" })).body.draft;
    expect(again).toMatchObject({ status: "published", publish_error: null });
    expect(existsSync(dir)).toBe(true);
  }, 300_000);
});

describe("Social accounts: many TikTok accounts, chosen per agent, per schedule and per draft", () => {
  test("connect two Zernio keys, default account per agent, a job's account wins, change it on the draft, switched off = never posted", async () => {
    env = await createTestEnv({}, { zernioApiBase: `http://127.0.0.1:${fake.port}/api/v1` });
    await env.pairRunner();
    await env.api("/api/projects", { body: { slug: "sp", name: "SmashPoint" } });

    // two connections, one account each; the owner names one
    const c1 = (await env.api("/api/social-accounts/zernio", { body: { label: "Main", api_key: KEY } })).body.connection;
    expect(c1.accounts).toMatchObject([{ id: "acc_1", username: "healing.my", label: "Healing MY", enabled: true }]);
    expect(JSON.stringify(c1)).not.toContain(KEY);
    const c2 = (await env.api("/api/social-accounts/zernio", { body: { label: "Second", api_key: KEY2 } })).body.connection;
    await env.api(`/api/social-accounts/${c1.id}`, { method: "PATCH", body: { accounts: { acc_1: { label: "Healing" } } } });
    const list = (await env.api("/api/social-accounts")).body;
    expect(list.tiktok.map((t: { id: string; label: string }) => `${t.id}:${t.label}`)).toEqual(["acc_1:Healing", "acc_2:Quotes MY"]);

    // an uploaded video the jobs attach
    const bytes = new Uint8Array(4096).fill(7);
    const res = await freshFetch(`${env.hub.url}/api/uploads/parts/${crypto.randomUUID().replace(/-/g, "")}?${new URLSearchParams({ name: "v.mp4", total: "4096", offset: "0" })}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "video/mp4" },
      body: bytes,
    });
    const video = ((await res.json()) as { upload: { id: string } }).upload;
    const agent = (
      await env.api("/api/agents", { body: { slug: "tk", name: "TK", provider: "mock", model: "mock-script", tools: ["save_draft"], config: { self_review: false, tiktok_account: "acc_1" } } })
    ).body.agent;
    const draftOf = async (input: Record<string, unknown>) => {
      const script = [{ tool: "save_draft", input: { project: "sp", platform: "tiktok", kind: "video", title: "Hook", body: "Caption #fypmalaysia", self_check: check, video: video.id } }, { text: "ok" }];
      const job = (await env.api("/api/jobs", { body: { agent_id: agent.id, title: "tiktok", input: { script, attachments: [{ id: video.id, name: "v.mp4", content_type: "video/mp4" }], ...input } } })).body.job;
      await waitFor(() => env.hub.hub.store.state.jobs[job.id]?.status === "done", 30_000, "job");
      const drafts = (await env.api("/api/drafts?status=pending")).body.drafts as { id: string; run_id: string; meta: { social_account: string | null }; can_publish: boolean }[];
      return drafts.find((d) => env.hub.hub.store.state.runs[d.run_id]?.job_id === job.id)!;
    };
    // the agent's default account, and a schedule/job that picks the other one
    const a = await draftOf({});
    expect(a.meta.social_account).toBe("acc_1");
    expect(a.can_publish).toBe(true);
    const b = await draftOf({ tiktok_account: "acc_2" });
    expect(b.meta.social_account).toBe("acc_2");

    // approving b posts to acc_2 (in the background)
    const before = zernio.posts.length;
    await env.api(`/api/drafts/${b.id}/decide`, { body: { decision: "approve" } });
    await waitFor(() => env.hub.hub.content.draft(b.id)?.status === "published", 30_000, "posted b");
    expect((zernio.posts[before] as { platforms: { accountId: string }[] }).platforms[0]!.accountId).toBe("acc_2");

    // the owner moves a to acc_2; an unknown account is refused
    expect((await env.api(`/api/drafts/${a.id}/account`, { method: "PATCH", body: { account: "acc_nope" } })).status).toBe(400);
    expect((await env.api(`/api/drafts/${a.id}/account`, { method: "PATCH", body: { account: "acc_2" } })).body.draft.meta.social_account).toBe("acc_2");
    // switching acc_2 off: its drafts are never posted elsewhere
    await env.api(`/api/social-accounts/${c2.id}`, { method: "PATCH", body: { accounts: { acc_2: { enabled: false } } } });
    expect((await env.api("/api/drafts?status=pending")).body.drafts.find((d: { id: string }) => d.id === a.id).can_publish).toBe(false);
    const n = zernio.posts.length;
    await env.api(`/api/drafts/${a.id}/decide`, { body: { decision: "approve" } });
    expect(zernio.posts.length).toBe(n);
    expect(env.hub.hub.content.draft(a.id)?.status).toBe("approved");

    // removing a connection drops its accounts
    await env.api(`/api/social-accounts/${c2.id}`, { method: "DELETE" });
    expect((await env.api("/api/social-accounts")).body.tiktok.map((t: { id: string }) => t.id)).toEqual(["acc_1"]);
  }, 120_000);
});
