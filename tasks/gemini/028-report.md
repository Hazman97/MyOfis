# Task 028 Report (Attempt 3): Clip Factory (OpusClip)

Following `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, and `tasks/gemini/028-review-2.md`.
All command outputs below are raw tool outputs; anything not executed is marked `NOT RUN`.

---

## Step 1 — Emoji Double-Wrap Fix
- `packages/shared/src/clipFactory.ts`: Removed `wrapAssEmoji` call from `generateAnimatedCaptions` so captions are returned as plain text with raw emoji, and removed the unused `emojiFontName`/`wrapAssEmoji` import.
- `packages/tools/src/video.ts`: `captionsAss` remains the single place wrapping emoji in monochrome outline font tags (`{\fn...}`).
- `packages/shared/test/clipFactory.test.ts` & `packages/tools/test/video.test.ts`: Updated/added tests verifying `generateAnimatedCaptions` + `captionsAss` wraps emoji once and emits no `/fn` literal leakage.

```text
$ bun test packages/shared/test/clipFactory.test.ts packages/tools/test/video.test.ts
 40 pass
 0 fail
 215 expect() calls
Ran 40 tests across 2 files. [16.59s]

$ bun run typecheck
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
(exit 0)
```

---

## Step 2 — Draft and Project Fix (Plus Page Reframe Cleanup)
- `packages/shared/src/protocol.ts`, `apps/hub/src/core.ts`, `apps/runner/src/client.ts`, `apps/runner/src/runtimes/types.ts`, `packages/tools/src/types.ts`: Added optional `error` to `ack`, returned `#draft` refusal reasons in `ack`, added `#sendRunAck` in `RunnerClient`, and made `saveDraft` awaitable returning `{ ok, error? }`.
- `packages/tools/src/content.ts`: Exported `resolveProject` and `validateDraftAgainstBrief` and awaited `ctx.saveDraft` in `saveDraftTool` (throwing `ToolDenied` on hub refusal).
- `packages/tools/src/clipFactory.ts`: Updated `clip_render` to resolve project via `resolveProject` (missing project throws `ToolDenied` instead of sending `""`), require agent-written `caption` and `self_check` validated via `validateDraftAgainstBrief` (removing hardcoded `self_check` and `#viral #fyp #shorts #reels`), and report `ok: false, draft_saved: false` when the hub refuses.
- `apps/web/src/views/ClipFactoryView.vue`: Added a Project picker (`selectedProjectId`, persisted in `localStorage` under `myofis.clipFactory.projectId`, defaulting to last used or first project), passed `project_id` to `api.chat(...)`, and removed `crop_speaker` from the reframe selector.
- `packages/tools/test/clipFactory.test.ts`: Added `await` on `.rejects`, missing-project error check, hub-refusal (`ok: false, draft_saved: false`) check, and accepted-draft check.

```text
$ bun test packages/tools/test/clipFactory.test.ts
(pass) Clip Factory Runner Tools (clip_find & clip_render) > clip_find discovers moments, calculates virality scores, and saves to hub
(pass) Clip Factory Runner Tools (clip_find & clip_render) > clip_render tool validates boundaries, project/caption/self_check, and hub refusal [3500.00ms]
 2 pass
 0 fail
 17 expect() calls
Ran 2 tests across 1 file. [3.69s]

$ bun run typecheck
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
(exit 0)
```

---

## Step 3 — Windows Across the Whole Video
- `packages/shared/src/clipFactory.ts`: Updated `findCandidateWindows` to walk the entire transcript (removing the 12-window early cap), snap window edges to shot cuts within `±1.0 s`, rank candidates using `prompt` topic keywords and `audioPeaks`, and spread selected candidates across `[0, duration]` via `spreadWindowsAcrossVideo`.
- `packages/shared/test/clipFactory.test.ts`: Added test `4b` verifying full-video spread (`<100s`, `100-200s`, `>=200s`), `±1s` shot-cut snapping (`29.2s`), and topic keyword inclusion (`baja organik`).

```text
$ bun test packages/shared/test/clipFactory.test.ts
 12 pass
 0 fail
 62 expect() calls
Ran 12 tests across 1 file. [131.00ms]

$ bun run typecheck
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
(exit 0)
```

