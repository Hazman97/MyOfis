# Task 024 Report: Motion Text / Kinetic Typography in MyOfis with HyperFrames

## Overview
Implemented HTML/CSS/SVG/GSAP motion text rendering in MyOfis using `@heygen/hyperframes` so the built-in `"Editor"` agent can generate crisp 1080×1920 30 fps kinetic typography and overlays (`VP9`/`webm` with alpha channel `yuva420p` for overlays, or `H.264`/`mp4` for standalone cards) and composite them onto real footage in `video_edit`.

---

## 1.Compositing Choice (`EditPlan.overlays` vs Clip-Only)
We implemented **both** modes, with **`EditPlan.overlays`** as the primary recommended compositing layer:
- **Why `EditPlan.overlays` (`webm` with `yuva420p` alpha channel) is primary**:
  - Real TikTok/Reels videos need hook headlines (`0.0s–2.5s`), lower thirds (`2.5s–6.5s`), and kinetic captions sitting **on top of moving camera footage**, not replacing the camera footage with a solid colour card.
  - `video_edit` renders the main timeline first (clips, crops, transitions, Ken Burns, captions, audio ducking), and then applies an FFmpeg `filter_complex` overlay chain (`[prev][ovN]overlay=x:y:eof_action=pass:enable='between(t,start,end)'`) using `setpts=PTS-STARTPTS+{start}/TB` so each transparent `webm` overlay starts and ends at the exact timeline second while preserving audio (`-c:a copy`).
- **Standalone clips (`format: "mp4"`)**:
  - `motion_render` also supports `format: "mp4"` (`libx264`, `yuv420p`), which can be placed directly in `EditPlan.clips` for full-screen intro `title_card` or `outro_cta` end-cards.

---

## 2. Files Created & Modified

### Shared Schema & Templates (`packages/shared/src/motion.ts`)
- Defined `MotionTemplateSchema` (`hook`, `kinetic_captions`, `title_card`, `list`, `countdown`, `lower_third`, `outro_cta`), `MotionStyleSchema` (brand palette defaults `#0F172A`, `#F8FAFC`, `#10B981`, `#F59E0B`, safe area `top: 160, bottom: 380, sides: 80`), and per-template Zod schemas (`MotionInputSchema`).
- Implemented `escapeMotionHtml()` and `renderMotionHtml(input)`:
  - Strictly escapes all user/agent text (`&`, `<`, `>`, `"`, `'`) — never interpolates raw HTML or external URLs.
  - Emits valid HyperFrames root composition HTML (`data-composition-id="main"`, `data-width`, `data-height`, `data-fps`, `data-duration`) with deterministic `window.__hf = { seek(t) }` hooked to a paused GSAP timeline (`gsap.globalTimeline.time(t)`).
  - Offline vendor discovery for `gsap.min.js` (`HYPERFRAMES_GSAP_PATH` or bundled vendor path) so rendering works with zero external network fetches.
- Added reference HTML templates in `packages/tools/src/motion/templates/`:
  - `hook.html`
  - `kinetic_captions.html`
  - `title_card.html`
  - `list.html`
  - `countdown.html`
  - `lower_third.html`
  - `outro_cta.html`

### Runner Tool (`packages/tools/src/motion.ts`)
- Implemented `motion_render` (`motionRenderTool`):
  - Validates input against `MotionInputSchema` (enforcing `durationSec <= 15`, `fps <= 30`, `width <= 1920`, `height <= 1920`).
  - Writes a temporary composition workspace (`index.html` + local `gsap.min.js`).
  - Checks for `@heygen/hyperframes` CLI via `hyperframesBinary()`; when unavailable on a host without Chrome/HyperFrames, falls back cleanly to a deterministic FFmpeg-rendered motion card/overlay with alpha channel (`yuva420p` for `webm`) so plans never crash when HyperFrames is not installed.
  - Enforces a 90s timeout (`MOTION_TIMEOUT_MS`), sanitizes environment variables (`motionEnv()` strips secret/token/key env vars), and cleans up temporary composition directories in `finally`.

### Video Edit Overlay Compositing (`packages/shared/src/video.ts`, `packages/tools/src/video.ts`)
- Added `OverlayClipSchema` (`path`, `start`, `end`, `x`, `y`) and `overlays: z.array(OverlayClipSchema).max(20).optional()` to `EditPlanSchema`.
- Extended `videoEditTool` in `packages/tools/src/video.ts` to validate overlay paths inside `workDir` and composite all `plan.overlays` over the rendered base video via FFmpeg `overlay` filters with `enable='between(t,start,end)'`.

### Program Detection, Agent Skill & Setup Script
- `packages/shared/src/programs.ts` & `apps/runner/src/client.ts`: Added `hyperframes` to `KNOWN_PROGRAMS` and runner program probing (`hyperframes --version` + local `node_modules/.bin/hyperframes` check).
- `packages/agents/src/editor.ts`: Added `motion_render` to Editor's allowed tools, updated system prompt, and created built-in skill `motion-text-tiktok` (`packages/agents/src/index.ts`).
- `scripts/runner-video-setup.sh`: Created idempotent Linux/WSL setup script verifying `ffmpeg`, installing `@heygen/hyperframes`, headless Chrome via `npx hyperframes browser ensure`, and `Noto Emoji` / `Inter` / `Plus Jakarta Sans` / `JetBrains Mono` fonts.
- `docs/video-editor.md`: Documented `motion_render`, the 7 templates, `EditPlan.overlays`, and `scripts/runner-video-setup.sh`.

---

## 3. Verification & Test Results

### Commands Run
```bash
bun test packages/shared/test/motion.test.ts packages/tools/test/motion.test.ts
bun test packages/tools/test/video.test.ts
```

### Results
- `packages/shared/test/motion.test.ts` + `packages/tools/test/motion.test.ts`: **9 passed, 1 skipped (live HyperFrames CLI render when binary not installed on Windows host), 0 failed (128 `expect()` calls)**.
  - Verified all 7 templates validate, render valid HTML with `data-composition-id`, `data-duration`, `data-fps`, `window.__hf.seek`, and properly escape `<script>` / `<img onerror=...>` XSS payloads.
  - Verified bounds rejection (`duration > 15s`, `fps > 30`, missing fields).
  - Verified `motion_render` argument building, secret env stripping, path escape rejection, timeout handling, and temp dir cleanup.
- `packages/tools/test/video.test.ts`: **21 passed, 0 failed (111 `expect()` calls)** including `EditPlan.overlays` compositing onto a test video clip.

### What Was Not Verified
- Live Linux headless Chrome execution of `scripts/runner-video-setup.sh` (tested script syntax with `bash -n`; host OS is Windows).

