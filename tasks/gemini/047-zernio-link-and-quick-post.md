# 047: Link social accounts from MyOfis (Zernio connect) + Quick Post (compress → caption → post)

Owner (2026-11-27): "aku nk proper add zernio … aku just link aku punya tiktok tu je nt dia compress then senang
sikit nk post". Today the owner must connect TikTok inside Zernio's dashboard, paste an API key in MyOfis, press
Refresh, then go through Video HD → TikTok Poster chat → Drafts. Make it: paste the key once → "Link TikTok" →
TikTok login → back in MyOfis with the account ready; then one page to drop a video and post it.

Read first: `tasks/gemini/SUPERVISOR.md`, CLAUDE.md sections "Social accounts (many TikTok accounts through
Zernio)", "Pengurus Sosial (task 042)", "Video HD", and `apps/hub/src/social.ts` (`addZernio`, `refreshZernio`,
`#zernioAccounts`, `postViaZernio`), `apps/web/src/views/SocialAccountsView.vue`, `VideoHdView.vue`.

**Depends on the 042 review fixes** (non-TikTok accounts start disabled; project mapping). Do 042-review first.

## Zernio facts (docs.zernio.com, read 2026-11-27 — verify each against the docs before coding, write the page URLs
in the report)
- `GET /v1/profiles`, `POST /v1/profiles {name}` — a profile groups accounts; free and unlimited.
- `GET /v1/connect/{platform}?profileId=&redirect_url=` (Bearer key) → `{ authUrl }`. After consent Zernio redirects
  to `redirect_url` with `connected`, `profileId`, `accountId`, `username` (+ `request_id`, `stage`); on failure
  `error` + `platform`. Treat unknown `error` values as a generic failure. Confirm `tiktok` is an accepted
  `{platform}` value (and instagram/facebook/threads/youtube).
- Account list: `GET /v1/accounts` (already used). Check the docs for disconnecting an account; if there is no
  documented endpoint, "Remove" only hides it in MyOfis and says "disconnect it in Zernio too".
- TikTok video: MP4/MOV/WebM, H.264, 3 s – 10 min, ≤ 4 GB, 9:16 1080×1920 30 fps recommended. Rolling 24 h API
  cap; "Duplicate content detected"; HTTP 207 = failed (already handled).
- Billing changes on **2026-12-01** (prepaid balance). Read `/pricing/balance` and put one plain line in the docs.