---

## Step 4 — `clip_score` Tool + Agent Prompt (No Numeric Fallback)
- `packages/shared/src/clipFactory.ts`: Made `score`, `subscores`, and `reasons` nullable on `ClipCandidateSchema` with `unscored?: boolean`, removed all hardcoded default scores and template hooks from `parseModelScoring` (returns `null` when incomplete), and added `CLIP_SCORE_PROMPT_V1` and `ClipScoreItemSchema`.
- `packages/tools/src/clipFactory.ts`: Removed `describeImages`, blank-frame generation, and numeric heuristic fallback from `clip_find` (records explicit `warnings` on transcribe/index failures and throws `ToolDenied` if neither is available); stores `unscored` windows and returns `CLIP_SCORE_PROMPT_V1`, `shot_cuts`, and `audio_peaks`. Added `clipScoreTool` (`clip_score`) to validate subscores/reasons/hooks/headline with Zod, compute the weighted score, and persist scored clips.
- `packages/tools/src/index.ts` & `apps/hub/src/http.ts`: Registered `clipScoreTool` and granted `clip_score` access to `clips_get` and `clips_put`.
- `packages/agents/src/clipFactory.ts` & `packages/agents/src/editor.ts`: Granted `clip_score` (and `read_brief` for Clip Factory) and updated `CLIP_FACTORY_PROMPT` to embed `CLIP_SCORE_PROMPT_V1` for text-only scoring.
- `apps/web/src/views/ClipFactoryView.vue`: Displays `"Belum dinilai"` when `clip.score === null || clip.unscored` instead of `"/99"`.
- `packages/shared/test/clipFactory.test.ts` & `packages/tools/test/clipFactory.test.ts`: Verified `parseModelScoring` returns `null` on incomplete input, executed `clip_find` with fake transcript + shot index, validated `clip_score` Zod rejection + weighted scoring (`81/99`).

```text
$ bun test packages/shared/test/clipFactory.test.ts packages/tools/test/clipFactory.test.ts
 14 pass
 0 fail
 93 expect() calls
Ran 14 tests across 2 files. [4.06s]

$ bun run typecheck
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
(exit 0)

$ bun run --cwd apps/web build
✓ 4101 modules transformed.
✓ built in 2.62s
```

---

## Step 5 — Hook on Screen
- `packages/tools/src/clipFactory.ts`: Added a top-positioned `"pop"` hook caption (`start: 0, end: min(2.5, dur), position: "top", animation: "pop"`) to `EditPlan.captions` when `hook` is provided in `clip_render`, and returned `hook_on_screen: boolean` in `clip_render`'s output.
- `packages/tools/test/clipFactory.test.ts`: Verified `clip_render` with `hook: "Rahsia Jimat Modal!"` renders and returns `hook_on_screen: true`.

```text
$ bun test packages/tools/test/clipFactory.test.ts
(pass) Clip Factory Runner Tools (clip_find, clip_score & clip_render) > clip_find discovers unscored windows from transcript + shot index, and clip_score validates & scores them [438.00ms]
(pass) Clip Factory Runner Tools (clip_find, clip_score & clip_render) > clip_render tool validates boundaries, project/caption/self_check, and hub refusal [3469.00ms]
 2 pass
 0 fail
 30 expect() calls
Ran 2 tests across 1 file. [4.08s]

$ bun run typecheck
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
(exit 0)
```

---

## Step 6 — Real Run & Final Verification

### Real Run (Owner's Runner Upload + `canopy-ai` via Clip Factory Agent)
- **Status:** **`NOT RUN`** (`data/hub.db` and `canopy-ai` / owner's runner uploads are not present in this test workspace).

### Final Verification (Raw Output)

```text
$ bun run typecheck
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
(exit 0)

$ bun test
1 tests skipped:
(skip) motion_render with real hyperframes CLI > renders hook template to MP4 and uploads it as a video attachment

 410 pass
 1 skip
 0 fail
 4356 expect() calls
Ran 411 tests across 73 files. [204.38s]

$ bun run --cwd apps/web build
✓ 4101 modules transformed.
✓ built in 3.42s
```
