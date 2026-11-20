import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { VideoPresetId, detectBeats, planMontage, type BeatAnalysis } from "@agent-office/shared";
import { clipFolder, clipKey, musicTracks, readIndex, writeIndex } from "./clips.ts";
import { ToolDenied, defineTool } from "./types.ts";
import { attachmentFile, ffmpegBin, mediaDir, probe, spawn } from "./video.ts";

export interface CachedTrackBeats extends BeatAnalysis {
  duration: number;
  cached: boolean;
}

/**
 * Decode `<clipFolder>/music/<track>` to mono 22050 Hz float32 PCM via ffmpeg and detect beats.
 * Caches the result in `.myofis-clips.json` keyed by file name + size + mtime.
 */
export async function analyzeTrackBeats(
  clipDir: string,
  track: string,
  workDir: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<CachedTrackBeats> {
  const safeName = basename(track.trim());
  if (!safeName || safeName !== track.trim()) {
    throw new ToolDenied(`invalid track name "${track}"`);
  }
  const available = musicTracks(clipDir);
  if (!available.includes(safeName)) {
    throw new ToolDenied(`no music track "${safeName}" in music/ (available: ${available.join(", ") || "none"})`);
  }

  const trackPath = join(clipDir, "music", safeName);
  const st = statSync(trackPath);
  const key = clipKey(`music/${safeName}`, st.size, st.mtimeMs);
  const idx = readIndex(clipDir);
  const hit = idx.music_beats?.[key];
  if (hit) {
    return { ...hit, cached: true };
  }

  const bin = ffmpegBin();
  if (!bin) throw new ToolDenied("ffmpeg is not installed on the runner PC (ffmpeg.org). Tell the owner.");

  const rawName = `beats-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.f32`;
  const rawPath = join(workDir, rawName);
  try {
    const r = await spawn(
      [bin, "-hide_banner", "-nostdin", "-y", "-i", trackPath, "-ac", "1", "-ar", "22050", "-f", "f32le", rawName],
      workDir,
      signal,
      undefined,
      120_000,
    );
    if (r.code !== 0 || !existsSync(rawPath)) {
      throw new ToolDenied(`ffmpeg could not decode "${safeName}": ${r.stderr.slice(-300)}`);
    }
    const buf = readFileSync(rawPath);
    const alignedLen = buf.byteLength - (buf.byteLength % 4);
    const pcm = new Float32Array(buf.buffer, buf.byteOffset, alignedLen / 4);
    const duration = Number((pcm.length / 22050).toFixed(3));
    const analysis = detectBeats(pcm, 22050);

    idx.music_beats ??= {};
    idx.music_beats[key] = { ...analysis, duration };
    writeIndex(clipDir, idx);
    return { ...analysis, duration, cached: false };
  } finally {
    rmSync(rawPath, { force: true });
  }
}

export const musicBeatsTool = defineTool({
  name: "music_beats",
  description:
    "Detect BPM, beat timestamps, and 4/4 bar downbeats for a music track in the agent's clip_folder/music/ subfolder (cached by file size + mtime).",
  category: "think",
  input: z.object({
    track: z.string().min(1).max(200).describe("File name from clip_folder/music/ (as listed by clip_library)"),
  }),
  risk: () => "safe",
  describe: (i) => `detect beats in music/${i.track}`,
  async execute(i, ctx) {
    const dir = clipFolder(ctx);
    const res = await analyzeTrackBeats(dir, i.track, mediaDir(ctx), ctx.signal);
    await ctx
      .videoData("beats", {
        track: i.track,
        beats: { bpm: res.bpm, beats: res.beats, bars: res.bars, confidence: res.confidence },
      })
      .catch(() => {});
    const lowConfidence = res.confidence < 0.25;
    return {
      ok: true,
      summary: `${i.track}: ${res.bpm} BPM, ${res.beats.length} beats, ${res.bars.length} bars (${res.duration}s)${res.cached ? " [cached]" : ""}${lowConfidence ? " [low confidence]" : ""}`,
      output: {
        track: i.track,
        bpm: res.bpm,
        beat_count: res.beats.length,
        beats: res.beats.slice(0, 64),
        bars: res.bars,
        duration: res.duration,
        confidence: res.confidence,
        cached: res.cached,
        ...(lowConfidence ? { warning: "Beat confidence is low; consider cut_every=2 or 4, or a track with a clearer pulse." } : {}),
      },
    };
  },
});

export const montagePlanTool = defineTool({
  name: "montage_plan",
  description:
    "Build a beat-synced EditPlan (without rendering) from a music track's detected beats/bars and attached video clips. " +
    "Inspect the returned edit_plan and pass it to video_edit.",
  category: "think",
  input: z.object({
    track: z.string().min(1).max(200).describe("Music track file name in clip_folder/music/"),
    clips: z.array(z.number().int().min(1).max(20)).min(1).max(20).optional().describe("1-based video attachment indices (defaults to all attached videos)"),
    target_seconds: z.number().min(3).max(180).default(20).describe("Target montage length in seconds (rounded to a whole bar)"),
    cut_every: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1).describe("Cut every 1, 2, or 4 beats"),
    lines: z.array(z.string().min(1).max(200)).max(20).default([]).describe("Short caption lines (5-9 words each), shown one per bar"),
    hook: z.string().max(120).optional().describe("Opening hook text shown from 0 to the first bar"),
    loop: z.boolean().default(true).describe("Seamless loop back to clip 1's opening frames"),
    volume_db: z.number().min(-40).max(6).default(-6).describe("Music volume in dB"),
    mute: z.boolean().optional().describe("Mute original clip audio (defaults to true when music is set)"),
    preset: VideoPresetId.default("tiktok_fhd"),
    name: z.string().trim().min(1).max(60).default("beat-montage"),
  }),
  risk: () => "safe",
  describe: (i) => `plan beat-sync montage with music/${i.track} (${i.target_seconds}s)`,
  async execute(i, ctx) {
    const dir = clipFolder(ctx);
    const beatData = await analyzeTrackBeats(dir, i.track, mediaDir(ctx), ctx.signal);
    if (!beatData.beats.length) {
      throw new ToolDenied(`no beats detected in "${i.track}" (silence or no clear pulse)`);
    }

    const indices =
      i.clips ??
      ctx.attachments
        .map((a, idx) => (a.content_type.startsWith("video/") ? idx + 1 : 0))
        .filter((n) => n > 0);
    if (!indices.length) {
      throw new ToolDenied("no video attachments found: call clip_library(action: 'pick', ...) or attach videos first");
    }

    const probedClips: { video: number; duration: number }[] = [];
    for (const v of indices) {
      const { file } = await attachmentFile(ctx, v);
      const pr = await probe(ctx, file);
      if (pr.duration <= 0) throw new ToolDenied(`video ${v} has zero duration`);
      probedClips.push({ video: v, duration: pr.duration });
    }

    const planned = planMontage({
      beats: beatData.beats,
      bars: beatData.bars,
      clips: probedClips,
      target_seconds: i.target_seconds,
      cut_every: i.cut_every,
      lines: i.lines,
      hook: i.hook,
      loop: i.loop,
      track: i.track,
      volume_db: i.volume_db,
      mute: i.mute,
      preset: i.preset,
      name: i.name,
    });

    return {
      ok: true,
      summary: `Planned beat-sync montage: ${planned.plan.clips.length} clips, ${planned.total_seconds}s @ ${beatData.bpm} BPM (cut_every=${planned.cut_every_used})`,
      output: {
        bpm: beatData.bpm,
        cut_every_used: planned.cut_every_used,
        auto_adjusted_cut_every: planned.auto_adjusted_cut_every,
        total_seconds: planned.total_seconds,
        notes: planned.notes,
        edit_plan: planned.plan,
      },
    };
  },
});
