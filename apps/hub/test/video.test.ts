import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshFetch } from "@agent-office/shared";
import { uploads } from "../src/db/schema.ts";
import { TOKEN, createTestEnv, waitFor, type TestEnv } from "./helpers.ts";
import { OpencutWatch } from "../src/opencutWatch.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

const put = (key: string, q: Record<string, string>, body: Uint8Array, type = "video/mp4") =>
  freshFetch(`${env.hub.url}/api/uploads/parts/${key}?${new URLSearchParams(q)}`, { method: "PUT", headers: { authorization: `Bearer ${TOKEN}`, "content-type": type }, body });

/** Upload a video in two parts, like the web client does for big files. */
async function sendVideo(bytes: Uint8Array, name = "clip.mp4"): Promise<{ id: string; size: number }> {
  const key = crypto.randomUUID().replace(/-/g, "");
  const half = Math.floor(bytes.length / 2);
  const total = String(bytes.length);
  expect((await put(key, { name, total, offset: "0" }, bytes.slice(0, half))).status).toBe(200);
  // a retried part is ignored, a gap is refused with what we have
  expect(((await (await put(key, { name, total, offset: "0" }, bytes.slice(0, half))).json()) as { received: number }).received).toBe(half);
  expect((await put(key, { name, total, offset: String(half + 1) }, bytes.slice(half + 1))).status).toBe(409);
  const last = await put(key, { name, total, offset: String(half) }, bytes.slice(half));
  expect(last.status).toBe(201);
  return ((await last.json()) as { upload: { id: string; size: number } }).upload;
}

const check = { facts_match_brief: true, only_released_features: true, no_overclaims: true, tone_and_language_match: true, notes: "" };

