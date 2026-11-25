# Task 039: Video HD for every social platform (one file per format, not per platform)

Read `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md` (honesty rules) first. Write
`tasks/gemini/039-report.md` (a note after each step). Do not commit.

## Why
The owner will post the same video to TikTok, Instagram, Facebook, Threads and YouTube Shorts. Most of them take the
same file (1080×1920, 9:16, H.264 + AAC). He ticks platforms; the system makes only the files that are really
different, and labels each file with the platforms it covers. Today only `tiktok`, `whatsapp`, `whatsapp_status` exist.

## Facts from the code
- `packages/shared/src/video.ts`: `HdTarget` (zod enum), `HD_TARGETS: Record<HdTarget, HdTargetSpec>`,
  `hdPlan(facts, target, mode)` (pure, tested), `tiktokHdPlan` (compat).
- `packages/tools/src/video.ts`: `buildHdArgs(input, out, probe, target, mode, encoder)` (pure), `HD_SUFFIX`,
  `HD_PRESET`, tools `video_hd` and `video_tiktok_hd`.
- Owner side: `POST /api/videos/:id/hd {targets, mode}`, `GET /api/video-hd` (`Studio.videoHd/videoHdList` in
  `apps/hub/src/studio.ts`), page `apps/web/src/views/VideoHdView.vue` (`/video-hd`).
- Public side: `apps/hub/src/publicHd.ts` + `publicHdPage.ts` (`/video-hd/public`). Keep every rule from review 038
  (magic-byte sniff + `-f`, limits, isolation). See `docs/public-video-hd.md`.
- Compatibility that must keep working: target names `tiktok`, `whatsapp`, `whatsapp_status`; job types `video_hd`
  and `tiktok_hd`; `/api/videos/:id/tiktok-hd`, `/api/tiktok-hd`, the `/tiktok-hd` redirect; stored results of old
  jobs must still render.

## Build
1. **Output formats** (new `HdTarget` values; keep the old three):
   | target | size | notes |
   |---|---|---|
   | `vertical` | 1080×1920 | TikTok, IG Reels, FB Reels, YouTube Shorts, Threads (vertical). Same limits as `tiktok` today. `tiktok` stays as an alias that produces the same file. |
   | `story` | 1080×1920 | IG Story + FB Story. ≤ 25 Mbit/s. Videos longer than 60 s are **split into parts of ≤ 60 s** (`story_1.mp4`, `story_2.mp4`…), cut on a scene change or silence near the limit when one is within 5 s, else at 60 s. |
   | `feed_4x5` | 1080×1350 | IG/FB/Threads feed video. Crop when the source is close to 4:5, else blur-fill (same rule style as `hdPlan`). |
   | `square` | 1080×1080 | optional square feed. |
   | `whatsapp`, `whatsapp_status` | unchanged | |
   Use `hdPlan` + `buildHdArgs` for all of them (extend, do not copy). Splitting is pure logic in shared
   (`storyParts(duration, cutPoints) → [{start,end}]`) with tests.
2. **Platforms → files** (pure, shared, tested): `SocialPlacement` enum (`tiktok`, `ig_reels`, `ig_story`, `ig_feed`,
   `fb_reels`, `fb_story`, `fb_feed`, `yt_shorts`, `threads`, `whatsapp`, `whatsapp_status`) and
   `hdOutputsFor(placements) → [{target, covers: placements[]}]` with duplicates merged. A table `PLACEMENT_TARGET`
   is the single source of truth; the web and the public page read it.
3. **Owner page `/video-hd`:** chips are grouped by platform (TikTok · Instagram · Facebook · YouTube · Threads ·
   WhatsApp), with an "Semua platform" shortcut. Above the button show the plan: "3 fail akan dibuat: Menegak HD (TikTok,
   Reels, Shorts, FB Reels, Threads) · Story (2 bahagian) · WhatsApp HD". Each result shows its `covers` chips, the
   player (`▶ Tengok`, like the public page) and Download. Remember the last choice in localStorage (try/catch).
4. **Public page `/video-hd/public`:** the same platform chips and plan line, same ▶ Tengok / Muat Turun per file
   (story parts listed in order). The settings card limit "targets per job" becomes "files per job" (default 4).
5. **Agent tool `video_hd`:** accepts `placements` as well as `target`; returns every file with `covers`. Update
   the Editor / TikTok Poster prompts only through the built-in upgrade path (`BuiltinAgent.upgrade`), not by hand.
6. **Docs:** a "Platforms" table in `docs/public-video-hd.md` and the manual section 39; a CLAUDE.md bullet.

## Tests and proof
- Shared: `hdOutputsFor` (e.g. TikTok+Reels+Shorts+IG Story → 2 files), every new `hdPlan` target, `storyParts`
  (59 s → 1 part, 61 s → 2, a cut point at 57 s is used, none within 5 s → 60 s).
- Tools: `buildHdArgs` for `vertical`, `story`, `feed_4x5`, `square` (args contain the right scale/crop/pad and
  bitrate caps).
- Hub: old target names still accepted on both owner and public routes; a story job on a 130 s clip returns 3
  parts; public isolation tests from 038 still pass.
- **Real run** (temp dirs, preview hub on 8811): a 75 s 1920×1080 `testsrc2` clip and a 720×1280 phone clip through
  "Semua platform". Paste `ffprobe` (size, fps, bitrate, duration) of every output.
- Screenshots of `/video-hd` and `/video-hd/public` (desktop 1440 + phone 390, light + dark). Follow the browser
  rule in SUPERVISOR.md.
- `bun run typecheck`, the full `bun test`, `bun run --cwd apps/web build`: raw final lines.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/039-video-hd-all-platforms.md`
> step by step, tests after each, notes appended to `tasks/gemini/039-report.md`. Keep the old target names and
> routes working. Use temp DBs and dirs, never the owner's. Paste raw output only; anything not run is NOT RUN.
> Do not commit.
