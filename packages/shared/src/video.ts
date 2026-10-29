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

/** Sound recordings the owner may send (meetings, voice notes) for Notulis to transcribe. Sent in parts like videos. */
export const AUDIO_TYPES: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/webm": "weba",
  "audio/aac": "aac",
  "audio/x-aac": "aac",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/amr": "amr",
};
export const isAudioType = (type: string) => type in AUDIO_TYPES;

/** Videos and sound recordings: the large files that arrive in parts and are streamed to disk. */
export const MEDIA_TYPES: Record<string, string> = { ...VIDEO_TYPES, ...AUDIO_TYPES };

/** A content type from a file name, for browsers and phones that send none (or octet-stream) for .m4a, .opus, .mkv… */
export function mediaTypeFromName(name: string): string | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!ext) return null;
  const byExt: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", m4v: "video/x-m4v", m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", weba: "audio/webm", aac: "audio/aac", flac: "audio/flac", amr: "audio/amr" };
  return byExt[ext] ?? null;
}

/**
 * Jobs the runner does without the AI (no provider, key or tokens): the one tool each may use.
 * video_render = the Video Studio's "Render again"; video_transcribe = its "Transcribe".
 */
export const DIRECT_JOBS: Record<string, string> = { video_render: "video_edit", video_transcribe: "video_transcribe", tiktok_hd: "video_tiktok_hd" };

// ---------------------------------------------------------------- TikTok HD (owner request 2026-10-20, like zilemmethod.com)

/**
 * "TikTok HD": get a finished video (edited on the phone, CapCut…) ready for TikTok without
 * losing quality. When the file already matches what TikTok plays (1080×1920, 30/60 fps constant,
 * H.264/HEVC 8-bit 4:2:0, AAC) it is only remuxed (streams copied, MOV → MP4, index at the front:
 * what Zilem Method sells). Otherwise it is re-encoded once to that spec, so TikTok's own
 * compression starts from a clean file instead of guessing (25 fps, 4K, 10-bit, VFR phone video…).
 */
export const TikTokHdMode = z.enum(["auto", "remux", "reencode"]);
export type TikTokHdMode = z.infer<typeof TikTokHdMode>;

export interface TikTokHdFacts {
  width: number;
  height: number;
  fps: number;
  duration: number;
  video_codec: string;
  size_bytes: number;
  pix_fmt?: string;
  audio_codec?: string | null;
  vfr?: boolean;
  rotation?: number;
  mbps?: number;
}

export interface TikTokHdPlan {
  mode: "remux" | "reencode";
  /** Why, in plain words (shown to the owner). Empty for a clean remux. */
  reasons: string[];
  /** Frame rate of the result. */
  fps: 30 | 60;
  /** How a non-9:16 picture is fitted when re-encoding. */
  fit: "crop" | "blur";
}

/** TikTok's longest upload, and a size above which its app compresses harder. */
export const TIKTOK_MAX_SECONDS = 600;
export const TIKTOK_HD_MAX_MB = 280;
/** Above this, TikTok's re-encode throws most of it away anyway; re-encoding first keeps control. */
export const TIKTOK_HD_MAX_MBPS = 30;

const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;

