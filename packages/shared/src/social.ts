import type { ContentDraft, DraftPlacement, WebPost } from "./marketing.ts";

/** Social platforms supported via Zernio POST /v1/posts. */
export const ZERNIO_PLATFORMS = ["facebook", "instagram", "threads", "tiktok", "youtube"] as const;
export type ZernioPlatform = (typeof ZERNIO_PLATFORMS)[number];

export function isZernioPlatform(p: string): p is ZernioPlatform {
  return (ZERNIO_PLATFORMS as readonly string[]).includes(p);
}

/** Caption/text character limits per platform (verified from Zernio docs). */
export const CAPTION_MAX_CHARS: Record<ZernioPlatform, number> = {
  tiktok: 2200,
  instagram: 2200,
  facebook: 63206,
  threads: 500,
  youtube: 5000,
};

export interface PlacementCheckInput {
  platform: string;
  kind?: string;
  title?: string;
  body: string;
  meta?: Partial<WebPost> | null;
}

/**
 * Infer the effective placement when `meta.placement` is omitted. Pure.
 */
export function defaultPlacementFor(draft: PlacementCheckInput): DraftPlacement | null {
  if (draft.meta?.placement) return draft.meta.placement;
  const hasVideo = !!draft.meta?.video_upload_id;
  const imgs = draft.meta?.images?.length ? draft.meta.images : draft.meta?.cover_upload_id ? [draft.meta.cover_upload_id] : [];
  switch (draft.platform) {
    case "tiktok":
      return "tiktok";
    case "instagram":
      if (imgs.length >= 2) return "ig_carousel";
      if (hasVideo) return "ig_reels";
      return "ig_feed";
    case "facebook":
      return hasVideo ? "fb_reels" : "fb_feed";
    case "threads":
      return "threads";
    case "youtube":
      return "yt_shorts";
    case "whatsapp":
      return "whatsapp";
    default:
      return null;
  }
}

/**
 * Pure placement & caption validation for social drafts (Task 042).
 * Returns a list of human-readable problems (empty array = valid).
 *
 * Only enforces media rules when `meta.placement` is explicitly set OR for platforms
 * that strictly require specific media (e.g. YouTube Shorts title, Threads 500-char ceiling).
 * Pure text-only captions without `meta.placement` (legacy marketing captions) still check
 * caption length limits without breaking older workflows.
 */
export function placementCheck(draft: PlacementCheckInput): string[] {
  const problems: string[] = [];
  const platform = draft.platform;
  const meta = draft.meta ?? null;
  const body = draft.body ?? "";
  const title = (draft.title ?? "").trim();

  // Caption length check per platform
  if (isZernioPlatform(platform)) {
    const max = CAPTION_MAX_CHARS[platform];
    if (body.length > max) {
      problems.push(`Kapsyen ${platform} melebihi had ${max} aksara (${body.length} aksara).`);
    }
  }

  const explicitPlacement = meta?.placement ?? null;
  const placement = explicitPlacement ?? defaultPlacementFor(draft);
  if (!placement) return problems;

  const images = meta?.images?.length ? meta.images : meta?.cover_upload_id ? [meta.cover_upload_id] : [];
  const hasVideo = !!meta?.video_upload_id;
  const duration = meta?.video_duration_s;
  const aspect = meta?.video_aspect;

  // Platform ↔ placement mismatch guard
  const expectedPlatform: Partial<Record<DraftPlacement, string>> = {
    tiktok: "tiktok",
    ig_feed: "instagram",
    ig_carousel: "instagram",
    ig_reels: "instagram",
    ig_story: "instagram",
    fb_feed: "facebook",
    fb_reels: "facebook",
    fb_story: "facebook",
    threads: "threads",
    yt_shorts: "youtube",
    whatsapp: "whatsapp",
    whatsapp_status: "whatsapp",
  };
  if (explicitPlacement && expectedPlatform[explicitPlacement] && expectedPlatform[explicitPlacement] !== platform) {
    problems.push(`Placement ${explicitPlacement} tidak sepadan dengan platform ${platform}.`);
  }

  switch (placement) {
    case "ig_story":
    case "fb_story": {
      const mediaCount = images.length + (hasVideo ? 1 : 0);
      if (mediaCount !== 1) {
        problems.push(`${placement === "ig_story" ? "IG Story" : "FB Story"} perlukan tepat 1 gambar ATAU 1 video (sekarang: ${images.length} gambar, ${hasVideo ? 1 : 0} video).`);
      }
      if (hasVideo && duration !== undefined && duration > 60) {
        problems.push(`Video Story mesti ≤ 60 saat (sekarang ${Math.round(duration)} s; guna bahagian Story daripada Video HD).`);
      }
      break;
    }

    case "ig_reels":
    case "fb_reels": {
      if (explicitPlacement || draft.kind === "video") {
        if (!hasVideo) {
          problems.push(`${placement === "ig_reels" ? "IG Reels" : "FB Reels"} perlukan video menegak (9:16).`);
        } else if (aspect && aspect !== "vertical") {
          problems.push(`${placement === "ig_reels" ? "IG Reels" : "FB Reels"} perlukan video menegak (9:16), bukan ${aspect}.`);
        }
      }
      break;
    }

    case "yt_shorts": {
      if (!title) {
        problems.push("YouTube Shorts perlukan tajuk (title).");
      } else if (title.length > 100) {
        problems.push(`Tajuk YouTube Shorts mesti ≤ 100 aksara (sekarang ${title.length}).`);
      }
      if (explicitPlacement || draft.kind === "video") {
        if (!hasVideo) {
          problems.push("YouTube Shorts perlukan video menegak (9:16).");
        } else {
          if (aspect && aspect !== "vertical") {
            problems.push(`YouTube Shorts perlukan video menegak (9:16), bukan ${aspect}.`);
          }
          if (duration !== undefined && duration > 180) {
            problems.push(`YouTube Shorts mesti ≤ 180 saat (sekarang ${Math.round(duration)} s).`);
          }
        }
      }
      break;
    }

    case "ig_carousel": {
      if (images.length < 2 || images.length > 10) {
        problems.push(`IG Carousel perlukan 2–10 gambar (sekarang ${images.length}).`);
      }
      if (hasVideo) {
        problems.push("IG Carousel dalam MyOfis hanya menerima 2–10 gambar (tanpa video).");
      }
      break;
    }

    case "ig_feed": {
      if (explicitPlacement && images.length === 0 && !hasVideo) {
        problems.push("IG Feed perlukan sekurang-kurangnya 1 gambar.");
      }
      break;
    }

    case "tiktok": {
      if ((explicitPlacement || draft.kind === "video") && !hasVideo) {
        problems.push("TikTok perlukan video.");
      }
      break;
    }

    case "threads": {
      if (images.length > 10) {
        problems.push(`Threads menyokong sehingga 10 gambar dalam draf (sekarang ${images.length}).`);
      }
      break;
    }

    case "fb_feed":
    case "whatsapp":
    case "whatsapp_status":
      break;
  }

  return problems;
}

