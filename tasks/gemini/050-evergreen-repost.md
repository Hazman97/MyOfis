# 050: Repost best performers (evergreen)

Owner (2026-11-27): posts that did well should come back later automatically, with a fresh caption, so TikTok
does not refuse them as duplicates.

Read first: `tasks/gemini/SUPERVISOR.md`, `045-post-performance-all-platforms.md` (`post_stats`,
`performanceSummary`), `048-queue-slots-bulk-upload.md` (queues, duplicate guard). **Depends on 045 and 048.**

## Rules
- Off by default, per account: `settings` `evergreen.<workspace>.<account_id>` = `{ enabled, min_age_days (30–365,
  default 45), top_percent (default 20), max_per_week (default 2), require_approval: true }`.
  `require_approval` can be turned off only by the owner, and only for accounts with `auto_publish` already allowed.
- Pure `pickEvergreen(stats, history, cfg, now)` (`packages/shared/src/evergreen.ts`): candidates = posts on that
  account older than `min_age_days`, in the top `top_percent` by a score (views + 5×shares + 3×saves +
  2×comments, normalised by account median), never reposted in the last `min_age_days`, max 3 reposts ever, not
  taken down. Returns up to `max_per_week` ordered by score. Fully tested.
- Weekly job (Sunday 21:30 KL, with the 045 report): for each pick, a `caption_only` job (047) with notes "fresh
  angle, different hook, no copy of the old caption" → new draft (`meta.repost_of = <old draft id>`, same video;
  TikTok: re-encode with a tiny change — new HD render with `-metadata` + 1-frame trim — because TikTok fingerprints
  files) → into the account's queue (048) as pending (or approved when `require_approval` is false).
- The Telegram set card says "Repost: <old caption first line> (asal: N views)".
- Stats: a repost's stats are kept separately and linked; `performanceSummary` shows "repost vs asal".

## UI
Settings → Social accounts → account row → "Repost auto" switch + fields. Drafts card shows a "Repost" chip with a
link to the original.

## Tests
`pickEvergreen` cases (too young, already reposted recently, max 3 ever, taken down, top % cut, empty stats);
weekly job creates N pending drafts in queue slots with `repost_of`; caption differs from the original (fake
caption job returns the old caption → refused and retried once, then skipped with a note); require_approval false
refused for a non-auto-publish account. No real posting.

## Proof
Raw new tests, `bun run typecheck`, full `bun test`, web build final lines. Anything not run is NOT RUN. Do not
commit.
