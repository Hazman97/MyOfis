# 049: Link-in-bio page + short links with click counts

Owner (2026-11-27): one public page per project for the TikTok/IG bio (products, TikTok Shop affiliate links,
booking, latest posts), and short links in captions so we know which post brought people.

Read first: `tasks/gemini/SUPERVISOR.md`, CLAUDE.md "Public Video HD (task 038)" (how a public no-login route is
registered before `app.route("/api", api)` and why it needs its **own** Cloudflare Access Bypass app), Brand Kit
(task 040), `apps/hub/src/publicHd.ts` for limits style.

## Rules (security)
- Public routes live under **`/l/*`** only (one Bypass app for path `l`). They never read owner tables except the
  `bio_pages`, `bio_links`, `short_links` rows that are marked published, and published drafts' public URLs.
- Everything rendered is escaped (reuse `design.ts` escaping); no inline scripts except one static script file;
  strict CSP header; links only `https:` (plus `tel:`, `mailto:`, `https://wa.me/`). No owner ids, emails, room
  names or upload ids in the HTML.
- Clicks store: short id, time (minute), country from `CF-IPCountry`, referrer host only, a daily salted hash of
  IP+UA for unique counts (salt rotates daily, never stored with the raw IP). No cookies.
- Per-IP rate limit on `/l/*` (60/min); bots (UA list) counted separately.

## Part A — Bio page
- Tables (migration): `bio_pages {id, workspace_id, project_id, slug unique, title, intro, avatar_upload_id,
  theme: from Brand Kit, published, show_latest_posts}`, `bio_links {id, page_id, label, url, icon (DESIGN_ICONS),
  kind: link|product|booking|whatsapp, price_text?, image_upload_id?, sort, enabled}`.
- `GET /l/:slug` renders a fast mobile page (≤ 30 KB HTML+CSS, Brand Kit colours/fonts from `assets/fonts`, avatar
  + images served via `/l/:slug/img/:n` that only serve uploads attached to that page). "Latest posts": last 6
  published drafts of the project with their `published_url` (TikTok/IG/website).
- Owner/room UI: Projects → **Bio** tab: edit, drag-sort links, preview iframe (sandboxed), Publish switch, copy
  URL, QR code PNG download (`design_render` or a pure QR lib already in deps — check; else pure TS QR encoder
  with tests).
- Agents: tool `bio_links_list` (read-only) so Pengurus Sosial/Misi 1K can say "link in bio" correctly.

## Part B — Short links
- Table `short_links {id (6-char base62), workspace_id, project_id?, draft_id?, target_url, label, created_at}` and
  `link_clicks {short_id, at_minute, country, referrer_host, visitor_hash, is_bot}`.
- `GET /l/s/:id` → 302 to target (after logging). Unknown → plain 404 page.
- Every bio link goes through a short link automatically (to count bio clicks per link).
- Captions: `save_draft`/`draft_web_post`/Quick Post get an option "pendekkan link" (default on per project): URLs
  in the caption are replaced by `https://<PUBLIC_BASE_URL host>/l/s/<id>` tied to the draft. TikTok captions are
  not clickable — still useful for IG/FB/Threads/YouTube/website; for TikTok show the bio-page hint instead.
- Stats: `GET /api/links/stats?project=&days=` → per link and per draft: clicks, unique, top countries. UI:
  Drafts → Prestasi (045) gets a "Klik" column; Bio tab shows clicks per link (7/30 days).

## Docs
`docs/link-in-bio.md`: setup, the Cloudflare **separate** Access Bypass app for path `l` (screens like
`docs/public-video-hd.md`), privacy note.

## Tests
Escaping (a `<script>` label renders as text), `javascript:` URL refused, unpublished page 404, image route only
serves the page's own uploads (other upload id → 404), short link 302 + click row with hashed visitor and no raw
IP, rate limit, caption URL rewrite (pure), stats aggregation (pure), cross-room edit → 404.

## Proof
Raw new tests, `bun run typecheck`, full `bun test`, web build final lines; screenshots of the public page (360 px,
light + dark Brand Kit) and the Bio tab. Anything not run is NOT RUN. Do not commit.
