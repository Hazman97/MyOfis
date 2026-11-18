# Task 033: retention polish (karaoke captions, seamless loop, text-first hook rule)

Read `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md` first. Write `tasks/gemini/033-report.md`
(append a note after each step). Do not commit. **Do it after 031 and 032** (same files).

## Why
Owner request (2026-11-18), from the 2026 short-video research:
- captions that light up word by word in sync with the voice keep people watching;
- videos that loop with no visible seam get replays;
- the first 1–2 s must show the hook as text.

## Facts from the code
- `Subtitles.style` is `pop` (2 words at a time) or `line` (up to 6 words), defined in
  `packages/shared/src/video.ts:202`. There is **no current-word highlight** today.
- **Cues:** `subtitleCues()` in `packages/shared/src/transcript.ts` (it follows cuts, speed and transition overlap).
- **ASS:** `captionsAss()` / the animation tags in `packages/tools/src/video.ts` (~243-280). Emoji are wrapped once
  there; do not wrap them again (see 028-review-2).
- Transcripts come with word times (`video_transcribe`, whisper `-ml 1 -sow`). The words touch each other, so use
  `Transcript.silences` to end a word early.

## Build
1. **Karaoke style** `Subtitles.style: "karaoke"`:
   - Each cue shows 3–5 words (a phrase), and the word being spoken is highlighted: a different colour plus a
     slightly bigger size.
   - Use ASS `\k` timing with `SecondaryColour` (libass supports `\kf` / `\k`), or one dialogue line per word
     state if `\k` cannot also scale the word. **Pick one, say why, and show a frame.**
   - Colours come from a small `KARAOKE_THEMES` list (white + yellow, white + green, black box), chosen by
     `Subtitles.theme`.
   - Pure: `karaokeCues(words, cuts…)` → phrases with per-word offsets; tested for drift ≤ 1 frame after cuts.
2. **Seamless loop** `EditPlan.loop: boolean`:
   - The last 0.4 s cross-fades into the first frame: render the first 0.4 s again at the end, with an
     `xfade`/`acrossfade` from the last clip.
   - It shortens to match, so the length stays the same.
   - `finishedSeconds` accounts for it.
   - The pure args are tested; the real render is checked with ffprobe plus a 2-frame compare (the last frame is
     close to the first: `ffmpeg … -lavfi psnr` > 25 dB).
3. **Text-first hook rule:**
   - Editor, Misi 1K, TikTok Poster and Clip Factory prompts (an upgrade only when unedited) must put the hook as
     a caption or motion text from 0 s to ≤ 2 s.
   - `video_review` (026) gets a pure check `hookShownEarly(plan)`: no caption or overlay starting ≤ 0.3 s and
     lasting ≥ 1 s gives the warning "no text hook in the first 2 s", which counts in the review score.
4. **Studio controls** (logic only):
   - the subtitle style select gains Karaoke + theme;
   - a Loop switch;
   - the hook warning shown on the plan.

## Tests and proof
- Pure tests as above; existing subtitle tests unchanged.
- One real render of a 20 s test clip with a fake transcript:
  - karaoke frames at 3 timestamps (paste the paths and look at them; describe what you see);
  - loop PSNR output.
- `bun run typecheck`, the full `bun test`, the web build: raw final lines.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/033-retention-polish.md` step
> by step, tests after each, notes appended to `tasks/gemini/033-report.md`. Paste raw output only. Do not commit.
