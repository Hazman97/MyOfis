# Public Video HD (`/video-hd/public`)

A public, no-login Video HD page (`TikTok HD`, `WhatsApp HD`, `WhatsApp Status`) served by the hub at `/video-hd/public`, strictly isolated from the owner's Agent Office.

## Isolation & Architecture
- **Separate storage (`PUBLIC_HD_DIR`, default `./data/public-hd`):** stores `incoming/`, `out/`, and `public-hd.db` (its own SQLite database). Not backed up or mirrored by `backup.ts`. Shown as its own row in **Settings → Storage**.
- **Hub-side processing (`PublicHd`):** runs `ffmpeg` directly at low OS priority (`setPriority(pid, 19)`) using the same pure `hdPlan()` + `buildHdArgs()` logic as `video_hd`. Writes **zero** rows to the owner's `jobs`, `runs`, `uploads`, or `events` tables.
- **Self-contained HTML (`GET /video-hd/public`):** inline CSS and JS only — no Vite bundle and no `/assets`.
- **Public API (`GET /api/public/hd/*`, `PUT /api/public/hd/parts/:key`):** registered before `app.route("/api", api)` so `requireUser` never runs on them, while all other `/api/*` routes remain locked.
- **Retention & logs:** inputs are deleted immediately after processing (or failure); outputs expire after `retention_hours` (default 24 h); access logs (`ip_hash` via HMAC-SHA256 with `SECRETS_KEY`, size, timestamp, result) are kept 30 days.

## Cloudflare Setup (Owner)

### 1. Cloudflare Access — Bypass Application
Create a **Bypass** Access application for **only these two paths** on your domain (e.g. `myofis.bijokdev.com`):
1. `video-hd/public`
2. `api/public/hd` (with path prefix / wildcard `api/public/hd/*` as needed by Access)

Do **not** bypass `/api/*`, `/assets/*`, or `/`. Everything else stays behind Cloudflare Access.

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
