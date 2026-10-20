# Task 019: live job status and the work queue (UI)

The owner was confused: a chat reply showed only "pending / thinking…" while the job was really stuck, queued behind another agent, or failed.

Claude built a pure status model and a plain card that already works. You make it pleasant and add a queue view.

## The contract (already in the code; do not change it)
- `apps/web/src/runStatus.ts` (pure, tested in `apps/web/test/runStatus.test.ts`): `runStatus(state, jobId, now)` returns
  `{ phase, label, detail, position, seconds, steps, silent_for, run_id, can_stop, can_retry }`.
  - `phase` is `queued | running | waiting_approval | quiet | done | failed | cancelled`. `quiet` = running but no news for 2+ min.
  - Also exported: `fmtDuration(s)` and `stepLabel(step)`.
- `useOffice().state` is the live office state: `jobs`, `runs` (with `step`, `tool_calls`, `last_event_at`), `agents`, `runners`, `paused`.
- **Stop:** `api.cancelJob(jobId)`. **Try again:** the parent sends the same text again (ChatView `send(m.text)`, AskEditorPanel `send(m.text)`).

## Scope: edit ONLY
- `apps/web/src/components/RunStatusCard.vue`: restyle it. Keep its props `jobId`, `compact`; its emits `stop`, `retry`; and the use of `runStatus()`.
- New `apps/web/src/components/shell/WorkQueue.vue`, plus ONE line in `apps/web/src/components/shell/AppShell.vue` to place it (see below).
- `apps/web/src/views/ChatView.vue` and `apps/web/src/components/studio/AskEditorPanel.vue`: only the markup around `<RunStatusCard>` if needed.

Never delete, rename or move files. No new packages. Do not run `git commit`. Do not edit `runStatus.ts`, `packages/` or `apps/hub/`.

## What to build
1. **RunStatusCard:**
   - one clear line per phase: icon + label + timer + steps, with a subtle progress feel while running (a thin animated bar);
   - `queued` shows "#2 in line" as a chip;
   - `quiet` is amber, with the detail ("No news for 3m…, press Stop if it looks stuck");
   - `failed` is red, with the error text shown in full (wrap; no truncation) and a **Try again** button;
   - `cancelled` is grey, with the reason;
   - Stop / Try again are ≥ 40 px on phones;
   - `compact` = one line only, used under a partly written reply.
2. **WorkQueue** (new):
   - a small button in the sidebar's bottom area (next to the RUNNERS box) showing "N running · M waiting";
   - opens a popover or sheet listing:
     - **Running:** agent avatar + name, job title, the `runStatus` label, timer, Stop;
     - **Waiting:** in queue order (oldest first), with the position and the reason from `detail` (paused, no runner, budget, runner busy);
   - hidden when both are empty;
   - on phones it opens as a bottom sheet.
   - Place it with one line in AppShell, next to the existing runners / today tiles. Keep the owner's styling there.
3. **Phone (390 px):** no horizontal scroll. Light and dark.

## Rules
- Follow `docs/FRONTEND.md`: design tokens, canonical Tailwind v4 classes (no `-[Npx]` for spacing or sizes), `localStorage` in try/catch. English UI text.

## Check before you hand back
- `bun run --cwd apps/web typecheck` and `bun run --cwd apps/web build` pass.
- `bun test apps/web` passes.
- Tell the owner you are done; Claude reviews the diff.
