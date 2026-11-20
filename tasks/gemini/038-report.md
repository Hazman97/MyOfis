# Task 038 Report: Public Video HD (`/video-hd/public`)

> Security-sensitive task: public no-login endpoints (`/api/public/hd/*`, `/video-hd/public`) strictly isolated from the owner's DB, storage, events, and `/api/*` routes.

---

## Build Steps Completed
1. **Separate storage & env:**
   - `apps/hub/src/env.ts`: Added `PUBLIC_HD_DIR` (default `./data/public-hd`), `PUBLIC_HD_TURNSTILE_SITE_KEY`, `PUBLIC_HD_TURNSTILE_SECRET`, and `TURNSTILE_API_BASE`.
   - `apps/hub/src/publicHd.ts`: Creates `incoming/`, `out/`, and isolated `public-hd.db` (`public_hd_jobs`, `public_hd_access_log`, `public_hd_meta`). Not backed up or mirrored by `backup.ts`.
   - `apps/hub/src/diskUsage.ts`: Added `public-hd` ("Public Video HD") row to Settings → Storage.
2. **Hub-side `PublicHd` queue:**
   - `packages/tools/src/video.ts` & `packages/tools/src/index.ts`: Exported `HD_SUFFIX`, `HD_PRESET`, `ffmpegBin`, `ffprobeBin`, and pure `buildHdArgs(...)` reusing `hdPlan()` + `remuxArgs()` / `buildEditArgs()`.
   - `apps/hub/src/publicHd.ts`: Single-worker queue running `ffmpeg` directly at `setPriority(pid, 19)`, probing with `ffprobe` first (refuses non-videos), deleting `incoming/<id>.input` immediately on completion or failure, writing zero rows to owner `jobs`, `runs`, `uploads`, or `events`.
3. **Limits & Turnstile:**
   - `packages/shared/src/video.ts` & `apps/hub/src/integrations.ts`: Added `PublicHdSettingsSchema` (`enabled: false`, `max_mb: 500`, `max_minutes: 10`, `per_ip_hour: 3`, `per_ip_day: 6`, `daily_total: 30`, `max_queue: 5`, `storage_cap_gb: 20`, `retention_hours: 24`) under settings key `public_hd`.
   - `apps/hub/src/publicHd.ts`: HMAC-SHA256 IP hashing (`CF-Connecting-IP` with `SECRETS_KEY`), optional Turnstile Siteverify check on first part, storage cap check with one-time Telegram alert, 24h output sweep + 30-day access log sweep.
4. **Public Routes (`apps/hub/src/http.ts`):**
   - Registered `/api/public/hd/config`, `PUT /api/public/hd/parts/:key`, `/api/public/hd/jobs/:id`, and `/api/public/hd/jobs/:id/file/:target` (with `Range`, `content-disposition`, and `x-robots-tag: noindex`) before `app.route("/api", api)` so `requireUser` never runs on them while all other `/api/*` routes remain protected.
5. **Self-contained HTML (`apps/hub/src/publicHdPage.ts`):**
   - Served at `GET /video-hd/public` before static assets / SPA fallback; inline CSS + JS only (no Vite bundle, no `/assets`), BM UI, light/dark toggle, 390 px responsive layout, chunked upload progress, queue position, download buttons, WhatsApp Document tip, and 24-hour notice.
6. **Owner Side & Daily Digest:**
   - `apps/web/src/api/http.ts`, `apps/web/src/views/IntegrationsView.vue`, `apps/hub/src/http.ts`: Owner card in Settings → Integrations with enable toggle, all 8 limits, today's count, storage used, Turnstile warning when unconfigured, and "Padam semua sekarang".
   - `apps/hub/src/server.ts`: Runs `publicHd.sweep()` and sends the 21:00 KL 1-line Telegram digest via `publicHd.dailyDigestIfDue()`.
7. **Docs:**
   - Added `docs/public-video-hd.md` (Cloudflare Access Bypass paths `video-hd/public` & `api/public/hd`, optional Turnstile, WAF rate limit) and added a bullet in `CLAUDE.md`.

---

## Test Output (`apps/hub/test/public-hd.test.ts`)

```text
$ bun test apps/hub/test/public-hd.test.ts
(pass) Task 038: Public Video HD (/video-hd/public) > Isolation: no-cookie owner routes stay 401/404, public page has no /assets, owner DB counts stay unchanged [1453.00ms]
(pass) Task 038: Public Video HD (/video-hd/public) > Limits: disabled, max_mb, not-a-video, too-long, per-IP hour/day, daily total, queue full, storage cap + Telegram alert, Turnstile [8015.00ms]
(pass) Task 038: Public Video HD (/video-hd/public) > Real 60s 1080p clip + phone clip across all 3 targets, Range download, input deleted, 24h sweep + 21:00 KL digest [56782.00ms]
 3 pass
 0 fail
 85 expect() calls
Ran 3 tests across 1 file. [66.84s]
```

---

## Preview Hub Run (`http://127.0.0.1:8811`, temp DB + temp `PUBLIC_HD_DIR`)

### `ffprobe` Results (60s 1080p clip & 5s 720×1280 phone clip across all 3 targets)
```json
{
  "60s_1080p": {
    "tiktok": {
      "codec_v": "h264",
      "width": 1080,
      "height": 1920,
      "r_frame_rate": "30/1",
      "codec_a": "aac",
      "duration": 60,
      "size_bytes": 56669477
    },
    "whatsapp": {
      "codec_v": "h264",
      "width": 1280,
      "height": 720,
      "r_frame_rate": "30/1",
      "codec_a": "aac",
      "duration": 60,
      "size_bytes": 19676559
    },
    "whatsapp_status": {
      "codec_v": "h264",
      "width": 720,
      "height": 1280,
      "r_frame_rate": "30/1",
      "codec_a": "aac",
      "duration": 60,
      "size_bytes": 19761576
    }
  },
  "phone_720x1280": {
    "tiktok": {
      "codec_v": "h264",
      "width": 1080,
      "height": 1920,
      "r_frame_rate": "30/1",
      "codec_a": "aac",
      "duration": 5,
      "size_bytes": 7901474
    },
    "whatsapp": {
      "codec_v": "h264",
      "width": 720,
      "height": 1280,
      "r_frame_rate": "30/1",
      "codec_a": "aac",
      "duration": 5,
      "size_bytes": 1727802
    },
    "whatsapp_status": {
      "codec_v": "h264",
      "width": 720,
      "height": 1280,
      "r_frame_rate": "30/1",
      "codec_a": "aac",
      "duration": 5,
      "size_bytes": 1727802
    }
  }
}
```
`INCOMING_FILES_AFTER: []`

### Screenshots (outside the repo, visually inspected via `read_file`)
- Desktop Light (`/video-hd/public`): `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\public-hd-desktop-light.png`
- Desktop Dark (`/video-hd/public`): `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\public-hd-desktop-dark.png`
- Phone 390px Light (`/video-hd/public`): `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\public-hd-phone-light.png`
- Phone 390px Dark (`/video-hd/public`): `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\public-hd-phone-dark.png`
- Owner Card (`/settings/integrations`): `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\public-hd-owner-card.png`

---

## Final Verification (Raw Output)

```text
$ bun run typecheck
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
(exit 0)

$ bun test
1 tests skipped:
(skip) motion_render with real hyperframes CLI > renders hook template to MP4 and uploads it as a video attachment

 416 pass
 1 skip
 0 fail
 4460 expect() calls
Ran 417 tests across 74 files. [289.26s]

$ bun run --cwd apps/web build
✓ 4101 modules transformed.
✓ built in 2.80s
```
