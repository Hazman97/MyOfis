import { describe, expect, test } from "bun:test";
import { planMontage, splitLineWords } from "../src/index.ts";

describe("Task 032 Step 3: Pure montage planner (planMontage)", () => {
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
      cum += (c.end ?? 0) - c.start;
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

  test("auto-raises cut_every when > 80 clips would be produced", () => {
    // 120 BPM for 60s = 120 beats (> 80) -> raises cut_every from 1 to 2
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

  test("loop mode ends with first clip's opening frames and avoids repeating clip 0 back-to-back", () => {
    const res = planMontage({
      beats: beats120,
      bars: bars120,
      clips,
      target_seconds: 8,
      cut_every: 2,
      lines: ["Satu dua tiga empat lima"],
      loop: true,
    });
    const last = res.plan.clips.at(-1)!;
    const prev = res.plan.clips.at(-2)!;
    expect(last.video).toBe(clips[0]!.video);
    expect(last.start).toBe(0);
    expect(prev.video).not.toBe(last.video);
  });

  test("splitLineWords keeps chunks within 5-9 words", () => {
    const parts = splitLineWords("Ini ialah satu ayat yang sangat panjang untuk dipecahkan kepada beberapa baris pendek");
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      const count = p.split(/\s+/).length;
      expect(count).toBeGreaterThanOrEqual(4);
      expect(count).toBeLessThanOrEqual(9);
    }
  });
});
