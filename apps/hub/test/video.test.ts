import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshFetch } from "@agent-office/shared";
import { uploads } from "../src/db/schema.ts";
import { TOKEN, createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

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
});
