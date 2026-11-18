# Task 037: learn from post performance (Zernio analytics → stats → agents remember what works)

Read `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md` first. Write `tasks/gemini/037-report.md` (a
note after each step). Do not commit.

## Why
The owner wants the agents (Misi 1K, TikTok Poster, Pencerita, Clip Factory) to learn which hooks, formats and
pillars get views, saves and follows, instead of guessing every time.

## Facts (Zernio docs, checked 2026-11-18)
- **`GET /v1/analytics?postId=<id>`** (Zernio post id, external id or native id). Optional: `platform`,
  `accountId`, `fromDate` / `toDate` (YYYY-MM-DD), `limit`, `page`, `sortBy`, `view=summary`.
- **`PostAnalytics`:** `impressions`, `reach`, `likes`, `comments`, `shares`, `saves`, `clicks`, `views`, `follows`,
  plus `engagementRate`, `retentionCurve` on some platforms.
- **Statuses:**
  - `202` = sync pending; `424` = unavailable;
  - **`402 analytics_addon_required`**: legacy plans need the Analytics add-on, usage-based plans include it;
  - `429` with `details.retryAfterSeconds`.
- **TikTok:** numbers appear about 24–48 h after posting, and only for posts active in the last 7 days. The
  original TikTok integration gives only views / likes / comments / shares.
- `GET /v1/analytics/post-timeline` gives daily values per post.

## Facts from the code
- `apps/hub/src/social.ts`:
  - `#zernio(key, path)`;
  - TikTok posting stores the pending `post_id` in `settings` `tiktok.pending.<draft>`, which
    `resolveTikTokLinks()` uses and then deletes;
  - Zernio connections live per room in `zernio.connections.<ws>`.
- Facebook/IG/Threads are posted through their own APIs; leave them out of this task (Zernio only).

## Build
1. **Keep the Zernio post id:** when a TikTok draft is posted, store `meta.zernio_post_id` (and `conn_id`) on the
   draft permanently. Backfill from the pending settings where they still exist.
2. **Storage:** a migration with a table `post_stats` (draft_id, workspace_id, platform, fetched_at, views, likes,
   comments, shares, saves, follows, reach, engagement_rate, raw JSON trimmed). Keep one row per fetch, so
   growth is visible.
3. **Fetcher** (`apps/hub/src/postStats.ts`, its own timer, every 6 h, first run 5 min after boot,
   `postStatsMs` for tests):
   - for posted drafts with a Zernio id, posted between 1 and 10 days ago, fetch `GET /v1/analytics?postId=`;
   - handle `202` (try later), `424` (skip), `429` (respect `retryAfterSeconds`, stop this round);
   - **`402` → mark the connection `analytics: "addon_required"`, tell the owner on Telegram once, and stop
     fetching for it** until it changes in Social accounts;
   - `ZERNIO_API_BASE` is used for tests (fake server).
4. **Pure** `performanceSummary(rows, drafts)` (tested):
   - per agent and per tag (format, pillar, hook type, posting hour), it gives: the median views, the save rate,
     the follow rate, and the top 3 / bottom 3 drafts with their hook lines.
   - Pillar and hook come from draft meta. Add `meta.pillar` / `meta.hook` / `meta.format` to `save_draft`
     (optional fields) and ask the agents to fill them (prompt upgrade).
5. **Tool `post_performance {days: 7|30}`** (read-only, room-scoped, through a runner route gated by the tool)
   returns that summary. Give it to Misi 1K, TikTok Poster, Pencerita and Clip Factory.
   - Their prompts: "before choosing a pillar or hook, check post_performance; keep 1 memory line of what works".
6. **Owner view:**
   - a "Prestasi" tab on Drafts (or Settings → Social accounts): a table per post (views, saves, follows, link)
     and the summary;
   - a weekly Telegram report (Sunday 21:00 KL): top post, worst post, best hour, best format.

## Tests and proof
- Fetcher against a fake Zernio: 200, 202, 402 (one Telegram message, then stop), 429.
- Pure summary cases.
- Tool gating: other rooms see nothing.
- **Real:** one GET to the owner's real Zernio with the **existing key** for one real posted draft (read-only).
  - Paste the status and the metric names (no personal data).
  - If 402, report that the add-on is needed.
  - If no TikTok post exists yet, **NOT RUN**.
- `bun run typecheck`, the full `bun test`, the web build: raw final lines.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/037-post-performance-learning.md`
> step by step, tests after each, notes appended to `tasks/gemini/037-report.md`. Never print the Zernio key. Paste raw
> output only; anything not run is NOT RUN. Do not commit.
