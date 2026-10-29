import { z } from "zod";
import type { ShotInfo, VideoPreset } from "./video.ts";
import { emojiFontName, wrapAssEmoji } from "./video.ts";
import type { Transcript, TranscriptWord } from "./transcript.ts";

/**
 * Clip Factory Pure Schemas & Domain Logic (Task 028).
 * Pure functions for sentence snapping, candidate windowing, audio peak detection,
 * virality scoring formula, model response parsing, animated captions, and reframe filters.
 */

// ---------------------------------------------------------------- Schemas & Types

export const ViralitySubscoresSchema = z.object({
  hook: z.number().min(0).max(100).describe("First 3 seconds hook strength & curiosity (30%)"),
  value: z.number().min(0).max(100).describe("Insight, utility or takeaway (25%)"),
  emotion: z.number().min(0).max(100).describe("Energy, humor, or emotional resonance (20%)"),
  flow: z.number().min(0).max(100).describe("Pacing, coherence, and logical flow (15%)"),
  trend: z.number().min(0).max(100).describe("Relevance to prompt or current short-form trends (10%)"),
});
export type ViralitySubscores = z.infer<typeof ViralitySubscoresSchema>;

export const ViralityReasonsSchema = z.object({
  hook: z.string(),
  value: z.string(),
  emotion: z.string(),
  flow: z.string(),
  trend: z.string(),
});
export type ViralityReasons = z.infer<typeof ViralityReasonsSchema>;

export const ReframeModeSchema = z.enum(["blur_fit", "crop_center", "crop_speaker", "split_screen"]);
export type ReframeMode = z.infer<typeof ReframeModeSchema>;
export const REFRAME_MODES = ["blur_fit", "crop_center", "crop_speaker", "split_screen"] as const;

export const CaptionPresetSchema = z.enum(["pop", "neon", "bold_box", "karaoke", "minimal"]);
export type CaptionPreset = z.infer<typeof CaptionPresetSchema>;
export const CAPTION_PRESETS = ["pop", "neon", "bold_box", "karaoke", "minimal"] as const;

export const ClipCandidateSchema = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  duration: z.number(),
  score: z.number().int().min(0).max(99),
  subscores: ViralitySubscoresSchema,
  reasons: ViralityReasonsSchema,
  summary_reason: z.string(),
  transcript: z.string(),
  headline: z.string(),
  hooks: z.array(z.string()).min(1).max(5),
  chosen_hook: z.string(),
  caption_post: z.string(),
  source: z.enum(["speech", "visual_shots", "audio_peaks"]),
  audio_peak_at: z.number().optional(),
});
export type ClipCandidate = z.infer<typeof ClipCandidateSchema>;

export interface Sentence {
  text: string;
  start: number;
  end: number;
  words: Transcript["words"];
}

export interface CandidateWindow {
  id: string;
  start: number;
  end: number;
  duration: number;
  transcript: string;
  words: Transcript["words"];
  source: "speech" | "visual_shots" | "audio_peaks";
  audio_peak_at?: number;
}

export interface BrandKit {
  logo_url?: string;
  logo_position?: "top_right" | "top_left" | "bottom_right" | "bottom_left";
  logo_opacity?: number;
  font_family?: string;
  accent_color?: string;
  caption_preset?: CaptionPreset;
  outro_cta?: string;
}

// ---------------------------------------------------------------- 1. Sentence Extraction & Snapping

const SENTENCE_END_RE = /[.!?]+$/;
const NUMBER_DOT_RE = /\d+\.\d+$/;

/** Break whisper word stream into grammatical sentences using punctuation and speech pauses. Pure. */
export function extractSentences(transcript: Transcript): Sentence[] {
  const sentences: Sentence[] = [];
  const words = transcript.words || [];
  if (!words.length) return sentences;

  let currentWords: Transcript["words"] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    currentWords.push(w);
    const nextW = words[i + 1];

    const hasTerminator = SENTENCE_END_RE.test(w.w) && !NUMBER_DOT_RE.test(w.w);
    const pauseToNext = nextW ? nextW.s - w.e : 999;
    const isLongPause = pauseToNext >= 0.8;
    const isMaxWords = currentWords.length >= 35;

    if (hasTerminator || isLongPause || isMaxWords || !nextW) {
      const text = currentWords.map((cw: TranscriptWord) => cw.w).join(" ").trim();
      if (text) {
        sentences.push({
          text,
          start: currentWords[0]!.s,
          end: currentWords.at(-1)!.e,
          words: currentWords,
        });
      }
      currentWords = [];
    }
  }

  return sentences;
}

