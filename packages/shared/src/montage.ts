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

/**
 * Split a caption line into balanced chunks of 5-9 words (or fewer if the whole line has < 5 words). Pure.
 * For any line with >= 10 words, every chunk has between 5 and 9 words.
 */
export function splitLineWords(line: string, maxWords = 9): string[] {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (words.length <= maxWords) return [words.join(" ")];
  const numChunks = Math.ceil(words.length / maxWords);
  const base = Math.floor(words.length / numChunks);
  const rem = words.length % numChunks;
  const chunks: string[] = [];
  let offset = 0;
  for (let i = 0; i < numChunks; i++) {
    const size = base + (i < rem ? 1 : 0);
    chunks.push(words.slice(offset, offset + size).join(" "));
    offset += size;
  }
  return chunks;
}

/**
 * Build cut boundaries in phase with bars (counting from the first bar index)
 * and always ending on `endLimit` (the whole bar closest to targetSeconds).
 */
function buildCutBoundaries(beats: number[], bars: number[], targetSeconds: number, cutEvery: 1 | 2 | 4): number[] {
  const sortedBeats = [...beats].filter((b) => Number.isFinite(b) && b > 0.05).sort((a, b) => a - b);
  if (!sortedBeats.length) return [0, Math.max(1, targetSeconds)];

  const validBars = [...bars].filter((b) => Number.isFinite(b) && b > 0.05).sort((a, b) => a - b);
  // End on a whole bar >= 1s closest to targetSeconds (fallback to last valid bar if all < 1s)
  const endCandidates = validBars.filter((b) => b >= 1);
  const barPool = endCandidates.length ? endCandidates : validBars;
  let endLimit = targetSeconds;
  if (barPool.length) {
    let bestBar = barPool[0]!;
    let bestDiff = Math.abs(bestBar - targetSeconds);
    for (const b of barPool) {
      const diff = Math.abs(b - targetSeconds);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestBar = b;
      }
    }
    endLimit = bestBar;
  }

  // Align cut_every phase to the index of the first bar in sortedBeats
  let firstBarIdx = 0;
  if (validBars.length) {
    const firstBar = validBars[0]!;
    let bestDist = Infinity;
    for (let i = 0; i < sortedBeats.length; i++) {
      const d = Math.abs(sortedBeats[i]! - firstBar);
      if (d < bestDist) {
        bestDist = d;
        firstBarIdx = i;
      }
    }
  }

  const cuts: number[] = [0];
  for (let i = 0; i < sortedBeats.length; i++) {
    const phase = (((i - firstBarIdx) % cutEvery) + cutEvery) % cutEvery;
    if (phase !== 0) continue;
    const t = Number(sortedBeats[i]!.toFixed(3));
    if (t > cuts.at(-1)! + 0.12 && t <= endLimit + 0.08) {
      cuts.push(t);
    }
  }

  const endRounded = Number(Math.max(1, endLimit).toFixed(3));
  const last = cuts.at(-1)!;
  if (cuts.length < 2 || endRounded - last > 0.08) {
    cuts.push(endRounded);
  } else if (Math.abs(endRounded - last) > 0.001) {
    cuts[cuts.length - 1] = endRounded;
  }
  return cuts;
}

/**
 * Emit one or more Clip entries for a single segment of exact finished duration `segDur`.
 * - If `src.duration >= segDur`: single clip at speed 1, varied start offset (or 0 when forced).
 * - Else if `src.duration >= segDur * 0.5`: single clip slowed down (`speed = src.duration / segDur >= 0.5`).
 * - Else: loop the clip (using speed >= 0.5 when helpful) so total finished duration equals `segDur`.
 */
