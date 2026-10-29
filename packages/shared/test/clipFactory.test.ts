import { describe, expect, test } from "bun:test";
import {
  calculateViralityScore,
  extractSentences,
  findCandidateWindows,
  generateAnimatedCaptions,
  lookupWordEmoji,
  mergeOverlappingWindows,
  parseAudioEnergyPeaks,
  parseModelScoring,
  smoothCropPath,
  snapToSentenceBoundaries,
  buildSmartReframeFilter,
  buildScoringPrompt,
  SCORING_PROMPT_VERSION,
  type ViralitySubscores,
  type Sentence,
} from "../src/clipFactory.ts";
import type { Transcript } from "../src/video.ts";

describe("Clip Factory Pure Logic (Task 028 Step 1-3)", () => {
  const sampleTranscript: Transcript = {
    duration: 120,
    language: "ms",
    model: "whisper-medium",
    words: [
      // Sentence 1 (0.0 - 5.0)
      { w: "Hari", s: 0.0, e: 0.8 },
      { w: "ini", s: 0.9, e: 1.4 },
      { w: "kita", s: 1.5, e: 2.1 },
      { w: "nak", s: 2.2, e: 2.6 },
      { w: "bincang", s: 2.7, e: 3.4 },
      { w: "pasal", s: 3.5, e: 4.1 },
      { w: "kandang.", s: 4.2, e: 5.0 },
      // Sentence 2 (5.8 - 12.0)
      { w: "Kandang", s: 5.8, e: 6.5 },
      { w: "lembu", s: 6.6, e: 7.2 },
      { w: "ni", s: 7.3, e: 7.8 },
      { w: "modal", s: 7.9, e: 8.5 },
      { w: "dia", s: 8.6, e: 9.0 },
      { w: "sangat", s: 9.1, e: 9.8 },
      { w: "jimat.", s: 10.0, e: 12.0 },
      // Sentence 3 (13.5 - 20.0)
      { w: "Kalau", s: 13.5, e: 14.1 },
      { w: "ikut", s: 14.2, e: 14.8 },
      { w: "cara", s: 14.9, e: 15.5 },
      { w: "biasa,", s: 15.6, e: 16.3 },
      { w: "memang", s: 16.4, e: 17.0 },
      { w: "boleh", s: 17.1, e: 17.8 },
      { w: "rugi.", s: 18.0, e: 20.0 },
      // Sentence 4 (21.0 - 32.0)
      { w: "Sebab", s: 21.0, e: 21.8 },
      { w: "tu", s: 21.9, e: 22.3 },
      { w: "penting", s: 22.4, e: 23.0 },
      { w: "ada", s: 23.1, e: 23.6 },
      { w: "ventilasi", s: 23.7, e: 25.0 },
      { w: "yang", s: 25.1, e: 25.6 },
      { w: "padu.", s: 25.8, e: 32.0 },
    ],
  };

  test("1. extractSentences splits words into grammatical sentences", () => {
    const sentences = extractSentences(sampleTranscript);
    expect(sentences).toHaveLength(4);
    expect(sentences[0]!.text).toBe("Hari ini kita nak bincang pasal kandang.");
    expect(sentences[0]!.start).toBe(0.0);
    expect(sentences[0]!.end).toBe(5.0);

    expect(sentences[1]!.text).toBe("Kandang lembu ni modal dia sangat jimat.");
    expect(sentences[1]!.start).toBe(5.8);
    expect(sentences[1]!.end).toBe(12.0);

    expect(sentences[3]!.text).toBe("Sebab tu penting ada ventilasi yang padu.");
    expect(sentences[3]!.start).toBe(21.0);
    expect(sentences[3]!.end).toBe(32.0);
  });

  test("2. snapToSentenceBoundaries never cuts mid-sentence or mid-word", () => {
    const sentences = extractSentences(sampleTranscript);
    // Raw cut from 3.0s to 15.0s (mid sentence 1 to mid sentence 3)
    const snapped = snapToSentenceBoundaries(sentences, 3.0, 15.0, 15, 60);

    // Snaps start to sentence 1 start (0.0), and end to sentence 3 end (20.0)
    expect(snapped.start).toBe(0.0);
    expect(snapped.end).toBe(20.0);
    expect(snapped.sentences).toHaveLength(3);
    expect(snapped.sentences[0]!.text).toStartWith("Hari ini");
    expect(snapped.sentences.at(-1)!.text).toEndWith("rugi.");
  });

  test("3. parseAudioEnergyPeaks detects momentary loudness spikes", () => {
    const sampleEburLog = `
      [Parsed_ebur128_0 @ 0000021b0dc56580] t: 2.100000 TARGET:-23 LUFS M: -28.4 S: -27.1
      [Parsed_ebur128_0 @ 0000021b0dc56580] t: 14.500000 TARGET:-23 LUFS M: -15.2 S: -18.0
      [Parsed_ebur128_0 @ 0000021b0dc56580] t: 16.000000 TARGET:-23 LUFS M: -16.0 S: -17.5
      [Parsed_ebur128_0 @ 0000021b0dc56580] t: 45.200000 TARGET:-23 LUFS M: -14.1 S: -16.0
    `;
    const peaks = parseAudioEnergyPeaks(sampleEburLog, -18);
    // 14.5 and 45.2 (16.0 skipped because it is within 4s of 14.5)
    expect(peaks).toEqual([14.5, 45.2]);
  });

  test("4. findCandidateWindows generates sentence-aligned candidate windows", () => {
    const windows = findCandidateWindows({
      transcript: sampleTranscript,
      duration: 120,
      minDuration: 15,
      maxDuration: 60,
      audioPeaks: [15.0],
      prompt: "modal dan kos",
    });

    expect(windows.length).toBeGreaterThan(0);
    for (const win of windows) {
      expect(win.duration).toBeGreaterThanOrEqual(15);
      expect(win.duration).toBeLessThanOrEqual(60);
      expect(win.start).toBeLessThan(win.end);
      expect(win.transcript.length).toBeGreaterThan(0);
    }
  });

  test("5. mergeOverlappingWindows combines heavily overlapping windows", () => {
    const raw = [
      { id: "1", start: 0, end: 30, duration: 30, transcript: "A", words: [], source: "speech" as const },
      { id: "2", start: 5, end: 32, duration: 27, transcript: "B", words: [], source: "speech" as const }, // overlaps > 80%
      { id: "3", start: 50, end: 80, duration: 30, transcript: "C", words: [], source: "speech" as const },
    ];
    const merged = mergeOverlappingWindows(raw);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.id).toBe("1");
    expect(merged[1]!.id).toBe("3");
  });

  test("6. calculateViralityScore uses 30/25/20/15/10 weighting and clamps to 0..99", () => {
    const subscores: ViralitySubscores = {
      hook: 90,    // 90 * 0.30 = 27
      value: 80,   // 80 * 0.25 = 20
      emotion: 70, // 70 * 0.20 = 14
      flow: 85,    // 85 * 0.15 = 12.75
      trend: 75,   // 75 * 0.10 = 7.5
    };
    // Sum = 27 + 20 + 14 + 12.75 + 7.5 = 81.25 -> 81
    expect(calculateViralityScore(subscores)).toBe(81);

    // Perfect 100 on everything clamps to 99
    expect(calculateViralityScore({ hook: 100, value: 100, emotion: 100, flow: 100, trend: 100 })).toBe(99);
    // 0 on everything is 0
    expect(calculateViralityScore({ hook: 0, value: 0, emotion: 0, flow: 0, trend: 0 })).toBe(0);
  });

  test("7. parseModelScoring extracts subscores, reasons, hooks and headline", () => {
    const modelOutput = `
- Hook: 88 | reason: Strong opening question about high cowbarn construction costs.
- Value: 85 | reason: Gives concrete practical airflow ventilation tips.
- Emotion: 72 | reason: Passionate delivery from the speaker.
- Flow: 90 | reason: Clear problem to solution arc.
- Trend: 80 | reason: High interest in modern farming and agriculture.

1. Rahsia Jimat Modal Kandang!
2. Jangan Buat Kandang Sebelum Dengar Ni
3. Cara Jimatkan Kos Penternakan Lembu

Title: Rahsia Kandang Lembu Jimat Kos
Summary: Panduan praktikal bina kandang lembu jimat kos dengan ventilasi padu.
`;
    const parsed = parseModelScoring(modelOutput, { transcript: "Hari ini bincang kandang", duration: 30 });
    expect(parsed.subscores.hook).toBe(88);
    expect(parsed.subscores.value).toBe(85);
    expect(parsed.subscores.emotion).toBe(72);
    expect(parsed.subscores.flow).toBe(90);
    expect(parsed.subscores.trend).toBe(80);

    expect(parsed.reasons.hook).toContain("Strong opening question");
    expect(parsed.hooks).toHaveLength(3);
    expect(parsed.hooks[0]).toBe("Rahsia Jimat Modal Kandang!");
    expect(parsed.headline).toBe("Rahsia Kandang Lembu Jimat Kos");
    expect(parsed.summary_reason).toContain("Panduan praktikal");

    const overallScore = calculateViralityScore(parsed.subscores);
    // 88*0.3(26.4) + 85*0.25(21.25) + 72*0.2(14.4) + 90*0.15(13.5) + 80*0.1(8) = 83.55 -> 84
    expect(overallScore).toBe(84);
  });

  test("8. lookupWordEmoji matches keywords to curated vector emoji", () => {
    expect(lookupWordEmoji("modal")).toBe("💸");
    expect(lookupWordEmoji("duit")).toBe("💰");
    expect(lookupWordEmoji("padu")).toBe("🔥");
    expect(lookupWordEmoji("kandang")).toBe("🏠");
    expect(lookupWordEmoji("lembu")).toBe("🐄");
    expect(lookupWordEmoji("biasa")).toBeNull();
  });

  test("9. generateAnimatedCaptions creates ASS chunks with vector outline emoji font wrapping", () => {
    const captions = generateAnimatedCaptions(sampleTranscript.words, 5.0, 12.0, "pop", "Segoe UI Symbol");
    expect(captions.length).toBeGreaterThan(0);
    // "Kandang lembu ni modal" chunk has lembu 🐄 and modal 💸
    const chunkWithEmoji = captions.find((c) => c.text.includes("Segoe UI Symbol"));
    expect(chunkWithEmoji).toBeDefined();
    expect(chunkWithEmoji?.text).toContain("{\\fnSegoe UI Symbol\\b0}");
  });

  test("10. smoothCropPath removes sudden jump jitter", () => {
    const rawKeys = [
      { t: 0.0, x: 200 },
      { t: 0.5, x: 500 }, // sudden 300px jump in 0.5s (max 160 px/s = 80px)
      { t: 1.0, x: 520 },
    ];
    const smoothed = smoothCropPath(rawKeys, 160);
    expect(smoothed).toHaveLength(3);
    expect(smoothed[0]!.x).toBe(200);
    expect(smoothed[1]!.x).toBe(280); // clamped to 200 + (160 * 0.5) = 280
  });

  test("11. buildSmartReframeFilter generates correct ffmpeg filter strings", () => {
    // blur_fit
    const blurFit = buildSmartReframeFilter({
      srcWidth: 1920,
      srcHeight: 1080,
      dstWidth: 1080,
      dstHeight: 1920,
      mode: "blur_fit",
      letterboxCrop: "1920:800:0:140",
    });
    expect(blurFit).toContain("crop=1920:800:0:140,split=2[fg][bg]");
    expect(blurFit).toContain("boxblur=25:25");

    // crop_center
    const cropCenter = buildSmartReframeFilter({
      srcWidth: 1920,
      srcHeight: 1080,
      dstWidth: 1080,
      dstHeight: 1920,
      mode: "crop_center",
    });
    expect(cropCenter).toContain("scale=w=1080:h=1920:force_original_aspect_ratio=increase,crop=1080:1920");

    // split_screen
    const splitScreen = buildSmartReframeFilter({
      srcWidth: 1920,
      srcHeight: 1080,
      dstWidth: 1080,
      dstHeight: 1920,
      mode: "split_screen",
    });
    expect(splitScreen).toContain("split=2[top][bot]");
    expect(splitScreen).toContain("vstack");
  });
});
