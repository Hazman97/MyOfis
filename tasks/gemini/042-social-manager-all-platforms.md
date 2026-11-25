# Task 042: "Pengurus Sosial" agent and posting to every platform (Reels, Stories, carousels, Shorts, Threads, FB)

Read `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md` (honesty rules) first. Write
`tasks/gemini/042-report.md` (a note after each step). Do not commit. Do it after 039, 040 and 041.

## Why
The owner wants one assistant that plans his week, makes the pictures (040 templates + 041 AI pictures) and videos
(039 files), writes a caption **per platform**, and posts after he approves: TikTok, Instagram (feed, carousel,
Reels, Story), Facebook (feed, Reels, Story), Threads and YouTube Shorts. Today:
- TikTok goes through **Zernio**;
- Instagram, Facebook and Threads use direct Meta calls for **single photos/text only**.

## Facts from the code
- `apps/hub/src/social.ts`:
  - `Social.post(draftId)` picks a platform → `postToFacebook / postToInstagram / postToThreads / postToTikTok`;
  - Zernio connections per room live in `zernio.connections.<ws>`, and each account has a `platform`;
  - TikTok posting = presign → PUT → `POST /posts publishNow`, where 207 = failed and the link arrives later
    through `resolveTikTokLinks()`;
  - `#tiktokTarget`, `canPostTikTok`, `checkTokens`;
  - `ZERNIO_API_BASE` is for tests.
- Settings → Social accounts (`SocialAccountsView.vue`) lists Zernio accounts per platform. The `tiktokTargets`
  name is TikTok-only today.
- Drafts: `platform`, `kind`, `meta` (`WebPost`: `cover_upload_id`, `video_upload_id`, `social_account`, `images`
  from 040), `publish_at`, `hub.afterApprove`, `hub.canPublish`, auto-publish limits (`#autoPublish`).
- 039 adds `SocialPlacement` + `hdOutputsFor`.
- Zernio supports 16 platforms via `POST /v1/posts`: one `platforms[]` entry per account, and per-platform options
  in `platformSpecificData`.
  - **Read** https://docs.zernio.com/guides/platform-settings and the Instagram, Facebook, YouTube and Threads
    platform pages before coding.
  - Quote in the report the exact field names for: Story vs Reel vs feed, carousels, YouTube title/privacy/Shorts,
    and media limits. **Do not guess field names.**
  - Tests use a fake Zernio.

## Build
1. **Generic Zernio posting.**
   - Rename the TikTok-only helpers to platform-generic ones (`socialTargets(ws, platform)`,
     `canPost(draft)`), keeping the old names as wrappers.
   - `postViaZernio(draft)` handles `instagram`, `facebook`, `threads`, `youtube` and `tiktok`, with
     `meta.placement` (`SocialPlacement`) choosing feed / carousel / reel / story / shorts.
   - Media are uploaded with presign → PUT. A carousel keeps the order of `meta.images`.
   - Results:
     - 207 = failed;
     - pending links are resolved like TikTok (generalise `resolveTikTokLinks`);
     - `checkTokens` covers every enabled account.
   - **Routing rule:**
     - the draft's `meta.social_account`;
     - else the only enabled account of that platform in the room;
     - else the older direct Meta connection of the project, for single photo/text, as today;
     - a switched-off account is never swapped for another.
2. **Placement rules (pure, shared, tested):** `placementCheck(draft) → problems[]`. A Story needs exactly one image
   or a video of ≤ 60 s (039 parts become several story drafts). Reels/Shorts need a vertical video. A carousel has
   2–10 images. A YouTube Short needs a title. Caption lengths are checked per platform. `save_draft` refuses
   a draft that fails these checks, with the reason; DraftCard shows the problems too.
3. **Post sets.**
   - `meta.set_id` groups the drafts of one idea (e.g. a TikTok video + IG Reel + 3 Stories + a Threads text).
   - DraftsView shows a set as one card with a tab per platform, **Lulus semua** / per-platform approve, and one
     schedule time for the whole set (each draft gets its own `publish_at`; the existing scheduler posts them).
4. **Agent `pengurus-sosial` ("Pengurus Sosial", `packages/agents/src/socialManager.ts`):**
   - Tools: `read_brief`, `read_feature_log`, `read_past_drafts`, `save_draft`, `design_render`, `image_generate`,
     `video_hd`, `clip_library`, `memory`, `skills_list`, `skill_view`, `session_search`.
   - Prompt (versioned, BM):
     - plan from the brief's content pillars and **facts only**;
     - one caption per platform: TikTok short + 3–5 hashtags, IG longer with line breaks, Threads conversational with
       no hashtag wall, FB with the CTA/link, YouTube title + description;
     - the language per `brief.languages`;
     - always use the Brand Kit templates for text graphics, and AI pictures only for photos/backgrounds;
     - Story sets of 3–5 frames;
     - never post without approval unless the owner switched auto-publish on for the agent.
   - Built-in skill `social-captions-multi` (platform rules and BM examples).
   - Job type `content_week`: schedule Sunday 20:00, seeded **off**. It makes the next week's sets as drafts with
     proposed `publish_at` times, which the owner approves on the Grid Planner (040) or in Drafts.
   - Telegram: a new set arrives as one card with **Lulus semua** / **Tolak** (signed like the draft buttons).
5. **Settings → Social accounts** lists accounts of every platform from each Zernio connection, with on/off and
   labels. Each project chooses which accounts it posts to.
6. **Docs:**
   - `docs/social-manager.md`: connecting accounts in Zernio, what each placement needs, sets, scheduling, the
     weekly plan. Mention that Highlights must be set in the Instagram app (no API) using the 040 covers.
   - A manual section (BM) and a CLAUDE.md bullet.

## Tests and proof
- Pure: `placementCheck` for every placement; set grouping; caption length rules.
- Hub with a fake Zernio:
  - an IG carousel (order kept);
  - an IG Story (image and video);
  - an IG Reel;
  - FB Reel + Story;
  - a Threads text and a Threads image;
  - a YouTube Short (title sent);
  - 207 → failed;
  - a pending link resolved later;
  - routing (draft account, only account, a switched-off account never swapped, Meta fallback);
  - Lulus semua posts every draft of a set once, and a retry does not double-post;
  - members' rooms are scoped (404 across rooms).
- Agent: a mock-provider run of `content_week` creates a set whose drafts pass `placementCheck`.
- Screenshots: a set card in Drafts, Social accounts with several platforms (desktop 1440 + phone 390, light + dark).
  Follow the browser rule.
- `bun run typecheck`, the full `bun test`, `bun run --cwd apps/web build`: raw final lines.
- **No real posting.** Real accounts are the owner's own test after review.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/042-social-manager-all-platforms.md`
> step by step, tests after each, notes appended to `tasks/gemini/042-report.md`. Read the Zernio docs first and quote
> the exact field names you use; never guess them. Fake Zernio in tests, never post for real. Use temp DBs and dirs,
> never the owner's. Paste raw output only; anything not run is NOT RUN. Do not commit.
