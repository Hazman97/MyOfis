# Task 045: Learn from post performance on every platform (replaces 037)

Read `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md` first. Write `tasks/gemini/045-report.md`
(a note after each step). Do not commit. **Task 037 is replaced by this one** (037 was TikTok-only; since 042 every
platform posts through Zernio). Do it after 039–042 are committed; it can run in parallel with 043.

## Why
Agents (Misi 1K, TikTok Poster, Pengurus Sosial, Pencerita, Clip Factory) choose hooks, pillars, formats and hours
blind. The owner wants them to learn what gets views, saves and follows — on TikTok, Instagram, Facebook, Threads
and YouTube.

## Facts (Zernio docs, read 2026-11-25 — re-check each against docs.zernio.com and quote it in the report)
- `GET /v1/analytics` with `postId` (Zernio post id, external id or native id), plus `platform`, `accountId`,
  `fromDate`/`toDate`, `source` (`late` = posted via the API), `limit`, `page`, `view`.
- Metrics by platform (compare page): Instagram impressions/reach/likes/comments/shares/saves/views; Facebook
  impressions/likes/comments/shares/clicks/views; Threads impressions/likes/comments/shares/views; YouTube and TikTok
  likes/comments/shares/views. Field names include `impressions, reach, likes, comments, shares, saves, clicks, views,
  follows, engagementRate`. Store missing ones as null, never 0.
- `402 analytics_addon_required` (legacy plans need the add-on); `429` (post-analytics is on a 30-second sliding
  window; account endpoints 120 reads/hour/account). `202`/`424` as in 037 — verify they still exist.
- Follower history: `GET /v1/accounts/follower-stats` (verify fields).
- Webhook `analytics.synced` exists; this task polls (the hub is behind Access); 046 adds the webhook receiver.
- TikTok numbers appear 24–48 h after posting.

## Build
1. **Keep the Zernio post id** on every posted draft: `meta.zernio_post_id`, `meta.zernio_conn_id` (all platforms,
   set by `postViaZernio`). Backfill from `tiktok.pending.*` / pending-link settings where still present.
2. **Migration:** `post_stats` (draft_id, workspace_id, platform, account_id, fetched_at, views, likes, comments,
   shares, saves, follows, reach, impressions, clicks, engagement_rate, raw JSON trimmed ≤ 4 KB) — one row per fetch;
   `follower_stats` (workspace_id, platform, account_id, date, followers).
3. **Fetcher** `apps/hub/src/postStats.ts` (timer every 6 h, first run 5 min after boot, `postStatsMs` for tests):
   drafts posted 1–14 days ago; follower stats once a day per enabled account. 402 → mark the connection
   `analytics: "addon_required"`, one Telegram message, stop for that connection; 429 → respect retry-after and stop
   this round. `ZERNIO_API_BASE` for tests.
4. **Pure** `performanceSummary(rows, drafts, {days})` (tested): per agent, platform, placement, pillar, hook type,
   format, template, posting hour → median views, save rate, follow rate; top 3 / bottom 3 with hook lines.
   `save_draft` gains optional `meta.pillar`, `meta.hook`, `meta.format` (prompt upgrades ask agents to fill them).
5. **Tool `post_performance {days: 7|30, platform?}`** (read-only, room-scoped, runner route gated by the tool) for
   Misi 1K, TikTok Poster, Pengurus Sosial, Pencerita, Clip Factory. Prompt upgrades: "check post_performance before
   choosing a pillar, hook or hour; keep one memory line of what works". 044's `weekPlan` reads it when present.
6. **Owner view:** Drafts → **Prestasi** tab: per-post table (platform icon, views, saves, follows, link), the
   summary, and a follower line per account (spark line). Weekly Telegram report Sunday 21:00 KL: top post, worst
   post, best hour, best format, follower change per account.

## Tests and proof
- Fetcher vs fake Zernio: 200 (each platform's metric set), 202, 402 (one Telegram message, then stop), 429.
- Pure summary cases incl. nulls (TikTok has no saves).
- Tool gating: other rooms see nothing; member rooms only their own drafts.
- **Real:** read-only GETs to the owner's Zernio with the existing key for one real posted draft per platform that
  exists; paste status + metric names only (no personal data). If 402 → say the add-on is needed. Platforms with no
  posted draft yet → NOT RUN.
- `bun run typecheck`, the full `bun test`, the web build: raw final lines. Screenshots of Prestasi (desktop + phone,
  light + dark).

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/045-post-performance-all-platforms.md`
> step by step, tests after each, notes appended to `tasks/gemini/045-report.md`. Quote the Zernio docs for every field
> you use. Never print the Zernio key. Paste raw output only; anything not run is NOT RUN. Do not commit.