function buildSegmentClips(
  src: MontageClipSource,
  segDur: number,
  occ: number,
  zoom: "in" | "out",
  forceStartZero: boolean,
): Clip[] {
  const dur = Math.max(0.05, src.duration);
  if (dur >= segDur - 0.001) {
    const usable = Math.min(dur, segDur);
    const maxStart = Math.max(0, dur - usable);
    const start =
      forceStartZero
        ? 0
        : maxStart > 0.05
          ? Number((((occ * 0.37) % 1) * maxStart).toFixed(3))
          : 0;
    const end = Number(Math.min(dur, start + usable).toFixed(3));
    return [{ video: src.video, start, end, speed: 1, zoom }];
  }

  // Can we cover segDur with a single slow-mo clip (speed >= 0.5)?
  const neededSpeed = dur / segDur;
  if (neededSpeed >= 0.5) {
    return [
      {
        video: src.video,
        start: 0,
        end: Number(dur.toFixed(3)),
        speed: Number(neededSpeed.toFixed(4)),
        zoom,
      },
    ];
  }

  // Otherwise loop the short clip cleanly until remaining finished duration is 0
  const out: Clip[] = [];
  let rem = segDur;
  while (rem > 0.015) {
    if (dur >= rem - 0.001) {
      out.push({
        video: src.video,
        start: 0,
        end: Number(Math.min(dur, rem).toFixed(3)),
        speed: 1,
        zoom,
      });
      rem = 0;
    } else if (dur / rem >= 0.5) {
      out.push({
        video: src.video,
        start: 0,
        end: Number(dur.toFixed(3)),
        speed: Number((dur / rem).toFixed(4)),
        zoom,
      });
      rem = 0;
    } else {
      out.push({
        video: src.video,
        start: 0,
        end: Number(dur.toFixed(3)),
        speed: 1,
        zoom,
      });
      rem = Number((rem - dur).toFixed(4));
    }
  }
  return out;
}

