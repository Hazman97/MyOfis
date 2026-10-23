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
