import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { montagePlanTool, musicBeatsTool } from "../src/beats.ts";
import { makeCtx } from "./helpers.ts";

describe("Task 032 Step 2: music_beats tool", () => {
  test("decodes 120 BPM click track with ffmpeg, caches in .myofis-clips.json, and rejects missing/traversal track", async () => {
    const ws = mkdtempSync(join(tmpdir(), "mb-ws-"));
    const clipDir = mkdtempSync(join(tmpdir(), "mb-clips-"));
    try {
      mkdirSync(join(clipDir, "music"), { recursive: true });
      const trackPath = join(clipDir, "music", "click120.mp3");

      // Generate an 8s 120 BPM click track using ffmpeg aevalsrc
      const gen = Bun.spawn({
        cmd: [
          "ffmpeg", "-y",
          "-f", "lavfi",
          "-i", "aevalsrc='if(lt(mod(t,0.5),0.025),sin(2*PI*1000*t)*exp(-mod(t,0.5)/0.005),0)':s=22050:d=8",
          "-c:a", "libmp3lame", "-b:a", "128k",
          trackPath,
        ],
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(await gen.exited).toBe(0);

      const { ctx } = makeCtx(ws);
      ctx.config.clip_folder = clipDir;

      // Rejects traversal / missing track
      await expect(musicBeatsTool.execute({ track: "../secret.mp3" }, ctx)).rejects.toThrow("invalid track name");
      await expect(musicBeatsTool.execute({ track: "nope.mp3" }, ctx)).rejects.toThrow("no music track");

      // First run: decodes & caches
      const r1 = await musicBeatsTool.execute({ track: "click120.mp3" }, ctx);
      expect(r1.ok).toBe(true);
      const out1 = r1.output as any;
      expect(Math.abs(out1.bpm - 120)).toBeLessThanOrEqual(1.5);
      expect(out1.beat_count).toBeGreaterThanOrEqual(12);
      expect(out1.beats.length).toBeLessThanOrEqual(64);
      expect(out1.bars.length).toBeGreaterThanOrEqual(3);
      expect(out1.duration).toBeGreaterThan(7.5);
      expect(out1.cached).toBe(false);

      // Second run: hits cache
      const r2 = await musicBeatsTool.execute({ track: "click120.mp3" }, ctx);
      const out2 = r2.output as any;
      expect(out2.cached).toBe(true);
      expect(out2.bpm).toBe(out1.bpm);

      // Step 4: montage_plan builds an EditPlan without rendering
      for (let n = 1; n <= 3; n++) {
        const mp4 = join(ws, "media", `in-${n}.mp4`);
        const vgen = Bun.spawn({
          cmd: ["ffmpeg", "-y", "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=30:duration=4`, "-c:v", "libx264", "-preset", "ultrafast", mp4],
          stdout: "ignore",
          stderr: "ignore",
        });
        expect(await vgen.exited).toBe(0);
      }
      ctx.attachments = [
        { id: "v1", name: "c1.mp4", content_type: "video/mp4" },
        { id: "v2", name: "c2.mp4", content_type: "video/mp4" },
        { id: "v3", name: "c3.mp4", content_type: "video/mp4" },
      ];
      const mp = await montagePlanTool.execute(
        {
          track: "click120.mp3",
          target_seconds: 6,
          cut_every: 1,
          hook: "Tengok hasil ikut beat ini!",
          lines: ["Klip bertukar tepat pada setiap detik", "Setiap bar ada mesej yang jelas"],
          loop: true,
          volume_db: -6,
          preset: "tiktok_fhd",
          name: "test-montage",
        },
        ctx,
      );
      expect(mp.ok).toBe(true);
      const mpOut = mp.output as any;
      expect(mpOut.edit_plan.clips.length).toBeGreaterThanOrEqual(8);
      expect(mpOut.edit_plan.music).toEqual({ track: "click120.mp3", volume_db: -6 });
      expect(mpOut.edit_plan.transition.type).toBe("none");
    } finally {
      rmSync(ws, { recursive: true, force: true });
      rmSync(clipDir, { recursive: true, force: true });
    }
  }, 30_000);
});
