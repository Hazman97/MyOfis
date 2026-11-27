# 056: Platform preview + caption signature + LinkedIn / X / Bluesky / Pinterest

Owner (2026-11-27), after research (Postiz, Buffer, Publer): see how a post will look on each platform before
approving, add a fixed signature per account automatically, and post to more platforms through Zernio.

Read first: `tasks/gemini/SUPERVISOR.md`, CLAUDE.md "Pengurus Sosial (task 042)", `packages/shared/src/social.ts`
(`ZernioPlatform`, `placementCheck`, `buildZernioPostBody`), `apps/hub/src/social.ts`, `DraftCard.vue`,
`051-first-comment-hashtag-sets.md` (`applyHashtags`). **Depends on 047 and 051.**

## Part A — More platforms
- Verify in docs.zernio.com (write URLs + date in the report) the exact platform ids, media rules and text limits
  for **LinkedIn** (personal + page), **X/Twitter**, **Bluesky**, **Pinterest** (board id required). Add them to
  `ZernioPlatform`, `placementCheck` (limits per platform: text length, image count, video length/size, Pinterest
  needs an image/video + board + link), `buildZernioPostBody`, the 047 link buttons, project mapping, and the
  Pengurus Sosial prompt/skill (`social-captions-multi` gets a section per platform; prompt upgrade only when
  unedited).
- Accounts of these platforms start **disabled** and are only used when mapped to a project (042 rule).
- Note in docs: each connected account counts toward Zernio billing.

## Part B — Signature
- Per account `signature: { text (≤ 300), platforms_only?: boolean, position: "end" }` in the Zernio connection
  account record (Settings → Social accounts row). Pure `withSignature(caption, signature, platformLimit)`: adds
  `\n\n<text>` unless already present, trims the caption body (never the signature) to fit the platform limit with
  "…", returns warnings. Applied at **post time** (so editing the signature later affects queued posts) and shown in
  the preview. Tested.

## Part C — Preview
- Pure view models `previewModel(draft, platform, account)` (`apps/web/src/preview.ts`): final caption (with
  hashtags + signature), "see more" cut point per platform (TikTok, IG feed/Reels, FB, Threads, YouTube Shorts,
  LinkedIn, X, Bluesky, Pinterest), media aspect/crop as the platform shows it, counters and warnings from
  `placementCheck`. Tested.
- `components/PostPreview.vue`: a phone-frame mock per platform (our own simple drawing: avatar circle, username,
  caption with the cut, media box with the right aspect and safe-area overlay for TikTok/Reels UI). No platform
  logos or brand assets; use neutral icons from lucide and the platform name as text.
- Shown in DraftCard (tabs per target platform of the set), Quick Post (047) and Bulk (048).

## Tests
`placementCheck` for the 4 new platforms; body builder per platform (fake Zernio); `withSignature` (dedupe, limit
trim keeps the signature, emoji counted correctly — use grapheme-safe length where the platform counts that way, say
which); `previewModel` cut points; new accounts disabled on refresh.

## Proof
Raw new tests, `bun run typecheck`, full `bun test`, web build final lines; screenshots (360 px + desktop) of the
preview for TikTok, IG Reels, LinkedIn, X and Pinterest. No real posting. Anything not run is NOT RUN. Do not
commit.
