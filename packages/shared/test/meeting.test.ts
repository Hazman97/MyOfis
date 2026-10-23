import { describe, expect, test } from "bun:test";
import { cleanSegments, formatTranscript, mediaTypeFromName, parseWhisperSegments, stamp, transcriptParts, type MeetingSegment } from "../src/index.ts";

const seg = (s: number, text: string): MeetingSegment => ({ s, e: s + 2, text });

describe("meeting transcripts", () => {
  test("whisper -oj segments in seconds", () => {
    const segs = parseWhisperSegments({ transcription: [{ offsets: { from: 1500, to: 4200 }, text: " Kipas zon A. " }, { offsets: { from: 4200, to: 5000 } }] });
    expect(segs).toEqual([
      { s: 1.5, e: 4.2, text: "Kipas zon A." },
      { s: 4.2, e: 5, text: "" },
    ]);
  });

  test("drops silence, invented outros, repeats and loops; keeps real lines", () => {
    const { segments, dropped } = cleanSegments([
      seg(0, "Okay, dan seterusnya kita ada siren."),
      seg(2, "[BLANK_AUDIO]"),
      seg(4, "Anggaran spek je lah."),
      seg(6, "Anggaran spek je lah"),
      seg(8, "Terima kasih kerana menonton!"),
      seg(10, "Haa betul."),
      seg(12, "Anggaran spek je lah."),
      seg(14, "Haa betul."),
      seg(16, "Anggaran spek je lah."),
      seg(18, "Pintu kayu 50 x 70 cm."),
      seg(20, ""),
    ]);
    expect(segments.map((x) => x.text)).toEqual(["Okay, dan seterusnya kita ada siren.", "Anggaran spek je lah.", "Haa betul.", "Anggaran spek je lah.", "Haa betul.", "Pintu kayu 50 x 70 cm."]);
    expect(dropped).toBe(5);
  });

  test("a line that comes back much later is kept", () => {
    const segs = ["Okay", "a", "b", "c", "d", "e", "f", "Okay", "g", "Okay"].map((t, i) => seg(i * 2, t));
    expect(cleanSegments(segs).segments.filter((x) => x.text === "Okay")).toHaveLength(3);
  });

  test("times and paragraphs", () => {
    expect(stamp(75)).toBe("01:15");
    expect(stamp(3725.9)).toBe("1:02:05");
    expect(formatTranscript([seg(0, "Satu."), seg(30, "Dua."), seg(61, "Tiga."), seg(3700, "Empat.")])).toBe("[00:00] Satu. Dua.\n[01:01] Tiga.\n[1:01:40] Empat.");
  });

  test("parts split at paragraph ends, never over the limit", () => {
    const text = ["[00:00] aaaa", "[01:00] bbbb", "[02:00] cccc"].join("\n");
    expect(transcriptParts(text, 26)).toEqual(["[00:00] aaaa\n[01:00] bbbb", "[02:00] cccc"]);
    const long = transcriptParts("x".repeat(25), 10);
    expect(long).toEqual(["xxxxxxxxxx", "xxxxxxxxxx", "xxxxx"]);
    expect(transcriptParts("")).toEqual([""]);
  });

  test("media types from file names", () => {
    expect(mediaTypeFromName("Hardware part.m4a")).toBe("audio/mp4");
    expect(mediaTypeFromName("PTT-20261022.opus")).toBe("audio/ogg");
    expect(mediaTypeFromName("clip.MKV")).toBe("video/x-matroska");
    expect(mediaTypeFromName("notes.pdf")).toBeNull();
  });
});
