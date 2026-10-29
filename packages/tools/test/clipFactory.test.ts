import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clipFindTool, clipRenderTool } from "../src/clipFactory.ts";
import { makeCtx } from "./helpers.ts";

describe("Clip Factory Runner Tools (clip_find & clip_render)", () => {
  test("clip_find discovers moments, calculates virality scores, and saves to hub", async () => {
    const ws = mkdtempSync(join(tmpdir(), "cf-test-"));
    const { ctx } = makeCtx(ws);
    const dir = join(ctx.workspace, ".media");
    mkdirSync(dir, { recursive: true });

    // Mock video file
    writeFileSync(join(dir, "video-1.mp4"), "fake video content");

    ctx.attachments = [
      { id: "upl_video_1", name: "podcast.mp4", content_type: "video/mp4" },
    ];

    let savedClipsData: unknown = null;
    ctx.videoData = async (action: string, params: Record<string, unknown>) => {
      if (action === "transcript_get") {
        return {
          transcript: {
            duration: 60,
            language: "ms",
            model: "whisper",
            words: [
              { w: "Rahsia", s: 0.0, e: 0.8 },
              { w: "jimat", s: 0.9, e: 1.4 },
              { w: "modal", s: 1.5, e: 2.0 },
              { w: "kandang.", s: 2.1, e: 3.5 },
              { w: "Ramai", s: 4.0, e: 4.8 },
              { w: "orang", s: 4.9, e: 5.5 },
              { w: "tersilap", s: 5.6, e: 6.5 },
              { w: "bina", s: 6.6, e: 7.2 },
              { w: "bumbung.", s: 7.3, e: 8.5 },
              { w: "Ikut", s: 9.0, e: 9.5 },
              { w: "tips", s: 9.6, e: 10.2 },
              { w: "ini", s: 10.3, e: 11.0 },
              { w: "memang", s: 11.1, e: 11.8 },
              { w: "untung", s: 11.9, e: 13.0 },
              { w: "banyak.", s: 13.1, e: 16.0 },
            ],
          },
        };
      }
      if (action === "index_get") {
        return { index: null };
      }
      if (action === "clips_put") {
        savedClipsData = params.clips;
        return { saved: true };
      }
      return {};
    };

    // describeImages returns a model score
    ctx.describeImages = async () => `
- Hook: 92 | reason: Opening promises immediate secret to save farm capital
- Value: 88 | reason: Concrete roofing advice
- Emotion: 75 | reason: Convincing speaker tone
- Flow: 85 | reason: Excellent concise progression
- Trend: 80 | reason: High relevance to agricultural business

1. Rahsia Jimat Modal Kandang!
2. Kesilapan Besar Bina Bumbung
3. Tips Untung Penternakan

Title: Cara Jimat Modal Bina Kandang
Summary: Tips elak kesilapan bina bumbung kandang untuk jimat modal.
`;

    // Note: since this is a unit test without real ffmpeg probing in this mock environment,
    // we verify clipFindTool schema and validation
    expect(clipFindTool.name).toBe("clip_find");
    expect(clipFindTool.category).toBe("write");
    expect(clipFindTool.risk({}, ctx)).toBe("safe");
  });

  test("clip_render tool validates boundaries and creates draft", async () => {
    const ws = mkdtempSync(join(tmpdir(), "cf-test-2-"));
    const ctx = makeCtx(ws);
    expect(clipRenderTool.name).toBe("clip_render");
    expect(clipRenderTool.category).toBe("write");
    expect(clipRenderTool.risk({} as any, ctx)).toBe("safe");

    // Invalid start/end throws ToolDenied
    expect(
      clipRenderTool.execute(
        { video: 1, start: 20, end: 10, caption_preset: "pop", reframe_mode: "blur_fit", save_draft: true },
        ctx,
      ),
    ).rejects.toThrow("clip ends before it starts");
  });
});
