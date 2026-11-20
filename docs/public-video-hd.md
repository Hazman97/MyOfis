# Public Video HD (`/video-hd/public`)

A public, no-login Video HD page (`TikTok HD`, `WhatsApp HD`, `WhatsApp Status`) served by the hub at `/video-hd/public`, strictly isolated from the owner's Agent Office.

## Isolation & Architecture
- **Separate storage (`PUBLIC_HD_DIR`, default `./data/public-hd`):** stores `incoming/`, `out/`, and `public-hd.db` (its own SQLite database). Not backed up or mirrored by `backup.ts`. Shown as its own row in **Settings → Storage**.
- **Hub-side processing (`PublicHd`):** runs `ffmpeg` directly at low OS priority (`setPriority(pid, 19)`) using the same pure `hdPlan()` + `buildHdArgs()` logic as `video_hd`. Writes **zero** rows to the owner's `jobs`, `runs`, `uploads`, or `events` tables.
- **Self-contained HTML (`GET /video-hd/public`):** inline CSS and JS only — no Vite bundle and no `/assets`.
- **Public API (`GET /api/public/hd/*`, `PUT /api/public/hd/parts/:key`):** registered before `app.route("/api", api)` so `requireUser` never runs on them, while all other `/api/*` routes remain locked.
- **Result files (`GET /api/public/hd/jobs/:id/file/:target`):** served `inline` with Range support (outputs are `+faststart`), so the page's player streams and seeks without a download. `?download=1` answers `attachment` with a clean file name. Both carry `x-robots-tag: noindex`.
- **Retention & logs:** inputs are deleted immediately after processing (or failure); outputs expire after `retention_hours` (default 24 h); access logs (`ip_hash` via HMAC-SHA256 with `SECRETS_KEY`, size, timestamp, result) are kept 30 days.

## What a visitor sees
1. Pick a video, tick one or more targets (TikTok HD, WhatsApp HD, WhatsApp Status) and a mode (Auto / Keep / Re-encode).
2. An upload progress bar, then the queue position while the PC works on it.
3. One row per target with its size, resolution and any warnings, plus two buttons:
   - **▶ Tengok** opens a player under the row (made only when tapped, so nothing streams before that); **✕ Tutup** closes it.
   - **Muat Turun** saves the file (`?download=1`).
4. The notice: videos are deleted after 24 hours.

## Owner switches
Settings → Integrations → **Public Video HD**: on/off (off by default; the page then says "Ditutup sementara"), the limits, today's count, storage used, and "Padam semua sekarang". A Telegram summary arrives daily at 21:00 KL.

## Cloudflare Setup (Owner)

### 1. Cloudflare Access — Bypass Application
Create a **new, separate** self-hosted Access application (e.g. `myofis-public-hd`). **Do not add these paths to the existing MyOfis app**: that app covers the whole site, and a Bypass policy there would make all of MyOfis public.
1. Destinations (each row with a path):
   - `myofis.bijokdev.com` · path `video-hd/public`
   - `myofis.bijokdev.com` · path `api/public/hd`
2. Policy: name `public`, Action **Bypass**, Include **Everyone**. Attach it to this app only.
3. Check in a private window: `https://myofis.bijokdev.com/` must still ask for login; `/video-hd/public` opens directly.

Access matches the more specific path first, so these two paths skip login while the main app keeps everything else owner-only. Do **not** bypass `/api/*`, `/assets/*`, or `/`.

### 2. Optional: Cloudflare Turnstile
1. Create a Turnstile widget in Cloudflare Dashboard for your hostname.
2. Set in `.env`:
   ```env
   PUBLIC_HD_TURNSTILE_SITE_KEY=0x4AAAAAAA...
   PUBLIC_HD_TURNSTILE_SECRET=0x4AAAAAAA...
   ```
3. Restart the hub. The first upload part will require a valid Turnstile token verified server-side against `/turnstile/v0/siteverify`.

### 3. Optional: Cloudflare WAF Rate-Limit Rule (Second Layer)
Add a WAF Rate Limiting rule as a second layer on top of the hub's per-IP and daily limits:
- **Expression:** `(http.request.uri.path contains "/api/public/hd/parts/")`
- **Characteristics:** IP (`CF-Connecting-IP`)
- **Threshold:** e.g. 60 requests per 1 minute (to allow multi-part uploads while blocking floods)
- **Action:** Block / Managed Challenge
