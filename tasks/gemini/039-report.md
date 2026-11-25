# 039 report

## Step 1 & 2 (Shared) — Output formats, `SocialPlacement`, `hdOutputsFor`, `storyParts`
- Added `feed_4x5` preset to `VideoPresetId` / `VIDEO_PRESETS`, and extended `HdTarget` / `HD_TARGETS` / `hdPlan` with `vertical`, `story`, `feed_4x5`, `square` (keeping `tiktok`, `whatsapp`, `whatsapp_status` intact) in `packages/shared/src/video.ts`.
- Added `SocialPlacement`, `PLACEMENT_TARGET`, `SOCIAL_PLACEMENTS`, `PLACEMENT_INFO`, `hdOutputsFor()`, `storyParts()`, and `PublicHdSettingsSchema.max_files` (default `4`).
- `bun test packages/shared/test/video.test.ts`:
```text
 3 pass
 0 fail
 30 expect() calls
Ran 3 tests across 1 file. [283.00ms]
```

## Step 2 (Tools & Agent Upgrades) — `buildHdArgs`, `video_hd(placements)`, Story splitting, prompt upgrades
- Extended `HD_SUFFIX`, `HD_PRESET`, `isHdPrepared`, `buildHdArgs` (optional `segment`), and `video_hd` (accepts `placements` + `target`, splits Story > 60 s via `detectStoryCutPoints` + `storyParts`, returns `covers` and `files`) in `packages/tools/src/video.ts` and exported `detectStoryCutPoints` in `packages/tools/src/index.ts`.
- Updated `EDITOR_PROMPT` (`EDITOR_PROMPT_V5` preserved) and `TIKTOK_POSTER_PROMPT` (`TIKTOK_POSTER_PROMPT_V3` preserved, added `video_hd` to `tiktokPosterUpgrade.tools`) via `BuiltinAgent.upgrade`.
- `bun test packages/tools/test/video.test.ts -t "buildHdArgs for vertical"`:
```text
 1 pass
 29 filtered out
 0 fail
 20 expect() calls
Ran 1 test across 1 file. [239.00ms]
```

## Step 3 (Hub, Runner & Public HD)
- `apps/hub/src/studio.ts`: `videoHd()` accepts `HdTarget[] | HdOutputGroup[]` and stores `covers` on `job.input`; `videoHdList()` returns `covers` and `results` (all rendered uploads in order, keeping `result` for backward compatibility).
- `apps/runner/src/runtimes/direct.ts`: formats multi-part Story summaries cleanly.
- `apps/hub/src/publicHd.ts`: enforces `max_files` (default `4`), splits `story` > 60 s via `detectStoryCutPoints` + `storyParts` (`-f <kind>` passed on both `ffprobe` and `ffmpeg` per review 038), serves `story_1..N` via strict validated key/path, and cleans up part files in `sweep()`.
- `apps/hub/src/http.ts`: `GET /api/public/hd/config` exposes `placements` & `placement_target`; `PUT /api/public/hd/parts/:key` and `POST /api/videos/:id/hd` accept both `placements` and legacy `targets`; `GET /api/public/hd/jobs/:id/file/:target` accepts `HdTarget` or `story_<n>`. Guarded identically to existing routes (owner/member `W(c)` on `/api/videos/:id/hd`, isolated public route on `/api/public/hd/*`).
- `bun test apps/hub/test/public-hd.test.ts -t "Task 039"`:
```text
(pass) Task 038: Public Video HD (/video-hd/public) > Task 039: placements merge, max_files limit, and 130s Story clip splits into 3 parts [71547.00ms]

 1 pass
 5 filtered out
 0 fail
 22 expect() calls
Ran 1 test across 1 file. [72.22s]
```

