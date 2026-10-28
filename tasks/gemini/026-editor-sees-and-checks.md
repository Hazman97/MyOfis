# Task 026: Editor sees the footage and checks its own render

Read `tasks/gemini/SUPERVISOR.md` first. Write `tasks/gemini/026-report.md`. Do not commit.

## Why (tested 2026-10-28, score 6/10)
Claude tested Editor on 3 Blender trailers ("TikTok 25-30 s, best scene of each, Ken Burns, fade/slide, hook").
Technically perfect (1080×1920, 30 fps, 28.5 s; it noticed a 39.5 s first render was too long and re-rendered),
but creatively weak, because **Editor cannot see the picture**:
- it picked a very dark alley scene; it cropped 16:9 → 9:16 straight through **burned-in title text**
  ("…E GIANT PA…"); it kept the source's **letterbox bars** (Sintel is 2.39:1 inside 720p);
- the hook emoji 🔥 rendered as a wrong glyph (no emoji font in the ASS caption path);
- only one transition type for the whole video (asked for fade + slide);
- `save_draft` failed 3 times with the same input before stopping;
- the rejected first render (same name, same run) shows in the UI as a second video.

How others do it (researched 2026-10-28): open-source agentic editors **index the footage first** (scene detection +
frame sampling + a vision model describing each shot; e.g. calesthio/OpenMontage "Video Understand",
poseljacob/agentic-video-editor `footage_index.json`), a "director" picks shots **from those descriptions**, and a
**reviewer watches the render** (frames + ffprobe), scores it (adherence, pacing, visual quality) and loops back
up to 2 times. OpenMontage also checks black frames, broken overlays, audio levels and subtitles after render.
The canopy-ai model (Qwen3.8 27B) reads images (max 4 per request); `ToolContext.describeImages` already exists
(`apps/runner/src/runtimes/vision.ts`, used by `clip_library`).

## Build
1. **Shot index** (`video_probe` gains it, or a new `video_index` tool; cached per upload like transcripts):
   scene cuts (existing `sceneChanges`), for each shot 1-3 frames → `describeImages` in batches of ≤4 →
   per shot: start/end, a one-line description, and flags `dark` (mean luma, ffmpeg `signalstats`), `blurry`,
   `text_on_screen`, `faces`, `letterboxed`. Pure helpers for the measurements and their parsing, tested.
   Tokens count to the run. Mock provider → empty descriptions (tests).
2. **Letterbox:** `cropdetect` once per source; `buildEditArgs` crops the bars before the 9:16 crop/blur
   (pure + tested; a manual `crop` field in `Clip` overrides it).
3. **Text-safe reframing:** when a shot is flagged `text_on_screen` or the crop would cut a face, use `fit: "blur"`
   for that clip (allow per-clip `fit` in `Clip`).
4. **Emoji in captions:** captions render emoji correctly (ship/locate an emoji-capable font for libass, e.g.
   Noto Color Emoji or Noto Emoji; if colour emoji is impossible with libass, render the caption with a monochrome
   emoji font) and never show tofu. Test with "🔥".
5. **Transitions per cut:** `EditPlan.transition` may be a list (one per boundary) as well as one value; keep the
   overlap maths (`finishedSeconds`, `subtitleCues`) correct, tested.
6. **Reviewer pass** (`video_review` tool, or automatic after `video_edit`): sample 6-8 frames + ffprobe +
   `blackdetect` + loudness → vision check against the request: black/dark frames, cut text, bars, length vs
   target, hook visible in the first 2 s → `{score 0-1, problems[]}`. Editor's prompt: if score < 0.7, fix and
   re-render once more (max 2 retries), then deliver with the problems listed.
7. **One deliverable per run:** a re-render with the same name in the same run supersedes the previous one
   (`uploads` row marked superseded or deleted with its file); the UI (chat, Drafts, Studio list) shows only the
   latest. Keep render history only in the run log.
8. **No blind retries:** a tool that fails twice with the same input gets refused on the third try with a clear
   message (generalise the existing repeat guard: same tool + same input + previous result failed).
9. Prompt upgrade for Editor and TikTok Poster through `BuiltinAgent.upgrade` (index → plan from descriptions →
   render → review → fix), and update the `short-video-editing` skill.

## Tests and proof
Unit tests for every pure piece; a hub/runner test with fake vision; and **a real run** on the owner's sample
folder `C:\Users\Hazman\Desktop\Sample video MyOfis` (files 1-3, same prompt as above) using a preview hub
(see CLAUDE.md) with the canopy-ai provider: put the contact sheet (8 frames) and the review score in the report.
`bun run typecheck`, full `bun test`, `bun run --cwd apps/web build`.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, then do `tasks/gemini/026-editor-sees-and-checks.md`.
> Write `tasks/gemini/026-report.md` when done. Do not commit.
