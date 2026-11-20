import { z } from "zod";

export const BeatAnalysisSchema = z.object({
  bpm: z.number().min(0),
  beats: z.array(z.number()),
  bars: z.array(z.number()),
  confidence: z.number().min(0).max(1),
});

export interface BeatAnalysis {
  bpm: number;
  beats: number[];
  bars: number[];
  confidence: number;
}

/** In-place radix-2 Cooley-Tukey FFT (n must be a power of 2). */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j]!;
        const uIm = im[i + j]!;
        const vRe = re[i + j + half]! * wRe - im[i + j + half]! * wIm;
        const vIm = re[i + j + half]! * wIm + im[i + j + half]! * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }
}

/**
 * Normalize raw BPM into [70, 180], preferring [90, 140] when halving/doubling lands cleanly inside it.
 * Pure helper exported for unit testing.
 */
export function normalizeTempoRange(rawBpm: number): number {
  if (!Number.isFinite(rawBpm) || rawBpm <= 0) return 0;
  let bpm = rawBpm;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  if (bpm < 90 && bpm * 2 <= 140) bpm *= 2;
  else if (bpm > 140 && bpm / 2 >= 90) bpm /= 2;
  return bpm;
}

/**
 * Pure beat detection on mono float32 PCM (default 22050 Hz).
 * 1) Spectral flux onset envelope (FFT 1024, hop 512)
 * 2) Autocorrelation tempo in 70-180 BPM (preferring 90-140)
 * 3) Ellis (2007) dynamic programming beat tracker
 * 4) 4/4 downbeat phase selection by highest mean onset strength
 */