/** Snap arbitrary start/end timestamps to strictly whole sentence boundaries. Pure. */
export function snapToSentenceBoundaries(
  sentences: Sentence[],
  rawStart: number,
  rawEnd: number,
  minDuration = 15,
  maxDuration = 90,
): { start: number; end: number; sentences: Sentence[] } {
  if (!sentences.length) {
    const s = Math.max(0, rawStart);
    const e = Math.max(s + minDuration, rawEnd);
    return { start: s, end: e, sentences: [] };
  }

  // Find first sentence whose center or end is >= rawStart
  let startIdx = sentences.findIndex((s) => s.end >= rawStart);
  if (startIdx === -1) startIdx = 0;

  // Find last sentence whose start is <= rawEnd
  let endIdx = sentences.findIndex((s) => s.start > rawEnd);
  if (endIdx === -1) endIdx = sentences.length - 1;
  else endIdx = Math.max(startIdx, endIdx - 1);

  let snappedStart = sentences[startIdx]!.start;
  let snappedEnd = sentences[endIdx]!.end;
  let dur = snappedEnd - snappedStart;

  // If too short, expand forward if possible, else backward
  while (dur < minDuration && (endIdx < sentences.length - 1 || startIdx > 0)) {
    if (endIdx < sentences.length - 1) {
      endIdx++;
      snappedEnd = sentences[endIdx]!.end;
    } else if (startIdx > 0) {
      startIdx--;
      snappedStart = sentences[startIdx]!.start;
    }
    dur = snappedEnd - snappedStart;
  }

  // If too long, shrink from end
  while (dur > maxDuration && endIdx > startIdx) {
    endIdx--;
    snappedEnd = sentences[endIdx]!.end;
    dur = snappedEnd - snappedStart;
  }

  const matched = sentences.slice(startIdx, endIdx + 1);
  return {
    start: Number(snappedStart.toFixed(2)),
    end: Number(snappedEnd.toFixed(2)),
    sentences: matched,
  };
}

// ---------------------------------------------------------------- 2. Audio Energy Peak Parsing

/** Parse ffmpeg `ebur128` log to find momentary loudness peaks (speech energy/laughter). Pure. */
export function parseAudioEnergyPeaks(eburLog: string, thresholdLufs = -20): number[] {
  const peaks: number[] = [];
  // Line format e.g.: [Parsed_ebur128_0 @ 0000...] t: 12.300000 TARGET:-23 LUFS M: -16.4 S: -19.2 ...
  const re = /t:\s*([\d.]+)\s+.*?M:\s*(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(eburLog)) !== null) {
    const t = Number(m[1]);
    const lufs = Number(m[2]);
    if (lufs >= thresholdLufs && Number.isFinite(t)) {
      // De-duplicate peaks within 4 seconds of each other
      const prev = peaks.at(-1);
      if (prev === undefined || t - prev >= 4.0) {
        peaks.push(Number(t.toFixed(2)));
      }
    }
  }
  return peaks;
}

// ---------------------------------------------------------------- 3. Candidate Window Generation & De-duplication

