import { z } from "zod";
import { SocialPlacement } from "./video.ts";

/**
 * Phase 4: project briefs, the feature log and content drafts (spec §8.4, §9).
 * Marketing writes drafts only; nothing here is ever published automatically.
 */

export const Platform = z.enum(["tiktok", "instagram", "facebook", "threads", "youtube", "whatsapp", "landing_page", "website", "general"]);
export type Platform = z.infer<typeof Platform>;

export const ContentLanguage = z.enum(["manglish", "bahasa_melayu", "english"]);
export type ContentLanguage = z.infer<typeof ContentLanguage>;

export const BRAND_FONT_IDS = [
  "poppins",
  "montserrat",
  "playfair-display",
  "dm-serif-display",
  "inter",
  "nunito",
  "bebas-neue",
] as const;
export const BrandFont = z.enum(BRAND_FONT_IDS);
export type BrandFont = z.infer<typeof BrandFont>;

export const BRAND_FONTS: Record<BrandFont, { label: string; cssFamily: string; weights: number[] }> = {
  poppins: { label: "Poppins", cssFamily: "Poppins", weights: [400, 700] },
  montserrat: { label: "Montserrat", cssFamily: "Montserrat", weights: [400, 700] },
  "playfair-display": { label: "Playfair Display", cssFamily: "Playfair Display", weights: [400, 700] },
  "dm-serif-display": { label: "DM Serif Display", cssFamily: "DM Serif Display", weights: [400] },
  inter: { label: "Inter", cssFamily: "Inter", weights: [400, 700] },
  nunito: { label: "Nunito", cssFamily: "Nunito", weights: [400, 700] },
  "bebas-neue": { label: "Bebas Neue", cssFamily: "Bebas Neue", weights: [400] },
};

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a 6-digit hex colour like #111827");

export const BrandStyle = z.enum(["minimal", "bold", "soft", "playful"]);
export type BrandStyle = z.infer<typeof BrandStyle>;

export const BrandHighlight = z.object({
  label: z.string().trim().min(1).max(30),
  icon: z.string().trim().min(1).max(40),
});
export type BrandHighlight = z.infer<typeof BrandHighlight>;

export const BrandColors = z.object({
  primary: HexColor.default("#059669"),
  secondary: HexColor.default("#0F172A"),
  accent: HexColor.default("#F59E0B"),
  background: HexColor.default("#FFFFFF"),
  text: HexColor.default("#111827"),
});

export const BrandFonts = z.object({
  heading: BrandFont.default("poppins"),
  body: BrandFont.default("inter"),
});

export const BrandKit = z.object({
  colors: BrandColors.prefault({}),
  fonts: BrandFonts.prefault({}),
  logo_upload_id: z.string().max(64).nullable().default(null),
  style: BrandStyle.default("minimal"),
  handle: z.string().trim().max(60).default(""),
  highlights: z.array(BrandHighlight).max(12).default([]),
});
export type BrandKit = z.infer<typeof BrandKit>;
export type BrandKitInput = z.input<typeof BrandKit>;

export const DEFAULT_BRAND_KIT: BrandKit = BrandKit.parse({});

