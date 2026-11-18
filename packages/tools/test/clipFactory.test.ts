import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clipFindTool, clipRenderTool, clipScoreTool } from "../src/clipFactory.ts";
import { makeCtx } from "./helpers.ts";

describe("Clip Factory Runner Tools (clip_find, clip_score & clip_render)", () => {
  test("clip_find discovers unscored windows from transcript + shot index, and clip_score validates & scores them", async () => {
    const ws = mkdtempSync(join(tmpdir(), "cf-test-"));
    const { ctx } = makeCtx(ws);
    const media = join(ws, "media");
    mkdirSync(media, { recursive: true });

    // Create a real 20s MP4 in media/in-1.mp4 for ffprobe + ebur128
    const gen = Bun.spawn({
      cmd: [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=15:duration=20",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=20",
        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
        join(media, "in-1.mp4"),
      ],
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await gen.exited).toBe(0);

    ctx.attachments = [{ id: "upl_video_1", name: "podcast.mp4", content_type: "video/mp4" }];

    let savedClipsData: any[] = [];
    ctx.videoData = async (action: string, params: Record<string, unknown>) => {
      if (action === "transcript_get") {
        return {
          transcript: {
            duration: 20,
            language: "ms",
            model: "whisper",
            words: [
              { w: "Rahsia", s: 0.0, e: 0.8 },
              { w: "jimat", s: 0.9, e: 1.4 },
              { w: "modal", s: 1.5, e: 2.0 },
              { w: "kandang.", s: 2.1, e: 4.5 },
              { w: "Ramai", s: 4.6, e: 5.5 },
              { w: "orang", s: 5.6, e: 6.5 },
              { w: "tersilap", s: 6.6, e: 7.5 },
              { w: "bina", s: 7.6, e: 8.5 },
              { w: "bumbung.", s: 8.6, e: 10.5 },
              { w: "Ikut", s: 10.6, e: 11.5 },
              { w: "tips", s: 11.6, e: 12.5 },
              { w: "ini", s: 12.6, e: 13.5 },
              { w: "memang", s: 13.6, e: 14.5 },
              { w: "untung", s: 14.6, e: 16.0 },
              { w: "banyak.", s: 16.1, e: 19.5 },
            ],
          },
        };
      }
      if (action === "index_get") {
        return {
          index: {
            duration: 20,
            width: 640,
            height: 360,
            shots: [
              { index: 1, start: 0, end: 10.3, dark: false, blurry: false, text_on_screen: false, faces: true, letterboxed: false, description: "Speaker intro" },
              { index: 2, start: 10.3, end: 20.0, dark: false, blurry: false, text_on_screen: false, faces: true, letterboxed: false, description: "Tips section" },
            ],
          },
        };
      }
      if (action === "clips_put") {
        savedClipsData = params.clips as any[];
        return { saved: true };
      }
      if (action === "clips_get") {
        return { clips: savedClipsData };
      }
      return {};
    };

    expect(clipFindTool.name).toBe("clip_find");
    expect(clipScoreTool.name).toBe("clip_score");

    // 1) Execute clip_find -> produces unscored windows (no numeric fallback)
    const found = await clipFindTool.execute({ video: 1, min_duration: 15, max_duration: 20, max_clips: 4 }, ctx);
    expect(found.ok).toBe(true);
    const out = found.output as any;
    expect(out.scoring_prompt).toContain("CLIP_SCORE_PROMPT_V1");
    expect(out.shot_cuts).toEqual([10.3, 20]);
    expect(out.windows.length).toBeGreaterThan(0);
    expect(savedClipsData.length).toBe(out.windows.length);
    expect(savedClipsData[0]!.score).toBeNull();
    expect(savedClipsData[0]!.unscored).toBe(true);

    // 2) clip_score rejects invalid/empty input via Zod
    await expect(
      clipScoreTool.execute({ video: 1, id: out.windows[0].id } as any, ctx),
    ).rejects.toThrow();

    // 3) Execute clip_score -> computes weighted score and persists scored clip
    const winId = out.windows[0].id;
    const scored = await clipScoreTool.execute(
      {
        video: 1,
        clips: [
          {
            id: winId,
            subscores: { hook: 90, value: 80, emotion: 70, flow: 85, trend: 75 },
            reasons: {
              hook: "Opens with a concrete cost-saving promise.",
              value: "Explains roofing mistakes clearly.",
              emotion: "Confident practical tone.",
              flow: "Smooth progression from mistake to solution.",
              trend: "Strong fit for SME farming audience.",
            },
            hooks: ["Elak Rugi Bina Bumbung!", "Rahsia Jimat Modal Kandang"],
            headline: "Cara Jimat Modal Bina Kandang",
            summary_reason: "Practical cost-saving tip for livestock farmers.",
          },
        ],
      },
      ctx,
    );
    expect(scored.ok).toBe(true);
    const scoredClip = savedClipsData.find((c) => c.id === winId);
    expect(scoredClip.score).toBe(81); // 90*0.3 + 80*0.25 + 70*0.2 + 85*0.15 + 75*0.1 = 81.25 -> 81
    expect(scoredClip.unscored).toBe(false);
    expect(scoredClip.chosen_hook).toBe("Elak Rugi Bina Bumbung!");
  }, 45000);

  test("clip_render tool validates boundaries, project/caption/self_check, and hub refusal", async () => {
    const ws = mkdtempSync(join(tmpdir(), "cf-test-2-"));
    const { ctx, drafts } = makeCtx(ws);
    expect(clipRenderTool.name).toBe("clip_render");
    expect(clipRenderTool.category).toBe("write");
    expect(clipRenderTool.risk({ video: 1, start: 0, end: 15, caption_preset: "pop", reframe_mode: "blur_fit", save_draft: true }, ctx)).toBe("safe");

    // Invalid start/end throws ToolDenied
    await expect(
      clipRenderTool.execute(
        { video: 1, start: 20, end: 10, caption_preset: "pop", reframe_mode: "blur_fit", save_draft: true },
        ctx,
      ),
    ).rejects.toThrow("clip ends before it starts");

    // Missing project throws ToolDenied when save_draft is true
    await expect(
      clipRenderTool.execute(
        { video: 1, start: 0, end: 2, caption_preset: "pop", reframe_mode: "blur_fit", save_draft: true },
        ctx,
      ),
    ).rejects.toThrow("no project context");

    // Generate a real 3s test video at media/in-1.mp4 so videoEditTool + uploadVideo execute
    const media = join(ws, "media");
    mkdirSync(media, { recursive: true });
    const srcMp4 = join(media, "in-1.mp4");
    const gen = Bun.spawn({
      cmd: [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=3",
        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
        srcMp4,
      ],
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await gen.exited).toBe(0);

    ctx.attachments = [{ id: "upl_src", name: "src-clip.mp4", content_type: "video/mp4" }];
    ctx.uploadVideo = async (_path, _name) => ({ id: "upl_rendered", size: 1024 });
    ctx.projectId = "prj_1";
    ctx.projectContext = {
      projects: [{ id: "prj_1", slug: "demo", name: "Demo", brief: null, past_drafts: [] }],
      active_project_id: "prj_1",
    } as any;

    const validSelfCheck = {
      facts_match_brief: true,
      only_released_features: true,
      no_overclaims: true,
      tone_and_language_match: true,
      notes: "Disahkan mengikut brief.",
    };

    // 1) Hub refuses draft -> clip_render returns ok: false, draft_saved: false
    ctx.saveDraft = async () => ({ ok: false, error: "unknown project" });
    const refused = await clipRenderTool.execute(
      {
        video: 1,
        start: 0,
        end: 2,
        headline: "Klip Ujian",
        caption: "Kapsyen penuh dari agent #teknologi",
        self_check: validSelfCheck,
        caption_preset: "pop",
        reframe_mode: "blur_fit",
        save_draft: true,
      },
      ctx,
    );
    expect(refused.ok).toBe(false);
    expect((refused.output as any).draft_saved).toBe(false);
    expect((refused.output as any).error).toBe("unknown project");

    // 2) Hub accepts draft -> clip_render returns ok: true, draft_saved: true
    ctx.saveDraft = (d) => {
      drafts.push(d);
      return { ok: true };
    };
    const accepted = await clipRenderTool.execute(
      {
        video: 1,
        start: 0,
        end: 2,
        hook: "Rahsia Jimat Modal!",
        headline: "Klip Ujian",
        caption: "Kapsyen penuh dari agent #teknologi",
        self_check: validSelfCheck,
        caption_preset: "pop",
        reframe_mode: "blur_fit",
        save_draft: true,
      },
      ctx,
    );
    expect(accepted.ok).toBe(true);
    expect((accepted.output as any).hook_on_screen).toBe(true);
    expect((accepted.output as any).draft_saved).toBe(true);
    expect(drafts.length).toBe(1);
    expect(drafts[0]!.project_id).toBe("prj_1");
    expect(drafts[0]!.body).toBe("Kapsyen penuh dari agent #teknologi");
  }, 45000);
});
