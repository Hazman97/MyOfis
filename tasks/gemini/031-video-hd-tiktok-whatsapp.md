# Task 031: one "Video HD" place for TikTok HD + WhatsApp HD + WhatsApp Status

Read `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md` (honesty rules) first.
Write `tasks/gemini/031-report.md`. Do not commit.

## Why
The owner (2026-11-18): "alang-alang better buat 1 tempat je". Today TikTok HD is its own tool, job, page and menu
item. He also wants the same thing for WhatsApp:
- a video that keeps its quality when sent in a chat with **HD** on;
- a video for **Status**.

**One page, one tool, one job type.** The target is a choice, and the owner can tick more than one target for the
same upload.

## Facts from the code (read these first)
- **`packages/shared/src/video.ts`:**
  - `VideoPresetId` / `VIDEO_PRESETS` (tiktok_fhd 1080×1920 …);
  - `TikTokHdMode`, `TikTokHdFacts`, `TikTokHdPlan`;
  - `tiktokHdPlan()` with the constants `TIKTOK_MAX_SECONDS` / `TIKTOK_HD_MAX_MB` / `TIKTOK_HD_MAX_MBPS`.
- **`packages/tools/src/video.ts`:**
  - `remuxArgs()`, `isTiktokHdPrepared()`, `videoTiktokHdTool` (`video_tiktok_hd`): auto → remux or a re-encode
    through `videoEditTool` with preset `tiktok_fhd`;
  - `buildEditArgs` and the encoder lines with `-maxrate` (around line 230).
- **Hub:**
  - `apps/hub/src/studio.ts`: `TIKTOK_HD_JOB = "tiktok_hd"`, `tiktokHd()`, `tiktokHdList()`;
  - `apps/hub/src/http.ts`: `GET /tiktok-hd`, `POST /videos/:id/tiktok-hd`, and the runner upload gate around
    line 455 that lists `video_tiktok_hd`;
  - `apps/hub/src/scope.ts`, `core.ts`.
- **Runner:** `apps/runner/src/runtimes/direct.ts` (the `video_tiktok_hd` branch and its message).
- **Shared:**
  - `packages/shared/src/programs.ts` (`video_tiktok_hd: "ffmpeg"`);
  - `DIRECT_JOBS` and `VIDEO_RUN_TOOLS` (grep).
- **Agents:** `packages/agents/src/editor.ts` and `tiktokPoster.ts` use `video_tiktok_hd`. **The owner's DB stores
  this tool name in agent configs**, so it must keep working.
- **Web:**
  - `apps/web/src/views/TikTokHdView.vue`, router `/tiktok-hd`;
  - AppShell menu items (desktop line ~114, phone ~134);
  - `api.tiktokHd` / `api.tiktokHdList` in `apps/web/src/api/http.ts`.
- **Tests:** `packages/tools/test/video.test.ts` (tiktokHdPlan cases, `isTiktokHdPrepared`), `apps/hub/test/video.test.ts`.

## WhatsApp facts (checked 2026-11-18; third-party sources, not WhatsApp's own docs)
- WhatsApp **always re-encodes** what it sends:
  - **HD** gives at most **720p** (long edge 1280);
  - **Standard** gives 480p.

  1080p/4K is downscaled anyway, so the goal is a file WhatsApp barely touches: already 720p, H.264, about
  1.5–2.5 Mbit/s, 8-bit 4:2:0, AAC, constant frame rate, 30 fps.
- **Status:** vertical is best (720×1280). Keep Status clips short. The length limit seen is 60 s per Status, and
  longer ones are split by the app; keep it a named constant `WA_STATUS_MAX_SECONDS = 60` with a comment saying it
  is unverified.
- **Size limits:** reports differ (16 / 64 / 100 MB). Use `WA_MAX_MB = 64` as a soft warning only, never a hard
  refusal.
- **Truly original quality:** send the file as a **Document**; WhatsApp does not compress documents (up to 2 GB).
  The page shows this as a tip.
- Put these numbers as constants with one comment each. Do not invent extra limits.

## Build
1. **Shared (pure, tested):**
   - `HdTarget = z.enum(["tiktok", "whatsapp", "whatsapp_status"])`.
   - `HD_TARGETS`: `{label, width, height, keep_aspect, fps: "30|60" | 30, max_mbps, audio, max_seconds?, soft_max_mb}`:
     - **tiktok:** today's values (1080×1920, crop/blur, 30/60, ≤ 30 Mbit/s, 280 MB, 600 s); `tiktokHdPlan` must
       give exactly today's results.
     - **whatsapp:** long edge 1280, **keeps orientation and aspect** (portrait 720×1280, landscape 1280×720,
       square 720×720, others scaled to fit with even sizes; **no crop, no blur, no padding**), 30 fps, target
       2 Mbit/s with maxrate 2.5, AAC 128 kbit/s, soft 64 MB.
     - **whatsapp_status:** 720×1280 9:16 (crop when close to 9:16, else blur, the same rule as tiktok), 30 fps,
       2 Mbit/s, AAC 128 kbit/s, warning above `WA_STATUS_MAX_SECONDS` ("WhatsApp will split it into N parts").
   - `hdPlan(facts, target, mode)` → `{mode, reasons, fps, fit, warnings}`.
     - Remux only when the file already fits the target. For WhatsApp: H.264, AAC (or no sound), long edge ≤ 1280,
       ≤ 2.5 Mbit/s, CFR, 8-bit, no rotation.
     - Reasons stay in plain English, as today.
     - Keep `tiktokHdPlan(p, m) = hdPlan(p, "tiktok", m)` minus `warnings` (an unchanged signature), so the old tests
       still pass **without edits**.
   - New presets: `whatsapp_v` (720×1280), `whatsapp_h` (1280×720) and `whatsapp_square` (720×720), max_mbps 2.5,
     audio 128.
     - Or one preset with `keep_aspect: true`, handled in `buildEditArgs` by scaling the long edge to 1280 with no
       crop. **Pick one approach, say why in the report**, and test the ffmpeg args.
     - Whichever you pick, the existing presets must render byte-identical args.
