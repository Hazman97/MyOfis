# 042 report

## Zernio API Field Names (verified from `docs.zernio.com` before coding)
Source: `https://docs.zernio.com/guides/platform-settings` and platform pages (Instagram, Facebook, YouTube, Threads).

- **Endpoint:** `POST /v1/posts`
  - Top-level fields: `content` (string), `mediaItems` (`{ type: "image" | "video", url: string, thumbnail?: string }[]`), `platforms` (`{ platform, accountId, platformSpecificData? }[]`), `publishNow` (`true`).
  - Media upload: `POST /v1/media/presign` (`{ filename, contentType, size }`) → `{ uploadUrl, publicUrl }`, then `PUT uploadUrl`.
  - Account listing: `GET /v1/accounts?limit=100` (`_id`, `platform`, `username`, `displayName`, `followersCount`, `needsReconnection`, `isActive`).
  - Status / delayed link resolution: `GET /v1/posts/:id` → `post.platforms[0].platformPostUrl`, `post.platforms[0].status`, `post.platforms[0].errorMessage`. HTTP `207` on `POST /v1/posts` indicates partial/failed delivery.
- **Instagram (`platform: "instagram"`):**
  - `platformSpecificData.contentType`: `"story"` for Instagram Story (1 media item), `"reel"` for Reel (single videos also default to Reels), omitted for feed / carousel.
  - `platformSpecificData.shareToFeed`: boolean (for Reels).
  - Carousels: multiple items in `mediaItems[]` (up to 20 images/videos; our `placementCheck` enforces 2–10 images per Task 042) in display order.
- **Facebook (`platform: "facebook"`):**
  - `platformSpecificData.contentType`: `"story"` for Facebook Story (images or videos up to 120 s; our `placementCheck` enforces ≤ 60 s per Task 042), `"reel"` for Facebook Reel (max 60 s), omitted for feed posts.
  - Custom video thumbnail: `mediaItems[].thumbnail`.
- **YouTube (`platform: "youtube"`):**
  - Shorts classification: automatic when vertical/square (9:16 or 1:1) and ≤ 3 minutes; no separate `contentType` flag required.
  - `platformSpecificData.title`: video/Short title.
  - `platformSpecificData.visibility`: `"public" | "private" | "unlisted"`.
  - `platformSpecificData.madeForKids`: boolean (optional).
- **Threads (`platform: "threads"`):**
  - Character limit: **500 characters** strict maximum for `content` (and `firstComment`).
  - Media limits: up to 20 images (JPEG/PNG, max 8 MB each) or 1 video (MP4/MOV, max 1 GB, max 5 min) in `mediaItems[]`.
  - `platformSpecificData.topic_tag`: optional topic tag (1–50 chars, no `.` or `&`).
- **TikTok (`platform: "tiktok"`):**
  - Existing `tiktokSettings` (`privacy_level`, `allow_comment`, `allow_duet`, `allow_stitch`, `content_preview_confirmed`, `express_consent_given`, `video_cover_timestamp_ms`), max caption 2200 chars.

## Step 1 (Shared Pure Logic) — `placementCheck`, `groupDraftSets`, `buildZernioPostBody`
- Extended `WebPost` and `WebPostEdit` (`packages/shared/src/marketing.ts`) with `DraftPlacement` (`SocialPlacement` + `ig_carousel`), `placement`, `set_id`, `video_duration_s`, `video_aspect`, and `proposed_publish_at`.
- Added `packages/shared/src/social.ts` (exported via `packages/shared/src/index.ts`) with `ZERNIO_PLATFORMS`, `CAPTION_MAX_CHARS`, `defaultPlacementFor`, `placementCheck`, `groupDraftSets`, and `buildZernioPostBody`.
- `bun test packages/shared/test/social.test.ts`:
```text
 3 pass
 0 fail
 29 expect() calls
Ran 3 tests across 1 file. [86.00ms]
```

## Step 2 & 3 (Hub Generic Zernio Posting, Routing, Pending Links, Post Sets & `save_draft` Placement Guard)
- Generalised `apps/hub/src/social.ts`:
  - `socialTargets(ws, platform?)`, `canPost(draft)`, `postViaZernio(draftId)`, `resolvePendingLinks(now)` (keeping `tiktokTargets`, `canPostTikTok`, `postToTikTok`, `resolveTikTokLinks` as wrappers).
  - `addZernio` / `refreshZernio` now list all 5 supported Zernio platforms (`tiktok`, `instagram`, `facebook`, `threads`, `youtube`); `checkTokens` checks every enabled account across all platforms.
  - Added per-project account selection (`projectAccounts` / `setProjectAccounts`, routes `GET/PUT /api/projects/:id/social-accounts` guarded by `ownProject`).
  - Routing enforces: draft `meta.social_account` → project account → only enabled account in room → legacy direct Meta fallback (single photo/text only); switched-off accounts are never swapped.
