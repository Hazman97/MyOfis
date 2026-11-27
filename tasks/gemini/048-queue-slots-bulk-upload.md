# 048: Posting queue (time slots) + bulk upload

Owner (2026-11-27): wants what Buffer/Publer have: set fixed posting times once, then just drop videos and they
fill the next free slot; and drop many videos at once.

Read first: `tasks/gemini/SUPERVISOR.md`, `047-zernio-link-and-quick-post.md` (Quick Post, `POST /api/quick-post`),
CLAUDE.md "Scheduled posts", "Pengurus Sosial (task 042)", `apps/hub/src/core.ts` `publishDue`, Grid Planner
(`GridPlannerView.vue`). **Depends on 047.**

## Part A — Queue slots
- Per **social account** (Zernio account id; also the per-project Facebook/website targets where `canPublish`), a
  queue in `settings` `queue.<workspace>.<account_id>` = `{ slots: [{ day: 0-6 | "daily", time: "HH:MM" }],
  timezone: "Asia/Kuala_Lumpur", paused: boolean }`. Max 6 slots a day, 42 a week.
- Pure `nextSlots(queue, taken: string[], from: Date, n)` in `packages/shared/src/queue.ts`: the next `n` free slot
  times (ISO, KL time), skipping slots already used by a scheduled draft for that account (±10 min) and past times
  (≥ 2 min ahead). Fully tested (DST-free KL, week wrap, daily + weekday mix, all taken → looks ahead up to 60 days,
  empty queue → []).
- Hub: `GET/PUT /api/queues/:accountId` (room-scoped; the account must belong to the room). `POST
  /api/drafts/:id/queue` = approve with `publish_at = nextSlots(...)[0]` (same checks as schedule: `canPublish`,
  ≤ 60 days). Queue empty → 400 "set posting times first".
- Quick Post (047) gets a 4th "Bila" choice: **Masuk queue** (default when the account has slots), showing the
  slot it will take.
- **Reshuffle**: when a queued draft is cancelled/deleted, later ones do NOT move (predictable); a "Rapatkan queue"
  button moves them up to fill gaps (`POST /api/queues/:accountId/compact`).
- Telegram draft card: extra button "Queue" (signed like the others).
- UI: Settings → Social accounts → each account row "Waktu post" editor (weekday chips + time list, presets:
  "12pm & 8pm setiap hari", "8pm Isn–Jum"). Planner shows empty slots as dashed ghost cells per account.

## Part B — Bulk upload
- `/post` gets a **Bulk** tab: drop up to 20 videos (parts upload, sequential, resumable on retry), pick account(s),
  options: compress (default on), "Tulis caption dengan AI" (default on), when = queue (default) / one per day
  from date X at time Y / drafts only.
- Hub `POST /api/quick-post/bulk {upload_ids[], accounts[], compress, ai_caption, notes?, when}` → one batch id;
  per video: HD job (if compress) → `caption_only` job (if ai_caption; skip when the owner typed one per video) →
  draft per account → queue/schedule/pending. All drafts share `meta.set_id = bulk:<batch>` so the set card from
  042 (`Lulus semua`) works. Runs at most 2 HD jobs at a time (GPU lock already serialises NVENC); AI captions obey
  the daily budget — over budget → those drafts stay pending with caption empty and a note.
- Progress: `GET /api/quick-post/bulk/:batch` (per video: uploading / compressing / caption / ready / failed +
  reason). The page shows a list with a progress bar per row; failures can be retried one by one.
- Duplicate guard: same upload file hash already posted to the same account in the last 30 days → warn and skip
  unless "post anyway" (TikTok refuses duplicates).

## Tests
`nextSlots` table tests; queue route scoping (other room's account → 404); `/drafts/:id/queue` picks the right
slot and never double-books when two drafts are queued at once (do it inside a transaction); compact; bulk with 3
fake videos → 3 drafts with set id and 3 different slots; budget-out path; duplicate guard; nothing posts before
`publishDue` time (fake clock). No real posting.

## Proof
Raw new tests, `bun run typecheck`, full `bun test`, web build final lines; screenshots (360 px + desktop) of the
slot editor, Bulk tab mid-progress, planner with ghost slots. Anything not run is NOT RUN. Do not commit.
