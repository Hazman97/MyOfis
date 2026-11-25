import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agents, jobs, runners, runs } from "../src/db/schema.ts";
import { hashToken } from "../src/crypto.ts";
import { MEMBER_TOOLS } from "../src/scope.ts";
import { startHub, type HubServer } from "../src/server.ts";
import { TOKEN, testConfig } from "./helpers.ts";

const newId = (p: string) => `${p}_${crypto.randomUUID().slice(0, 8)}`;

describe("Task 041 Step 3: Hub image_gen pause switch, max_per_day, member exclusion & PNG parts gate", () => {
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()!();
    }
  });

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "hub-comfy-041-"));
    const srv: HubServer = startHub(testConfig(dir));
    cleanups.push(async () => {
      await srv.stop();
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {}
    });
    return { dir, srv };
  }

  test("image_generate is excluded from MEMBER_TOOLS", () => {
    expect(MEMBER_TOOLS.has("image_generate")).toBe(false);
    expect(MEMBER_TOOLS.has("design_render")).toBe(true);
  });

  test("paused switch returns BM error, max_per_day caps daily usage, and parts route allows PNG for image_generate", async () => {
    const { srv } = setup();
    const db = srv.hub.db;
    const runnerId = newId("runr");
    const runnerToken = "runner-comfy-tok";
    db.insert(runners).values({ id: runnerId, name: "r1", token_hash: hashToken(runnerToken) }).run();

    const agtImg = newId("agt");
    db.insert(agents).values({ id: agtImg, workspace_id: "owner", slug: "img-1", name: "Img", role: "Img", system_prompt: "t", tools: ["image_generate"], provider: "mock", model: "mock" }).run();
    const j1 = newId("job");
    const r1 = newId("run");
    db.insert(jobs).values({ id: j1, workspace_id: "owner", agent_id: agtImg, type: "chat", trigger: "manual", title: "img", status: "running", input: {} }).run();
    db.insert(runs).values({ id: r1, job_id: j1, agent_id: agtImg, runner_id: runnerId, status: "running" }).run();

    // 1) Pause switch on -> image_gen_check returns ok:false with BM message
    const pauseRes = await fetch(`${srv.url}/api/settings/integrations/image-gen`, {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ paused: true, max_per_day: 2 }),
    });
    expect(pauseRes.status).toBe(200);

    const checkPaused = await fetch(`${srv.url}/api/runner/video-data`, {
      method: "POST",
      headers: { authorization: `Bearer ${runnerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: r1, action: "image_gen_check", params: { count: 1 } }),
    });
    expect(checkPaused.status).toBe(200);
    expect(((await checkPaused.json()) as any).data).toEqual({ ok: false, error: "Gambar AI dijeda oleh pemilik" });

    // 2) Unpause -> consume 2 succeeds, 3rd refused by max_per_day
    await fetch(`${srv.url}/api/settings/integrations/image-gen`, {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ paused: false, max_per_day: 2 }),
    });
    const ok2 = await fetch(`${srv.url}/api/runner/video-data`, {
      method: "POST",
      headers: { authorization: `Bearer ${runnerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: r1, action: "image_gen_check", params: { count: 2 } }),
    });
    expect(((await ok2.json()) as any).data).toEqual({ ok: true, used: 2, max_per_day: 2 });

    const overCap = await fetch(`${srv.url}/api/runner/video-data`, {
      method: "POST",
      headers: { authorization: `Bearer ${runnerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: r1, action: "image_gen_check", params: { count: 1 } }),
    });
    expect(((await overCap.json()) as any).data.ok).toBe(false);

    // 3) Parts route allows PNG for image_generate
    const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
    const upPng = await fetch(`${srv.url}/api/runner/uploads/parts/comfykey123456789?run_id=${r1}&name=ai.png&total=${pngBytes.length}&offset=0`, {
      method: "PUT",
      headers: { authorization: `Bearer ${runnerToken}`, "content-type": "image/png" },
      body: pngBytes,
    });
    expect(upPng.status).toBe(201);
  });
});