/**
 * Pure beat-sync montage planner.
 * Cuts land on beats (or every 2/4 beats in phase with bars), captions change on 4/4 bars (5-9 words per line),
 * never repeats the same clip back-to-back, keeps <= 80 clips, handles short clips without drifting off-beat,
 * and supports seamless loop (including with 2 clips and even segment count).
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
  const segDurs = Array.from({ length: segCount }, (_, i) => Number((cuts[i + 1]! - cuts[i]!).toFixed(3)));

  // Pick clip indices per segment:
  // 1) Decide last two segments FIRST for loop mode (last = clip 0, penultimate != clip 0)
  // 2) Skip clips shorter than segDur whenever a long-enough alternative exists (excluding prev clip)
  const pickedIndices = new Array<number>(segCount).fill(0);

  const pickBest = (
    preferred: number,
    segDur: number,
    forbidden: Set<number>,
  ): number => {
    const order = Array.from({ length: clipCount }, (_, k) => (preferred + k) % clipCount);
    // Pass 1: not forbidden AND long enough
    for (const idx of order) {
      if (!forbidden.has(idx) && input.clips[idx]!.duration >= segDur - 0.001) return idx;
    }
    // Pass 2: not forbidden (will slow-mo or loop to exact segDur)
    for (const idx of order) {
      if (!forbidden.has(idx)) return idx;
    }
    // Pass 3: long enough (only when clipCount === 1)
    for (const idx of order) {
      if (input.clips[idx]!.duration >= segDur - 0.001) return idx;
    }
    return preferred % clipCount;
  };

  if (loop && segCount >= 2 && clipCount > 1) {
    // Fix last = clip 0, penultimate != clip 0
    pickedIndices[segCount - 1] = 0;
    pickedIndices[segCount - 2] = pickBest(1, segDurs[segCount - 2]!, new Set([0]));

    if (clipCount === 2) {
      // With exactly 2 clips, alternate backwards from penultimate so there are zero back-to-back repeats
      for (let i = segCount - 3; i >= 0; i--) {
        pickedIndices[i] = pickedIndices[i + 1] === 0 ? 1 : 0;
      }
    } else {
      // Round-robin 0..segCount-3 avoiding previous AND avoiding penultimate on segCount-3
      for (let i = 0; i <= segCount - 3; i++) {
        const forbidden = new Set<number>();
        if (i > 0) forbidden.add(pickedIndices[i - 1]!);
        if (i === segCount - 3) forbidden.add(pickedIndices[segCount - 2]!);
        pickedIndices[i] = pickBest(i % clipCount, segDurs[i]!, forbidden);
      }
    }
  } else {
    for (let i = 0; i < segCount; i++) {
      const forbidden = new Set<number>();
      if (i > 0 && clipCount > 1) forbidden.add(pickedIndices[i - 1]!);
      pickedIndices[i] = pickBest(i % clipCount, segDurs[i]!, forbidden);
    }
  }

  const occurrences = new Map<number, number>();
  const clips: Clip[] = [];
  for (let i = 0; i < segCount; i++) {
    const segDur = segDurs[i]!;
    const srcIdx = pickedIndices[i]!;
    const src = input.clips[srcIdx]!;
    const occ = occurrences.get(srcIdx) ?? 0;
    occurrences.set(srcIdx, occ + 1);

    const forceStartZero = loop && i === segCount - 1;
    const segClips = buildSegmentClips(src, segDur, occ, i % 2 === 0 ? "in" : "out", forceStartZero);
    for (const sc of segClips) {
      if (clips.length < MAX_CLIPS) clips.push(sc);
    }
  }

  // Captions:
  // - With hook: hook runs 0 -> firstBar, lines[i] runs bar i -> bar i+1 starting at firstBar.
  // - Without hook: lines[0] runs bar 0 -> bar 1 (never flashing 0 -> firstBar before bar 0).
  // - Split sub-lines snap to beat boundaries inside [bStart, bEnd] instead of arbitrary fractional steps.
  const totalSeconds = Number((cuts.at(-1)! - cuts[0]!).toFixed(3));
  const sortedBeats = [...input.beats].filter((b) => Number.isFinite(b) && b > 0.05 && b <= totalSeconds + 0.05).sort((a, b) => a - b);
  const sortedBars = [...input.bars].filter((b) => Number.isFinite(b) && b > 0.15 && b <= totalSeconds + 0.05).sort((a, b) => a - b);
  const firstBar = sortedBars[0] ?? Math.min(totalSeconds, cuts[Math.min(4, cuts.length - 1)]!);

  const captions: EditPlan["captions"] = [];
  const hasHook = !!input.hook?.trim();
  if (hasHook) {
    captions.push({
      text: input.hook!.trim(),
      start: 0,
      end: Number(Math.max(0.5, firstBar).toFixed(3)),
      position: "middle",
      animation: "pop",
    });
  }

  const rawBarEdges = sortedBars.length ? [...sortedBars, totalSeconds] : [0, totalSeconds];
  const cleanBarEdges: number[] = [];
  for (const e of rawBarEdges.sort((a, b) => a - b)) {
    if (!cleanBarEdges.length || e - cleanBarEdges.at(-1)! > 0.25) cleanBarEdges.push(Number(e.toFixed(3)));
  }

  for (let i = 0; i < input.lines.length && i < cleanBarEdges.length - 1; i++) {
    const bStart = cleanBarEdges[i]!;
    const bEnd = cleanBarEdges[i + 1]!;
    const subLines = splitLineWords(input.lines[i]!);
    if (!subLines.length) continue;

    if (subLines.length === 1) {
      if (captions.length < MAX_CAPTIONS) {
        captions.push({
          text: subLines[0]!,
          start: bStart,
          end: bEnd,
          position: "middle",
          animation: "pop",
        });
      }
      continue;
    }

    // Snap sub-line boundaries to beats inside (bStart, bEnd)
    const innerBeats = sortedBeats.filter((b) => b > bStart + 0.12 && b < bEnd - 0.12);
    const grid = [bStart, ...innerBeats.map((b) => Number(b.toFixed(3))), bEnd];
    const edges: number[] = [bStart];
    for (let j = 1; j < subLines.length; j++) {
      const targetIdx = Math.min(grid.length - 2, Math.max(1, Math.round((j * (grid.length - 1)) / subLines.length)));
      const candidate = grid[targetIdx]!;
      if (candidate > edges.at(-1)! + 0.08 && candidate < bEnd - 0.08) {
        edges.push(candidate);
      } else {
        edges.push(Number((bStart + ((bEnd - bStart) * j) / subLines.length).toFixed(3)));
      }
    }
    edges.push(bEnd);

    for (let j = 0; j < subLines.length && captions.length < MAX_CAPTIONS; j++) {
      captions.push({
        text: subLines[j]!,
        start: edges[j]!,
        end: edges[j + 1]!,
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
