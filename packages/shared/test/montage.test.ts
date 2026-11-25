import { describe, expect, test } from "bun:test";
import { planMontage, splitLineWords } from "../src/index.ts";

describe("Task 032 Step 3 & Review Fixes: Pure montage planner (planMontage)", () => {
  // 120 BPM beats for 24s (0.5, 1.0, ..., 24.0) and bars every 2s (2.0, 4.0, ..., 24.0)
  const beats120 = Array.from({ length: 48 }, (_, i) => (i + 1) * 0.5);
  const bars120 = Array.from({ length: 12 }, (_, i) => (i + 1) * 2.0);
  const clips = [
    { video: 1, duration: 10 },
    { video: 2, duration: 12 },
    { video: 3, duration: 8 },
  ];

  test("cuts equal beat times (±1 frame at 30fps), captions change on bars, and no clip repeats back-to-back", () => {
    const res = planMontage({
      beats: beats120,
      bars: bars120,
      clips,
      target_seconds: 12,
      cut_every: 1,
      hook: "Tengok projek baru kami sekarang!",
      lines: [
        "Langkah pertama mula dengan asas yang sangat kukuh",
        "Setiap hari kita perbaiki kualiti produk tempatan",
        "Hasil kerja keras kini nampak di depan mata",
        "Klik pautan di bio untuk tempahan awal anda",
      ],
      loop: false,
      track: "upbeat.mp3",
      volume_db: -6,
    });

    expect(res.cut_every_used).toBe(1);
    expect(res.auto_adjusted_cut_every).toBe(false);
    expect(res.plan.transition).toEqual({ type: "none", seconds: 0.5 });
    expect(res.plan.music).toEqual({ track: "upbeat.mp3", volume_db: -6 });

    // Cumulative cut times land on beats120 (± 1 frame at 30 fps = 0.0334s)
    let cum = 0;
    for (let i = 0; i < res.plan.clips.length; i++) {
      const c = res.plan.clips[i]!;
      cum += ((c.end ?? 0) - c.start) / (c.speed ?? 1);
      expect(Math.abs(cum - beats120[i]!)).toBeLessThanOrEqual(0.034);
      if (i > 0) expect(c.video).not.toBe(res.plan.clips[i - 1]!.video);
    }

    // Hook runs 0 -> first bar (2.0s), then lines change on bars (2.0, 4.0, 6.0, 8.0, 10.0)
    expect(res.plan.captions[0]!.start).toBe(0);
    expect(res.plan.captions[0]!.end).toBe(2);
    expect(res.plan.captions[0]!.animation).toBe("pop");
    expect(res.plan.captions[0]!.position).toBe("middle");
    expect(res.plan.captions[1]!.start).toBe(2);
  });

  test("Fix 1: short 0.3s clip never pushes later cuts off the beat (skips short clip or slows/loops to exact segDur)", () => {
    // Case A: 0.3s clip + 10s clip, beats every 0.5s, cut_every 2 (1.0s segments) -> skips 0.3s clip, cuts stay on 1, 2, 3, 4...
    const resMixed = planMontage({
      beats: beats120,
      bars: bars120,
      clips: [
        { video: 1, duration: 0.3 },
        { video: 2, duration: 10 },
        { video: 3, duration: 10 },
      ],
      target_seconds: 6,
      cut_every: 2,
      lines: ["Satu dua tiga empat lima"],
      loop: false,
    });
    let cum = 0;
    const expectedCuts = [1, 2, 3, 4, 5, 6];
    expect(resMixed.plan.clips.length).toBe(expectedCuts.length);
    for (let i = 0; i < resMixed.plan.clips.length; i++) {
      const c = resMixed.plan.clips[i]!;
      cum += ((c.end ?? 0) - c.start) / (c.speed ?? 1);
      expect(Math.abs(cum - expectedCuts[i]!)).toBeLessThanOrEqual(0.034);
    }

    // Case B: ALL clips are 0.3s -> loops/slows each segment so every segment ends on its exact beat!
    const resAllShort = planMontage({
      beats: beats120,
      bars: bars120,
      clips: [
        { video: 1, duration: 0.3 },
        { video: 2, duration: 0.3 },
      ],
      target_seconds: 4,
      cut_every: 2,
      lines: ["Satu dua tiga empat lima"],
      loop: false,
    });
    // Group consecutive sub-clips of the same video to check segment cut boundaries
    const segEnds: number[] = [];
    let t = 0;
    for (let i = 0; i < resAllShort.plan.clips.length; i++) {
      const c = resAllShort.plan.clips[i]!;
      t += ((c.end ?? 0) - c.start) / (c.speed ?? 1);
      const next = resAllShort.plan.clips[i + 1];
      if (!next || next.video !== c.video) segEnds.push(Number(t.toFixed(3)));
    }
    expect(segEnds.length).toBe(4);
    for (let i = 0; i < segEnds.length; i++) {
      expect(Math.abs(segEnds[i]! - (i + 1))).toBeLessThanOrEqual(0.034);
    }
  });

  test("Fix 2: cut_every 2 and 4 stay in phase with bars (0.5, 2.5, 4.5, 6.5) and end on a bar", () => {
    const beatsOffset = Array.from({ length: 16 }, (_, i) => 0.5 + i * 0.5); // 0.5, 1.0, 1.5, ..., 8.0
    const barsOffset = [0.5, 2.5, 4.5, 6.5];
    const res = planMontage({
      beats: beatsOffset,
      bars: barsOffset,
      clips,
      target_seconds: 6.5,
      cut_every: 2,
      lines: ["Satu dua tiga empat lima"],
      loop: false,
    });
    const cutTimes: number[] = [];
    let t = 0;
    for (const c of res.plan.clips) {
      t += ((c.end ?? 0) - c.start) / (c.speed ?? 1);
      cutTimes.push(Number(t.toFixed(3)));
    }
    // Cuts must hit 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5 (every bar is a cut, ends on 6.5)
    expect(cutTimes).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5]);
    expect(res.total_seconds).toBe(6.5);
  });

  test("Fix 3: loop mode works with 2 clips and an even segment count (last = clip 0 from 0, no back-to-back)", () => {
    const res = planMontage({
      beats: beats120,
      bars: bars120,
      clips: [
        { video: 1, duration: 10 },
        { video: 2, duration: 10 },
      ],
      target_seconds: 6,
      cut_every: 2, // 6 segments (even)
      lines: ["Satu dua tiga empat lima"],
      loop: true,
    });
    expect(res.plan.clips.length).toBe(6);
    const last = res.plan.clips.at(-1)!;
    const prev = res.plan.clips.at(-2)!;
    expect(last.video).toBe(1);
    expect(last.start).toBe(0);
    expect(prev.video).toBe(2);
    for (let i = 1; i < res.plan.clips.length; i++) {
      expect(res.plan.clips[i]!.video).not.toBe(res.plan.clips[i - 1]!.video);
    }
  });

  test("auto-raises cut_every when > 80 clips would be produced", () => {
    const longBeats = Array.from({ length: 120 }, (_, i) => (i + 1) * 0.5);
    const longBars = Array.from({ length: 30 }, (_, i) => (i + 1) * 2.0);
    const res = planMontage({
      beats: longBeats,
      bars: longBars,
      clips,
      target_seconds: 56,
      cut_every: 1,
      lines: ["Satu dua tiga empat lima enam"],
      loop: false,
    });
    expect(res.plan.clips.length).toBeLessThanOrEqual(80);
    expect(res.cut_every_used).toBe(2);
    expect(res.auto_adjusted_cut_every).toBe(true);
  });

  test("Fix 5: splitLineWords strictly keeps every chunk within 5-9 words (for lines >= 5 words)", () => {
    const cases = [
      "Ini ialah satu ayat yang sangat panjang untuk dipecahkan kepada beberapa baris pendek sekali gus", // 15 words -> 8 + 7
      "Satu dua tiga empat lima enam tujuh lapan sembilan sepuluh", // 10 words -> 5 + 5
      "Satu dua tiga empat lima enam tujuh lapan sembilan sepuluh sebelas", // 11 words -> 6 + 5
      "Satu dua tiga empat lima enam tujuh lapan sembilan sepuluh sebelas dua belas tiga belas empat belas lima belas enam", // 19 words -> 7 + 6 + 6
    ];
    for (const line of cases) {
      const parts = splitLineWords(line);
      expect(parts.length).toBeGreaterThan(1);
      for (const p of parts) {
        const count = p.split(/\s+/).length;
        expect(count).toBeGreaterThanOrEqual(5);
        expect(count).toBeLessThanOrEqual(9);
      }
    }
  });

  test("Fix 6: without a hook, lines[0] runs bar 0 -> bar 1 (not 0 -> bar 0), and split sub-lines snap to beats", () => {
    const beatsOffset = Array.from({ length: 24 }, (_, i) => 0.5 + i * 0.5);
    const barsOffset = [0.5, 2.5, 4.5, 6.5, 8.5];
    const res = planMontage({
      beats: beatsOffset,
      bars: barsOffset,
      clips,
      target_seconds: 8.5,
      cut_every: 2,
      // No hook!
      lines: [
        "Ini ialah satu ayat yang sangat panjang untuk dipecahkan kepada beberapa baris pendek sekali gus", // 15 words -> 2 sub-lines
        "Baris kedua bermula tepat pada bar seterusnya",
      ],
      loop: false,
    });
    // First sub-line starts at bar 0 (0.5s), NOT 0!
    expect(res.plan.captions[0]!.start).toBe(0.5);
    // Split boundary snaps to a beat inside (0.5, 2.5) (e.g. 1.5), and second sub-line ends at bar 1 (2.5)
    expect(beatsOffset).toContain(res.plan.captions[0]!.end);
    expect(res.plan.captions[1]!.start).toBe(res.plan.captions[0]!.end);
    expect(res.plan.captions[1]!.end).toBe(2.5);
    // Second line runs bar 1 (2.5) -> bar 2 (4.5)
    expect(res.plan.captions[2]!.start).toBe(2.5);
    expect(res.plan.captions[2]!.end).toBe(4.5);
  });
});
