# 031 report

## Step 1 (Shared + buildEditArgs keep_aspect) — DONE
- Added `HdTarget`, `HD_TARGETS`, `HdPlan`, `hdPlan()`, and WhatsApp constants (`WA_MAX_EDGE = 1280`, `WA_MAX_MBPS = 2.5`, `WA_STATUS_MAX_SECONDS = 60`, `WA_MAX_MB = 64`) in `packages/shared/src/video.ts`, keeping `tiktokHdPlan()` as a signature-compatible wrapper over `hdPlan(p, "tiktok", m)`.
- Added `whatsapp_hd` (`keep_aspect: true`, `max_mbps: 2.5`, `audio_kbps: 128`) and `whatsapp_v` (`720×1280`, `max_mbps: 2.5`, `audio_kbps: 128`) presets. Chose `keep_aspect: true` on `whatsapp_hd` in `buildEditArgs` (`packages/tools/src/video.ts`) so any input aspect ratio (16:9 → 1280×720, 9:16 → 720×1280, 1:1 → 720×720, 4:3 → 1280×960) scales cleanly with even dimensions and zero crop/blur/padding, while existing presets run the exact unchanged filter path.
- Added 5 unit tests in `packages/tools/test/video.test.ts`.
- `bun run typecheck`:
```
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```
- `bun test packages/tools/test/video.test.ts`:
```
 26 pass
 0 fail
 130 expect() calls
Ran 26 tests across 1 file. [11.56s]
```

## Step 2 (Tool `video_hd` + registries) — DONE
- Added `videoHdTool` (`video_hd {video, target, mode}`) and `isHdPrepared(name, target)` in `packages/tools/src/video.ts`, exported in `packages/tools/src/index.ts`.
- Kept `video_tiktok_hd` (`videoTiktokHdTool`) and `isTiktokHdPrepared` as thin wrappers returning the exact old output shape (`{ video_id, mode, reasons, before, after }`).
- Registered `video_hd` in `DIRECT_JOBS` (`packages/shared/src/video.ts`), `TOOL_PROGRAMS` (`packages/shared/src/programs.ts`), `editorAgent.tools` and `editorUpgrade.tools` (`packages/agents/src/editor.ts`), `VIDEO_RUN_TOOLS` (`apps/hub/src/core.ts`), `MEMBER_TOOLS` (`apps/hub/src/scope.ts`), and the runner upload gate (`apps/hub/src/http.ts`).
- Updated expected tool count in `apps/hub/test/manual.test.ts` to 61.
- Added real `ffmpeg` (`testsrc2`) render tests for `tiktok`, `whatsapp` (landscape & portrait), and `whatsapp_status` plus `isHdPrepared` and `video_tiktok_hd` output shape tests in `packages/tools/test/video.test.ts`.
- `bun run typecheck`:
```
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```
- `bun test packages/tools/test/video.test.ts`:
```
 28 pass
 0 fail
 152 expect() calls
Ran 28 tests across 1 file. [19.38s]
```
- `bun test apps/hub/test/manual.test.ts`:
```
 3 pass
 0 fail
 18 expect() calls
Ran 3 tests across 1 file. [1304.00ms]
```

## Step 3 (Hub: `studio.ts` + `http.ts`) — DONE
- Added `VIDEO_HD_JOB = "video_hd"`, `Studio.videoHd(uploadId, targets, mode, ws)` (creates one `video_hd` job per target), and `Studio.videoHdList(ws)` (lists both `video_hd` and legacy `tiktok_hd` rows with `target` on each item) in `apps/hub/src/studio.ts`.
- Added `GET /api/video-hd` and `POST /api/videos/:id/hd` in `apps/hub/src/http.ts`, keeping `GET /api/tiktok-hd` and `POST /api/videos/:id/tiktok-hd` as backward-compatible aliases with identical `W(c)` workspace/video guards.
- Added hub test in `apps/hub/test/video.test.ts` verifying two-target job creation, mixed listing with legacy `tiktok_hd` rows, and 404 cross-room isolation.
- `bun run typecheck`:
```
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```
- `bun test apps/hub/test/video.test.ts`:
```
 9 pass
 0 fail
 118 expect() calls
Ran 9 tests across 1 file. [16.36s]
```

