// A stand-in for whisper.cpp's whisper-cli in tests (compiled to an .exe with `bun build --compile`).
// It reads -of <base> and writes <base>.json in the -ojf -ml 1 -sow shape with fixed words.
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const out = args[args.indexOf("-of") + 1];
if (!out || !args.includes("-ojf")) process.exit(2);
const word = (from: number, to: number, text: string) => ({ offsets: { from, to }, text });
writeFileSync(
  `${out}.json`,
  JSON.stringify({
    result: { language: "ms" },
    transcription: [word(0, 100, ""), word(100, 300, " Um,"), word(400, 800, " Smash"), word(1000, 1400, " Sabtu"), word(1400, 1800, " ni.")],
  }),
);
