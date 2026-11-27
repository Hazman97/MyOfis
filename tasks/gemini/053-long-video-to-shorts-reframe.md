# 053: Long video → many shorts (highlights + score) + auto reframe to 9:16

Owner (2026-11-27), after research (OpusClip / Vizard / CapCut): drop one long video (podcast, talk, event,
landscape phone video) and get several ready 9:16 shorts, each with a hook, subtitles, a score, and the speaker
kept in frame.

Read first: `tasks/gemini/SUPERVISOR.md`, CLAUDE.md "Editor hears speech" (whisper, `packTranscript`, `tightCuts`,
`subtitleCues`), "Motion in renders", "Video HD", `packages/tools/src/video.ts`, `packages/shared/src/transcript.ts`,
`packages/tools/browser/worker.mjs` (Node worker pattern), GPU lock (`withGpuLock`).

## Part A — Find highlights
- Tool **`find_highlights {video, count (1–10, default 5), min_s (15), max_s (60), language?}`** (Editor, TikTok
  Poster, Misi 1K, Pengurus Sosial):
  1. `video_transcribe` (cached) → packed transcript with times.
  2. Pure `candidateWindows(transcript, min_s, max_s)` (`packages/shared/src/highlights.ts`): windows that start
     and end on sentence boundaries / silences, no overlap > 30 %, ≤ 200 candidates. Tested.
  3. One LLM call (the run's own model, structured JSON, tokens counted) scores each candidate 0–100 on hook
     strength (first 3 s), payoff, standalone sense, emotion; returns `{start, end, score, title, hook_text,
     reason}`. The hub never trusts the model's times: snap to the nearest candidate window, drop anything outside
     the video.
  4. Pure `pickHighlights(scored, count)` = best non-overlapping. Tested.
- Result stored on the upload (`uploads.highlights` JSON, migration) and shown in Video Studio as a list with
  score chips; each can be rendered.

## Part B — Auto reframe (landscape → 9:16 following the speaker)
- **Face track in the Node worker** (`worker.mjs` new mode `{mode:"faces", video, fps:2}`): sample frames with
  ffmpeg at 2 fps, detect faces with a small ONNX model run by `onnxruntime-node`. Proposed model: **YuNet**
  (OpenCV Zoo, check its licence — must allow commercial use; write it in `assets/models/LICENSES`). Download on
  first use into `%LOCALAPPDATA%/MyOfis/models` with a pinned URL + SHA-256 check (no auto-update). If the model or
  runtime is missing → fall back to centre crop and say so; never fail the render.
- Pure `cropPath(faces, srcW, srcH, outAspect)` (`packages/shared/src/reframe.ts`): pick the main face (largest,
  most present), smooth with a dead-zone (no move when the face stays inside the middle 40 %) and max pan speed,
  hold during gaps, cut (not pan) on scene changes; output keyframes `{t, x}`. Multiple speakers → follow the one
  talking if the transcript gives turns, else the largest. Tested with synthetic tracks (jitter, gap, jump).
- `buildEditArgs` gets `Clip.reframe: {keyframes}` → ffmpeg `crop` with an expression built from the keyframes
  (piecewise linear `if(between(t,…))…`, ≤ 120 keyframes, else split the clip). Tested argv + one real render
  (lavfi with a moving white box as "face" — skipped only when ffmpeg is missing): the box stays inside the crop.
- Other mode `fit_blur` (blurred background, no crop) stays available.

## Part C — Make the shorts
- Tool **`make_shorts {video, highlights: [ids] | "top", reframe: "auto"|"center"|"blur", subtitles: true,
  hook_caption: true}`** → for each highlight one `EditPlan` (tight cuts inside the window, `subtitleCues`,
  hook text as a top caption for 3 s, reframe keyframes) → `video_edit` render → one draft each (`kind: video`,
  pending, `meta.set_id = shorts:<upload>`, `meta.score`). Direct-job version for the Studio button (0 tokens
  apart from the scoring call, which the Studio runs as a small job).
- Studio page: "Jadikan shorts" button on any video ≥ 60 s → choose count + reframe → progress per short → the
  drafts appear as a set (042 set card, works with 048 queue).

## Limits
Run time: these jobs get the 60-min video limit. Max input 2 h. Scoring prompt sends only text (no frames).

## Tests
`candidateWindows`, `pickHighlights`, `cropPath` table tests; the hub/tool snaps model times; fake model returning
times outside the video → dropped; `make_shorts` on a 3-min lavfi video with a fake transcript → N drafts with
the set id; reframe argv; missing ONNX → centre crop + note.

## Proof
Raw new tests, `bun run typecheck`, full `bun test`, web build final lines; a real run on a ≥ 3 min talking-head
landscape clip from the owner's PC (ask the owner which file; if none, a public-domain one) → contact sheet of
frames from each short + the scores list. Anything not run is NOT RUN. Do not commit.
