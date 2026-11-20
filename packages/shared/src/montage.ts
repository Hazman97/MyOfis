import { EditPlan, VIDEO_PRESETS, type Clip, type VideoPresetId } from "./video.ts";

export interface MontageClipSource {
  video: number;
  duration: number;
  description?: string;
}

export interface PlanMontageInput {
  beats: number[];
  bars: number[];
  clips: MontageClipSource[];
  target_seconds: number;
  cut_every?: 1 | 2 | 4;
  lines: string[];
  hook?: string;
  loop?: boolean;
  track?: string;
  volume_db?: number;
  mute?: boolean;
  preset?: VideoPresetId;
  name?: string;
}

export interface PlanMontageResult {
  plan: EditPlan;
  cut_every_used: 1 | 2 | 4;
  auto_adjusted_cut_every: boolean;
  total_seconds: number;
  notes: string[];
}

const MAX_CLIPS = 80;
const MAX_CAPTIONS = 40;

/** Split a caption line into chunks of 5-9 words (or fewer if the whole line is short). Pure. */
export function splitLineWords(line: string, maxWords = 9, targetWords = 7): string[] {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (words.length <= maxWords) return [words.join(" ")];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += targetWords) {
    let end = Math.min(words.length, i + targetWords);
    // Avoid leaving a tiny 1-2 word orphan at the end when previous chunk can absorb or balance
    if (words.length - end > 0 && words.length - end < 4 && end - i >= 5) {
      end = Math.ceil((i + words.length) / 2);
      chunks.push(words.slice(i, end).join(" "));
      chunks.push(words.slice(end).join(" "));
      break;
    }
    chunks.push(words.slice(i, end).join(" "));
  }
  return chunks;
}

function buildCutBoundaries(beats: number[], bars: number[], targetSeconds: number, cutEvery: 1 | 2 | 4): number[] {
  const sortedBeats = [...beats].filter((b) => Number.isFinite(b) && b > 0.05).sort((a, b) => a - b);
  if (!sortedBeats.length) return [0, Math.max(1, targetSeconds)];

  // Round total length to a whole bar closest to targetSeconds
  const validBars = [...bars].filter((b) => Number.isFinite(b) && b >= 1).sort((a, b) => a - b);
  let endLimit = targetSeconds;
  if (validBars.length) {
    let bestBar = validBars[0]!;
    let bestDiff = Math.abs(bestBar - targetSeconds);
    for (const b of validBars) {
      const diff = Math.abs(b - targetSeconds);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestBar = b;
      }
    }
    endLimit = bestBar;
  }

  const cuts: number[] = [0];
  for (let i = cutEvery - 1; i < sortedBeats.length; i += cutEvery) {
    const t = Number(sortedBeats[i]!.toFixed(3));
    if (t > cuts.at(-1)! + 0.12 && t <= endLimit + 0.08) {
      cuts.push(t);
    }
  }
  if (cuts.length < 2) {
    cuts.push(Number(Math.max(1, endLimit).toFixed(3)));
  }
  return cuts;
}

/**
 * Pure beat-sync montage planner.
 * Cuts land on beats (or every 2/4 beats), captions change on 4/4 bars (5-9 words per line),
 * never repeats the same clip back-to-back, keeps <= 80 clips, and supports seamless loop.
 */