export interface DraftSetGroup<T extends { id: string; meta?: { set_id?: string | null } | null } = ContentDraft> {
  /** Non-null when this group is a multi-platform post set; null for standalone drafts. */
  set_id: string | null;
  drafts: T[];
}

/**
 * Group drafts by `meta.set_id`, preserving first-seen order.
 * Drafts without `set_id` (or sets with only 1 draft when `keepSingletonSets` is false) remain standalone.
 */
export function groupDraftSets<T extends { id: string; meta?: { set_id?: string | null } | null }>(
  drafts: T[],
  opts: { keepSingletonSets?: boolean } = {},
): DraftSetGroup<T>[] {
  const bySet = new Map<string, DraftSetGroup<T>>();
  const out: DraftSetGroup<T>[] = [];
  for (const d of drafts) {
    const sid = d.meta?.set_id?.trim() || null;
    if (!sid) {
      out.push({ set_id: null, drafts: [d] });
      continue;
    }
    const existing = bySet.get(sid);
    if (existing) {
      existing.drafts.push(d);
    } else {
      const group: DraftSetGroup<T> = { set_id: sid, drafts: [d] };
      bySet.set(sid, group);
      out.push(group);
    }
  }
  if (!opts.keepSingletonSets) {
    for (const g of out) {
      if (g.set_id && g.drafts.length < 2) g.set_id = null;
    }
  }
  return out;
}

export interface ZernioMediaItem {
  type: "image" | "video";
  url: string;
  thumbnail?: string;
}

/**
 * Build the exact `POST /v1/posts` JSON payload for Zernio using verified `docs.zernio.com` field names:
 * - Instagram Story: `platformSpecificData: { contentType: "story" }`
 * - Instagram Reel: `platformSpecificData: { contentType: "reel", shareToFeed: true }`
 * - Instagram Feed / Carousel: `mediaItems` in order (no `contentType`)
 * - Facebook Story: `platformSpecificData: { contentType: "story" }`
 * - Facebook Reel: `platformSpecificData: { contentType: "reel" }`
 * - YouTube Shorts: `platformSpecificData: { title, visibility: "public" }` (auto-detected by vertical ≤ 3 min)
 * - Threads: `content` ≤ 500 chars, optional `mediaItems`
 * - TikTok: `tiktokSettings` (existing fields)
 */
export function buildZernioPostBody(
  draft: { platform: ZernioPlatform; title: string; body: string; meta?: Partial<WebPost> | null },
  opts: {
    accountId: string;
    mediaItems: ZernioMediaItem[];
    tiktokPrivacy?: string;
  },
): Record<string, unknown> {
  const max = CAPTION_MAX_CHARS[draft.platform];
  const content = draft.body.slice(0, max);
  const placement = defaultPlacementFor(draft);

  const platformEntry: Record<string, unknown> = {
    platform: draft.platform,
    accountId: opts.accountId,
  };

  if (draft.platform === "instagram") {
    if (placement === "ig_story") {
      platformEntry.platformSpecificData = { contentType: "story" };
    } else if (placement === "ig_reels") {
      platformEntry.platformSpecificData = { contentType: "reel", shareToFeed: true };
    }
  } else if (draft.platform === "facebook") {
    if (placement === "fb_story") {
      platformEntry.platformSpecificData = { contentType: "story" };
    } else if (placement === "fb_reels") {
      platformEntry.platformSpecificData = { contentType: "reel" };
    }
  } else if (draft.platform === "youtube") {
    platformEntry.platformSpecificData = {
      title: (draft.title.trim() || content.split(/\r?\n/)[0] || "Short").slice(0, 100),
      visibility: "public",
    };
  }

  const body: Record<string, unknown> = {
    content,
    platforms: [platformEntry],
    publishNow: true,
  };

  if (opts.mediaItems.length > 0) {
    body.mediaItems = opts.mediaItems;
  }

  if (draft.platform === "tiktok") {
    body.tiktokSettings = {
      privacy_level: opts.tiktokPrivacy || "PUBLIC_TO_EVERYONE",
      allow_comment: true,
      allow_duet: true,
      allow_stitch: true,
      content_preview_confirmed: true,
      express_consent_given: true,
      video_cover_timestamp_ms: 1000,
    };
  }

  return body;
}
