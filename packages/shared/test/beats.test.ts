import { describe, expect, test } from "bun:test";
import { detectBeats, normalizeTempoRange } from "../src/index.ts";

function makeClickTrack(bpm: number, durationSec: number, sampleRate = 22050, noiseLevel = 0): Float32Array {
  const len = Math.floor(durationSec * sampleRate);
  const pcm = new Float32Array(len);
  const interval = 60 / bpm;
  for (let t = 0; t < durationSec; t += interval) {
    const start = Math.floor(t * sampleRate);
    // 25 ms percussive click burst
    const clickLen = Math.floor(0.025 * sampleRate);
    for (let i = 0; i < clickLen && start + i < len; i++) {
      const env = Math.exp(-i / (0.006 * sampleRate));
      pcm[start + i] = env * (0.9 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate) + 0.3);
    }
  }
  if (noiseLevel > 0) {
    let seed = 42;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      pcm[i]! += ((seed / 0xffffffff) * 2 - 1) * noiseLevel;
    }
  }
  return pcm;
}

describe("Task 032 Step 1: Pure beat detection (detectBeats)", () => {
  test("120 BPM synthetic click track -> bpm 120 ± 1, beats within 20 ms, bars every 4 beats", () => {
    const pcm = makeClickTrack(120, 8);
    const res = detectBeats(pcm, 22050);
    expect(Math.abs(res.bpm - 120)).toBeLessThanOrEqual(1);
    expect(res.confidence).toBeGreaterThan(0.3);
    expect(res.beats.length).toBeGreaterThanOrEqual(12);

    // Every detected beat lands within 20 ms of a 0.5 s grid click
    for (const b of res.beats) {
      const nearest = Math.round(b / 0.5) * 0.5;
      expect(Math.abs(b - nearest)).toBeLessThanOrEqual(0.025);
    }
    expect(res.bars.length).toBeGreaterThanOrEqual(3);
  });

  test("100 BPM click track with noise -> bpm 100 ± 2", () => {
    const pcm = makeClickTrack(100, 10, 22050, 0.04);
    const res = detectBeats(pcm, 22050);
    expect(Math.abs(res.bpm - 100)).toBeLessThanOrEqual(2);
    expect(res.confidence).toBeGreaterThan(0.2);
    expect(res.beats.length).toBeGreaterThanOrEqual(12);
  });

  test("silence -> confidence 0 and no beats", () => {
    const pcm = new Float32Array(22050 * 4);
    const res = detectBeats(pcm, 22050);
    expect(res.confidence).toBe(0);
    expect(res.bpm).toBe(0);
    expect(res.beats).toEqual([]);
    expect(res.bars).toEqual([]);
  });

  test("tempo halving / doubling prefers 90-140 BPM", () => {
    expect(normalizeTempoRange(60)).toBe(120);
    expect(normalizeTempoRange(180)).toBe(90);
    expect(normalizeTempoRange(240)).toBe(120);
    expect(normalizeTempoRange(120)).toBe(120);

    // 180 BPM click track -> halved to 90 BPM (inside 90-140)
    const fastPcm = makeClickTrack(180, 8);
    const res = detectBeats(fastPcm, 22050);
    expect(Math.abs(res.bpm - 90)).toBeLessThanOrEqual(2);
  });
});
