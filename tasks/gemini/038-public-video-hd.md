# Task 038: public Video HD page (`/video-hd/public`), fully separate from the owner's office

Read `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md` first. Write `tasks/gemini/038-report.md` (a note
after each step). Do not commit. Task 031 (Video HD) is done; reuse its logic.

## Why
The owner wants anyone to use his Video HD tool (TikTok HD, WhatsApp HD, WhatsApp Status) at
`https://myofis.bijokdev.com/video-hd/public`, with no login. The work runs on his PC, and the files are kept in
storage separate from his own.

**Rule 1: a public visitor must never reach anything of the owner's.** That means no `/api/*` route except the new
`/api/public/hd/*` ones, no app bundle, no events, no office, no jobs/uploads rows, and no Telegram buttons.

## Facts from the code
- `apps/hub/src/http.ts`:
  - `GET /aitext` is the model for a no-login route: it is registered after `app.route("/api", api)` and before
    the static web app.
  - Behind Cloudflare Access, the owner adds a **Bypass** application for that one path.
  - The CSRF middleware covers `/api/*`.
- Video HD:
  - `hdPlan()`, `HD_TARGETS` and `HdTarget` are in `packages/shared/src/video.ts`;
  - the ffmpeg args are in `packages/tools/src/video.ts` (`videoHdTool`, `remuxArgs`).
- Uploads in parts: `UploadParts` (`apps/hub/src/uploads.ts`) handles parts of ≤ 32 MB, because Cloudflare refuses
  bodies over 100 MB. It adopts finished files into the owner's `uploads` table, which must **not** happen here.

## Build
1. **Separate storage:**
   - env `PUBLIC_HD_DIR` (default `data/public-hd`), with `incoming/`, `out/` and `public-hd.db` (its own
     SQLite file, not the owner's DB);
   - a table `public_hd_jobs` (id = 128-bit random token, ip_hash, name, size, targets, mode, status, error,
     results JSON, created_at, done_at);
   - not backed up and not mirrored by `backup.ts`;
   - shown as its own row on Settings → Storage.
2. **Processing in the hub, not the runner:** a `PublicHd` queue (`apps/hub/src/publicHd.ts`).
   - It runs ffmpeg **directly**, one job at a time, using the **same pure plan + args code** as the `video_hd`
     tool. Move the arg building into a pure exported function if needed; do not copy it.
   - Lower its priority (`os.setPriority(pid, 19)`) so the owner's work comes first.
   - **No** `jobs` / `runs` / `events` rows, so nothing shows in the office, feed, Board or Telegram cards.
   - Probe the file with ffprobe first and refuse what is not a real video.
   - Delete the input as soon as it is done (also on failure).
3. **Limits** (settings key `public_hd`, owner card in Settings → Integrations; defaults in brackets):
   - `enabled` [false]: when off, the page says "Ditutup sementara";
   - max size [500 MB], max length [10 min];
   - per IP [3 per hour, 6 per day]: the IP comes from `CF-Connecting-IP`, stored only as an HMAC hash (key =
     `SECRETS_KEY`);
   - total per day [30], waiting queue [5], so the 6th visitor gets "Sibuk, cuba lagi nanti";
   - storage cap [20 GB]: when it is reached, new uploads are refused and the owner is told once on Telegram;
   - results are deleted after [24 h] by a sweep.
   - **Turnstile:** when env `PUBLIC_HD_TURNSTILE_SITE_KEY` / `_SECRET` are set, the first upload part needs a
     valid token checked server-side with Siteverify. Without them it works, with a warning in the owner card.
4. **Routes** (no login, all under `/api/public/hd/`, registered before `app.route("/api", api)` so `requireUser`
   never runs):
   - `GET config`: enabled, targets, limits, site key;
   - `PUT parts/:key?name&total&offset&targets&mode`: parts into `incoming/`; the last part queues the job and
     returns `{id}`;
   - `GET jobs/:id`: status, queue position, results (sizes, warnings);
   - `GET jobs/:id/file/:target`: download, with `content-disposition`, Range and `x-robots-tag: noindex`.

   Every handler validates with Zod, never takes a path from the request, and answers 404 for an unknown id.
5. **The page `GET /video-hd/public`** is one **self-contained HTML** file served by the hub: inline CSS and JS, no
   Vite bundle and no `/assets`, so Cloudflare only needs bypasses for `/video-hd/public` and `/api/public/hd`.
   - BM text, light/dark, and it works at phone width (390 px).
   - **Flow:** pick a video → target chips → Auto / Keep / Re-encode → an upload progress bar → queue position
     → Download buttons per target, with the WhatsApp "send as Document" tip.
   - A short notice: "Video dipadam selepas 24 jam. Jangan muat naik kandungan haram atau milik orang lain."
   - The hub's SPA fallback must not catch this path first.
6. **Owner side:**
   - Settings card: on/off, the limits, today's count, storage used, and a "Padam semua sekarang" button;
   - a daily Telegram line at 21:00 KL: how many were processed, GB in/out, failures, refused (limit / busy);
   - an access log (ip_hash, size, time, result), kept 30 days, for abuse reports.
7. **Docs:**
   - `docs/public-video-hd.md`, which includes the owner's Cloudflare steps:
     - an Access **Bypass** app for paths `video-hd/public` and `api/public/hd`, exactly those two;
     - optionally a Turnstile widget;
     - a WAF rate-limit rule as a second layer.
   - A CLAUDE.md bullet.

## Tests and proof
- **Isolation:** with the public routes, a request with no cookie to `/api/state`, `/api/uploads`,
  `/api/video-hd`, `/api/events` and `/api/public/hd/../state` stays 401/404. A public job adds no rows to `jobs`,
  `uploads` or `events` in the owner DB (count before and after).
- **Limits:** per IP, per day, queue full, storage cap, disabled, too long, not a video (a renamed .txt), Turnstile
  on (fake Siteverify via `TURNSTILE_API_BASE`).
- **Real:** start a preview hub (temp DB, temp `PUBLIC_HD_DIR`, `AUTH_MODE=local`, port 8811). Put a `testsrc2`
  60 s 1080p clip and a phone-sized clip through all three targets. Paste the ffprobe of each result; the input is
  gone afterwards, and the 24 h sweep is tested with a fake clock.
- **Screenshots** of the page (desktop and 390 px, light and dark) and the owner card. Follow the browser-script
  rule in SUPERVISOR.md: `finally browser.close()`, an overall timeout, no `chrome-headless-shell` left running.
- `bun run typecheck`, the full `bun test`, the web build: raw final lines.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/038-public-video-hd.md` step by
> step, tests after each, notes appended to `tasks/gemini/038-report.md`. Public visitors must never reach the owner's
> data: prove it with the isolation tests. Use a temp DB and temp dirs, never the owner's. Paste raw output only;
> anything not run is NOT RUN. Do not commit.
