# Task 028: Clip Factory — OpusClip-level clipping inside MyOfis

Read `tasks/gemini/SUPERVISOR.md` first. Write `tasks/gemini/028-report.md`. Do not commit.
**Depends on:** 026 (shot index with vision + render review), 024 (motion text / kinetic captions),
canopy 005 (`/v1/audio/speech`, Malay TTS) and canopy 006 (`/v1/video/generations`). Where one is not merged yet,
build against its documented contract behind a capability check and say so in the report.

## Why
The owner wants everything OpusClip does, but private (runs on his PC / AWS runner), free per use, with his
approve-first drafts and auto-posting (Zernio/TikTok, Facebook, Instagram, Threads) that MyOfis already has.
OpusClip's features (2026, from reviews and its help centre): **ClipAnything** (find the best moments in any long
video from visual, audio and sentiment cues, clips up to 15 min), a **Virality Score 0–99** with clips sorted by
it, **object/active-speaker tracking reframe**, **animated captions**, **AI B-roll**, **brand templates**, a
**social scheduler**, plus hooks/titles, filler removal and multi-aspect export.

## Build (Editor gets the tools; a new built-in agent "Clip Factory" with a fixed playbook uses them)
1. **Find moments (`clip_find`)**: input one long video (podcast, talk, event, vlog, meeting) + optional prompt
   ("bahagian pasal harga", "lucu", "tips"). Use the transcript (existing `video_transcribe`, sentence times), the
   shot index (026), audio energy/laughter peaks (ffmpeg `ebur128`/`astats`, pure parsing, tested). The model
   proposes candidate clips that **start at a sentence start and end at a sentence end** (never mid-word),
   15–90 s by default (owner can set 15 s–15 min), no overlaps unless asked. Long transcripts are processed in
   windows with overlap; results merged and de-duplicated (pure, tested).
2. **Virality score**: each candidate gets 0–99 = weighted sub-scores **hook (first 3 s)**, **flow/coherence**,
   **value/insight**, **emotion/energy**, **trend/relevance to the prompt**, with a one-line reason per sub-score.
   Scoring prompt fixed and versioned; weights in one pure function (tested). Clips sorted by score. Be honest in
   the UI: "AI estimate, not a guarantee".
3. **Smart reframe** (16:9 → 9:16/1:1): detect faces/subjects on sampled frames (CPU: OpenCV DNN face detector
   or MediaPipe; pin versions; no Docker) → active speaker = the face whose mouth region moves while that speaker
   talks (or the largest face as fallback) → a **smoothed crop path** (keyframes, max pan speed, no jitter; pure +
   tested) → ffmpeg `crop` with expressions or segment crops. Two speakers far apart → optional **split screen**
   (top/bottom). Falls back to 026's blur fit when nothing is found.
4. **Animated captions**: word-by-word highlight (current word coloured), **auto emoji** for key words (small
   curated map + model suggestions, rendered with the 026 emoji fix), **keyword emphasis** (bigger/colour), 4–6
   named styles (e.g. Pop, Bold Box, Karaoke, Minimal, Neon) as presets; Malay and English. Reuse 024's
   kinetic captions where possible; otherwise extend the ASS path. Pure caption timing/styling tested.
5. **Hook + title**: generate 3 hook lines and a title per clip (Malay/Manglish by default, match the clip's
   language), overlay the chosen hook for the first 2–3 s (024 `hook` template), and a caption for the post.
6. **AI B-roll**: at moments where the speaker names a thing/place/action, insert 2–4 s B-roll from, in order:
   the agent's `clip_folder` (existing `clip_library`), a stock source if a key is configured (Pexels/Pixabay
   API, keys stay in the hub like other integrations), or a generated clip (canopy 006). Never cover a face for
   more than 3 s; keep the speech audio.
7. **Polish**: filler/silence trimming (existing `tightCuts`), **speech enhancement** (ffmpeg `afftdn` +
   `loudnorm`, toggle), optional **voice-over or dubbing** via canopy 005 (e.g. translate captions BM↔EN with
   canopy-ai, then TTS), background music from the clip folder with ducking under speech.
8. **Brand kit per project** (`projects` settings, owner UI): logo + position/opacity, fonts, colours, caption
   style default, intro/outro clip, CTA end card (024 `outro_cta`). Applied to every clip of that project.
9. **Export**: 9:16 (TikTok/Reels/Shorts), 1:1, 16:9 from the same plan; TikTok HD check (existing
   `tiktokHdPlan`). Each clip becomes a **draft** (kind video) with caption + hashtags + score, so the existing
   approve → post/schedule flow (Zernio, Facebook, Instagram, Threads, scheduled posts) works unchanged.
10. **Web: "Clip Factory" page** (Work menu): upload a long video (parts upload, existing) + optional prompt +
    project + clip length range → progress → a grid of clips sorted by score (thumbnail, score with sub-scores
    tooltip, duration, hook) → open one to preview, change hook/caption style/reframe mode, re-render, **Approve**
    (→ draft) or **Discard**. Phone 390 px and dark mode must work.
11. **Built-in agent "Clip Factory"** (`packages/agents/src/clipFactory.ts`) + skill `clip-factory-playbook`
    (what makes a good short: hook in 3 s, one idea per clip, end on a punchline/CTA; BM examples). Seeded
    enabled, pinned to nothing (the program routing sends it to a runner with ffmpeg/whisper).

## Tests and proof
Pure logic tested (windows/merge, sentence-boundary snapping, scores, crop path smoothing, caption timing,
B-roll placement rules). Hub/runner tests with fakes (vision, scoring model, TTS, video-gen). **A real run** on the
owner's sample `C:\Users\Hazman\Desktop\Sample video MyOfis\4-ujian-meeting-cowbarn.mp4` and one longer talk
video of your choice with a free licence (state the source): report the clips, scores, reasons, contact sheets
and render times. `bun run typecheck`, full `bun test`, `bun run --cwd apps/web build`, screenshots of the page.
Split the work into commits-sized steps in the report (Claude reviews step by step).

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, then do `tasks/gemini/028-clip-factory-opusclip.md`. It is big: work in the
> numbered order, keep each step working and tested, and write `tasks/gemini/028-report.md` as you go. Do not commit.
