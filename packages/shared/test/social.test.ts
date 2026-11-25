import { describe, expect, test } from "bun:test";
import {
  CAPTION_MAX_CHARS,
  buildZernioPostBody,
  defaultPlacementFor,
  groupDraftSets,
  placementCheck,
} from "../src/social.ts";

describe("Task 042 Step 1: placementCheck, set grouping & Zernio payload builder", () => {
  test("placementCheck validates every placement and caption length rule", () => {
    // IG Story: exactly 1 image OR 1 video <= 60s
    expect(placementCheck({ platform: "instagram", body: "Story!", meta: { placement: "ig_story", cover_upload_id: "img1" } })).toEqual([]);
    expect(placementCheck({ platform: "instagram", body: "Story vid", meta: { placement: "ig_story", video_upload_id: "vid1", video_duration_s: 45 } })).toEqual([]);
    expect(placementCheck({ platform: "instagram", body: "Empty story", meta: { placement: "ig_story" } }).length).toBeGreaterThan(0);
    expect(placementCheck({ platform: "instagram", body: "Two imgs", meta: { placement: "ig_story", images: ["a", "b"] } }).length).toBeGreaterThan(0);
    expect(placementCheck({ platform: "instagram", body: "Long story", meta: { placement: "ig_story", video_upload_id: "vid1", video_duration_s: 75 } })[0]).toContain("60");

    // FB Story
    expect(placementCheck({ platform: "facebook", body: "FB story", meta: { placement: "fb_story", cover_upload_id: "img1" } })).toEqual([]);
    expect(placementCheck({ platform: "facebook", body: "FB story long", meta: { placement: "fb_story", video_upload_id: "v1", video_duration_s: 61 } })[0]).toContain("60");

    // IG Reels & FB Reels: vertical video
    expect(placementCheck({ platform: "instagram", body: "Reel", meta: { placement: "ig_reels", video_upload_id: "v1", video_aspect: "vertical" } })).toEqual([]);
    expect(placementCheck({ platform: "instagram", body: "Reel no vid", meta: { placement: "ig_reels" } }).length).toBeGreaterThan(0);
    expect(placementCheck({ platform: "instagram", body: "Reel landscape", meta: { placement: "ig_reels", video_upload_id: "v1", video_aspect: "landscape" } })[0]).toContain("menegak");
    expect(placementCheck({ platform: "facebook", body: "FB reel", meta: { placement: "fb_reels", video_upload_id: "v1", video_aspect: "vertical" } })).toEqual([]);

    // IG Carousel: 2-10 images
    expect(placementCheck({ platform: "instagram", body: "Caro", meta: { placement: "ig_carousel", images: ["a", "b", "c"] } })).toEqual([]);
    expect(placementCheck({ platform: "instagram", body: "Caro 1", meta: { placement: "ig_carousel", images: ["a"] } })[0]).toContain("2–10");
    expect(placementCheck({ platform: "instagram", body: "Caro 11", meta: { placement: "ig_carousel", images: Array.from({ length: 11 }, (_, i) => `i${i}`) } })[0]).toContain("2–10");

    // YouTube Shorts: title + vertical video
    expect(placementCheck({ platform: "youtube", title: "Tip kamera 30 saat", body: "Desc", meta: { placement: "yt_shorts", video_upload_id: "v1", video_aspect: "vertical", video_duration_s: 30 } })).toEqual([]);
    expect(placementCheck({ platform: "youtube", title: "", body: "Desc", meta: { placement: "yt_shorts", video_upload_id: "v1" } })[0]).toContain("tajuk");
    expect(placementCheck({ platform: "youtube", title: "Short", body: "Desc", meta: { placement: "yt_shorts" } })[0]).toContain("video");

    // Threads: <= 500 chars, text or image ok
    expect(placementCheck({ platform: "threads", body: "Santai je hari ni.", meta: { placement: "threads" } })).toEqual([]);
    expect(placementCheck({ platform: "threads", body: "x".repeat(CAPTION_MAX_CHARS.threads + 1), meta: { placement: "threads" } })[0]).toContain("500");

    // TikTok caption > 2200 chars
    expect(placementCheck({ platform: "tiktok", body: "x".repeat(CAPTION_MAX_CHARS.tiktok + 1), meta: { placement: "tiktok", video_upload_id: "v1" } })[0]).toContain("2200");

    // Platform/placement mismatch
    expect(placementCheck({ platform: "facebook", body: "Hi", meta: { placement: "ig_story", cover_upload_id: "i1" } })[0]).toContain("tidak sepadan");
  });

  test("groupDraftSets groups drafts by set_id in stable order and leaves standalones separate", () => {
    const items = [
      { id: "d1", meta: { set_id: "set_a" } },
      { id: "d2", meta: { set_id: null } },
      { id: "d3", meta: { set_id: "set_a" } },
      { id: "d4", meta: { set_id: "set_b" } },
      { id: "d5", meta: { set_id: "set_a" } },
    ];
    const groups = groupDraftSets(items);
    expect(groups).toEqual([
      { set_id: "set_a", drafts: [items[0]!, items[2]!, items[4]!] },
      { set_id: null, drafts: [items[1]!] },
      { set_id: null, drafts: [items[3]!] },
    ]);
    const keepSingle = groupDraftSets(items, { keepSingletonSets: true });
    expect(keepSingle[2]!.set_id).toBe("set_b");
  });

  test("buildZernioPostBody emits verified Zernio docs field names per placement", () => {
    const igStory = buildZernioPostBody(
      { platform: "instagram", title: "Story", body: "Hai", meta: { placement: "ig_story" } },
      { accountId: "acc_ig", mediaItems: [{ type: "image", url: "https://cdn/1.png" }] },
    );
    expect(igStory).toEqual({
      content: "Hai",
      mediaItems: [{ type: "image", url: "https://cdn/1.png" }],
      platforms: [{ platform: "instagram", accountId: "acc_ig", platformSpecificData: { contentType: "story" } }],
      publishNow: true,
    });

    const igReel = buildZernioPostBody(
      { platform: "instagram", title: "Reel", body: "Watch", meta: { placement: "ig_reels" } },
      { accountId: "acc_ig", mediaItems: [{ type: "video", url: "https://cdn/v.mp4" }] },
    );
    expect((igReel.platforms as Record<string, unknown>[])[0]).toEqual({
      platform: "instagram",
      accountId: "acc_ig",
      platformSpecificData: { contentType: "reel", shareToFeed: true },
    });

    const fbStory = buildZernioPostBody(
      { platform: "facebook", title: "FB Story", body: "Hi", meta: { placement: "fb_story" } },
      { accountId: "acc_fb", mediaItems: [{ type: "image", url: "https://cdn/1.png" }] },
    );
    expect((fbStory.platforms as Record<string, unknown>[])[0]).toEqual({
      platform: "facebook",
      accountId: "acc_fb",
      platformSpecificData: { contentType: "story" },
    });

    const yt = buildZernioPostBody(
      { platform: "youtube", title: "Short Title", body: "Desc", meta: { placement: "yt_shorts" } },
      { accountId: "acc_yt", mediaItems: [{ type: "video", url: "https://cdn/v.mp4" }] },
    );
    expect((yt.platforms as Record<string, unknown>[])[0]).toEqual({
      platform: "youtube",
      accountId: "acc_yt",
      platformSpecificData: { title: "Short Title", visibility: "public" },
    });

    const threadsText = buildZernioPostBody(
      { platform: "threads", title: "T", body: "Hello Threads", meta: { placement: "threads" } },
      { accountId: "acc_th", mediaItems: [] },
    );
    expect(threadsText).toEqual({
      content: "Hello Threads",
      platforms: [{ platform: "threads", accountId: "acc_th" }],
      publishNow: true,
    });
    expect(defaultPlacementFor({ platform: "instagram", body: "x", meta: { images: ["1", "2"] } })).toBe("ig_carousel");
  });
});
