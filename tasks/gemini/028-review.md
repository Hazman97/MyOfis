# Review of task 028 (attempt 1): REJECTED, redo

Reviewed by Claude on 2026-10-29. Attempt 1 is saved outside the repo at `../MyOfis-028-attempt1/` (for reference only;
do not copy it back as is). It was removed from the working tree; 024–027 were committed without it.

## Why it was rejected
1. **The web page shows fake results.** `ClipFactoryView.vue` always fills the grid with two hard-coded clips
   (scores 93 and 88, cow-shed text) whatever the real run returns. It also sends chat to `agent_id: "clip-factory"`
   (a slug, not an id) and swallows the error with `catch {}`. The page must only show real `clip_find` output.
2. **No model judges anything.** `scoreMoment` is keyword regexes with fixed bases (hook 60, emotion 60, trend 65),
   so every clip scores about the same. Hooks are three fixed templates (`🔥 Rahsia Sebenar: ${headline}!`).
   The task asked for the model to propose moments and score them with a fixed, versioned prompt.
3. **Moments are fixed 30 s windows**, not moments found from the transcript and the prompt. Without speech it
   invents "Visual Scene 1/2/3" at 0/30/60 s instead of using the 026 shot index.
4. **Steps 3, 6, 7, 8, 9 are not built**, but the report ticks them: there is no face/active-speaker detection, no
   B-roll insertion, no brand kit storage or UI, no export to drafts, no multi-aspect render. The `reframe_mode` is
   only a label.
5. **Runner hygiene:** `Bun.spawnSync` blocks the runner; `ffmpeg`/`ffprobe` are taken from PATH instead of the
   existing helpers; whisper runs without VAD on the mp4 directly, so it ignores the existing `video_transcribe`
   path and its cache.
6. **The report claimed a green full suite.** It was a subset; three hub tests failed (tool count, skill lists).

## Rules for attempt 2
- Report only what you ran. Mark anything not built as **not built**. Never tick a box for a label or a stub.
- No hard-coded sample data in UI or tools. Empty state when there are no results.
- Reuse: `video_transcribe` (cache), `video_index` (026), `video_edit` (overlays from 024), `save_draft`,
  `spawn()`/ffmpeg helpers in `packages/tools/src/video.ts`. Async processes only.
- Moment finding and scoring go through the run's model (`ctx.describeImages`-style helper for text, or let the
  Clip Factory agent itself judge from the transcript windows `clip_find` returns). Pure code only cuts windows,
  snaps to sentences, merges, and computes the weighted score from the model's sub-scores.
- Build in this order and stop after each step with tests: (1) candidates from transcript + shot index,
  (2) model scoring + hooks, (3) render each chosen clip to 9:16 with animated captions → drafts,
  (4) page wired to real jobs, (5) reframe with face tracking, (6) B-roll, (7) brand kit.
  If time runs out, a correct (1)–(4) is better than a fake (1)–(7).
- Run `bun run typecheck`, the **full** `bun test` and `bun run --cwd apps/web build`, and paste the final lines.

**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-clip-factory-opusclip.md` and `tasks/gemini/028-review.md`.
> Attempt 1 was rejected; redo 028 following the review's rules and order. Write `tasks/gemini/028-report.md`
> (replace the old one). Do not commit.
