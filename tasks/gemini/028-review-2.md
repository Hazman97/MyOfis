# Review of task 028 (attempt 2): REJECTED, attempt 3 needed

Reviewed by Claude on 2026-11-18. Attempt 2 is a real step up from attempt 1:
- hub storage, scoping and the page wiring are honest now;
- it uses only async processes and reuses the transcript, index and edit helpers.

The core rule from `028-review.md` is still broken, though, and the report again shows results that only the
fallback produced. `apps/web/src/views/ClipFactoryView.vue` was already fixed by Claude (colour tokens; it follows
the job status from the reducer instead of polling for 90 s). Keep that version.

## Defects (verified)
1. **Fixed-base scoring is still there.**
   - `packages/tools/src/clipFactory.ts:170-194` uses hook 75/68, value 80/70, emotion 82/64, flow 78, trend 85/70,
     with template hooks ("Tengok Sampai Habis!").
   - `parseModelScoring` (`packages/shared/src/clipFactory.ts` ~438-470) also fills defaults and template hooks when
     a line does not parse.
2. **The report's "real runs" were all the fallback.** Every sub-score matches the fallback numbers and the
   fallback reason text.
   - Scoring goes through `describeImages` with one thumbnail. That returns "" on failure, so the fallback kicks in
     silently.
   - **Text must be judged as text, by the model.**
3. **The `clip_find` test never runs `clip_find`** (`packages/tools/test/clipFactory.test.ts:10-80`). The
   `.rejects` at ~90 is not awaited.
4. **The windows do not cover the whole video.**
   - `findCandidateWindows` walks from t=0, stops after 12 windows, and closes each window at `minDur`.
   - `promptKeywords` is computed and never used.
   - `slice(0, max_clips)` takes the first windows by time.
   - The 026 shot index is used only when there is no transcript.
5. **Emoji are double-wrapped.** `generateAnimatedCaptions` calls `wrapAssEmoji` (shared ~619), and then
   `captionsAss` cleans and wraps again (`packages/tools/src/video.ts:268`). The result is `/fnSegoe UI Symbol/b0`
   burned into the frame.
6. **The draft is lost while the tool reports success.**
   - `clip_render` sends `project_id: i.project_id ?? ""`; the hub refuses it with "unknown project"
     (`apps/hub/src/core.ts:825`), yet the tool still returns `draft_saved: true`.
   - `self_check` is hard-coded to all true, and hashtags are hard-coded (`#viral #fyp…`, `#myofis`).
7. **The hook is never on screen.** It only goes into the draft body.
8. **`crop_speaker` / `split_screen` are labels that render blur.** The report also names a `fit: "smart_reframe"`
   that does not exist. The weight formula in the report is wrong.
9. `catch {}` swallows transcribe and index failures. An audio-only file sends a blank frame to the vision model.

## Rules for attempt 3 (in addition to 028-review.md)
- **No numeric fallback, anywhere.** When no model scored a clip, it is `unscored` (the page shows "belum dinilai"),
  never 70/80.
- **Scoring is text-only, by the run's model.** `clip_find` returns transcript windows (text + times + audio peak +
  shot cuts) to the Clip Factory agent. The agent judges them and calls a second tool `clip_score {id, subscores,
  reasons, hooks, headline}`, which is validated with zod and stored.
  - The pure code only computes the weighted score.
  - Make the agent's prompt ask for JSON in a fixed, versioned format (`CLIP_SCORE_PROMPT_V1`).
- **Windows across the whole video:**
  - spread candidates over the full length (e.g. split into N equal parts and take the best windows from each);
  - snap the edges to sentence ends and to shot cuts within ±1 s;
  - use the topic keywords to rank.
- **Drafts:** a missing project is an error, not "".
  - The page gets a project picker (default: the last one used).
  - The tool reports `draft_saved` only when the hub accepted it. That means the hub's acknowledgement, or
    `ctx.saveDraft` must return or throw the refusal; check how `save_draft` does it and reuse that.
  - Use the brief's self-check the way `save_draft` does.
  - Captions and hashtags come from the agent, not constants.
- **Show the chosen hook on screen** for the first 2–3 s, using 024's motion text / overlay or a big caption.
- **Fix the emoji double-wrap.** Wrap in exactly one place (`captionsAss`), and add a test that renders the ASS
  text of a caption with an emoji and asserts no `/fn` appears.
- **Remove `crop_speaker` / `split_screen` from the page** until they really work (or build them; step 5 of the
  old order).
- **Tests:** `clip_find` really executed with a fake transcript and index; `clip_score` validation; `clip_render`
  with the hub refusing → `ok: false`.
- **Real run (paste raw output):** one real long video from the owner's runner (any of his uploads) through the
  Clip Factory agent with canopy-ai.
  - Show the scores the model returned, which must differ between clips, and the agent's own reasons.
  - If it was not run, write **NOT RUN**.

**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md` and `tasks/gemini/028-review-2.md`, then do attempt 3
> of `tasks/gemini/028-clip-factory-opusclip.md`, in this order, stopping to run the tests after each:
> (1) emoji double-wrap fix; (2) draft and project fix; (3) windows across the whole video; (4) `clip_score` tool +
> agent prompt (no numeric fallback); (5) hook on screen; (6) real run.
> Paste raw command output only. Write `tasks/gemini/028-report.md` (replace it). Do not commit.