- Added idempotent set actions in `apps/hub/src/core.ts` & `apps/hub/src/http.ts` (`POST /api/drafts/sets/:setId/decide`, `POST /api/drafts/sets/:setId/schedule`, workspace-scoped via `W(c)`).
- Updated `save_draft` (`packages/tools/src/content.ts`) to accept `placement`, `set_id`, `proposed_publish_at` and refuse drafts failing `placementCheck`.
- `bun test apps/hub/test/social-all-platforms.test.ts`:
```text
 2 pass
 0 fail
 38 expect() calls
Ran 2 tests across 1 file. [1471.00ms]
```

## Step 4 (Agent `pengurus-sosial`, Skill `social-captions-multi`, `content_week`, Telegram Set Card)
- Added `packages/agents/src/socialManager.ts` (`pengurus-sosial` / "Pengurus Sosial", versioned BM prompt, 12 tools per spec, `SOCIAL_CAPTIONS_MULTI_SKILL`, and Sunday 20:00 `content_week` schedule seeded disabled).
- Registered agent, schedule, and built-in skill in `packages/agents/src/index.ts`.
- Updated `apps/hub/src/telegram.ts` to group multi-draft sets into a single set card with HMAC-signed **✅ Lulus semua** / **❌ Tolak** buttons (`s:<setId>:<y|n>:<sig>`), routed through `hub.decideDraftSet`.
- `bun test apps/hub/test/social-all-platforms.test.ts`:
```text
 3 pass
 0 fail
 48 expect() calls
Ran 3 tests across 1 file. [2.23s]
```

## Step 5 & 6 (Web UI & Docs)
- Updated `apps/web/src/views/DraftsView.vue` to render `meta.set_id` post sets as one card with platform tabs, **Lulus semua**, **Tolak**, and shared schedule time (`Jadualkan set`).
- Updated `apps/web/src/components/DraftCard.vue` to surface live `placementCheck()` warnings.
- Updated `apps/web/src/views/SocialAccountsView.vue` to list accounts of all 5 platforms (`TikTok`, `Instagram`, `Facebook`, `Threads`, `YouTube`) with platform chips, labels, on/off toggles, plus **Akaun lalai mengikut projek** per-project account pickers.
- Updated `apps/web/src/api/http.ts` with multi-platform `ZernioAccount` / `SocialTarget` types and `projectSocialAccounts`, `saveProjectSocialAccounts`, `decideDraftSet`, `scheduleDraftSet`.
- Added `docs/social-manager.md` (including note that Instagram Highlights must be set in the Instagram app using 040 covers — no API), BM section 42 in `docs/manual.html`, and Task 042 bullet in `CLAUDE.md`.
- Updated `apps/hub/test/tiktok.test.ts`, `apps/hub/test/memory.test.ts`, and `apps/hub/test/schedules.test.ts` for the newly seeded multi-platform Zernio accounts, `social-captions-multi` skill, and Sunday 20:00 `content_week` schedule.

## Screenshots (Visually Inspected; Zero `chrome-headless-shell` Left Running)
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\042-drafts-set-desktop-light.png`
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\042-drafts-set-desktop-dark.png`
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\042-drafts-set-phone-light.png`
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\042-drafts-set-phone-dark.png`
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\042-social-accounts-desktop-light.png`
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\042-social-accounts-desktop-dark.png`
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\042-social-accounts-phone-light.png`
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\042-social-accounts-phone-dark.png`

## Final Verification (Raw Final Lines)
- `bun run typecheck`:
```text
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```
(exit code 0)

- `bun test`:
```text
 455 pass
 1 skip
 0 fail
 5011 expect() calls
Ran 456 tests across 87 files. [349.96s]
```

- `bun run --cwd apps/web build`:
```text
✓ built in 2.60s
```

## What I did NOT do
- **No real posting** to live Zernio / Meta / YouTube / TikTok accounts (per task rule; all posting tests used a local fake Zernio + fake Meta HTTP server).
- No git commit or push.