## Step 4 & 5 (Web `/video-hd`, Public `/video-hd/public`, Integrations card)
- `apps/web/src/views/VideoHdView.vue`: grouped platform chips (TikTok · Instagram · Facebook · YouTube · Threads · WhatsApp), **Semua platform** shortcut, live plan line (`N fail akan dibuat: ...`), `localStorage` persistence (`try/catch`), `covers` chips + lazy `▶ Tengok` player + Download per output file (and Story parts in order).
- `apps/hub/src/publicHdPage.ts`: same grouped platform chips (read from `/api/public/hd/config`), **Semua platform** shortcut, plan line with `max_files` check, `covers` pills, Story parts in order, lazy `▶ Tengok` player + `Muat Turun`.
- `apps/web/src/views/IntegrationsView.vue` & `apps/web/src/api/http.ts`: added `Files / job` (`max_files`, default `4`) to Public Video HD settings card, and `placements` + `covers`/`results` types on `api.videoHd` / `VideoHdItem`.

## Step 6 (Docs)
- Added "Platforms" table to `docs/public-video-hd.md`, updated section 39 in `docs/manual.html`, and added Task 039 bullet to `CLAUDE.md`.

## Real Run (temp dirs, preview hub on port 8811, "Semua platform")
Raw `ffprobe` output for 75 s 1920×1080 `testsrc2` clip and 6 s 720×1280 phone clip:
```text
=== land75s (1920x1080, 75s) -> 6 outputs ===
  vertical (covers=tiktok,ig_reels,fb_reels,yt_shorts,threads): size=1080x1920 fps=30 bitrate=7548kbps duration=75s bytes=70761278 mode=reencode
  story_1 (covers=ig_story,fb_story): size=1080x1920 fps=30 bitrate=7556kbps duration=60s bytes=56669366 mode=reencode
  story_2 (covers=ig_story,fb_story): size=1080x1920 fps=30 bitrate=7399kbps duration=15s bytes=13873386 mode=reencode
  feed_4x5 (covers=ig_feed,fb_feed): size=1080x1350 fps=30 bitrate=6448kbps duration=75s bytes=60447276 mode=reencode
  whatsapp (covers=whatsapp): size=1280x720 fps=30 bitrate=2626kbps duration=75s bytes=24620993 mode=reencode
  whatsapp_status (covers=whatsapp_status): size=720x1280 fps=30 bitrate=2633kbps duration=75s bytes=24681859 mode=reencode

=== phone720p (720x1280, 6s) -> 5 outputs ===
  vertical (covers=tiktok,ig_reels,fb_reels,yt_shorts,threads): size=1080x1920 fps=30 bitrate=12666kbps duration=6s bytes=9499271 mode=reencode
  story (covers=ig_story,fb_story): size=1080x1920 fps=30 bitrate=12666kbps duration=6s bytes=9499271 mode=reencode
  feed_4x5 (covers=ig_feed,fb_feed): size=1080x1350 fps=30 bitrate=8676kbps duration=6s bytes=6507112 mode=reencode
  whatsapp (covers=whatsapp): size=720x1280 fps=30 bitrate=2728kbps duration=6s bytes=2045643 mode=reencode
  whatsapp_status (covers=whatsapp_status): size=720x1280 fps=30 bitrate=2728kbps duration=6s bytes=2045643 mode=reencode
```

## Screenshots (visually verified; Playwright closed, zero `chrome-headless-shell` processes left)
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/039-owner-desktop-light.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/039-owner-desktop-dark.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/039-owner-phone-light.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/039-owner-phone-dark.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/039-public-desktop-light.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/039-public-desktop-dark.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/039-public-phone-light.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/039-public-phone-dark.png`

## Commands run (final verification)
- `bun run typecheck`:
```text
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```
(exit 0)
- `bun test`:
```text
 433 pass
 1 skip
 0 fail
 4676 expect() calls
Ran 434 tests across 79 files. [360.09s]
```
- `bun run --cwd apps/web build`:
```text
✓ built in 2.85s
```

## What I did NOT do or could not check, and why
- None (all unit, tool, hub, isolation, real 75 s + 720×1280 runs, screenshots, typecheck, full test suite, and web build ran and passed).
