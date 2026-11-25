import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { agents, jobs, runs, runners, settings, uploads } from "../src/db/schema.ts";
import { hashToken, Secrets } from "../src/crypto.ts";
import { seed } from "../src/seed.ts";
import { startHub, type HubServer } from "../src/server.ts";
import { TOKEN, testConfig } from "./helpers.ts";

const newId = (p: string) => `${p}_${crypto.randomUUID().slice(0, 8)}`;

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe("Task 032 Step 6: Studio video-data beats action & GET /api/videos/:id", () => {
  test("video-data action 'beats' is gated by music_beats/montage_plan and exposed on Studio video info", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-beats-"));
    const srv: HubServer = startHub(testConfig(dir), { sweepMs: 60_000, backupCheckMs: 600_000, tokenCheckMs: 0 });
    cleanups.push(async () => {
      await srv.stop();
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    });

    const db = srv.hub.db;
    const runnerToken = "runner-beats-token-123456";
    const runnerId = newId("runr");
    db.insert(runners).values({ id: runnerId, name: "r1", token_hash: hashToken(runnerToken), status: "online", capabilities: {} }).run();

    const agtNo = newId("agt");
    const agtYes = newId("agt");
    db.insert(agents).values({
      id: agtNo, workspace_id: "owner", slug: "no-beats", name: "NoBeats", role: "test",
      system_prompt: "test", tools: ["video_probe"], provider: "mock", model: "mock",
    }).run();
    db.insert(agents).values({
      id: agtYes, workspace_id: "owner", slug: "yes-beats", name: "YesBeats", role: "test",
      system_prompt: "test", tools: ["music_beats", "montage_plan"], provider: "mock", model: "mock",
    }).run();

    const job1 = newId("job");
    const run1 = newId("run");
    db.insert(jobs).values({ id: job1, workspace_id: "owner", agent_id: agtNo, type: "chat", trigger: "manual", title: "j1", status: "running", input: {} }).run();
    db.insert(runs).values({ id: run1, job_id: job1, agent_id: agtNo, runner_id: runnerId, status: "running" }).run();

    // 1) Agent without music_beats/montage_plan gets 403
    const denied = await fetch(`${srv.url}/api/runner/video-data`, {
      method: "POST",
      headers: { authorization: `Bearer ${runnerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: run1, action: "beats", params: { track: "upbeat.mp3" } }),
    });
    expect(denied.status).toBe(403);

    // 2) Agent with music_beats saves beats
    const job2 = newId("job");
    const run2 = newId("run");
    db.insert(jobs).values({ id: job2, workspace_id: "owner", agent_id: agtYes, type: "chat", trigger: "manual", title: "j2", status: "running", input: {} }).run();
    db.insert(runs).values({ id: run2, job_id: job2, agent_id: agtYes, runner_id: runnerId, status: "running" }).run();

    const beatPayload = { bpm: 120, beats: [0.5, 1.0, 1.5, 2.0], bars: [0.5, 2.5], confidence: 0.9 };
    const saved = await fetch(`${srv.url}/api/runner/video-data`, {
      method: "POST",
      headers: { authorization: `Bearer ${runnerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: run2, action: "beats", params: { track: "upbeat.mp3", size: 102400, mtime_ms: 1700000000000, beats: beatPayload } }),
    });
    expect(saved.status).toBe(200);

    // 3) Read back via video-data: matching size+mtime hits; mismatched size or mtime returns null (Fix 7)
    const readBack = await fetch(`${srv.url}/api/runner/video-data`, {
      method: "POST",
      headers: { authorization: `Bearer ${runnerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: run2, action: "beats", params: { track: "upbeat.mp3", size: 102400, mtime_ms: 1700000000000 } }),
    });
    expect(readBack.status).toBe(200);
    expect(((await readBack.json()) as any).data.beats).toEqual(beatPayload);

    const readMismatch = await fetch(`${srv.url}/api/runner/video-data`, {
      method: "POST",
      headers: { authorization: `Bearer ${runnerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ run_id: run2, action: "beats", params: { track: "upbeat.mp3", size: 999999, mtime_ms: 1700000000000 } }),
    });
    expect(readMismatch.status).toBe(200);
    expect(((await readMismatch.json()) as any).data.beats).toBeNull();

    // 4) Studio video info includes music_beats when plan has music.track
    const upId = newId("upl");
    db.insert(uploads).values({
      id: upId, workspace_id: "owner", name: "montage.mp4", content_type: "video/mp4", size: 123,
      path: join(dir, "files", "montage.mp4"),
      render: {
        plan: { clips: [{ video: 1, start: 0, speed: 1, fit: "crop", zoom: "none" }], preset: "tiktok_fhd", fit: "crop", fps: 30, captions: [], subtitles: null, overlays: [], transition: { type: "none", seconds: 0.5 }, mute: true, music: { track: "upbeat.mp3", volume_db: -6 }, normalize_audio: true, name: "montage" },
        attachments: [],
      } as any,
    }).run();

    const studioRes = await fetch(`${srv.url}/api/videos/${upId}`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(studioRes.status).toBe(200);
    const studioJson = (await studioRes.json()) as any;
    expect(studioJson.music_beats).toEqual(beatPayload);
  });

  test("Fix 4: BuiltinAgent.upgrade.skills adds beat-montage-bm once to an existing Misi 1K agent seeded with the old skill list", async () => {
    const dir = mkdtempSync(join(tmpdir(), "seed-skill-upgrade-"));
    const cfg = testConfig(dir);
    const srv: HubServer = startHub(cfg, { sweepMs: 60_000, backupCheckMs: 600_000, tokenCheckMs: 0 });
    cleanups.push(async () => {
      await srv.stop();
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    });

    const db = srv.hub.db;
    // Simulate an older DB where tiktok was seeded before beat-montage-bm existed
    const tt = db.select().from(agents).where(eq(agents.slug, "tiktok")).get()!;
    db.update(agents)
      .set({ config: { ...tt.config, skills: ["tiktok-captions-bm", "short-video-editing", "motion-text-tiktok"] } })
      .where(eq(agents.id, tt.id))
      .run();
    db.delete(settings).where(eq(settings.key, "seeded.skill.tiktok.beat-montage-bm")).run();

    const secrets = new Secrets(cfg.secretsKey);
    seed(db, cfg, secrets);

    const upgraded = db.select().from(agents).where(eq(agents.slug, "tiktok")).get()!;
    const skillsAfter = Array.isArray(upgraded.config.skills) ? upgraded.config.skills : [];
    expect(skillsAfter).toContain("beat-montage-bm");

    // If the owner later removes beat-montage-bm, re-running seed() must NOT add it back
    db.update(agents)
      .set({ config: { ...upgraded.config, skills: skillsAfter.filter((s) => s !== "beat-montage-bm") } })
      .where(eq(agents.id, tt.id))
      .run();
    seed(db, cfg, secrets);
    const afterOwnerRemoval = db.select().from(agents).where(eq(agents.slug, "tiktok")).get()!;
    expect((afterOwnerRemoval.config as { skills?: string[] }).skills).not.toContain("beat-montage-bm");
  });
});