## Part A — Link accounts (hub)
1. **Profile per connection.** On `addZernio`, find or create a Zernio profile named `MyOfis – <room name>`
   (reuse the default profile if the key has only one and it is empty of other rooms' accounts; otherwise create).
   Store `profile_id` on `StoredZernio`. Old connections without one get it lazily on first link.
2. **`POST /api/social-accounts/:id/link {platform}`** (room-scoped, owner or room manager per current rules):
   - builds `state` = base64url(JSON `{conn, ws, platform, nonce, exp: now+15 min}`) + `.` + HMAC-SHA256 (key derived
     from `SECRETS_KEY`, like the Telegram callbacks). Store the nonce in `settings` `zernio.link.<nonce>`.
   - calls Zernio connect with `redirect_url = <PUBLIC_BASE_URL>/api/social-accounts/link/callback?state=<state>`
     (refuse with a clear 400 when `PUBLIC_BASE_URL` is unset or loopback: "set PUBLIC_BASE_URL first").
   - returns `{ url: authUrl }`. Also used for **Reconnect** when `needs_reconnection`.
3. **`GET /api/social-accounts/link/callback`** (requires the logged-in user, as all `/api` routes):
   - verify the HMAC with `timingSafeEqual`, `exp`, single-use nonce (delete it), and that the caller may enter
     `ws`; any failure → redirect to `/settings/social?link=failed&reason=<short code>` (never echo raw query text
     into HTML).
   - Zernio `error` → same redirect with `reason=denied|failed`.
   - success → `refreshZernio(ws, conn)`; the new account: TikTok → enabled; other platforms → enabled only because
     the owner linked it by hand, but **not** routed anywhere until mapped (042 rule). Redirect to
     `/settings/social?linked=<accountId>`.
4. Never send the API key or `state` secret to the browser. The authUrl is fine.

## Part B — Settings → Social accounts UI
- A 3-step card when no connection exists: **1. Zernio key** (link to zernio.com dashboard → API keys, paste, Test)
  → **2. Link akaun** (buttons TikTok / Instagram / Facebook / Threads / YouTube; opens `url` in the same tab)
  → **3. Pilih projek** (map the new account to a project, existing `PUT /projects/:id/social-accounts`).
- After return: a toast "TikTok @username dah disambung" (from `?linked=`, look the account up in the loaded list);
  `?link=failed` → a friendly BM message per reason.
- Each account row: Reconnect button when `needs_reconnection`, plus the existing label/switch.
- Keep the "add another key" path for advanced use (collapsed).

## Part C — Quick Post page (`/post`, Work menu, phone bar "Post")
Flow on one page:
1. **Video**: drop/pick a file (existing parts upload) or pick a recent video (`GET /api/videos`).
2. **Akaun**: chips of enabled TikTok accounts (and later other platforms; TikTok only is fine for this task).
3. **Compress**: default ON = Video HD target `tiktok` (existing direct job `video_hd`, 0 tokens) with progress;
   a toggle "Hantar fail asal" skips it only when the file already fits (H.264, ≤ 4 GB, 3 s – 10 min) — the hub
   checks with ffprobe and refuses otherwise with the reason.
4. **Caption**: textarea (2,200 chars max, counter) + "Tulis dengan AI" → a `chat`-less job to the `tiktok-poster`
   agent that returns only a caption (new job type `caption_only`, input `{upload_id, notes}`; output is the
   caption text; it never calls `save_draft`). Budget rules apply.
5. **Bila**: Post sekarang / Jadual (date-time, ≥ 1 min, ≤ 60 days) / Simpan draf.
- Hub: **`POST /api/quick-post {upload_id, accounts[], caption, compress, when, publish_at?}`** creates one `video`
  draft per account (`platform: tiktok`, `meta.social_account`, `meta.video_upload_id` = the HD result or the
  original, `source: "owner"`), then: now → `decideDraft(approve)` + `afterApprove` in the background (like the
  existing video path); schedule → approve with `publish_at`; draft → leave pending. The upload must be in the
  caller's room (404 otherwise). The draft shows in Drafts as usual, with the link once resolved.
- When compress is on, the route waits for nothing: it returns `{ job_id }`; the draft is created when the HD job
  finishes (`Studio.afterHd` hook). The page follows progress by events and shows the final draft card with its
  status (posting → posted with link / failed with Zernio's message).

## Part D — Telegram shortcut
Owner sends a video to the bot with caption starting `/post` (or replies `/post` to a video): same pipeline with
compress ON, the default TikTok account (or `/post @label`), caption = the rest of the text (empty → AI caption).
Reply with a card: preview line + **Post sekarang / Jadual malam ni 8pm / Batal** (signed callbacks like `d:`).
Nothing posts without that button.

## Tests (fake Zernio via `ZERNIO_API_BASE`; no real posting, no real TikTok)
- profile found/created and stored; link returns authUrl with the right `redirect_url` and state.
- callback: good state → account added + redirect `linked=`; forged HMAC, expired, reused nonce, other room's
  state, Zernio `error=oauth_denied` → `link=failed` and nothing changes.
- `PUBLIC_BASE_URL` loopback → 400.
- quick-post: compress on → HD job → draft with HD upload id → approve → `postViaZernio` called once with the right
  account; schedule → `publish_at` set and nothing posted; cross-room upload → 404; "fail asal" refused for a 2 s
  clip.
- Telegram `/post`: forged callback refused; Batal posts nothing.
- web: pure helpers for the link-result message and caption counter.

## Docs
- `docs/tiktok-agent.md` + `docs/social-manager.md`: the new 3-step setup with screenshots, the billing line, and
  "TikTok limits: ~N posts per 24 h via API; duplicates refused".
- `docs/manual.html` Quick Post section. CLAUDE.md: one bullet under the 042 section (Gemini may draft it; Claude
  edits on review).

## Proof
Raw output of the new tests, `bun run typecheck`, full `bun test`, `bun run --cwd apps/web build` final lines.
Screenshots (preview hub, phone 360 px + desktop) of: the 3-step card, a linked toast, the Quick Post page at each
step, a failed-link message. Anything not run is NOT RUN. Do not commit.