export function detectBeats(pcm: Float32Array, sampleRate = 22050): BeatAnalysis {
  const fftSize = 1024;
  const hop = 512;
  if (pcm.length < fftSize * 2 || sampleRate <= 0) {
    return { bpm: 0, beats: [], bars: [], confidence: 0 };
  }

  // Silence check
  let sumSq = 0;
  for (let i = 0; i < pcm.length; i++) sumSq += pcm[i]! * pcm[i]!;
  const rms = Math.sqrt(sumSq / pcm.length);
  if (rms < 1e-5) {
    return { bpm: 0, beats: [], bars: [], confidence: 0 };
  }

  // Hann window
  const win = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const numFrames = Math.floor((pcm.length - fftSize) / hop) + 1;
  const onset = new Float64Array(numFrames);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const bins = fftSize / 2 + 1;
  const prevMag = new Float64Array(bins);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hop;
    for (let i = 0; i < fftSize; i++) {
      re[i] = pcm[offset + i]! * win[i]!;
      im[i] = 0;
    }
    fftInPlace(re, im);
    let flux = 0;
    for (let k = 0; k < bins; k++) {
      const mag = Math.log1p(100 * Math.hypot(re[k]!, im[k]!));
      const diff = mag - prevMag[k]!;
      if (diff > 0) flux += diff;
      prevMag[k] = mag;
    }
    onset[f] = flux;
  }

  // Local mean subtraction + normalization
  const normOnset = new Float64Array(numFrames);
  const meanWin = 8;
  let maxOnset = 0;
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, f - meanWin); j <= Math.min(numFrames - 1, f + meanWin); j++) {
      sum += onset[j]!;
      cnt++;
    }
    const v = Math.max(0, onset[f]! - sum / cnt);
    normOnset[f] = v;
    if (v > maxOnset) maxOnset = v;
  }
  if (maxOnset <= 1e-9) {
    return { bpm: 0, beats: [], bars: [], confidence: 0 };
  }
  for (let f = 0; f < numFrames; f++) normOnset[f] = normOnset[f]! / maxOnset;

  // Autocorrelation in 70..180 BPM
  const fps = sampleRate / hop;
  const minLag = Math.max(2, Math.floor((60 * fps) / 180));
  const maxLag = Math.min(numFrames - 2, Math.ceil((60 * fps) / 70));
  if (maxLag <= minLag) {
    return { bpm: 0, beats: [], bars: [], confidence: 0 };
  }

  let zeroLag = 0;
  for (let f = 0; f < numFrames; f++) zeroLag += normOnset[f]! * normOnset[f]!;
  if (zeroLag <= 1e-9) {
    return { bpm: 0, beats: [], bars: [], confidence: 0 };
  }

  const acf = new Float64Array(numFrames);
  for (let lag = minLag; lag <= Math.min(numFrames - 2, maxLag * 2 + 2); lag++) {
    let dot = 0;
    for (let f = 0; f < numFrames - lag; f++) {
      dot += normOnset[f]! * normOnset[f + lag]!;
    }
    acf[lag] = dot / zeroLag;
  }

  const sampleAcf = (exactLag: number): number => {
    const lo = Math.floor(exactLag);
    const hi = Math.ceil(exactLag);
    if (lo < 0 || hi >= acf.length) return 0;
    const frac = exactLag - lo;
    return acf[lo]! * (1 - frac) + acf[hi]! * frac;
  };

  let bestBpm = 120;
  let bestScore = -1;
  let rawBestCorr = 0;

  for (let candBpm = 70; candBpm <= 180; candBpm += 0.5) {
    const exactLag = (60 * fps) / candBpm;
    const c1 = sampleAcf(exactLag);
    const c2 = sampleAcf(exactLag * 2);
    const comb = c1 + 0.5 * c2;
    const pref = candBpm >= 90 && candBpm <= 140 ? 1.12 : 1.0;
    const weighted = comb * pref;
    if (weighted > bestScore) {
      bestScore = weighted;
      bestBpm = candBpm;
      rawBestCorr = Math.max(c1, c2);
    }
  }

  const bpm = Math.round(normalizeTempoRange(bestBpm) * 10) / 10;
  const confidence = Math.round(Math.max(0, Math.min(1, rawBestCorr * 2.5)) * 1000) / 1000;
  if (bpm <= 0 || confidence <= 0.02) {
    return { bpm: 0, beats: [], bars: [], confidence: 0 };
  }

  // Ellis (2007) dynamic programming beat tracking
  const period = (60 * fps) / bpm;
  const dp = new Float64Array(numFrames);
  const back = new Int32Array(numFrames).fill(-1);
  const alpha = 6.0;
  const minPrev = Math.max(1, Math.round(0.5 * period));
  const maxPrev = Math.max(minPrev + 1, Math.round(1.5 * period));

  for (let t = 0; t < numFrames; t++) {
    let bestVal = normOnset[t]!;
    let bestP = -1;
    const lo = Math.max(0, t - maxPrev);
    const hi = t - minPrev;
    for (let p = lo; p <= hi; p++) {
      const gap = t - p;
      const ratio = Math.log(gap / period);
      const val = dp[p]! - alpha * ratio * ratio + normOnset[t]!;
      if (val > bestVal) {
        bestVal = val;
        bestP = p;
      }
    }
    dp[t] = bestVal;
    back[t] = bestP;
  }

  // Start backtrack from peak in the final 2 beat periods
  let endFrame = numFrames - 1;
  let endBest = -Infinity;
  for (let t = Math.max(0, numFrames - Math.ceil(2 * period)); t < numFrames; t++) {
    if (dp[t]! > endBest) {
      endBest = dp[t]!;
      endFrame = t;
    }
  }

  const beatFrames: number[] = [];
  for (let cur = endFrame; cur >= 0; cur = back[cur]!) {
    beatFrames.push(cur);
    if (back[cur]! < 0) break;
  }
  beatFrames.reverse();

  const beats = beatFrames.map((f) => Number((((f + 1) * hop) / sampleRate).toFixed(4)));

  // 4/4 downbeats: pick phase 0..3 with highest mean onset strength
  let bestPhase = 0;
  let bestPhaseMean = -1;
  for (let phase = 0; phase < 4; phase++) {
    let sum = 0;
    let cnt = 0;
    for (let i = phase; i < beatFrames.length; i += 4) {
      sum += normOnset[beatFrames[i]!]!;
      cnt++;
    }
    const mean = cnt > 0 ? sum / cnt : 0;
    if (mean > bestPhaseMean) {
      bestPhaseMean = mean;
      bestPhase = phase;
    }
  }
  const bars = beats.filter((_, idx) => idx % 4 === bestPhase);

  return { bpm, beats, bars, confidence };
}
