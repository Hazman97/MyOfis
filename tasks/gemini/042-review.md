# 042 review (Claude, 2026-11-25): PASS WITH FIXES — items 1–3 are must-fix (real posts, real accounts)

Telegram `s:` callbacks signed + `timingSafeEqual` + owner-only, set routes scoped by room, 207 = failed, no double
posting, keys never sent to the browser, old TikTok path unchanged: all OK. Targeted tests pass (11/11).
Append notes to `tasks/gemini/042-report.md` under "## Fixes after review". Do not commit.

1. **"Lulus semua" posts the whole set at once; suggested times are ignored** — `apps/hub/src/core.ts:342`.
   `proposed_publish_at` is stored but never read. Fix: `decideDraftSet` uses `input.publish_at ??
   d.meta.proposed_publish_at` when it is ≥ 1 min ahead and `canPublish`; past times → post now only if the owner
   chose "Post sekarang". Show each time on the Telegram set card and in DraftsView/Grid Planner. Test: a 3-draft set
   with times → approve → all `publish_at` set, nothing posted until `publishDue` at each time.
2. **New platform accounts are enabled by default and take over routing** — `apps/hub/src/social.ts:481, :496`.
   `addZernio`/`refreshZernio` import every IG/FB/Threads/YouTube account with `enabled: true`; `#socialTarget` then
   prefers "the only enabled account" over the project's own Meta connection, and `auto_publish` agents start posting
   there. Fix: non-TikTok accounts start `enabled: false`; for non-TikTok platforms use an account only when it is
   mapped to the project (`projectAccounts`), never the "only enabled account" rule. Refresh keeps the owner's
   switches. Test: refresh with a new FB page → disabled, SmashPoint's FB caption still goes to its mapped page.
3. **`set_id` is agent-chosen and not unique** — `core.ts:347, :374, :923`. Approving a set also approves stale
   pending drafts from earlier runs/projects that reused the id. Fix: the hub stores `set_id = <run_id>:<agent set_id>`
   (and filters by project). Test: two runs with `set_id: "week"` → approving one touches only its drafts.
4. **`set_id` format** — `packages/shared/src/marketing.ts:208, :236`: `.regex(/^[A-Za-z0-9_-]{3,40}$/)` on the agent
   value; make sure the stored (prefixed) id still fits Telegram's 64-byte `callback_data` (use a short hash if not).
5. **Hub never re-checks placement** — `core.ts:880-931`: run `placementCheck` on draft insert; refuse failures.
6. **Clearing a pending set's schedule approves without posting** — `scheduleDraftSet(..., null)`: skip drafts still
   `draft` when `publishAt` is null.
7. **"Publish again" broken for YouTube** — `apps/hub/src/http.ts:1305`: use `isZernioPlatform(d.platform)`.
8. **Sets cut at 500 drafts** — query by `set_id` directly instead of `listDrafts(limit: 500)`.
9. **Tests:** forged `s:` callback → refused; refresh defaults; two sets sharing an id across projects.

Proof: raw output of new tests; `bun run typecheck`, full `bun test`, web build final lines. No real posting.
