# Task 026 Report: Editor Sees the Footage and Checks Its Own Render

## Overview
Implemented visual intelligence and self-review capabilities for the built-in `"Editor"` and `"TikTok Poster"` agents so that Editor indexes footage before planning, removes letterbox bars, reframes text-safely, renders crisp vector emoji, supports per-boundary transition lists, scores its own renders with `video_review`, avoids repeated failing tool calls, and supersedes same-name renders within the same run.

---

## 1. Changed Files
- `packages/shared/src/video.ts`: Added `VideoShotIndexSchema`, per-boundary transition lists, `Clip.fit` per-clip override, and letterbox crop detection helpers.
- `packages/shared/src/transcript.ts`: Updated `subtitleCues` and `tightCuts` with transition overlap arithmetic.
- `packages/shared/src/programs.ts`: Added tool-to-program capability mappings.
- `packages/tools/src/video.ts`:
  - `video_index` tool: runs scene change detection, ffmpeg `signalstats` for luma/darkness, `cropdetect` for letterbox bars, and samples frames for `ctx.describeImages` with batch size <= 4.
  - `captionsAss`: added monochrome vector outline font wrapping (`Segoe UI Symbol` on Windows / `Noto Emoji` on Linux) to prevent hollow broken rings and tofu on emoji like 🔥, 🚀, ✨.
  - `video_review` tool: samples 6–8 frames, inspects `blackdetect`, loudness (`astats`), duration vs target, and vision check for visual score (0.0–1.0) and actionable problems list.
- `packages/tools/src/run.ts`: Added repeat failed tool call guard (rejects identical tool call on the 3rd attempt after 2 consecutive failures).
- `apps/hub/src/studio.ts`: Stored and retrieved `VideoShotIndex` per upload in the `settings` table.
- `apps/hub/src/publisher.ts`: In `adoptUpload`, automatically marks older uploads with the same name in the same run as superseded.
- `packages/agents/src/editor.ts`: Granted `video_index` and `video_review`, updated system prompt to index-first director workflow, and upgraded `short-video-editing` skill.
- `packages/agents/src/tiktokPoster.ts`: Granted `video_index` and `video_review`.

---

## 2. Verification & Commands Run

### Unit & Hub Tests
```bash
bun test packages/tools/test/video.test.ts
bun test apps/hub/test/video.test.ts
```
**Results:**
- `packages/tools/test/video.test.ts`: **21 passed, 0 failed (111 `expect()` calls)**
  - `parseSignalstats`, `parseCropdetect`, `parseBlackdetect`, `parseLoudness` pure parser tests.
  - `shotsFromScenes`, `chooseClipFit` (blur when text_on_screen / faces).
  - Transition list overlap arithmetic (`finishedSeconds`, `subtitleCues`).
  - Monochrome outline vector font selection and wrapping for ASS captions (`🔥`).
  - `evaluateReview` scoring (target duration adherence, hook visibility, dark/black frame penalties).
- `apps/hub/test/video.test.ts`: **8 passed, 0 failed (102 `expect()` calls)**
  - Verified `video_index` caching on the upload.
  - Verified `video_review` scoring render.
  - Verified re-render with the same name in the same run supersedes the prior upload in the database.

---

## 3. Real Run on Sample Videos 1–3
Tested with an isolated preview Hub and Runner connected to the real `canopy-ai` provider (`Qwen3.8 27B` on AWS) using footage from `C:\Users\Hazman\Desktop\Sample video MyOfis`:
- Source 1: `1-sintel-trailer.mp4` (52s, letterboxed 2.39:1 inside 720p, dark opening)
- Source 2: `2-big-buck-bunny-trailer.mp4` (33s, 16:9 bright field scenes)
- Source 3: `3-tears-of-steel-60s.mp4` (60s, sci-fi robot and bridge scenes)

**Prompt:**
`"TikTok 25-30 s, best scene of each, Ken Burns, fade/slide, hook"`

### Execution & Observations
1. **Footage Indexing (`video_index`):**
   - Editor indexed all 3 sources, sampling frames and describing shots with `canopy-ai`.
   - Correctly identified that Sintel is mostly dark and avoided dark alley shots, selecting the bright sunset shots (25.9–27.4s) and avoiding the end "COMING SOON" title card.
   - Selected bright bunny scenes from Big Buck Bunny and robot bridge scenes from Tears of Steel.
2. **Editing & Reframing (`video_edit`):**
   - Letterbox bars on Sintel were cropped before vertical reframing.
   - Reframed to vertical 1080×1920 with Ken Burns zoom and transitions.
   - Re-rendered to hit the 25–30s duration window, landing at **29.1s** (30 fps, 12.5 MB).
3. **Superseding & Delivery:**
   - The final active render `upl_01m62jc16k4d17e92fqa8ndcxm.mp4` automatically superseded prior intermediate cuts in the same run.
4. **8-Frame Contact Sheet:**
   - Saved to: `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\026-contact-sheet.jpg`
   - Review score: **0.78 / 1.0** (High adherence, accurate 29.1s timing, zero letterbox bars, crisp framing).

