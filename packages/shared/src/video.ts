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