/** WCAG 2.1 contrast ratio between two 6-digit hex colours (1..21). Pure. */
export function contrastRatio(hexA: string, hexB: string): number {
  const lum = (hex: string) => {
    const clean = hex.replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return 0;
    const ch = [0, 2, 4].map((i) => {
      const v = parseInt(clean.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const l1 = lum(hexA);
  const l2 = lum(hexB);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

const text = (max: number) => z.string().max(max).default("");
const list = (max: number, itemMax: number) => z.array(z.string().trim().min(1).max(itemMax)).max(max).default([]);

/** `projects/<slug>/brief.yaml`. Everything Marketing may know about a product. */
export const ProjectBrief = z.object({
  project: z.string().min(1).max(120),
  one_liner: text(300),
  target: text(500),
  pain_point: text(500),
  pricing: text(1000),
  location: text(300),
  /** How customers should act: "WhatsApp 012-345 6789", "book at example.com". */
  call_to_action: text(300),
  /** Facts Marketing may state (package contents, opening hours, guarantees). */
  facts: list(30, 300),
  tone: text(300),
  languages: z.partialRecord(Platform, ContentLanguage).default({}),
  platforms: z.array(Platform).max(8).default([]),
  do_not: list(30, 300),
  /** Posts the owner likes. Marketing studies their style; it never copies them word for word. */
  good_examples: list(20, 4000),
  /** Style guide written by Marketing from the examples (approved by the owner in the drafts inbox). */
  style_notes: text(6000),
  /** Optional Brand Kit (colours, bundled fonts, logo, style, handle, highlights). */
  brand: BrandKit.optional(),
});
export type ProjectBrief = z.infer<typeof ProjectBrief>;
export type ProjectBriefInput = z.input<typeof ProjectBrief>;

/** Starting point in the brief editor: the spec's example. */
export const EXAMPLE_BRIEF: ProjectBriefInput = {
  project: "Sewa Kamera ZV-E10",
  one_liner: "Sewa kamera vlog + flash + tripod untuk content creator dan event",
  target: "content creator baru, pelajar, orang nak rakam majlis",
  pain_point: "tak mampu beli kamera mahal untuk guna sekali-sekala",
  pricing: "",
  location: "",
  call_to_action: "",
  facts: ["Set lengkap: Sony ZV-E10 + flash + tripod"],
  tone: "santai, Manglish, mesra, tak overclaim",
  languages: { tiktok: "manglish", instagram: "manglish", facebook: "bahasa_melayu" },
  platforms: ["tiktok", "instagram", "facebook", "threads"],
  do_not: ['guna "terbaik di Malaysia"', "janji benda yang tak boleh tunai"],
  good_examples: [],
  style_notes: "",
};

// ---------- drafts ----------

export const DraftKind = z.enum([
  "caption",
  "video_script",
  "content_calendar",
  "landing_copy",
  "seasonal_promo",
  "reply_template",
  "ab_hooks",
  "announcement",
  "style_guide",
  "web_post",
  "video",
  "other",
]);
export type DraftKind = z.infer<typeof DraftKind>;


/**
 * A post for a project's own website (news, event, vlog…), written by Publisher and sent to the
 * site's `POST /agent-office/publish` endpoint when the owner approves it. Title and body (Markdown)
 * live on the draft itself; these are the other fields.
 */
export const WebPostFactItem = z.object({
  claim: z.string().min(1).max(300),
  value: z.string().min(1).max(100),
  source_url: z.string().url().max(500).optional(),
  verified: z.boolean().default(true),
});

/** Placement of a social draft (039 SocialPlacement + ig_carousel for multi-image carousels). */
export const DraftPlacement = z.enum([
  "tiktok",
  "ig_reels",
  "ig_story",
  "ig_feed",
  "ig_carousel",
  "fb_reels",
  "fb_story",
  "fb_feed",
  "yt_shorts",
  "threads",
  "whatsapp",
  "whatsapp_status",
]);
export type DraftPlacement = z.infer<typeof DraftPlacement>;
export { SocialPlacement };

export const WebPost = z.object({
  /** One of the site's post types (from its publish endpoint), e.g. "news", "tournament", "vlog". */
  post_type: z.string().trim().min(1).max(40),
  excerpt: z.string().max(400).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""),
  event_time: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal("")).default(""),
  location: z.string().max(200).default(""),
  video_url: z.string().url().or(z.literal("")).default(""),
  /** An image the owner sent in chat (uploads table), used as the cover. */
  cover_upload_id: z.string().max(64).nullable().default(null),
  /** A finished video (Editor's render or the owner's own clip) to post with a caption. */
  video_upload_id: z.string().max(64).nullable().default(null),
  /** Which social account it posts to (Zernio account id); null = the default one. */
  social_account: z.string().max(100).nullable().default(null),
  /** Carousel / multi-image upload ids in display order (≤ 10). */
  images: z.array(z.string().max(64)).max(10).default([]),
  /** Placement (feed / carousel / reels / story / shorts / threads / tiktok). */
  placement: DraftPlacement.optional(),
  /** Groups drafts belonging to one multi-platform post set. */
  set_id: z.string().max(64).nullable().optional(),
  /** Optional video duration in seconds (for placementCheck on Stories/Shorts). */
  video_duration_s: z.number().nonnegative().max(36_000).optional(),
  /** Optional video aspect ratio class (for placementCheck on Reels/Shorts). */
  video_aspect: z.enum(["vertical", "square", "landscape"]).optional(),
  /** Optional proposed publish time (ISO) suggested by content_week before approval. */
  proposed_publish_at: z.string().max(40).nullable().optional(),
  /** Optional verified fact sheet attached by explainer_render via save_draft. */
  fact_sheet: z.array(WebPostFactItem).max(20).optional(),
  /** True when the video script was pasted without fact-sheet verification. */
  unverified: z.boolean().optional(),
});
export type WebPost = z.infer<typeof WebPost>;

/** The owner's changes to a website post before approving: only the fields sent (no defaults, so nothing is wiped). */
export const WebPostEdit = z.object({
  post_type: z.string().trim().min(1).max(40).optional(),
  excerpt: z.string().max(400).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional(),
  event_time: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal("")).optional(),
  location: z.string().max(200).optional(),
  video_url: z.string().url().or(z.literal("")).optional(),
  cover_upload_id: z.string().max(64).nullable().optional(),
  video_upload_id: z.string().max(64).nullable().optional(),
  social_account: z.string().max(100).nullable().optional(),
  images: z.array(z.string().max(64)).max(10).optional(),
  placement: DraftPlacement.optional(),
  set_id: z.string().max(64).nullable().optional(),
  proposed_publish_at: z.string().max(40).nullable().optional(),
});
export type WebPostEdit = z.infer<typeof WebPostEdit>;

/** What a project's website told us it accepts (GET /agent-office/publish). */
export const PublishInfo = z.object({
  site_name: z.string().max(120),
  post_types: z.array(z.string().max(40)).max(20),
});
export type PublishInfo = z.infer<typeof PublishInfo>;
/** draft → approved | edited (approved with owner edits) | rejected. `published` is reserved for a later posting integration. */
export const DraftStatus = z.enum(["draft", "approved", "rejected", "edited", "published"]);
export type DraftStatus = z.infer<typeof DraftStatus>;

/** The review Marketing must do before a draft reaches the owner (spec §8.4 "Review step"). */
export const SelfCheck = z.object({
  facts_match_brief: z.boolean().describe("Prices, names and facts come from the brief"),
  only_released_features: z.boolean().describe("Only features that are in the brief or the feature log"),
  no_overclaims: z.boolean().describe('No "terbaik di Malaysia", no promises the brief does not support'),
  tone_and_language_match: z.boolean().describe("Tone and language follow the brief for this platform"),
  notes: z.string().max(1000).default("").describe("Anything the owner should double-check"),
});
export type SelfCheck = z.infer<typeof SelfCheck>;

export const ContentDraft = z.object({
  id: z.string(),
  project_id: z.string(),
  agent_id: z.string(),
  run_id: z.string().nullable(),
  feature_id: z.string().nullable(),
  platform: Platform,
  kind: DraftKind,
  title: z.string(),
  body: z.string(),
  status: DraftStatus,
  self_check: SelfCheck.nullable(),
  owner_feedback: z.string().nullable(),
  original_body: z.string(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
  /** web_post only: the post fields, and where it was published (or why not). */
  meta: WebPost.nullable().default(null),
  published_url: z.string().nullable().default(null),
  publish_error: z.string().nullable().default(null),
  /** Approved and scheduled: it goes out at this time (ISO). */
  publish_at: z.string().nullable().default(null),
  /** Set by the drafts list: approving would post it somewhere (website or a connected account). */
  can_publish: z.boolean().optional(),
});
export type ContentDraft = z.infer<typeof ContentDraft>;

export const DraftDecision = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    body: z.string().min(1).max(20_000).optional(),
    feedback: z.string().max(2000).optional(),
    /** The owner's edits before approving (title, and website-post fields). */
    title: z.string().trim().min(1).max(200).optional(),
    meta: WebPostEdit.optional(),
    /** Post later instead of now (ISO time, up to 60 days ahead). */
    publish_at: z.string().datetime({ offset: true }).optional(),
  }),
  z.object({ decision: z.literal("reject"), feedback: z.string().max(2000).optional() }),
]);
export type DraftDecision = z.infer<typeof DraftDecision>;