export function tiktokHdPlan(p: TikTokHdFacts, mode: TikTokHdMode = "auto"): TikTokHdPlan {
  if (p.duration > TIKTOK_MAX_SECONDS) throw new Error(`the video is ${Math.round(p.duration)} s; TikTok takes at most ${TIKTOK_MAX_SECONDS} s`);
  const fps: 30 | 60 = p.fps >= 45 ? 60 : 30;
  const ratio = p.width / p.height;
  // close to 9:16 → fill the frame (a sliver is cut); wide or square → whole picture on a blurred copy
  const fit = Math.abs(ratio - 9 / 16) < 0.04 ? "crop" : "blur";
  const reasons: string[] = [];
  if (!(p.width === 1080 && p.height === 1920)) reasons.push(`size ${p.width}×${p.height}, TikTok plays 1080×1920`);
  if (!near(p.fps, 30) && !near(p.fps, 60) && !near(p.fps, 29.97) && !near(p.fps, 59.94)) reasons.push(`${p.fps} fps, TikTok wants 30 or 60`);
  if (p.vfr) reasons.push("variable frame rate (phone recording)");
  if (!["h264", "hevc"].includes(p.video_codec)) reasons.push(`codec ${p.video_codec}, TikTok wants H.264 or HEVC`);
  if (p.pix_fmt && p.pix_fmt !== "unknown" && p.pix_fmt !== "yuv420p" && p.pix_fmt !== "yuvj420p") reasons.push(`colour format ${p.pix_fmt} (10-bit/HDR), TikTok wants 8-bit`);
  if (p.audio_codec && p.audio_codec !== "aac") reasons.push(`sound ${p.audio_codec}, TikTok wants AAC`);
  if (p.rotation) reasons.push(`rotated ${p.rotation}° by metadata`);
  if ((p.mbps ?? 0) > TIKTOK_HD_MAX_MBPS) reasons.push(`${p.mbps} Mbit/s is more than TikTok keeps`);
  if (p.size_bytes > TIKTOK_HD_MAX_MB * 1024 ** 2) reasons.push(`${Math.round(p.size_bytes / 1024 ** 2)} MB, TikTok compresses big files harder`);
  if (mode === "remux") return { mode: "remux", reasons: [], fps, fit };
  if (mode === "reencode") return { mode: "reencode", reasons: reasons.length ? reasons : ["re-encode asked for"], fps, fit };
  return { mode: reasons.length ? "reencode" : "remux", reasons, fps, fit };
}
/** Renders and transcripts of long videos take time: they get at least this many minutes. */
export const DIRECT_JOB_MIN_MINUTES = 120;

// ---------------------------------------------------------------- Editor's edit plan (video_edit input; the studio edits it too)

export const Clip = z.object({
  video: z.number().int().min(1).max(10).describe("Which file the owner sent (1 = first), must be a video"),
  start: z.number().min(0).default(0).describe("Seconds into that video"),
  end: z.number().positive().optional().describe("Seconds into that video (default: its end)"),
  speed: z.number().min(0.5).max(2).default(1).describe("0.5 = slow motion, 2 = twice as fast"),
  zoom: z.enum(["none", "in", "out"]).default("none").describe("Slow zoom over the clip (Ken Burns): brings still shots and scenery to life"),
  fit: z.enum(["crop", "blur", "pad"]).optional().describe("Per-clip override for fit (e.g. 'blur' when the shot has burned-in text or faces near the edges)"),
  crop: z.string().regex(/^\d+:\d+:\d+:\d+$/).optional().describe("Optional w:h:x:y crop applied before reframing (e.g. to strip letterbox bars)"),
});

export type Clip = z.infer<typeof Clip>;

