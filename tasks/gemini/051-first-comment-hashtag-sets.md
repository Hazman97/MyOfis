# 051: First comment + saved hashtag sets

Owner (2026-11-27): save hashtag sets per project and add them with one tap; post a first comment automatically
(link, hashtags) where the platform allows it.

Read first: `tasks/gemini/SUPERVISOR.md`, CLAUDE.md "Pengurus Sosial (task 042)", `buildZernioPostBody`
(`packages/shared/src/social.ts`), `postViaZernio` (`apps/hub/src/social.ts`), Brief (`ProjectBrief`).

## Verify first (docs.zernio.com) and write the URLs in the report
Whether `POST /v1/posts` supports a first comment per platform (field name, which platforms: Instagram, Facebook,
YouTube, Threads, TikTok?). If a platform is not supported by Zernio, the UI hides the field for it — do not fake it
with a later comment call unless the docs show a supported comments endpoint for that platform (then do it after
the post's link is resolved, and record failures on the draft).

## Part A — Hashtag sets
- `ProjectBrief.hashtag_sets: [{ name, tags: string[] (≤ 30, each `^#?[\p{L}\p{N}_]{1,50}$`u, stored without #),
  platforms?: ZernioPlatform[] }]` (≤ 20 sets). Edited in Projects → Brief → new "Hashtag" section.
- Pure `applyHashtags(caption, tags, platform)`: dedupe case-insensitively against tags already in the caption,
  respect platform limits (Instagram 30 tags, TikTok caption 2,200 chars, Threads 1 tag recommended → warn,
  YouTube 15 → cut with a warning), returns `{ caption, warnings }`. Tested.
- Agents: `read_brief` already exposes the brief; add to Pengurus Sosial / TikTok Poster / Misi 1K prompts (upgrade,
  only when unedited) "use the project's hashtag sets; don't invent long tag walls".
- UI: DraftCard + Quick Post caption box get a "#" menu listing sets for that platform → inserts via
  `applyHashtags`.

## Part B — First comment
- `WebPost.first_comment?: string` (≤ 1,000 chars) on drafts; editable in DraftCard and Quick Post for platforms
  that support it; `save_draft` accepts `first_comment`. Per project default template in the brief
  (`first_comment_template`, e.g. "Booking: {bio_link} {hashtags:Utama}") with pure `renderTemplate` (only
  `{bio_link}` (049 page URL, empty if none), `{short_link}`, `{hashtags:<set name>}`; unknown placeholders are left
  out). Tested.
- Posting: pass it in the Zernio body where supported; the result (posted / not supported / failed + message) is
  stored on the draft (`meta.first_comment_status`).

## Tests
Hashtag validation, `applyHashtags` limits and dedupe, template render, Zernio body contains the first comment only
for supported platforms (fake), failure stored. No real posting.

## Proof
Raw new tests, `bun run typecheck`, full `bun test`, web build final lines; screenshots of the Hashtag section and
the "#" menu (360 px). Anything not run is NOT RUN. Do not commit.
