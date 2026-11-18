# Task 036: one long video → N clips → posted across the week

Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md` and `tasks/gemini/028-review-2.md` first. Write
`tasks/gemini/036-report.md` (a note after each step). Do not commit.
**It depends on 028 attempt 3 passing review** (real scores, drafts that really save).

## Why
The owner wants to drop one long video and get a week of posts. Clip Factory and scheduled posts both exist but
are not connected.

## Facts from the code
- **Scheduled posts:** `content_drafts.publish_at` (migration 0012).
  - Approving with `publish_at` (≥ 1 min, ≤ 60 days, only when `hub.canPublish`) sets it, and `afterApprove`
    skips posting.
  - The 1-minute timer runs `hub.publishDue()`.
  - `POST /api/drafts/:id/schedule {publish_at | null}`.
- **TikTok targets:** `meta.social_account`, `PATCH /api/drafts/:id/account` and Social accounts (Zernio, many
  accounts).
- **Clip Factory:** `clip_find` / `clip_render`, results under `video.clips.<uploadId>`; the page is
  `ClipFactoryView.vue`.

## Build
1. **Pure** `weekPlan({clips (sorted by score), count, start_date, times: ["20:00"…], days: [1..7], tz: "Asia/
   Kuala_Lumpur", skip_existing: Date[]})` → `[{clip_id, publish_at}]` (tested).
   - The best clip goes on the strongest day (Fri–Sun first when the owner did not choose), and two clips are never
     on the same day.
   - It skips times that already have a scheduled draft for the same account.
2. **Route** `POST /api/videos/:id/clips/schedule {clip_ids | count, start_date, times, days, account?, project_id}`.
   - It creates one `clip_render` job per clip with `input.publish_at`.
   - When the render saves its draft, the hub stores `meta.suggested_publish_at`. The draft stays **pending**
     (approve-first), **unless** the agent has `auto_publish` and the owner switched it on; then the existing
     `#autoPublish` path schedules it instead of posting at once.
3. **Drafts:**
   - DraftCard shows "Dicadang: Jumaat 20:00". Approve uses `suggested_publish_at` as `publish_at` (it can be
     changed).
   - New owner action **"Luluskan semua (jadual)"**: `POST /api/drafts/approve-scheduled {draft_ids}` approves
     several drafts with their suggested times, each through the same path as a single approve, with the same
     guards and audit.
4. **Page:** Clip Factory gets "Jadualkan seminggu":
   - pick the clips (default: the top N by score; `unscored` clips are not auto-picked);
   - set the days and time, the TikTok account and the project;
   - preview the calendar;
   - Confirm.
5. **Telegram:** one summary message ("7 klip siap untuk disemak, cadangan jadual: …") with an "Open Drafts"
   link. Each draft keeps its own card as today.

## Tests and proof
- `weekPlan` cases (KL time zone, DST-free, skips taken slots).
- Route guards (room, project ownership).
- The chain on a fake runner: schedule → jobs → drafts with suggested times → bulk approve → `publish_at` set →
  `publishDue` posts through the fake Zernio at the right time.
- **Real:** one owner video on a preview hub copy (temp DB) through to drafts with suggested times; the posting
  itself is not run.
- `bun run typecheck`, the full `bun test`, the web build: raw final lines. Screenshots: the schedule dialog and
  DraftCard.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, `tasks/gemini/028-review-2.md`, then do
> `tasks/gemini/036-clips-to-week-schedule.md` step by step, tests after each, notes appended to
> `tasks/gemini/036-report.md`. Approve-first stays the default. Paste raw output only. Do not commit.