## Step 4 (Runner `direct.ts`) — DONE
- Unified `video_hd` and `video_tiktok_hd` in `apps/runner/src/runtimes/direct.ts`.
- Names the target (`Ready for WhatsApp HD…` / `Ready for WhatsApp Status…`, while keeping existing TikTok phrasing intact) and appends any `warnings` (`Warnings: …`).
- Added end-to-end `directRuntime` execution check for `whatsapp` target in `apps/hub/test/video.test.ts`.
- `bun run typecheck`:
```
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```
- `bun test apps/hub/test/video.test.ts`:
```
 9 pass
 0 fail
 122 expect() calls
Ran 9 tests across 1 file. [21.05s]
```

## Step 5 (Web: `VideoHdView.vue` + router + `AppShell.vue` + `api/http.ts`) — DONE
- Created `apps/web/src/views/VideoHdView.vue` with multi-select target chips (`TikTok HD`, `WhatsApp HD`, `WhatsApp Status`, persisted in `localStorage`), mode selector (`auto`/`remux`/`reencode`), upload progress, results grouped by source video (1 row per target with badge, status, before→after notes, warnings banner, preview, Download), `"Caption & post with TikTok Poster"` on TikTok rows, and `"Nak kualiti asal 100%? Hantar fail asal sebagai Document."` tip on WhatsApp rows.
- Updated `apps/web/src/router.ts` (`/video-hd` -> `VideoHdView.vue`; `/tiktok-hd` redirects to `/video-hd?target=tiktok`), `apps/web/src/components/shell/AppShell.vue` (desktop + phone menu items renamed to `"Video HD"`), and `apps/web/src/api/http.ts` (`VideoHdItem`, `videoHdList`, `videoHd`).
- `bun run typecheck`:
```
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```
- `bun run --cwd apps/web build`:
```
✓ built in 3.53s
```

## Step 6 (Docs: `CLAUDE.md`, `docs/manual.html`, `README.md`) + Final Verification — DONE
- Updated `CLAUDE.md` (replaced the TikTok HD section under "TikTok HD + two TikTok agents + Storage" with Video HD summary), `README.md` (added Video HD `/video-hd` note), and `docs/manual.html` (added section `39. Video HD`).

### Final raw command outputs
- `bun run typecheck`:
```
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```
- `bun run --cwd apps/web build`:
```
dist/assets/office3d-Ce6K-Ufs.js                                    512.72 kB │ gzip: 132.41 kB
dist/assets/chunk-FOHPRMQF-DD4dKubD.js                              662.08 kB │ gzip: 143.15 kB
dist/assets/game-CM8GfKKr.js                                      1,205.83 kB │ gzip: 322.30 kB

✓ built in 2.56s
```
- Full `bun test`:
```
1 tests skipped:
(skip) motion_render with real hyperframes CLI > renders hook template to MP4 and uploads it as a video attachment

 411 pass
 1 skip
 0 fail
 4329 expect() calls
Ran 412 tests across 73 files. [189.43s]
```

## Screenshots (outside the repo, captured against preview hub + real ffmpeg runner, all visually inspected)
- Desktop Light (1440×900) — `/video-hd` with all 3 targets done (`WhatsApp Status`, `WhatsApp HD`, `TikTok HD`):
  `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\desktop-light_video-hd.png`
- Desktop Dark (1440×900) — `/video-hd` with all 3 targets done:
  `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\desktop-dark_video-hd.png`
- Phone Light (390×844) — `/video-hd` with all 3 targets done:
  `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\phone-light_video-hd.png`
- Phone Dark (390×844) — `/video-hd` with all 3 targets done:
  `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\phone-dark_video-hd.png`

## Owner check (sending real WhatsApp outputs)
1. Open **Work → Video HD** (`/video-hd`), tick **WhatsApp HD** and **WhatsApp Status**, and upload a raw 1080p/4K phone video.
2. Download both `-wa-hd.mp4` and `-wa-status.mp4` to your phone.
3. In WhatsApp chat, attach `-wa-hd.mp4`, tap the **HD** icon at the top of the preview, send it, and compare sharpness/detail against sending the raw 4K video with HD on.
4. Post `-wa-status.mp4` to **WhatsApp Status** and confirm it fills 9:16 cleanly without awkward cropping or heavy compression.
5. (Optional) Send the original raw video as **Document** to verify 100% untouched quality.

## What I did NOT do or could not check, and why
- Did not send the generated outputs through the real WhatsApp mobile app (requires the owner's phone/WhatsApp account; steps listed above).
- Did not delete `apps/web/src/views/TikTokHdView.vue` (kept untouched per `SUPERVISOR.md` rule not to delete existing files; `/tiktok-hd` now redirects to `/video-hd?target=tiktok`).
- Did not commit or push to git.

## Questions for the owner / Claude
- None; ready for `semak 031`.