2. **Tool `video_hd {video, target, mode}`** (`packages/tools/src/video.ts`):
   - It generalises `videoTiktokHdTool`.
   - Output names: `<base>-tiktok-hd.mp4`, `<base>-wa-hd.mp4`, `<base>-wa-status.mp4`.
   - `isHdPrepared(name, target)` replaces `isTiktokHdPrepared`; keep the old function as a wrapper.
   - **Keep `video_tiktok_hd`** as a thin wrapper: the same input as today, target fixed to tiktok, the same
     output shape. The owner's DB agents and the TikTok Poster prompt keep working.
   - Add `video_hd` to:
     - `programs.ts` (ffmpeg);
     - the hub upload gate in `http.ts`;
     - `VIDEO_RUN_TOOLS` / `DIRECT_JOBS`;
     - the Editor's tools through the existing `BuiltinAgent.upgrade` mechanism (`seeded.tool.<slug>.<tool>`). Do
       not hand-edit the owner's DB.
3. **Job + routes** (`apps/hub/src/studio.ts`, `http.ts`):
   - Job type **`video_hd`** with `input.target`.
   - `Studio.videoHd(uploadId, targets[], mode, ws)` creates one job per target and returns them.
   - `Studio.videoHdList(ws)` lists both the new jobs and old `tiktok_hd` rows (target `tiktok`), with `target` on
     each item.
   - Routes `POST /api/videos/:id/hd {targets: HdTarget[], mode}` and `GET /api/video-hd`.
   - Keep `POST /videos/:id/tiktok-hd` and `GET /tiktok-hd` as aliases (same guards).
   - Room scoping and guards are exactly as today (`W(c)`, upload workspace check, video only).
4. **Runner** `direct.ts`:
   - one branch for `video_hd` / `video_tiktok_hd`;
   - the message names the target ("Ready for WhatsApp HD…");
   - it lists warnings (Status length, soft size).
5. **Web:**
   - Rename the page to **Video HD**: `views/VideoHdView.vue`, route `/video-hd`; `/tiktok-hd` redirects to
     `/video-hd?target=tiktok`.
   - The menu item is "Video HD" (desktop + phone).
   - **Upload area:** target chips **TikTok HD · WhatsApp HD · WhatsApp Status** (multi-select; remember the last
     choice in localStorage in try/catch), the mode select (Auto / Copy only / Re-encode), then upload.
   - **Results:** grouped by source video. One row per target with a badge, before → after (size, fps, MB),
     reasons, warnings, and **Download**.
     - TikTok rows keep "Caption & post with TikTok Poster".
     - WhatsApp rows show the tip: "Nak kualiti asal 100%? Hantar fail asal sebagai **Document**."
   - Keep the polling behaviour (no new polling loops).
   - Phone 390 px, light + dark.
6. **Docs:**
   - the CLAUDE.md line under "TikTok HD + two TikTok agents + Storage" becomes Video HD (short);
   - `docs/manual.html` section;
   - README line.

## Tests and proof
- **Pure:**
  - every `hdPlan` target: an already-fitting file → remux;
  - a phone 4K HEVC 10-bit VFR file → re-encode with reasons;
  - a landscape file for whatsapp keeps 16:9 (1280×720), and a portrait one gives 720×1280;
  - 61 s for Status → the warning;
  - the old `tiktokHdPlan` tests unchanged and green.
- **`buildEditArgs`:** WhatsApp args (scale, maxrate 2.5M, AAC 128k, 30 fps); existing preset args unchanged
  (snapshot the current ones before you start).
- **Hub:**
  - `POST /videos/:id/hd` with two targets → two jobs;
  - the old alias still works;
  - another room's upload → 404;
  - the list includes old `tiktok_hd` rows.
- **Tool:**
  - a real ffmpeg render of a short generated test clip for each target (`ffmpeg -f lavfi testsrc2`), checked
    with ffprobe for size, fps, codecs and bitrate ≤ cap;
  - `video_tiktok_hd` still returns its old output shape.
- **Commands:** `bun run typecheck`, the **full** `bun test`, `bun run --cwd apps/web build`. Paste the final lines.
- **Screenshots** against a preview hub (see CLAUDE.md "Screenshots now need a preview hub"): the page with all
  three targets done, phone 390 + desktop, light + dark.
- **Owner check, not yours:** sending the WhatsApp outputs through a real WhatsApp. Write the exact steps for him in
  the report.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/031-video-hd-tiktok-whatsapp.md`
> one Build step at a time (1 shared → 2 tool → 3 hub → 4 runner → 5 web → 6 docs). After each step run
> `bun run typecheck` and the tests of the files you touched, and append a short note to `tasks/gemini/031-report.md`
> before starting the next step, so the work survives if you are stopped. Keep `video_tiktok_hd` and the old routes
> working. Paste raw command output only. Do not commit.
