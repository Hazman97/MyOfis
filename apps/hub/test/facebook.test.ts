import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { freshFetch } from "@agent-office/shared";
import { TOKEN, createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

const PAGE = "1234567890";
const PAGE_TOKEN = "EAA-page-token-secret-123";
let env: TestEnv;
let graph: ReturnType<typeof Bun.serve>;
const calls: { path: string; caption: string | null; message: string | null; hasPhoto: boolean }[] = [];

beforeAll(() => {
  // a fake Graph API: the Page, /feed and /photos
  graph = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET") {
        if (url.searchParams.get("access_token") !== PAGE_TOKEN) return Response.json({ error: { message: "Invalid OAuth access token" } }, { status: 400 });
        return Response.json({ name: "SmashPoint Badminton", id: PAGE });
      }
      const form = await req.formData();
      if (form.get("access_token") !== PAGE_TOKEN) return Response.json({ error: { message: "Invalid OAuth access token" } }, { status: 400 });
      calls.push({ path: url.pathname, caption: form.get("caption") as string | null, message: form.get("message") as string | null, hasPhoto: form.get("source") instanceof Blob });
      return url.pathname.endsWith("/photos") ? Response.json({ id: "ph1", post_id: `${PAGE}_111` }) : Response.json({ id: `${PAGE}_222` });
    },
  });
});
afterAll(() => graph.stop(true));
afterEach(async () => {
  await env?.close();
});

const check = { facts_match_brief: true, only_released_features: true, no_overclaims: true, tone_and_language_match: true, notes: "" };

describe("Facebook Page posting", () => {
  test("approved Facebook captions are posted to the Page: with the photo, or as text", async () => {
    env = await createTestEnv({}, { facebookGraphBase: `http://127.0.0.1:${graph.port}` });
    await env.pairRunner();
    const project = (await env.api("/api/projects", { body: { slug: "sp", name: "SmashPoint" } })).body.project;

    // connect the Page; a wrong token fails the test, the right one shows the Page name
    await env.api(`/api/projects/${project.id}/facebook`, { method: "PUT", body: { page_id: PAGE, token: "wrong-token" } });
    expect((await env.api(`/api/projects/${project.id}/facebook/test`, { method: "POST" })).status).toBe(400);
    await env.api(`/api/projects/${project.id}/facebook`, { method: "PUT", body: { page_id: PAGE, token: PAGE_TOKEN } });
    const fb = (await env.api(`/api/projects/${project.id}/facebook/test`, { method: "POST" })).body.facebook;
    expect(fb).toMatchObject({ page_id: PAGE, page_name: "SmashPoint Badminton", has_token: true });
    expect(JSON.stringify(fb)).not.toContain(PAGE_TOKEN);

    // a caption with the owner's photo, and one without
    const up = await freshFetch(`${env.hub.url}/api/uploads?name=court.jpg`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "image/jpeg" }, body: new Uint8Array([255, 216, 255, 0]) });
    const photo = ((await up.json()) as { upload: { id: string } }).upload.id;
    const agent = (await env.api("/api/agents", { body: { slug: "mk", name: "Marketing", provider: "mock", model: "mock-script", tools: ["save_draft"], config: { self_review: false } } })).body.agent;
    const caption = (title: string, extra = {}) => ({ tool: "save_draft", input: { project: "sp", platform: "facebook", kind: "caption", title, body: `${title} at SmashPoint this Saturday!`, self_check: check, ...extra } });
    const job = (
      await env.api("/api/jobs", {
        body: { agent_id: agent.id, project_id: project.id, title: "captions", input: { attachments: [{ id: photo, name: "court.jpg", content_type: "image/jpeg" }], script: [caption("With photo", { cover_photo: 1 }), caption("Text only"), { text: "ok" }] } },
      })
    ).body.job;
    await waitFor(() => env.hub.hub.store.state.jobs[job.id]?.status === "done", 8000, "captions");
    const drafts = (await env.api("/api/drafts?status=pending")).body.drafts as { id: string; title: string; meta: { cover_upload_id: string } | null }[];
    const withPhoto = drafts.find((d) => d.title === "With photo")!;
    expect(withPhoto.meta?.cover_upload_id).toBe(photo);

    const a = (await env.api(`/api/drafts/${withPhoto.id}/decide`, { body: { decision: "approve" } })).body.draft;
    expect(a).toMatchObject({ status: "published", published_url: `https://www.facebook.com/${PAGE}_111` });
    expect(calls.at(-1)).toMatchObject({ path: `/${PAGE}/photos`, caption: "With photo at SmashPoint this Saturday!", hasPhoto: true });

    const b = (await env.api(`/api/drafts/${drafts.find((d) => d.title === "Text only")!.id}/decide`, { body: { decision: "approve" } })).body.draft;
    expect(b.published_url).toBe(`https://www.facebook.com/${PAGE}_222`);
    expect(calls.at(-1)).toMatchObject({ path: `/${PAGE}/feed`, message: "Text only at SmashPoint this Saturday!", hasPhoto: false });
  });

  test("without a connected Page, approving a Facebook caption only records it", async () => {
    env = await createTestEnv({}, { facebookGraphBase: `http://127.0.0.1:${graph.port}` });
    await env.pairRunner();
    const project = (await env.api("/api/projects", { body: { slug: "sp2", name: "Other" } })).body.project;
    const agent = (await env.api("/api/agents", { body: { slug: "mk2", name: "Marketing", provider: "mock", model: "mock-script", tools: ["save_draft"], config: { self_review: false } } })).body.agent;
    const before = calls.length;
    const job = (
      await env.api("/api/jobs", {
        body: { agent_id: agent.id, project_id: project.id, title: "c", input: { script: [{ tool: "save_draft", input: { project: "sp2", platform: "facebook", kind: "caption", title: "Hi", body: "Hello there everyone", self_check: check } }, { text: "ok" }] } },
      })
    ).body.job;
    await waitFor(() => env.hub.hub.store.state.jobs[job.id]?.status === "done", 8000, "caption");
    const [d] = (await env.api("/api/drafts?status=pending")).body.drafts;
    expect((await env.api(`/api/drafts/${d.id}/decide`, { body: { decision: "approve" } })).body.draft).toMatchObject({ status: "approved", published_url: null });
    expect(calls.length).toBe(before);
  });
});
