import { describe, expect, test } from "bun:test";
import {
  HD_TARGETS,
  PLACEMENT_TARGET,
  SOCIAL_PLACEMENTS,
  hdOutputsFor,
  hdPlan,
  storyParts,
  type TikTokHdFacts,
} from "../src/video.ts";

describe("Task 039 Step 1 & 2: SocialPlacement, hdOutputsFor, hdPlan, storyParts", () => {
  test("hdOutputsFor merges platforms sharing the same file and preserves order", () => {
    const out = hdOutputsFor(["tiktok", "ig_reels", "yt_shorts", "ig_story"]);
    expect(out).toEqual([
      { target: "vertical", covers: ["tiktok", "ig_reels", "yt_shorts"] },
      { target: "story", covers: ["ig_story"] },
    ]);

    // Duplicates are dropped
    expect(hdOutputsFor(["tiktok", "tiktok", "fb_reels", "threads"])).toEqual([
      { target: "vertical", covers: ["tiktok", "fb_reels", "threads"] },
    ]);

    // All placements merge into 5 distinct files
    const all = hdOutputsFor(SOCIAL_PLACEMENTS.map((p) => p.id));
    expect(all.map((g) => g.target)).toEqual(["vertical", "story", "feed_4x5", "whatsapp", "whatsapp_status"]);
    expect(all[0]!.covers).toEqual(["tiktok", "ig_reels", "fb_reels", "yt_shorts", "threads"]);
    expect(all[1]!.covers).toEqual(["ig_story", "fb_story"]);
    expect(all[2]!.covers).toEqual(["ig_feed", "fb_feed"]);
    expect(PLACEMENT_TARGET.ig_feed).toBe("feed_4x5");
  });

  test("storyParts splits > 60s clips and uses cut points within 5s before the limit", () => {
    expect(storyParts(59)).toEqual([{ start: 0, end: 59 }]);
    expect(storyParts(60)).toEqual([{ start: 0, end: 60 }]);
    expect(storyParts(61)).toEqual([
      { start: 0, end: 60 },
      { start: 60, end: 61 },
    ]);
    // Cut point at 57s is within [55, 60]
    expect(storyParts(75, [20, 57, 70])).toEqual([
      { start: 0, end: 57 },
      { start: 57, end: 75 },
    ]);
    // Cut point at 50s is outside the 5s window → cuts at 60s
    expect(storyParts(75, [50])).toEqual([
      { start: 0, end: 60 },
      { start: 60, end: 75 },
    ]);
    // 130s clip → 3 parts
    expect(storyParts(130)).toEqual([
      { start: 0, end: 60 },
      { start: 60, end: 120 },
      { start: 120, end: 130 },
    ]);
  });

  test("hdPlan handles vertical, story, feed_4x5, and square", () => {
    const baseVertical: TikTokHdFacts = {
      width: 1080,
      height: 1920,
      fps: 30,
      duration: 30,
      video_codec: "h264",
      audio_codec: "aac",
      pix_fmt: "yuv420p",
      size_bytes: 10 * 1024 ** 2,
      mbps: 10,
    };

    expect(hdPlan(baseVertical, "vertical").mode).toBe("remux");
    expect(hdPlan(baseVertical, "story").mode).toBe("remux");

    // Story > 25 Mbps re-encodes
    const highBitrateStory = hdPlan({ ...baseVertical, mbps: 28 }, "story");
    expect(highBitrateStory.mode).toBe("reencode");
    expect(highBitrateStory.reasons.some((r) => r.includes("25 Mbit/s"))).toBe(true);

    // Story > 60 s warns (never throws)
    const longStory = hdPlan({ ...baseVertical, duration: 130 }, "story");
    expect(longStory.warnings.length).toBe(1);
    expect(longStory.warnings[0]).toContain("3");

    // feed_4x5: 1080x1350 remuxes; close to 4:5 crops; 16:9 blurs
    expect(hdPlan({ ...baseVertical, width: 1080, height: 1350 }, "feed_4x5").mode).toBe("remux");
    const near4x5 = hdPlan({ ...baseVertical, width: 800, height: 1000 }, "feed_4x5");
    expect(near4x5.mode).toBe("reencode");
    expect(near4x5.fit).toBe("crop");
    const wide4x5 = hdPlan({ ...baseVertical, width: 1920, height: 1080 }, "feed_4x5");
    expect(wide4x5.mode).toBe("reencode");
    expect(wide4x5.fit).toBe("blur");

    // square: 1080x1080 remuxes; 16:9 blurs; 720x720 crops
    expect(hdPlan({ ...baseVertical, width: 1080, height: 1080 }, "square").mode).toBe("remux");
    expect(hdPlan({ ...baseVertical, width: 720, height: 720 }, "square").fit).toBe("crop");
    expect(hdPlan({ ...baseVertical, width: 1920, height: 1080 }, "square").fit).toBe("blur");

    expect(HD_TARGETS.story.max_mbps).toBe(25);
    expect(HD_TARGETS.feed_4x5.width).toBe(1080);
    expect(HD_TARGETS.feed_4x5.height).toBe(1350);
  });
});