export const Overlay = z.object({
  video: z.number().int().min(1).max(10).describe("Which video file to overlay (1 = first, or the video number returned by motion_render)"),
  start: z.number().min(0).default(0).describe("Seconds in the FINISHED video when the overlay appears"),
  end: z.number().positive().optional().describe("Seconds in the FINISHED video when the overlay ends (default: start + overlay length)"),
  x: z.string().trim().max(40).default("(W-w)/2").describe("Horizontal position expression in ffmpeg overlay (default: centered)"),
  y: z.string().trim().max(40).default("(H-h)/2").describe("Vertical position expression in ffmpeg overlay (default: centered)"),
  chromakey: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Optional hex colour to key out as transparent (e.g. #00FF00)"),
  opacity: z.number().min(0.1).max(1).default(1).describe("Overlay opacity (0.1 to 1.0)"),
});
export type Overlay = z.infer<typeof Overlay>;

export const TransitionSpec = z.object({
  type: z.enum(["none", "fade", "dissolve", "slide", "zoom"]).default("none"),
  seconds: z.number().min(0.2).max(1.5).default(0.5),
});
export type TransitionSpec = z.infer<typeof TransitionSpec>;

export const Caption = z.object({
  text: z.string().trim().min(1).max(200),
  start: z.number().min(0).describe("Seconds in the FINISHED video"),
  end: z.number().positive(),
  position: z.enum(["bottom", "middle", "top"]).default("bottom"),
  animation: z.enum(["none", "fade", "pop"]).default("none").describe("fade = fades in and out; pop = grows in quickly, then fades out"),
});
export type Caption = z.infer<typeof Caption>;

/** Monochrome vector emoji font for libass (avoids COLRv0/COLRv1 broken hollow rings and missing-glyph tofu). Pure. */
export function emojiFontName(platformName: string = typeof process !== "undefined" ? process.platform : "linux"): string {
  return platformName === "win32" ? "Segoe UI Symbol" : "Noto Emoji";
}

const EMOJI_RUN_RE = /[\p{Extended_Pictographic}\u2600-\u27BF]+(?:\uFE0F|\u200D[\p{Extended_Pictographic}\u2600-\u27BF]+)*/gu;

/** Wrap emoji codepoints in an explicit monochrome outline font override for libass. Pure. */
export function wrapAssEmoji(cleanedText: string, emojiFont = emojiFontName()): string {
  return cleanedText.replace(EMOJI_RUN_RE, (m) => `{\\fn${emojiFont}\\b0}${m}{\\fnArial\\b1}`);
}

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
  overlays: z.array(Overlay).max(20).default([]).describe("Motion graphics or picture-in-picture videos overlaid on top of the main edit"),
  transition: z
    .union([TransitionSpec, z.array(TransitionSpec).min(1).max(80)])
    .prefault({})
    .describe("Between clips: each transition overlaps the clips, so the video gets shorter by `seconds` per cut (single object or list per boundary)"),
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

/** Normalize `plan.transition` into one TransitionSpec per cut boundary (`lengths.length - 1` entries). */
export function transitionsForCuts(
  plan: Pick<EditPlan, "transition">,
  lengths: number[],
): { type: TransitionSpec["type"]; seconds: number }[] {
  if (lengths.length < 2 || !plan.transition) {
    return Array.from({ length: Math.max(0, lengths.length - 1) }, () => ({ type: "none" as const, seconds: 0 }));
  }
  if (!Array.isArray(plan.transition)) {
    const t = plan.transition;
    if (t.type === "none") {
      return Array.from({ length: lengths.length - 1 }, () => ({ type: "none" as const, seconds: 0 }));
    }
    const sec = Math.max(0, Math.min(t.seconds, ...lengths.map((l) => l / 2)));
    return Array.from({ length: lengths.length - 1 }, () => ({ type: t.type, seconds: sec }));
  }
  const list = plan.transition;
  return Array.from({ length: lengths.length - 1 }, (_, i) => {
    const spec = list[i] ?? list[list.length - 1] ?? { type: "none" as const, seconds: 0.5 };
    if (spec.type === "none") return { type: "none" as const, seconds: 0 };
    const sec = Math.max(0, Math.min(spec.seconds, (lengths[i] ?? 0) / 2, (lengths[i + 1] ?? 0) / 2));
    return { type: spec.type, seconds: sec };
  });
}

/** How long transitions really last: never more than half of the shorter neighbouring clip. */
export function transitionSeconds(plan: Pick<EditPlan, "transition">, lengths: number[]): number {
  const cuts = transitionsForCuts(plan, lengths);
  if (!cuts.length) return 0;
  if (!Array.isArray(plan.transition)) return cuts[0]!.seconds;
  return Math.round((cuts.reduce((a, c) => a + c.seconds, 0) / cuts.length) * 100) / 100;
}

/** The finished video's length (seconds) from each clip's length, with transitions overlapping. */
export function finishedSeconds(plan: Pick<EditPlan, "transition">, lengths: number[]): number {
  const cuts = transitionsForCuts(plan, lengths);
  const totalOverlap = cuts.reduce((a, c) => a + c.seconds, 0);
  return Math.round((lengths.reduce((a, b) => a + b, 0) - totalOverlap) * 100) / 100;
}

/** What a render remembers about how it was made (uploads.render), so the studio can show and change it. */
export const RenderInfo = z.object({
  plan: EditPlan,
  /** The job's files in order: plan.clips[].video points into this list (1-based). */
  attachments: z.array(z.object({ id: z.string(), name: z.string(), content_type: z.string() })).max(10),
});
export type RenderInfo = z.infer<typeof RenderInfo>;

/** Per-shot visual analysis and quality flags produced by video_index / video_probe(index: true) (Task 026). */
export const ShotInfo = z.object({
  index: z.number().int().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
  description: z.string().max(400).default(""),
  dark: z.boolean().default(false),
  blurry: z.boolean().default(false),
  text_on_screen: z.boolean().default(false),
  faces: z.boolean().default(false),
  letterboxed: z.boolean().default(false),
  luma_mean: z.number().optional(),
});
export type ShotInfo = z.infer<typeof ShotInfo>;

export const VideoShotIndex = z.object({
  duration: z.number().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  crop: z.string().nullable().default(null),
  letterboxed: z.boolean().default(false),
  shots: z.array(ShotInfo).max(120),
});
export type VideoShotIndex = z.infer<typeof VideoShotIndex>;
