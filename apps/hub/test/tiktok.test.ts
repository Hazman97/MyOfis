import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, isNull } from "drizzle-orm";
import type { ContentDraft } from "@agent-office/shared";
import { jobs, uploads } from "../src/db/schema.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

/** A stand-in for Zernio: accounts, presign + upload, creator info, posts (207 on request), post status. */
const KEY = "zk_test_123456789";
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
      if (req.headers.get("authorization") !== `Bearer ${KEY}`) return Response.json({ error: "Invalid API key" }, { status: 401 });
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
