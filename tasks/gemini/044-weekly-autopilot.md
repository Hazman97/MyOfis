# Task 044: Weekly autopilot — one job plans, draws and writes a whole week, the owner approves once

Read `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md` (honesty rules) first. Write
`tasks/gemini/044-report.md` (a note after each step). Do not commit.
**Do it after 043** (it needs templates that look like real posts) and after 039–042 are committed.

## Why
The owner now has every piece: Pengurus Sosial (042), Brand Kit + templates (040/043), local AI pictures (041),
Video HD (039), post sets with "Lulus semua", scheduled posts. They are still separate. The owner wants one weekly
job that produces a ready week of posts, and he only taps **Lulus semua** on Telegram.

## Facts from the code (check them; say in the report what differs)
- `pengurus-sosial` agent (`packages/agents/src/socialManager.ts`), disabled schedule `content_week` Sunday 20:00.
- `save_draft` takes `placement`, `set_id`, `proposed_publish_at`; `POST /api/drafts/sets/:setId/decide|schedule`;
  Telegram set card `Lulus semua` / `Tolak`.
- `image_generate` (041): runner-side, game guard, GPU lock, `settings.image_gen {paused, max_per_day}`.
- `design_render` (040): template → PNG uploads, `meta.images` for carousels.
- Grid Planner `/planner`, `POST /api/drafts/swap-schedule`.

## Build
1. **Week plan (pure, tested)** `weekPlan({brief, performance?, slots, start_date, tz: "Asia/Kuala_Lumpur"})` →
   7 items `{day, publish_at, placement(s), pillar, template, image_prompt?, needs_video?, notes}`.
   - Rotate pillars from the brief; never the same template two days running; at most 2 AI pictures per day.
   - `slots` default: one feed post per day 20:00 + Story on 3 days 12:30; owner can change in the project's
     Brand tab ("Jadual autopilot").
   - When 045's `post_performance` exists, prefer the best hours/pillars from it; otherwise the defaults.
2. **Job `content_week`** (Pengurus Sosial):
   - Step A plan (LLM) → validated against `weekPlan` rules; Step B pictures: one `image_generate` per item that
     needs one; Step C `design_render` with the brand kit; Step D captions per placement (skill
     `social-captions-multi`); Step E `save_draft` with **one `set_id` for the whole week** and each item's
     `proposed_publish_at`.
   - **Pictures never block the week.** If image gen is paused, over `max_per_day`, or the GPU waits more than
     20 min (game), use the template's brand background (043 rule 4) and note it on the draft
     (`meta.notes: "tiada gambar AI — GPU sibuk"`).
   - Video items only use videos already in the project's uploads/clip folder; no new edits in this job.
3. **Owner timing:** the schedule may run at night. Add `settings.image_gen.quiet_hours` (default none) — when set
   (e.g. 18:00–01:00 gaming time), image jobs wait until outside it.
4. **Approval:** one Telegram message "Minggu 1–7 Dis: 7 post + 3 story siap" with a contact-sheet PNG of the week
   (render the grid with the existing worker) and the set buttons `Lulus semua (jadual)` / `Buka Drafts` / `Tolak`.
   `Lulus semua` approves every draft of the set **with its proposed time** through the same path as a single
   approve (`publish_at`, `hub.canPublish` guards). Nothing posts before its time; nothing posts unapproved
   (except agents with the existing `auto_publish` switch, unchanged).
5. **Web:** `/planner` shows the pending week set as a ghost row the owner can drag/swap before approving; DraftCard
   shows "Autopilot · Selasa 20:00".
6. **Docs:** `docs/social-manager.md` "Autopilot mingguan" section; manual (BM); CLAUDE.md bullet.

## Tests and proof
- `weekPlan` cases (rotation, template repeat rule, slots, KL time).
- Chain on a fake runner + fake ComfyUI + fake Zernio: schedule → 7 drafts in one set with times → Telegram card →
  `Lulus semua` → `publish_at` set on all → `publishDue` at the right minutes posts through the fake Zernio.
- Fallbacks: image gen paused, GPU busy 20 min (fake nvidia-smi), one design_render failing → week still saved.
- **Real (owner PC, temp DB copy, no posting):** one full `content_week` for SmashPoint with the real ComfyUI; paste
  time per step, number of pictures, the contact-sheet PNG path (outside the repo). Posting is NOT RUN.
- `bun run typecheck`, the full `bun test`, `bun run --cwd apps/web build`: raw final lines. Screenshots: planner ghost
  row + DraftCard (desktop + phone, light + dark).

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/044-weekly-autopilot.md` step by
> step, tests after each, notes appended to `tasks/gemini/044-report.md`. Nothing may post without approval; pictures
> must never block the week. Use temp DBs and dirs, never the owner's. Paste raw output only; anything not run is NOT
> RUN. Do not commit.
