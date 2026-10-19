import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { freshFetch } from "@agent-office/shared";
import { TOKEN, createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

const SECRET = "site-shared-secret-123";
let env: TestEnv;
let site: ReturnType<typeof Bun.serve>;
let siteDown = false;
const received: { post: Record<string, unknown>; cover: { content_type: string; data_base64: string } | null; draft_id: string }[] = [];

/** A website's /agent-office/publish endpoint, checking the signature like a real one must. */
function verify(req: Request, body: string) {
  const ts = req.headers.get("x-ao-timestamp") ?? "";
  const sig = req.headers.get("x-ao-signature") ?? "";
  const want = `v1=${createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")}`;
  return sig === want && Math.abs(Date.now() / 1000 - Number(ts)) < 300;
}

beforeAll(() => {
  site = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      // GET signs its query string, POST its body
      const body = req.method === "POST" ? await req.text() : new URL(req.url).search.replace(/^\?/, "");
      if (!verify(req, body)) return Response.json({ error: "bad signature" }, { status: 401 });
      const params = new URLSearchParams(body);
      if (req.method === "GET" && params.get("resource") === "bookings") {
        return Response.json({
          site_name: "SmashPoint",
          from: params.get("from"),
          bookings: [
            { date: params.get("from"), time: "20:00", court: "Court 1", customer: "Ali", phone: "60123456789", payment_status: "PENDING" },
            { date: params.get("from"), time: "21:00", court: "Court 2", customer: "Siti", phone: "60198765432", payment_status: "PAID" },
          ],
        });
      }
      if (req.method === "GET") return Response.json({ site_name: "SmashPoint", post_types: ["news", "tournament", "vlog"] });
      if (siteDown) return Response.json({ error: "firestore unavailable" }, { status: 503 });
      const data = JSON.parse(body);
      received.push(data);
      return Response.json({ id: `p${received.length}`, url: `https://smashpoint.example/news/p${received.length}` });
    },
  });
});
afterAll(() => site.stop(true));
afterEach(async () => {
  await env?.close();
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const check = { facts_match_brief: true, only_released_features: true, no_overclaims: true, tone_and_language_match: true, notes: "" };

async function setup() {
  env = await createTestEnv();
  await env.pairRunner();
  const project = (await env.api("/api/projects", { body: { slug: "smashpoint", name: "SmashPoint" } })).body.project;
  const agent = (
    await env.api("/api/agents", { body: { slug: "pub", name: "Publisher", provider: "mock", model: "mock-script", tools: ["draft_web_post"], config: { self_review: false } } })
  ).body.agent;
  return { project, agent };
}

async function upload() {
  const res = await freshFetch(`${env.hub.url}/api/uploads?name=court.png`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "image/png" }, body: PNG });
  expect(res.status).toBe(201);
  return ((await res.json()) as { upload: { id: string } }).upload.id;
}