export function planMontage(input: PlanMontageInput): PlanMontageResult {
  if (!input.clips.length) throw new Error("at least one clip is required");
  const presetId = input.preset ?? "tiktok_fhd";
  const preset = VIDEO_PRESETS[presetId];
  const target = Math.min(preset.max_seconds, Math.max(2, input.target_seconds));
  const requestedCut = input.cut_every ?? 1;
  const loop = input.loop ?? false;
  const notes: string[] = [];

  let cutEvery: 1 | 2 | 4 = requestedCut;
  let cuts = buildCutBoundaries(input.beats, input.bars, target, cutEvery);
  let autoAdjusted = false;

  // Raise cut_every automatically if segment count exceeds EditPlan's 80-clip limit
  const ladder: (1 | 2 | 4)[] = requestedCut === 1 ? [1, 2, 4] : requestedCut === 2 ? [2, 4] : [4];
  for (const cand of ladder) {
    const c = buildCutBoundaries(input.beats, input.bars, target, cand);
    cutEvery = cand;
    cuts = c;
    if (c.length - 1 <= MAX_CLIPS) break;
  }
  if (cutEvery !== requestedCut) {
    autoAdjusted = true;
    notes.push(`Raised cut_every from ${requestedCut} to ${cutEvery} to stay within ${MAX_CLIPS} clips`);
  }
  if (cuts.length - 1 > MAX_CLIPS) {
    cuts = cuts.slice(0, MAX_CLIPS + 1);
    notes.push(`Trimmed montage to ${MAX_CLIPS} clips (maximum per EditPlan)`);
  }

  const segCount = cuts.length - 1;
  const clipCount = input.clips.length;
  const occurrences = new Map<number, number>();
  const pickedIndices: number[] = [];

  for (let i = 0; i < segCount; i++) {
    let idx = i % clipCount;
    // If loop is true, last segment reuses clip 0's opening frames; ensure penultimate isn't clip 0 when possible
    if (loop && i === segCount - 1 && clipCount > 1) {
      idx = 0;
    } else if (loop && i === segCount - 2 && clipCount > 1 && idx === 0) {
      idx = 1;
    }
    if (i > 0 && idx === pickedIndices[i - 1] && clipCount > 1) {
      idx = (idx + 1) % clipCount;
    }
    pickedIndices.push(idx);
  }

  const clips: Clip[] = [];
  for (let i = 0; i < segCount; i++) {
    const segDur = Number((cuts[i + 1]! - cuts[i]!).toFixed(3));
    const srcIdx = pickedIndices[i]!;
    const src = input.clips[srcIdx]!;
    const occ = occurrences.get(srcIdx) ?? 0;
    occurrences.set(srcIdx, occ + 1);

    const usableDur = Math.min(segDur, Math.max(0.2, src.duration));
    const maxStart = Math.max(0, src.duration - usableDur);
    // Loop closing segment uses clip 0's opening frames [0, usableDur]
    const start =
      loop && i === segCount - 1
        ? 0
        : maxStart > 0.05
          ? Number((((occ * 0.37) % 1) * maxStart).toFixed(3))
          : 0;
    const end = Number(Math.min(src.duration, start + usableDur).toFixed(3));

    clips.push({
      video: src.video,
      start,
      end,
      speed: 1,
      zoom: i % 2 === 0 ? "in" : "out",
    });
  }

  // Captions: hook from 0 to first bar, then lines[i] on each subsequent bar (5-9 words per line)
  const totalSeconds = Number((cuts.at(-1)! - cuts[0]!).toFixed(3));
  const sortedBars = [...input.bars].filter((b) => b > 0.15 && b <= totalSeconds + 0.05).sort((a, b) => a - b);
  const firstBar = sortedBars[0] ?? Math.min(totalSeconds, cuts[Math.min(4, cuts.length - 1)]!);

  const captions: EditPlan["captions"] = [];
  if (input.hook?.trim()) {
    captions.push({
      text: input.hook.trim(),
      start: 0,
      end: Number(Math.max(0.5, firstBar).toFixed(3)),
      position: "middle",
      animation: "pop",
    });
  }

  const barEdges = [
    ...(input.hook?.trim() ? [firstBar] : [0, ...sortedBars.filter((b) => b > 0.15)]),
    ...(input.hook?.trim() ? sortedBars.filter((b) => b > firstBar + 0.15) : []),
    totalSeconds,
  ];
  // Dedupe ascending bar edges
  const cleanBarEdges: number[] = [];
  for (const e of barEdges.sort((a, b) => a - b)) {
    if (!cleanBarEdges.length || e - cleanBarEdges.at(-1)! > 0.25) cleanBarEdges.push(Number(e.toFixed(3)));
  }

  for (let i = 0; i < input.lines.length && i < cleanBarEdges.length - 1; i++) {
    const bStart = cleanBarEdges[i]!;
    const bEnd = cleanBarEdges[i + 1]!;
    const subLines = splitLineWords(input.lines[i]!);
    if (!subLines.length) continue;
    const step = (bEnd - bStart) / subLines.length;
    for (let j = 0; j < subLines.length && captions.length < MAX_CAPTIONS; j++) {
      captions.push({
        text: subLines[j]!,
        start: Number((bStart + j * step).toFixed(3)),
        end: Number((bStart + (j + 1) * step).toFixed(3)),
        position: "middle",
        animation: "pop",
      });
    }
  }

  const plan = EditPlan.parse({
    clips,
    preset: presetId,
    fit: "crop",
    fps: 30,
    captions,
    transition: { type: "none" },
    mute: input.mute ?? !!input.track,
    music: input.track ? { track: input.track, volume_db: input.volume_db ?? -6 } : null,
    normalize_audio: true,
    name: input.name || "beat-montage",
  });

  return {
    plan,
    cut_every_used: cutEvery,
    auto_adjusted_cut_every: autoAdjusted,
    total_seconds: totalSeconds,
    notes,
  };
}
