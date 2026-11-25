import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agents, contentDrafts, jobs, projects, runners, runs, uploads } from "../src/db/schema.ts";
import { hashToken } from "../src/crypto.ts";
import { startHub, type HubServer } from "../src/server.ts";
import { TOKEN, testConfig } from "./helpers.ts";

const newId = (p: string) => `${p}_${crypto.randomUUID().slice(0, 8)}`;

describe("Task 040 Step 4: Hub parts PNG gate, swap-schedule, and meta.images scoping", () => {
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    while (cleanups.length) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "hub-design-040-"));
    const srv: HubServer = startHub(testConfig(dir));
    cleanups.push(async () => {
      await srv.stop();
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {}
    });
    return { dir, srv };
  }

  test("parts route accepts PNG only for design_render, refuses other agents (403), and refuses video for design_render-only", async () => {
    const { srv } = setup();
    const db = srv.hub.db;
    const runnerId = newId("runr");
    const runnerToken = "runner-design-tok";
    db.insert(runners).values({ id: runnerId, name: "r1", token_hash: hashToken(runnerToken) }).run();

    const agtDesign = newId("agt");
    const agtOther = newId("agt");
    db.insert(agents).values({ id: agtDesign, workspace_id: "owner", slug: "des-1", name: "Designer", role: "Design", system_prompt: "t", tools: ["design_render"], provider: "mock", model: "mock" }).run();
    db.insert(agents).values({ id: agtOther, workspace_id: "owner", slug: "oth-1", name: "Other", role: "Other", system_prompt: "t", tools: ["video_edit"], provider: "mock", model: "mock" }).run();

    const j1 = newId("job");
    const r1 = newId("run");
    db.insert(jobs).values({ id: j1, workspace_id: "owner", agent_id: agtDesign, type: "chat", trigger: "manual", title: "d1", status: "running", input: {} }).run();
    db.insert(runs).values({ id: r1, job_id: j1, agent_id: agtDesign, runner_id: runnerId, status: "running" }).run();

    const j2 = newId("job");
    const r2 = newId("run");
    db.insert(jobs).values({ id: j2, workspace_id: "owner", agent_id: agtOther, type: "chat", trigger: "manual", title: "d2", status: "running", input: {} }).run();
    db.insert(runs).values({ id: r2, job_id: j2, agent_id: agtOther, runner_id: runnerId, status: "running" }).run();

    const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");

    // 1) Agent with design_render uploads PNG -> 201
    const okPng = await fetch(`${srv.url}/api/runner/uploads/parts/designkey12345678?run_id=${r1}&name=quote.png&total=${pngBytes.length}&offset=0`, {
      method: "PUT",
      headers: { authorization: `Bearer ${runnerToken}`, "content-type": "image/png" },
      body: pngBytes,
    });
    expect(okPng.status).toBe(201);

    // 2) Agent with design_render ONLY cannot upload video/mp4 -> 403
    const deniedVid = await fetch(`${srv.url}/api/runner/uploads/parts/designvid12345678?run_id=${r1}&name=clip.mp4&total=10&offset=0`, {
      method: "PUT",
      headers: { authorization: `Bearer ${runnerToken}`, "content-type": "video/mp4" },
      body: new Uint8Array(10),
    });
    expect(deniedVid.status).toBe(403);

    // 3) Agent without design_render cannot upload PNG -> 403
    const deniedPng = await fetch(`${srv.url}/api/runner/uploads/parts/otherpng123456789?run_id=${r2}&name=quote.png&total=${pngBytes.length}&offset=0`, {
      method: "PUT",
      headers: { authorization: `Bearer ${runnerToken}`, "content-type": "image/png" },
      body: pngBytes,
    });
    expect(deniedPng.status).toBe(403);
  });

  test("swap-schedule swaps publish_at within same project/room and 404s across rooms", async () => {
    const { srv } = setup();
    const db = srv.hub.db;
    const p1 = newId("prj");
    const p2 = newId("prj");
    const agt = newId("agt");
    db.insert(projects).values({ id: p1, workspace_id: "owner", slug: "proj-a", name: "Proj A" }).run();
    db.insert(projects).values({ id: p2, workspace_id: "ws_other", slug: "proj-b", name: "Proj B" }).run();
    db.insert(agents).values({ id: agt, workspace_id: "owner", slug: "m1", name: "M", role: "M", system_prompt: "t", tools: ["save_draft"], provider: "mock", model: "mock" }).run();

    const t1 = new Date(Date.now() + 3600_000).toISOString();
    const t2 = new Date(Date.now() + 7200_000).toISOString();
    const d1 = newId("drf");
    const d2 = newId("drf");
    const dOther = newId("drf");

    db.insert(contentDrafts).values({ id: d1, workspace_id: "owner", project_id: p1, agent_id: agt, platform: "instagram", kind: "caption", title: "A", body: "A", original_body: "A", status: "approved", publish_at: t1 }).run();
    db.insert(contentDrafts).values({ id: d2, workspace_id: "owner", project_id: p1, agent_id: agt, platform: "instagram", kind: "caption", title: "B", body: "B", original_body: "B", status: "approved", publish_at: t2 }).run();
    db.insert(contentDrafts).values({ id: dOther, workspace_id: "ws_other", project_id: p2, agent_id: agt, platform: "instagram", kind: "caption", title: "C", body: "C", original_body: "C", status: "approved", publish_at: t2 }).run();

    const swapped = await fetch(`${srv.url}/api/drafts/swap-schedule`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ a: d1, b: d2 }),
    });
    expect(swapped.status).toBe(200);
    const body = (await swapped.json()) as { a: { publish_at: string }; b: { publish_at: string } };
    expect(body.a.publish_at).toBe(t2);
    expect(body.b.publish_at).toBe(t1);

    // Across rooms -> 404
    const crossRoom = await fetch(`${srv.url}/api/drafts/swap-schedule`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ a: d1, b: dOther }),
    });
    expect(crossRoom.status).toBe(404);
  });

  test("meta.images from another run is dropped while images rendered in the same run are kept in order", async () => {
    const { dir, srv } = setup();
    const db = srv.hub.db;
    const p1 = newId("prj");
    const agt = newId("agt");
    const runnerId = newId("runr");
    db.insert(projects).values({ id: p1, workspace_id: "owner", slug: "proj-img", name: "Proj Img" }).run();
    db.insert(agents).values({ id: agt, workspace_id: "owner", slug: "m2", name: "M2", role: "M2", system_prompt: "t", tools: ["save_draft", "design_render"], provider: "mock", model: "mock" }).run();
    db.insert(runners).values({ id: runnerId, name: "r2", token_hash: hashToken("tok-r2") }).run();

    const j1 = newId("job");
    const r1 = newId("run");
    const jOther = newId("job");
    const rOther = newId("run");
    db.insert(jobs).values({ id: j1, workspace_id: "owner", project_id: p1, agent_id: agt, type: "chat", trigger: "manual", title: "j1", status: "running", input: {} }).run();
    db.insert(runs).values({ id: r1, job_id: j1, agent_id: agt, runner_id: runnerId, status: "running" }).run();
    db.insert(jobs).values({ id: jOther, workspace_id: "owner", project_id: p1, agent_id: agt, type: "chat", trigger: "manual", title: "j2", status: "running", input: {} }).run();
    db.insert(runs).values({ id: rOther, job_id: jOther, agent_id: agt, runner_id: runnerId, status: "running" }).run();

    const img1 = newId("upl");
    const img2 = newId("upl");
    const imgForeign = newId("upl");
    db.insert(uploads).values({ id: img1, workspace_id: "owner", run_id: r1, name: "s1.png", content_type: "image/png", size: 10, path: join(dir, "files", "s1.png") }).run();
    db.insert(uploads).values({ id: img2, workspace_id: "owner", run_id: r1, name: "s2.png", content_type: "image/png", size: 10, path: join(dir, "files", "s2.png") }).run();
    db.insert(uploads).values({ id: imgForeign, workspace_id: "owner", run_id: rOther, name: "other.png", content_type: "image/png", size: 10, path: join(dir, "files", "other.png") }).run();

    // Deliver a run.draft message directly to hub.runnerMessage
    const sent: unknown[] = [];
    srv.hub.runnerMessage(
      { runnerId, send: (m: unknown) => sent.push(m) } as any,
      {
        type: "run.draft",
        run_id: r1,
        seq: 1,
        project_id: p1,
        platform: "instagram",
        kind: "caption",
        title: "Carousel",
        body: "Hello carousel",
        self_check: { facts_match_brief: true, only_released_features: true, no_overclaims: true, tone_and_language_match: true, notes: "" },
        meta: {
          post_type: "social",
          excerpt: "",
          tags: [],
          event_date: "",
          event_time: "",
          location: "",
          video_url: "",
          cover_upload_id: imgForeign,
          video_upload_id: null,
          social_account: null,
          images: [img1, imgForeign, img2],
        },
      },
    );
    expect(sent.length).toBe(1);
    const list = srv.hub.content.listDrafts({ project_id: p1 });
    expect(list.length).toBe(1);
    expect(list[0]!.meta?.images).toEqual([img1, img2]);
    expect(list[0]!.meta?.cover_upload_id).toBeNull();
  });
});