describe("Publisher: chat photo → website post → approve → published", () => {
  test("the whole loop, signed, with the cover photo", async () => {
    const { project, agent } = await setup();
    const url = `http://127.0.0.1:${site.port}/agent-office/publish`;

    // the owner connects the website and tests it: its post types are remembered
    await env.api(`/api/projects/${project.id}/publish`, { method: "PUT", body: { url, secret: SECRET } });
    const tested = (await env.api(`/api/projects/${project.id}/publish/test`, { method: "POST" })).body.publish;
    expect(tested).toMatchObject({ url, has_secret: true, info: { site_name: "SmashPoint", post_types: ["news", "tournament", "vlog"] } });
    expect(JSON.stringify(tested)).not.toContain(SECRET);

    // the owner chats with a photo; the agent drafts the post with the photo as cover
    const photo = await upload();
    const script = [
      {
        tool: "draft_web_post",
        input: {
          project: "smashpoint",
          post_type: "tournament",
          title: "SmashPoint Open: Saturday 24 Oct",
          excerpt: "Doubles tournament with RM500 in prizes. Register by Friday.",
          body: "## SmashPoint Open\n\n- **Date:** Saturday 24 Oct, 9am\n- **Prize:** RM500\n\nRegister at the counter.",
          tags: ["tournament", "doubles"],
          event_date: "2026-10-24",
          event_time: "09:00",
          location: "SmashPoint Court 1-4",
          cover_photo: 1,
          self_check: check,
        },
      },
      { text: "Drafted the tournament post; it goes live when you approve it." },
    ];
    const chat = (await env.api("/api/chat", { body: { agent_id: agent.id, text: "Tournament Sabtu ni, hadiah RM500", project_id: project.id, attachments: [photo] } })).body;
    expect(chat.job.input.attachments).toEqual([{ id: photo, name: "court.png", content_type: "image/png" }]);
    // the mock model needs its script; real models read the photo instead
    const job = (await env.api("/api/jobs", { body: { agent_id: agent.id, project_id: project.id, title: "post", input: { script, attachments: chat.job.input.attachments } } })).body.job;
    await waitFor(() => env.hub.hub.store.state.jobs[job.id]?.status === "done", 8000, "draft run");

    const [draft] = (await env.api("/api/drafts?status=pending")).body.drafts;
    expect(draft).toMatchObject({ kind: "web_post", platform: "website", meta: { post_type: "tournament", cover_upload_id: photo, event_date: "2026-10-24" } });

    // approve = publish
    const decided = (await env.api(`/api/drafts/${draft.id}/decide`, { body: { decision: "approve" } })).body.draft;
    expect(decided).toMatchObject({ status: "published", published_url: "https://smashpoint.example/news/p1", publish_error: null });
    expect(received[0]!.post).toMatchObject({ type: "tournament", title: "SmashPoint Open: Saturday 24 Oct", tags: ["tournament", "doubles"], location: "SmashPoint Court 1-4" });
    expect(received[0]!.cover).toMatchObject({ content_type: "image/png", data_base64: Buffer.from(PNG).toString("base64") });
    expect(received[0]!.draft_id).toBe(draft.id);
  });

  test("site down: the draft stays approved with the error; publish again works", async () => {
    const { project, agent } = await setup();
    await env.api(`/api/projects/${project.id}/publish`, { method: "PUT", body: { url: `http://127.0.0.1:${site.port}/p`, secret: SECRET } });
    await env.api(`/api/projects/${project.id}/publish/test`, { method: "POST" });
    const script = [
      { tool: "draft_web_post", input: { project: "smashpoint", post_type: "news", title: "New lights on court 3", excerpt: "Brighter LED lights are up on court 3.", body: "Court 3 now has new LED lights.", self_check: check } },
      { tool: "draft_web_post", input: { project: "smashpoint", post_type: "recipe", title: "Wrong type", excerpt: "This type does not exist.", body: "Should be refused by the tool.", self_check: check } },
      { text: "ok" },
    ];
    const job = (await env.api("/api/jobs", { body: { agent_id: agent.id, project_id: project.id, title: "post", input: { script } } })).body.job;
    await waitFor(() => env.hub.hub.store.state.jobs[job.id]?.status === "done", 8000, "draft run");
    const drafts = (await env.api("/api/drafts?status=pending")).body.drafts;
    expect(drafts).toHaveLength(1); // the unknown post type was refused

    // the owner edits fields before approving; an unknown cover is refused
    const bad = await env.api(`/api/drafts/${drafts[0].id}/decide`, { body: { decision: "approve", meta: { cover_upload_id: "upl_nope" } } });
    expect(bad.status).toBe(400);
    siteDown = true;
    const failed = (
      await env.api(`/api/drafts/${drafts[0].id}/decide`, {
        body: { decision: "approve", title: "New LED lights on court 3!", meta: { event_date: "2026-11-01", tags: ["court", "lights"] } },
      })
    ).body.draft;
    expect(failed).toMatchObject({ title: "New LED lights on court 3!", meta: { post_type: "news", excerpt: "Brighter LED lights are up on court 3.", event_date: "2026-11-01", tags: ["court", "lights"] } });
    expect(failed).toMatchObject({ status: "edited", published_url: null });
    expect(failed.publish_error).toContain("503");
    siteDown = false;
    const retried = (await env.api(`/api/drafts/${drafts[0].id}/publish`, { method: "POST" })).body.draft;
    expect(retried.status).toBe("published");
    expect(received.at(-1)!.post).toMatchObject({ title: "New LED lights on court 3!", event_date: "2026-11-01", tags: ["court", "lights"] });
  });

  test("approve with a publish time: nothing goes out until then; move, cancel and publish-now work", async () => {
    const { project, agent } = await setup();
    await env.api(`/api/projects/${project.id}/publish`, { method: "PUT", body: { url: `http://127.0.0.1:${site.port}/s`, secret: SECRET } });
    await env.api(`/api/projects/${project.id}/publish/test`, { method: "POST" });
    const post = (title: string) => ({ tool: "draft_web_post", input: { project: "smashpoint", post_type: "news", title, excerpt: "Open late on Friday night.", body: "We open until 2am on Friday.", self_check: check } });
    const job = (await env.api("/api/jobs", { body: { agent_id: agent.id, project_id: project.id, title: "post", input: { script: [post("Late night Friday"), post("Second post"), { text: "ok" }] } } })).body.job;
    await waitFor(() => env.hub.hub.store.state.jobs[job.id]?.status === "done", 8000, "draft run");
    const [a, b] = (await env.api("/api/drafts?status=pending")).body.drafts;
    const before = received.length;

    // too soon / too far is refused
    const soon = await env.api(`/api/drafts/${a.id}/decide`, { body: { decision: "approve", publish_at: new Date(Date.now() + 5_000).toISOString() } });
    expect(soon.status).toBe(400);
    const far = await env.api(`/api/drafts/${a.id}/decide`, { body: { decision: "approve", publish_at: new Date(Date.now() + 61 * 86_400_000).toISOString() } });
    expect(far.status).toBe(400);

    const at = new Date(Date.now() + 2 * 3600_000);
    const scheduled = (await env.api(`/api/drafts/${a.id}/decide`, { body: { decision: "approve", publish_at: at.toISOString() } })).body.draft;
    expect(scheduled).toMatchObject({ status: "approved", publish_at: at.toISOString(), published_url: null });
    expect(received.length).toBe(before);
    expect(await env.hub.hub.publishDue()).toEqual([]);

    // its time comes: published once, the schedule is used up
    const done = await env.hub.hub.publishDue(new Date(at.getTime() + 1000));
    expect(done.map((d) => d.draft)).toMatchObject([{ id: a.id, status: "published", publish_at: null }]);
    expect(received.length).toBe(before + 1);
    expect(await env.hub.hub.publishDue(new Date(at.getTime() + 60_000))).toEqual([]);
    expect((await env.api(`/api/drafts/${a.id}/schedule`, { body: { publish_at: at.toISOString() } })).status).toBe(409);

    // the second: scheduled, moved, cancelled, then published now
    await env.api(`/api/drafts/${b.id}/decide`, { body: { decision: "approve", publish_at: at.toISOString() } });
    const later = new Date(at.getTime() + 86_400_000).toISOString();
    expect((await env.api(`/api/drafts/${b.id}/schedule`, { body: { publish_at: later } })).body.draft.publish_at).toBe(later);
    expect(await env.hub.hub.publishDue(new Date(at.getTime() + 1000))).toEqual([]);
    expect((await env.api(`/api/drafts/${b.id}/schedule`, { body: { publish_at: null } })).body.draft).toMatchObject({ status: "approved", publish_at: null });
    expect(await env.hub.hub.publishDue(new Date(Date.parse(later) + 1000))).toEqual([]);
    expect(received.length).toBe(before + 1);
    await env.api(`/api/drafts/${b.id}/schedule`, { body: { publish_at: later } });
    const now = (await env.api(`/api/drafts/${b.id}/publish`, { method: "POST" })).body.draft;
    expect(now).toMatchObject({ status: "published", publish_at: null });
  });

  test("runners can only fetch photos attached to the job they are running", async () => {
    await setup();
    const photo = await upload();
    const res = await freshFetch(`${env.hub.url}/api/runner/uploads/${photo}?run_id=nope`, { headers: { authorization: "Bearer wrong" } });
    expect(res.status).toBe(401);
    // the owner can view it
    const own = await freshFetch(`${env.hub.url}/api/uploads/${photo}`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(own.headers.get("content-type")).toBe("image/png");
  });
});

describe("Kerani: bookings from the website", () => {
  test("read_bookings goes through the hub with a signed query", async () => {
    const { project } = await setup();
    await env.api(`/api/projects/${project.id}/publish`, { method: "PUT", body: { url: `http://127.0.0.1:${site.port}/agent-office/publish`, secret: SECRET } });
    await env.api(`/api/projects/${project.id}/publish/test`, { method: "POST" });
    const kerani = (await env.api("/api/agents", { body: { slug: "kr", name: "Kerani", provider: "mock", model: "mock-script", tools: ["read_bookings"], config: { self_review: false } } })).body.agent;
    const job = (
      await env.api("/api/jobs", { body: { agent_id: kerani.id, project_id: project.id, title: "today", input: { script: [{ tool: "read_bookings", input: { from: "2026-10-18" } }, { text: "ok" }] } } })
    ).body.job;
    await waitFor(() => env.hub.hub.store.state.jobs[job.id]?.status === "done", 8000, "kerani run");
    const runId = env.hub.hub.store.state.jobs[job.id]!.run_ids[0]!;
    const result = (await env.api(`/api/runs/${runId}`)).body.events.find((e: { type: string }) => e.type === "agent.tool_result").payload;
    expect(result).toMatchObject({ tool: "read_bookings", ok: true, summary: "2 bookings from SmashPoint" });
  });
});

describe("Publisher: change or take down a live post", () => {
  test("update sends the edits as action=update; take down removes it and the draft can be published again", async () => {
    const { project, agent } = await setup();
    await env.api(`/api/projects/${project.id}/publish`, { method: "PUT", body: { url: `http://127.0.0.1:${site.port}/p`, secret: SECRET } });
    await env.api(`/api/projects/${project.id}/publish/test`, { method: "POST" });
    const script = [
      { tool: "draft_web_post", input: { project: "smashpoint", post_type: "tournament", title: "Open on 24 Oct", excerpt: "Doubles open, RM500 prize.", body: "Doubles open on 24 Oct.", event_date: "2026-10-24", self_check: check } },
      { text: "ok" },
    ];
    const job = (await env.api("/api/jobs", { body: { agent_id: agent.id, project_id: project.id, title: "post", input: { script } } })).body.job;
    await waitFor(() => env.hub.hub.store.state.jobs[job.id]?.status === "done", 8000, "draft run");
    const [d] = (await env.api("/api/drafts?status=pending")).body.drafts;
    expect((await env.api(`/api/drafts/${d.id}/decide`, { body: { decision: "approve" } })).body.draft.status).toBe("published");

    const updated = (await env.api(`/api/drafts/${d.id}/update-published`, { body: { title: "Open moved to 31 Oct", meta: { event_date: "2026-10-31" } } })).body.draft;
    expect(updated).toMatchObject({ status: "published", title: "Open moved to 31 Oct", meta: { event_date: "2026-10-31", excerpt: "Doubles open, RM500 prize." } });
    expect(received.at(-1)).toMatchObject({ action: "update", draft_id: d.id, post: { title: "Open moved to 31 Oct", event_date: "2026-10-31" } });

    const down = (await env.api(`/api/drafts/${d.id}/take-down`, { method: "POST" })).body.draft;
    expect(down).toMatchObject({ status: "approved", published_url: null });
    expect(received.at(-1)).toMatchObject({ action: "delete", draft_id: d.id });
    // the context lists only live posts, and a taken-down post is not live
    expect(env.hub.hub.content.context([project.id]).projects[0]!.published_posts).toEqual([]);
  });
});
