import { z } from "zod";

/**
 * Output formats for Editor's renders (video_edit). Every preset is H.264 + AAC in an MP4 with
 * faststart, which TikTok, Instagram, YouTube and Facebook all accept without complaint; the
 * bitrate cap is high enough that the platform's own re-encode starts from a clean picture.
 */
export const VideoPresetId = z.enum(["tiktok_fhd", "reels", "youtube_shorts", "youtube_1080p", "square"]);
export type VideoPresetId = z.infer<typeof VideoPresetId>;

export interface VideoPreset {
  label: string;
  width: number;
  height: number;
  /** Longest video the platform takes (seconds). */
  max_seconds: number;
  /** Peak video bitrate (Mbit/s). */
  max_mbps: number;
  audio_kbps: number;
}

export const VIDEO_PRESETS: Record<VideoPresetId, VideoPreset> = {
  tiktok_fhd: { label: "TikTok FHD 1080×1920 (9:16)", width: 1080, height: 1920, max_seconds: 600, max_mbps: 16, audio_kbps: 192 },
  reels: { label: "Instagram / Facebook Reels 1080×1920 (9:16)", width: 1080, height: 1920, max_seconds: 180, max_mbps: 12, audio_kbps: 192 },
  youtube_shorts: { label: "YouTube Shorts 1080×1920 (9:16)", width: 1080, height: 1920, max_seconds: 180, max_mbps: 16, audio_kbps: 192 },
  youtube_1080p: { label: "YouTube 1920×1080 (16:9)", width: 1920, height: 1080, max_seconds: 4 * 3600, max_mbps: 16, audio_kbps: 192 },
  square: { label: "Square 1080×1080 (1:1)", width: 1080, height: 1080, max_seconds: 600, max_mbps: 12, audio_kbps: 192 },
};

/** Video files the owner may send (chat, Telegram) and Editor may produce. */
export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/x-m4v": "m4v",
};

export const MAX_VIDEO_BYTES = 2 * 1024 ** 3;
/** Uploads are sent in parts this size: Cloudflare refuses request bodies over 100 MB. */
export const UPLOAD_PART_BYTES = 32 * 1024 ** 2;

export const isVideoType = (type: string) => type in VIDEO_TYPES;

/**
 * Jobs the runner does without the AI (no provider, key or tokens): the one tool each may use.
 * video_render = the Video Studio's "Render again"; video_transcribe = its "Transcribe".
 */
export const DIRECT_JOBS: Record<string, string> = { video_render: "video_edit", video_transcribe: "video_transcribe" };
/** Renders and transcripts of long videos take time: they get at least this many minutes. */
export const DIRECT_JOB_MIN_MINUTES = 120;

// ---------------------------------------------------------------- Editor's edit plan (video_edit input; the studio edits it too)

export const Clip = z.object({
  video: z.number().int().min(1).max(10).describe("Which file the owner sent (1 = first), must be a video"),
  start: z.number().min(0).default(0).describe("Seconds into that video"),
  end: z.number().positive().optional().describe("Seconds into that video (default: its end)"),
  speed: z.number().min(0.5).max(2).default(1).describe("0.5 = slow motion, 2 = twice as fast"),
  zoom: z.enum(["none", "in", "out"]).default("none").describe("Slow zoom over the clip (Ken Burns): brings still shots and scenery to life"),
});

export type Clip = z.infer<typeof Clip>;

export const Caption = z.object({
  text: z.string().trim().min(1).max(200),
  start: z.number().min(0).describe("Seconds in the FINISHED video"),
  end: z.number().positive(),
  position: z.enum(["bottom", "middle", "top"]).default("bottom"),
  animation: z.enum(["none", "fade", "pop"]).default("none").describe("fade = fades in and out; pop = grows in quickly, then fades out"),
});

export const Subtitles = z.object({
  style: z.enum(["pop", "line"]).default("pop").describe("pop = 2 words at a time (TikTok style); line = up to 6 words"),
  uppercase: z.boolean().default(true),
  position: z.enum(["bottom", "middle"]).default("bottom"),
});
export type Subtitles = z.infer<typeof Subtitles>;

export const EditPlan = z.object({
  clips: z.array(Clip).min(1).max(80).describe("Played one after another, in this order"),
  preset: VideoPresetId.default("tiktok_fhd"),
  fit: z.enum(["crop", "blur", "pad"]).default("crop").describe("crop = fill the frame (cuts the sides); blur = whole picture on a blurred copy; pad = whole picture on black"),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).default(30),
  captions: z.array(Caption).max(40).default([]).describe("Text burned into the picture"),
  subtitles: Subtitles.nullable().default(null).describe("Burn in subtitles from the speech (needs video_transcribe first); null = none"),
  transition: z
    .object({
      type: z.enum(["none", "fade", "dissolve", "slide", "zoom"]).default("none"),
      seconds: z.number().min(0.2).max(1.5).default(0.5),
    })
    .prefault({})
    .describe("Between clips: each transition overlaps the clips, so the video gets shorter by `seconds` per cut"),
  mute: z.boolean().default(false).describe("Drop the original sound"),
  music: z
    .object({
      track: z.string().trim().min(1).max(200).regex(/^[^\\/:*?"<>|]+$/).describe("A file name from the clip folder's music list (clip_library)"),
      volume_db: z.number().min(-40).max(6).default(-12).describe("Music loudness against the clip sound; with mute it is the only sound"),
    })
    .nullable()
    .default(null)
    .describe("Background music from the agent's music folder; null = none"),
  normalize_audio: z.boolean().default(true).describe("Even loudness (about -14 LUFS, what TikTok/YouTube expect)"),
  name: z.string().trim().min(1).max(60).regex(/^[\w\- ]+$/).default("edit").describe("Output file name, no extension"),
});
export type EditPlan = z.infer<typeof EditPlan>;

/** How long transitions really last: never more than half of the shorter neighbouring clip. */
export function transitionSeconds(plan: Pick<EditPlan, "transition">, lengths: number[]): number {
  if (!plan.transition || plan.transition.type === "none" || lengths.length < 2) return 0;
  return Math.max(0, Math.min(plan.transition.seconds, ...lengths.map((l) => l / 2)));
}

/** The finished video's length (seconds) from each clip's length, with transitions overlapping. */
export function finishedSeconds(plan: Pick<EditPlan, "transition">, lengths: number[]): number {
  const t = transitionSeconds(plan, lengths);
  return Math.round((lengths.reduce((a, b) => a + b, 0) - t * Math.max(0, lengths.length - 1)) * 100) / 100;
}

/** What a render remembers about how it was made (uploads.render), so the studio can show and change it. */
export const RenderInfo = z.object({
  plan: EditPlan,
  /** The job's files in order: plan.clips[].video points into this list (1-based). */
  attachments: z.array(z.object({ id: z.string(), name: z.string(), content_type: z.string() })).max(10),
});
export type RenderInfo = z.infer<typeof RenderInfo>;