describe("video uploads", () => {
  test("parts, range requests, downloads; only videos go in parts", async () => {
    env = await createTestEnv();
    const bytes = new Uint8Array(1000).map((_, i) => i % 251);
    const up = await sendVideo(bytes);
    expect(up.size).toBe(1000);

    const ranged = await freshFetch(`${env.hub.url}/api/uploads/${up.id}`, { headers: { authorization: `Bearer ${TOKEN}`, range: "bytes=100-199" } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(bytes.slice(100, 200));
    const dl = await freshFetch(`${env.hub.url}/api/uploads/${up.id}?download=1`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(dl.headers.get("content-disposition")).toContain('filename="clip.mp4"');
    expect((await dl.arrayBuffer()).byteLength).toBe(1000);

    expect((await put("k".repeat(20), { name: "x.jpg", total: "10", offset: "0" }, new Uint8Array(10), "image/jpeg")).status).toBe(400);
    expect((await put("bad key", { name: "x.mp4", total: "10", offset: "0" }, new Uint8Array(10))).status).toBe(400);
    expect((await freshFetch(`${env.hub.url}/api/uploads/parts/${"a".repeat(20)}?name=x&total=10&offset=0`, { method: "PUT", headers: { "content-type": "video/mp4" }, body: new Uint8Array(10) })).status).toBe(401);
  });

  test("a reply without files keeps the thread's files", async () => {
    env = await createTestEnv();
    const agent = (await env.api("/api/agents", { body: { slug: "ed", name: "Editor", provider: "mock", model: "mock-script", tools: ["save_draft"], config: { self_review: false } } })).body.agent;
    const v = await sendVideo(new Uint8Array(64).fill(7));
    const first = (await env.api("/api/chat", { body: { agent_id: agent.id, text: "potong jadi TikTok", attachments: [v.id] } })).body;
    const second = (await env.api("/api/chat", { body: { agent_id: agent.id, text: "yang 30 saat", thread_id: first.thread_id } })).body;
    expect(second.job.input).toMatchObject({ attachments: [{ id: v.id, content_type: "video/mp4" }], attachments_carried: true });
    const thread = (await env.api(`/api/chat/threads/${first.thread_id}`)).body.messages as { attachments: unknown[] }[];
    expect(thread.map((m) => m.attachments.length)).toEqual([1, 0]);
  });
});

const ffmpeg = Bun.which("ffmpeg");
describe.skipIf(!ffmpeg || !Bun.which("ffprobe"))("Editor renders on the runner", () => {
  let dir: string;
  let clip: Uint8Array;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ao-hub-video-"));
    const code = await Bun.spawn([ffmpeg!, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=2", "-f", "lavfi", "-i", "sine=duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest", "in.mp4"], { cwd: dir }).exited;
    expect(code).toBe(0);
    clip = new Uint8Array(readFileSync(join(dir, "in.mp4")));
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("the owner's clip → TikTok FHD render (uploaded in parts) → video draft", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const project = (await env.api("/api/projects", { body: { slug: "sp", name: "SmashPoint" } })).body.project;
    const v = await sendVideo(clip, "match.mp4");
    const agent = (
      await env.api("/api/agents", { body: { slug: "ed", name: "Editor", provider: "mock", model: "mock-script", tools: ["video_probe", "video_edit", "save_draft"], config: { self_review: false } } })
    ).body.agent;
    const caption = (title: string, video: string) => ({ tool: "save_draft", input: { project: "sp", platform: "tiktok", kind: "video", title, body: "Smash terbaik minggu ni! #smashpoint", self_check: check, video } });
    const script = [
      { tool: "video_probe", input: { video: 1 } },
      { tool: "video_edit", input: { clips: [{ video: 1, start: 0.5 }], name: "highlight", captions: [{ text: "SmashPoint", start: 0, end: 1 }] } },
      caption("owner clip", v.id),
      caption("made up", "upl_nope"),
      { text: "siap" },
    ];
    const job = (await env.api("/api/jobs", { body: { agent_id: agent.id, project_id: project.id, title: "tiktok", input: { script, attachments: [{ id: v.id, name: "match.mp4", content_type: "video/mp4" }] } } })).body.job;
    await waitFor(() => ["done", "failed"].includes(env.hub.hub.store.state.jobs[job.id]?.status ?? ""), 120_000, "render");
    expect(env.hub.hub.store.state.jobs[job.id]?.status).toBe("done");

    // the render came back as an upload tied to the run
    const renders = env.hub.hub.db.select().from(uploads).all().filter((u) => u.run_id);
    expect(renders).toHaveLength(1);
    expect(renders[0]).toMatchObject({ name: "highlight-tiktok_fhd.mp4", content_type: "video/mp4" });
    expect(renders[0]!.size).toBeGreaterThan(10_000);

    const drafts = (await env.api("/api/drafts?status=pending")).body.drafts as { id: string; title: string; kind: string; meta: { video_upload_id: string | null } | null }[];
    const draft = drafts.find((d) => d.title === "owner clip")!;
    expect(draft).toMatchObject({ kind: "video", meta: { video_upload_id: v.id } });
    expect(drafts.find((d) => d.title === "made up")).toBeUndefined(); // save_draft refused the unknown id

    // no TikTok connected: approving just records it (the owner downloads and posts it)
    expect((await env.api(`/api/drafts/${draft.id}/decide`, { body: { decision: "approve" } })).body.draft).toMatchObject({ status: "approved", publish_error: null });
  }, 180_000);

  test("Video Studio: a render remembers its plan; Render again (no AI) swaps the draft's video; own edits can replace it", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const project = (await env.api("/api/projects", { body: { slug: "sp", name: "SmashPoint" } })).body.project;
    const v = await sendVideo(clip, "match.mp4");
    const agent = (
      await env.api("/api/agents", { body: { slug: "ed2", name: "Editor 2", provider: "mock", model: "mock-script", tools: ["video_edit", "save_draft"], config: { self_review: false } } })
    ).body.agent;
    const script = [
      { tool: "video_edit", input: { clips: [{ video: 1, start: 0.5 }], name: "first", captions: [{ text: "Smash", start: 0, end: 1 }] } },
      { tool: "save_draft", input: { project: "sp", platform: "tiktok", kind: "video", title: "Clip", body: "Smash! #smashpoint", self_check: check, video: v.id } },
      { text: "ok" },
    ];
    const job = (await env.api("/api/jobs", { body: { agent_id: agent.id, project_id: project.id, title: "edit", input: { script, attachments: [{ id: v.id, name: "match.mp4", content_type: "video/mp4" }] } } })).body.job;
    await waitFor(() => ["done", "failed"].includes(env.hub.hub.store.state.jobs[job.id]?.status ?? ""), 120_000, "first render");

    // the render remembers how it was made
    const render = env.hub.hub.db.select().from(uploads).all().find((u) => u.run_id)!;
    const info = (await env.api(`/api/videos/${render.id}`)).body;
    expect(info).toMatchObject({ known: true, render: { plan: { name: "first", preset: "tiktok_fhd", captions: [{ text: "Smash" }] }, attachments: [{ id: v.id }] } });
    // the owner's own clip has no plan yet: the studio starts from the whole video
    const own = (await env.api(`/api/videos/${v.id}`)).body;
    expect(own).toMatchObject({ known: false, render: { plan: { clips: [{ video: 1, start: 0 }] } } });
    const draft = own.drafts[0];
    expect(draft).toMatchObject({ title: "Clip", status: "draft" });

    // bad plans are refused before any job starts
    expect((await env.api(`/api/videos/${v.id}/render`, { body: { plan: { clips: [{ video: 2 }] } } })).status).toBe(400);
    expect((await env.api(`/api/videos/${v.id}/render`, { body: { plan: { clips: [{ video: 1, start: 1, end: 0.5 }] } } })).status).toBe(400);

    // Render again from the studio: no LLM, the draft switches to the new video
    const plan = { ...own.render.plan, fit: "pad", name: "again", captions: [{ text: "Sabtu ni!", start: 0, end: 1, position: "top" }] };
    const rj = (await env.api(`/api/videos/${v.id}/render`, { body: { plan, draft_id: draft.id } })).body.job;
    expect(rj).toMatchObject({ type: "video_render" });
    await waitFor(() => ["done", "failed"].includes(env.hub.hub.store.state.jobs[rj.id]?.status ?? ""), 120_000, "re-render");
    expect(env.hub.hub.store.state.jobs[rj.id]?.status).toBe("done");
    const again = env.hub.hub.db.select().from(uploads).all().find((u) => u.name === "again-tiktok_fhd.mp4")!;
    expect(again.render?.plan.fit).toBe("pad");
    const updated = (await env.api("/api/drafts?status=pending")).body.drafts.find((d: { id: string }) => d.id === draft.id);
    expect(updated.meta.video_upload_id).toBe(again.id);
    expect(env.hub.hub.store.state.pending_drafts[draft.id]?.updated_at).toBeTruthy();
    // a re-render uses no tokens
    const run = env.hub.hub.store.state.runs[env.hub.hub.store.state.jobs[rj.id]!.run_ids[0]!]!;
    expect(run.tokens_in + run.tokens_out).toBe(0);

    // the owner's own edit (e.g. exported from OpenCut) can replace it; photos and decided drafts cannot
    const mine = await sendVideo(clip, "opencut-export.mp4");
    expect((await env.api(`/api/drafts/${draft.id}/video`, { method: "PATCH", body: { upload_id: mine.id } })).body.draft.meta.video_upload_id).toBe(mine.id);
    const photo = (await (await freshFetch(`${env.hub.url}/api/uploads?name=p.jpg`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "image/jpeg" }, body: new Uint8Array([255, 216, 255]) })).json()) as { upload: { id: string } };
    expect((await env.api(`/api/drafts/${draft.id}/video`, { method: "PATCH", body: { upload_id: photo.upload.id } })).status).toBe(400);
    await env.api(`/api/drafts/${draft.id}/decide`, { body: { decision: "reject" } });
    expect((await env.api(`/api/drafts/${draft.id}/video`, { method: "PATCH", body: { upload_id: mine.id } })).status).toBe(409);
  }, 300_000);
});

describe("OpenCut watcher", () => {
  test("first look only records; a new release or changed API lines are reported", async () => {
    let tag = "v0.1.0";
    let readme = "# OpenCut\n- [ ] Editor API (planned)\n- [ ] MCP server (planned)\n";
    const gh = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const p = new URL(req.url).pathname;
        if (!req.headers.get("user-agent")) return new Response("no UA", { status: 403 });
        if (p.endsWith("/releases")) return Response.json([{ tag_name: tag, name: tag, html_url: `https://github.com/opencut-app/opencut/releases/${tag}` }]);
        if (p.endsWith("/readme")) return new Response(readme);
        return new Response("nope", { status: 404 });
      },
    });
    try {
      env = await createTestEnv({}, { opencutApiBase: `http://127.0.0.1:${gh.port}` });
      const w = new OpencutWatch(env.hub.hub.db, `http://127.0.0.1:${gh.port}`);
      expect(w.due()).toBe(true);
      expect(await w.check()).toEqual([]);
      expect(w.due()).toBe(false);
      expect(await w.check()).toEqual([]); // nothing changed
      tag = "v0.2.0";
      readme = "# OpenCut\n- [x] Editor API (shipped)\n- [ ] MCP server (planned)\n";
      const msgs = await w.check();
      expect(msgs).toHaveLength(2);
      expect(msgs[0]).toContain("OpenCut released v0.2.0");
      expect(msgs[1]).toContain("Editor API (shipped)");
      expect((await env.api("/api/opencut")).body.opencut).toMatchObject({ release: "v0.2.0" });
    } finally {
      gh.stop(true);
    }
  });
});