/** Generate candidate windows from transcript sentences, audio peaks, or visual shots. Pure. */
export function findCandidateWindows(opts: {
  transcript?: Transcript | null;
  shots?: ShotInfo[] | null;
  duration: number;
  minDuration?: number;
  maxDuration?: number;
  audioPeaks?: number[];
  prompt?: string;
}): CandidateWindow[] {
  const minDur = opts.minDuration ?? 15;
  const maxDur = opts.maxDuration ?? 90;
  const windows: CandidateWindow[] = [];

  const sentences = opts.transcript ? extractSentences(opts.transcript) : [];

  if (sentences.length > 0) {
    // 1. Windows based on sentences & prompt/topic matches
    const promptKeywords = (opts.prompt ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter((k) => k.length >= 3);

    // Anchor windows: starting at sentence i, gather sentences until reaching target duration (30-60s)
    let idx = 0;
    let windowCount = 0;
    while (idx < sentences.length && windowCount < 12) {
      let curWords: Transcript["words"] = [];
      const startSentence = sentences[idx]!;
      const winStart = startSentence.start;
      let winEnd = startSentence.end;
      let endIdx = idx;

      while (endIdx < sentences.length) {
        const s = sentences[endIdx]!;
        if (s.end - winStart > maxDur && curWords.length > 0) break;
        curWords.push(...s.words);
        winEnd = s.end;
        if (winEnd - winStart >= Math.min(35, minDur)) {
          endIdx++;
          break;
        }
        endIdx++;
      }

      const dur = winEnd - winStart;
      if (dur >= minDur && dur <= maxDur) {
        const text = curWords.map((w: TranscriptWord) => w.w).join(" ").trim();
        windows.push({
          id: `win_s_${windows.length + 1}`,
          start: Number(winStart.toFixed(2)),
          end: Number(winEnd.toFixed(2)),
          duration: Number(dur.toFixed(2)),
          transcript: text,
          words: curWords,
          source: "speech",
        });
        windowCount++;
      }

      // Step forward by 2-3 sentences to allow overlapping candidate views
      idx = Math.max(idx + 1, Math.min(endIdx, idx + 3));
    }

    // 2. Extra windows anchored at audio energy peaks
    for (const peak of opts.audioPeaks || []) {
      const snapped = snapToSentenceBoundaries(sentences, Math.max(0, peak - 8), Math.min(opts.duration, peak + 22), minDur, maxDur);
      if (snapped.sentences.length > 0) {
        const dur = snapped.end - snapped.start;
        const allWords = snapped.sentences.flatMap((s) => s.words);
        windows.push({
          id: `win_peak_${windows.length + 1}`,
          start: snapped.start,
          end: snapped.end,
          duration: dur,
          transcript: snapped.sentences.map((s) => s.text).join(" "),
          words: allWords,
          source: "audio_peaks",
          audio_peak_at: peak,
        });
      }
    }
  } else if (opts.shots && opts.shots.length > 0) {
    // Visual-only video without transcript: group shots into coherent scenes
    const shots = opts.shots;
    let curStart = shots[0]!.start;
    let curEnd = shots[0]!.end;
    let shotIdx = 0;

    for (let i = 0; i < shots.length; i++) {
      const sh = shots[i]!;
      curEnd = sh.end;
      const dur = curEnd - curStart;
      if (dur >= minDur && dur <= maxDur) {
        windows.push({
          id: `win_v_${windows.length + 1}`,
          start: Number(curStart.toFixed(2)),
          end: Number(curEnd.toFixed(2)),
          duration: Number(dur.toFixed(2)),
          transcript: shots
            .slice(shotIdx, i + 1)
            .map((s) => s.description || `Shot ${s.index}`)
            .join(". "),
          words: [],
          source: "visual_shots",
        });
        // advance
        shotIdx = i + 1;
        if (shotIdx < shots.length) {
          curStart = shots[shotIdx]!.start;
        }
      }
    }
  } else {
    // Total fallback for un-indexed empty audio: 1 single window of minDuration
    const dur = Math.min(opts.duration, Math.max(minDur, 30));
    windows.push({
      id: "win_fallback_1",
      start: 0,
      end: dur,
      duration: dur,
      transcript: "",
      words: [],
      source: "speech",
    });
  }

  return mergeOverlappingWindows(windows);
}

/** Merge heavily overlapping candidate windows (> 35% overlap) to avoid duplicate cuts. Pure. */
export function mergeOverlappingWindows(windows: CandidateWindow[], maxOverlapPct = 0.35): CandidateWindow[] {
  if (windows.length <= 1) return windows;

  const sorted = [...windows].sort((a, b) => a.start - b.start || b.duration - a.duration);
  const result: CandidateWindow[] = [];

  for (const win of sorted) {
    const existing = result.find((r) => {
      const overlapStart = Math.max(r.start, win.start);
      const overlapEnd = Math.min(r.end, win.end);
      const overlapDur = Math.max(0, overlapEnd - overlapStart);
      const minDur = Math.min(r.duration, win.duration);
      return minDur > 0 && overlapDur / minDur >= maxOverlapPct;
    });

    if (!existing) {
      result.push(win);
    } else {
      // If the new one has audio peak info and existing didn't, attach it
      if (win.audio_peak_at && !existing.audio_peak_at) {
        existing.audio_peak_at = win.audio_peak_at;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------- 4. Virality Scoring & Model Prompt

export const SCORING_PROMPT_VERSION = "v1.0";

/**
 * Calculate overall virality score 0..99 using the OpusClip formula. Pure.
 * Weights: Hook 30%, Value 25%, Emotion 20%, Flow 15%, Trend 10%.
 */
export function calculateViralityScore(subscores: ViralitySubscores): number {
  const raw =
    subscores.hook * 0.3 +
    subscores.value * 0.25 +
    subscores.emotion * 0.2 +
    subscores.flow * 0.15 +
    subscores.trend * 0.1;
  const rounded = Math.round(raw);
  return Math.max(0, Math.min(99, rounded));
}

/** Build the standardized versioned scoring prompt sent to the LLM. Pure. */
export function buildScoringPrompt(opts: {
  transcript: string;
  duration: number;
  userPrompt?: string;
  hasAudioPeak?: boolean;
}): string {
  return [
    `You are the Clip Virality Evaluator (Prompt ${SCORING_PROMPT_VERSION}).`,
    `Analyze this video excerpt for short-form video virality (TikTok / Reels / Shorts):`,
    `Clip Duration: ${opts.duration} seconds`,
    opts.userPrompt ? `Topic/Goal Focus: "${opts.userPrompt}"` : `Topic/Goal Focus: General viral moments`,
    opts.hasAudioPeak ? `Audio Signal: High audio energy peak detected in this segment.` : null,
    `Transcript:\n"""\n${opts.transcript || "(No speech detected / visual action scene)"}\n"""`,
    ``,
    `Evaluate each dimension on a 0-100 scale with a 1-sentence reason:`,
    `- Hook: <score 0-100> | reason: <why the first 3 seconds grab curiosity>`,
    `- Value: <score 0-100> | reason: <practical takeaway, insight, or clear point>`,
    `- Emotion: <score 0-100> | reason: <humor, shock, warmth, or excitement level>`,
    `- Flow: <score 0-100> | reason: <coherence, pacing, clear beginning and punchy end>`,
    `- Trend: <score 0-100> | reason: <fit for modern short-form audience / prompt relevance>`,
    ``,
    `Provide 3 hook overlay suggestions (short, punchy, under 6 words):`,
    `1. <hook 1>`,
    `2. <hook 2>`,
    `3. <hook 3>`,
    `Title: <catchy video title under 10 words>`,
    `Summary: <one sentence summarizing why this clip works>`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** Parse structured model response from the scoring prompt. Pure. */
export function parseModelScoring(
  rawText: string,
  fallbackContext: { transcript: string; duration: number; userPrompt?: string },
): {
  subscores: ViralitySubscores;
  reasons: ViralityReasons;
  summary_reason: string;
  hooks: string[];
  headline: string;
} {
  const parseLine = (name: string, defaultScore: number): { score: number; reason: string } => {
    const re = new RegExp(`-\\s*${name}\\s*:\\s*(\\d+)(?:\\s*\\/\\s*100)?\\s*(?:\\|\\s*(?:reason\\s*:\\s*)?(.*))?`, "i");
    const m = rawText.match(re);
    if (!m) return { score: defaultScore, reason: `AI estimate based on ${name.toLowerCase()} analysis` };
    const score = Math.max(0, Math.min(100, Number(m[1])));
    const reason = (m[2] || "").trim() || `Solid ${name.toLowerCase()}`;
    return { score, reason };
  };

  const hook = parseLine("Hook", 65);
  const value = parseLine("Value", 70);
  const emotion = parseLine("Emotion", 60);
  const flow = parseLine("Flow", 75);
  const trend = parseLine("Trend", 65);

  const subscores: ViralitySubscores = {
    hook: hook.score,
    value: value.score,
    emotion: emotion.score,
    flow: flow.score,
    trend: trend.score,
  };

  const reasons: ViralityReasons = {
    hook: hook.reason,
    value: value.reason,
    emotion: emotion.reason,
    flow: flow.reason,
    trend: trend.reason,
  };

  // Extract hooks
  const hooks: string[] = [];
  const hookMatches = [...rawText.matchAll(/^\s*\d+\.\s*(.+)$/gm)];
  for (const hm of hookMatches) {
    const h = (hm[1] || "").replace(/^["']|["']$/g, "").trim();
    if (h && hooks.length < 3) hooks.push(h);
  }

  // Extract title
  const titleMatch = rawText.match(/Title\s*:\s*(.+)$/im);
  let headline = titleMatch ? titleMatch[1]!.replace(/^["']|["']$/g, "").trim() : "";
  if (!headline) {
    headline = fallbackContext.transcript.slice(0, 45).trim() || "Sorotan Terbaik";
  }

  if (hooks.length === 0) {
    hooks.push(`🔥 ${headline}`);
    hooks.push(`Tengok Sampai Habis!`);
    hooks.push(`Rahsia Yang Ramai Terlepas`);
  }

  // Summary reason
  const summaryMatch = rawText.match(/Summary\s*:\s*(.+)$/im);
  const summary_reason = summaryMatch
    ? summaryMatch[1]!.trim()
    : `${reasons.hook}. ${reasons.value}`;

  return {
    subscores,
    reasons,
    summary_reason,
    hooks,
    headline,
  };
}

// ---------------------------------------------------------------- 5. Curated Vector Emoji Map & Animated Captions

export const CURATED_EMOJI_MAP: Record<string, string> = {
  // Financial & Commerce
  duit: "💰",
  wang: "💵",
  modal: "💸",
  untung: "📈",
  rugi: "📉",
  bayar: "💳",
  beli: "🛒",
  kos: "🏷️",
  harga: "🏷️",
  jimat: "🪙",
  kaya: "💎",
  bisnes: "💼",
  perniagaan: "🏢",
  money: "💰",
  cost: "🏷️",
  profit: "📈",
  rich: "💎",

  // Energy & Reaction
  api: "🔥",
  padu: "🔥",
  gempak: "🔥",
  letup: "💥",
  power: "⚡",
  hebat: "✨",
  mantap: "💪",
  senyum: "😊",
  ketawa: "😂",
  lawak: "🤣",
  kelakar: "😆",
  terkejut: "😱",
  mengejutkan: "🤯",
  bahaya: "⚠️",
  fire: "🔥",
  shock: "😱",
  mindblown: "🤯",

  // Action & Growth
  roket: "🚀",
  laju: "⚡",
  pantas: "⚡",
  cepat: "⏩",
  kandang: "🏠",
  lembu: "🐄",
  kambing: "🐐",
  rumah: "🏡",
  tanah: "🌱",
  kebun: "🌾",
  pertanian: "🚜",
  makanan: "🍲",
  makan: "🍽️",

  // Advice & Communication
  rahsia: "💡",
  tips: "💡",
  ilmu: "📚",
  petua: "✨",
  cara: "🔑",
  kunci: "🔑",
  soalan: "❓",
  tanya: "❓",
  jawapan: "🎯",
  target: "🎯",
  fokus: "🎯",
  berjaya: "🏆",
  juara: "🏆",
  rahmat: "🤲",
  doa: "🤲",
};

/** Match keyword to curated vector outline emoji. Pure. */
export function lookupWordEmoji(word: string): string | null {
  const clean = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return CURATED_EMOJI_MAP[clean] ?? null;
}

/**
 * Generate animated caption entries suitable for TikTok/Reels with word-by-word pop and vector emoji.
 * Returns ASS-ready caption lines. Pure.
 */
export function generateAnimatedCaptions(
  words: Transcript["words"],
  clipStart: number,
  clipEnd: number,
  preset: CaptionPreset = "pop",
  emojiFont = emojiFontName(),
): { start: number; end: number; text: string; animation: "pop" | "fade" | "none" }[] {
  const inRange = words.filter((w: TranscriptWord) => w.s >= clipStart - 0.2 && w.e <= clipEnd + 0.2);
  if (!inRange.length) return [];

  const chunks: Transcript["words"][] = [];
  let chunk: Transcript["words"] = [];

  for (let i = 0; i < inRange.length; i++) {
    const w = inRange[i]!;
    chunk.push(w);
    // Split into 3-4 words or on punctuation
    if (chunk.length >= 4 || /[.!?]$/.test(w.w) || i === inRange.length - 1) {
      chunks.push(chunk);
      chunk = [];
    }
  }

  const results: { start: number; end: number; text: string; animation: "pop" | "fade" | "none" }[] = [];

  for (const c of chunks) {
    if (!c.length) continue;
    const cStart = Math.max(0, Number((c[0]!.s - clipStart).toFixed(2)));
    const cEnd = Math.max(cStart + 0.3, Number((c.at(-1)!.e - clipStart).toFixed(2)));

    // Find emoji for keywords in this chunk
    let emoji = "";
    for (const w of c) {
      const found = lookupWordEmoji(w.w);
      if (found) {
        emoji = ` ${found}`;
        break;
      }
    }

    const rawSentence = c.map((w: TranscriptWord) => w.w).join(" ") + emoji;
    const wrappedText = wrapAssEmoji(rawSentence, emojiFont);

    results.push({
      start: cStart,
      end: cEnd,
      text: wrappedText,
      animation: preset === "pop" || preset === "neon" ? "pop" : "fade",
    });
  }

  return results;
}

// ---------------------------------------------------------------- 6. Smart Reframe Filter Construction

/** Smooth horizontal crop pan path using moving-average filter to prevent camera jitter. Pure. */
export function smoothCropPath(
  keyframes: { t: number; x: number }[],
  maxPanSpeedPxPerSec = 160,
): { t: number; x: number }[] {
  if (keyframes.length <= 1) return keyframes;

  const smoothed: { t: number; x: number }[] = [];
  for (let i = 0; i < keyframes.length; i++) {
    const prev = smoothed[i - 1] ?? keyframes[i]!;
    const cur = keyframes[i]!;
    const dt = Math.max(0.01, cur.t - prev.t);
    const maxDelta = maxPanSpeedPxPerSec * dt;
    const clampedX = Math.max(prev.x - maxDelta, Math.min(prev.x + maxDelta, cur.x));
    smoothed.push({ t: cur.t, x: Math.round(clampedX) });
  }

  return smoothed;
}

/**
 * Build ffmpeg video filter string to convert arbitrary aspect ratios into vertical 9:16 (1080x1920)
 * with blur_fit, center crop, or speaker tracking. Pure.
 */
export function buildSmartReframeFilter(opts: {
  srcWidth: number;
  srcHeight: number;
  dstWidth: number;
  dstHeight: number;
  mode: ReframeMode;
  letterboxCrop?: string | null;
  cropPath?: { t: number; x: number }[];
}): string {
  const { dstWidth: W, dstHeight: H, mode, letterboxCrop } = opts;
  const preCrop = letterboxCrop ? `crop=${letterboxCrop},` : "";

  if (mode === "crop_center") {
    // 9:16 center crop
    return `${preCrop}scale=w=${W}:h=${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  }

  if (mode === "crop_speaker" && opts.cropPath && opts.cropPath.length > 0) {
    // Keyframe based crop pan or smoothed x-offset
    const avgX = Math.round(opts.cropPath.reduce((acc, k) => acc + k.x, 0) / opts.cropPath.length);
    return `${preCrop}scale=-1:${H},crop=${W}:${H}:${avgX}:0`;
  }

  if (mode === "split_screen") {
    // Stack two 16:9 crops vertically into 9:16
    const halfH = Math.round(H / 2);
    return `${preCrop}split=2[top][bot];[top]scale=${W}:${halfH}:force_original_aspect_ratio=increase,crop=${W}:${halfH}[t];[bot]scale=${W}:${halfH}:force_original_aspect_ratio=increase,crop=${W}:${halfH}[b];[t][b]vstack`;
  }

  // Default: rock-solid text-safe blur_fit (blurred background + centered sharp foreground)
  return (
    `${preCrop}split=2[fg][bg];` +
    `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=25:25[bgblur];` +
    `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[fgfit];` +
    `[bgblur][fgfit]overlay=(W-w)/2:(H-h)/2`
  );
}