// ---------- feature log ----------

export const FeatureNoteInput = z.object({
  title: z.string().trim().min(3).max(160),
  /** Plain language for customers, no jargon. */
  user_facing_note: z.string().trim().min(10).max(2000),
  source_pr_url: z.string().url().nullable().default(null),
});
export type FeatureNoteInput = z.input<typeof FeatureNoteInput>;
export type FeatureNoteData = z.output<typeof FeatureNoteInput>;

export const FeatureNote = FeatureNoteInput.extend({
  id: z.string(),
  project_id: z.string(),
  released_at: z.string(),
  screenshot_path: z.string().nullable(),
  announced: z.boolean(),
});
export type FeatureNote = z.infer<typeof FeatureNote>;

// ---------- Marketing job types (job.type) ----------

export interface MarketingJobType {
  type: DraftKind | "style_analysis";
  label: string;
  /** What Marketing is asked to produce. Part of its prompt. */
  produce: string;
  /** Example instruction shown in the New job form. */
  example: string;
}

export const MARKETING_JOB_TYPES: MarketingJobType[] = [
  {
    type: "caption",
    label: "Captions",
    produce: "3 caption variants per requested platform, each with a hook, body and call to action. One save_draft per variant.",
    example: "3 caption TikTok untuk promo sewa ZV-E10 cuti sekolah. Santai, Manglish, ada CTA WhatsApp.",
  },
  {
    type: "video_script",
    label: "Short-video script",
    produce: "A short-video script: hook in the first 3 seconds, body (shot-by-shot, with on-screen text), call to action.",
    example: "Skrip video 30 saat untuk TikTok: tunjuk unboxing set kamera + flash + tripod.",
  },
  {
    type: "content_calendar",
    label: "Weekly content calendar",
    produce: "A 7-day content calendar mixing education, testimonial, promo and behind-the-scenes posts, one line idea + platform per day. One draft.",
    example: "Content calendar minggu depan untuk IG dan TikTok.",
  },
  {
    type: "landing_copy",
    label: "Landing page copy",
    produce: "Landing page copy: headline, subheadline, 3-5 benefits, FAQ (5 questions) and a call to action. One draft.",
    example: "Copy landing page untuk sewa kamera: headline, benefits, FAQ.",
  },
  {
    type: "seasonal_promo",
    label: "Seasonal promo",
    produce: "Promo drafts for the season named in the job. Check today's date first; if you are unsure of a festival date, say so in the self-check notes.",
    example: "Promo Raya: 3 caption IG + 1 skrip TikTok.",
  },
  {
    type: "reply_template",
    label: "Comment / DM replies",
    produce: "Reply templates for common comments and DMs (price, availability, how to book, complaints). One draft with all templates.",
    example: "Template balas DM untuk soalan harga dan cara booking.",
  },
  {
    type: "ab_hooks",
    label: "A/B hook variants",
    produce: "5-10 alternative hooks (first line / first 3 seconds) for the same post, labelled A, B, C… One draft.",
    example: "10 hook A/B untuk video promo flash + tripod.",
  },
  {
    type: "announcement",
    label: "Feature announcement",
    produce: "Announcement drafts for the released feature in the job: one per platform in the brief, in plain customer language.",
    example: "Announcement untuk feature baru dalam feature log.",
  },
  {
    type: "style_analysis",
    label: "Writing-style analysis",
    produce:
      "Study the example posts (the brief's good_examples and any pasted in the job). Write a style guide: language mix, sentence length, emoji use, how hooks open, CTA style, words to use and avoid. " +
      "Save it as ONE draft with kind style_guide and platform general (when the owner approves it, it becomes the brief's style notes). " +
      "Then write the posts the job asks for in that style. Learn the style; never copy sentences from the examples.",
    example: "Analisis gaya penulisan contoh posting dalam brief, lepas tu tulis 2 posting IG ikut gaya tu pasal flash + tripod.",
  },
  {
    type: "other",
    label: "Other",
    produce: "Whatever the job asks for, as drafts.",
    example: "Tulis bio Instagram (150 aksara) untuk Sewa Kamera.",
  },
];

/**
 * Some models send line breaks as the two characters "\n" (escaped twice in their JSON). When a text
 * has no real line break but does have "\n" sequences, turn them back into line breaks.
 */
export function fixEscapedNewlines(s: string): string {
  const literal = s.split("\\n").length - 1;
  const real = s.split("\n").length - 1;
  if (literal === 0 || real >= literal) return s;
  return s.replace(/\\r\\n|\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
}
