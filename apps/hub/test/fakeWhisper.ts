// A stand-in for whisper.cpp's whisper-cli in tests (compiled to an .exe with `bun build --compile`).
// It reads -of <base> and writes <base>.json: with -ojf (Editor, word by word) fixed words; with -oj
// (Notulis, segments) a short meeting with the noise real recordings give: an invented outro and a loop.
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const out = args[args.indexOf("-of") + 1];
if (!out || !(args.includes("-ojf") || args.includes("-oj"))) process.exit(2);
const word = (from: number, to: number, text: string) => ({ offsets: { from, to }, text });
const transcription = args.includes("-ojf")
  ? [word(0, 100, ""), word(100, 300, " Um,"), word(400, 800, " Smash"), word(1000, 1400, " Sabtu"), word(1400, 1800, " ni.")]
  : [
      word(0, 2000, " Okay, kita mula dengan kipas zon A."),
      word(2000, 4000, " Misting jadi empat line, dua setiap zon."),
      word(4000, 5000, " Misting jadi empat line, dua setiap zon."),
      word(5000, 6000, " Terima kasih kerana menonton!"),
      word(61_000, 63_000, " Role tinggal dua, admin dengan user."),
    ];
writeFileSync(`${out}.json`, JSON.stringify({ result: { language: "ms" }, transcription }));
