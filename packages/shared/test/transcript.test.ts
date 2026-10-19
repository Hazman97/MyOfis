import { describe, expect, test } from "bun:test";
import { EditPlan, isFiller, packTranscript, subtitleCues, tightCuts, type Transcript } from "../src/index.ts";

const t: Transcript = {
  language: "en",
  duration: 12,
  model: "test",
  words: [
    { w: "Hello", s: 0.2, e: 0.7 },
    { w: "everyone.", s: 0.8, e: 1.5 },
    { w: "Um,", s: 2.0, e: 2.4 },
    { w: "welcome", s: 2.5, e: 3.0 },
    { w: "to", s: 3.0, e: 3.2 },
    { w: "SmashPoint.", s: 3.3, e: 4.0 },
    // a 3 s pause
    { w: "Prize", s: 7.0, e: 7.4 },
    { w: "is", s: 7.4, e: 7.6 },
    { w: "RM500.", s: 7.7, e: 8.5 },
  ],
};

describe("transcripts", () => {
  test("fillers are hesitation sounds only", () => {
    expect(["Um,", "uh", "Erm...", "hmm"].every(isFiller)).toBe(true);
    expect(["um-brella", "apa", "SmashPoint", "eh?"].map(isFiller)).toEqual([false, false, false, true]);
  });

  test("packed for the model: timed lines, {um}, pauses", () => {
    const p = packTranscript(t, 1);
    expect(p).toStartWith("Video 1 · 12s · language en");
    expect(p).toContain("[0.2–1.5] Hello everyone.");
    expect(p).toContain("{um} welcome to SmashPoint.");
    expect(p).toContain("(pause 3s)");
    expect(packTranscript({ ...t, words: [] }, 2)).toContain("(no speech found)");
  });

  test("measured silences are cut even where whisper's word times touch", () => {
    // whisper.cpp word times run into each other; ffmpeg silencedetect finds the real pause
    const joined: Transcript = { ...t, words: [{ w: "One", s: 0, e: 1 }, { w: "two", s: 1, e: 3 }, { w: "three", s: 3, e: 4 }], duration: 4, silences: [{ s: 1.4, e: 2.6 }] };
    expect(tightCuts(joined, 1)).toEqual([
      { video: 1, start: 0, end: 1.52, speed: 1, zoom: "none" },
      { video: 1, start: 2.48, end: 4, speed: 1, zoom: "none" },
    ]);
    expect(packTranscript(joined, 1)).toContain("(pause 1.2s)");
  });

  test("tight cut drops long pauses and fillers, keeps a little air", () => {
    const clips = tightCuts(t, 1);
    expect(clips).toEqual([
      { video: 1, start: 0, end: 1.62, speed: 1, zoom: "none" },
      { video: 1, start: 2.4, end: 4.12, speed: 1, zoom: "none" },
      { video: 1, start: 6.88, end: 8.62, speed: 1, zoom: "none" },
    ]);
    // keeping fillers: "Um" is speech, so the first two pieces join (no gap reaches 0.6 s)
    expect(tightCuts(t, 1, { drop_fillers: false })).toHaveLength(2);
    // nothing said: the whole range
    expect(tightCuts({ ...t, words: [] }, 2, { from: 1, to: 5 })).toEqual([{ video: 2, start: 1, end: 5, speed: 1, zoom: "none" }]);
    // never more than 80 clips
    const many: Transcript = { ...t, duration: 400, words: Array.from({ length: 200 }, (_, i) => ({ w: "word", s: i * 2, e: i * 2 + 0.5 })) };
    expect(tightCuts(many, 1)).toHaveLength(80);
  });

  test("subtitles follow the cut into finished-video time", () => {
    const plan = EditPlan.parse({ clips: tightCuts(t, 1), subtitles: { style: "pop" } });
    const cues = subtitleCues(plan, { 1: t });
    expect(cues.map((c) => c.text)).toEqual(["HELLO EVERYONE.", "WELCOME TO", "SMASHPOINT.", "PRIZE IS", "RM500."]);
    // the third clip starts at 1.62 + 1.72 = 3.34 s in the finished video; "Prize" is 0.12 s in
    expect(cues[3]!.start).toBe(3.46);
    // speed: twice as fast halves the times; style "line" groups more words
    const fast = subtitleCues(EditPlan.parse({ clips: [{ video: 1, speed: 2 }], subtitles: { style: "line", uppercase: false } }), { 1: t }, { 1: 12 });
    expect(fast.map((c) => c.text)).toEqual(["Hello everyone.", "welcome to SmashPoint.", "Prize is RM500."]);
    expect(fast[2]!.start).toBe(3.5);
    // off, or no transcript: none
    expect(subtitleCues(EditPlan.parse({ clips: [{ video: 1 }] }), { 1: t })).toEqual([]);
    expect(subtitleCues(plan, {})).toEqual([]);
  });
});
