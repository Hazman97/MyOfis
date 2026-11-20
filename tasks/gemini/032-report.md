# Task 032 Report: Beat-Sync Montage

Following `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md`.
All command outputs below are raw tool outputs; anything not executed is marked `NOT RUN`.

---

## Step 1 — Pure Beat Detection (`packages/shared/src/beats.ts`)
- Implemented radix-2 FFT, spectral flux onset envelope (FFT 1024, hop 512, 22050 Hz), comb autocorrelation tempo estimation in 70–180 BPM (preferring 90–140 BPM via `normalizeTempoRange`), Ellis (2007) dynamic programming beat tracker, and 4/4 downbeat bar selection.
- Exported from `packages/shared/src/index.ts`.
- Added unit tests in `packages/shared/test/beats.test.ts` (120 BPM click track within 20–25 ms, 100 BPM with noise, silence → confidence 0, and 180 BPM → 90 BPM halving).

```text
$ bun test packages/shared/test/beats.test.ts
(pass) Task 032 Step 1: Pure beat detection (detectBeats) > 120 BPM synthetic click track -> bpm 120 ± 1, beats within 20 ms, bars every 4 beats [31.00ms]
(pass) Task 032 Step 1: Pure beat detection (detectBeats) > 100 BPM click track with noise -> bpm 100 ± 2 [31.00ms]
(pass) Task 032 Step 1: Pure beat detection (detectBeats) > silence -> confidence 0 and no beats
(pass) Task 032 Step 1: Pure beat detection (detectBeats) > tempo halving / doubling prefers 90-140 BPM [16.00ms]

 4 pass
 0 fail
 32 expect() calls
Ran 4 tests across 1 file. [350.00ms]
```

---

## Step 2 — `music_beats` Tool (`packages/tools/src/beats.ts`)
- Added `analyzeTrackBeats` and `musicBeatsTool` (`music_beats {track}`), validating `clip_folder/music/<track>`, decoding mono 22050 Hz `f32le` PCM via async `ffmpeg`, running `detectBeats`, and caching in `.myofis-clips.json` by `file|size|mtime`.
- Added `music_beats` cache support on `ClipIndex` in `packages/tools/src/clips.ts`.
- Verified with `packages/tools/test/beats.test.ts` on a generated 8 s 120 BPM `aevalsrc` click track.

```text
$ bun test packages/tools/test/beats.test.ts
(pass) Task 032 Step 2: music_beats tool > decodes 120 BPM click track with ffmpeg, caches in .myofis-clips.json, and rejects missing/traversal track [187.00ms]

 1 pass
 0 fail
 12 expect() calls
Ran 1 test across 1 file. [366.00ms]
```

---

## Step 3 — Pure Montage Planner (`packages/shared/src/montage.ts`)
- Implemented `planMontage` and `splitLineWords` and exported them from `packages/shared/src/index.ts`.
- Cuts align to beat boundaries (`cut_every: 1 | 2 | 4`), auto-raise `cut_every` to stay `<= 80` clips, alternate `zoom: "in" | "out"`, never repeat the same clip back-to-back, place `hook` from `0` to first bar and `lines[i]` per bar (`5–9` words, `pop`, `middle`), use `transition: { type: "none" }`, and support `loop: true`.
- Verified with `packages/shared/test/montage.test.ts`.

```text
$ bun test packages/shared/test/montage.test.ts
(pass) Task 032 Step 3: Pure montage planner (planMontage) > cuts equal beat times (±1 frame at 30fps), captions change on bars, and no clip repeats back-to-back
(pass) Task 032 Step 3: Pure montage planner (planMontage) > auto-raises cut_every when > 80 clips would be produced
(pass) Task 032 Step 3: Pure montage planner (planMontage) > loop mode ends with first clip's opening frames and avoids repeating clip 0 back-to-back [15.00ms]
(pass) Task 032 Step 3: Pure montage planner (planMontage) > splitLineWords keeps chunks within 5-9 words

 4 pass
 0 fail
 67 expect() calls
Ran 4 tests across 1 file. [190.00ms]
```

---

## Step 4 — `montage_plan` Tool (`packages/tools/src/beats.ts`)
- Added `montagePlanTool` (`montage_plan`), which reads cached/detected beats via `analyzeTrackBeats`, probes attached video durations, and returns `planMontage(...)` as `edit_plan` without rendering so the agent can inspect before calling `video_edit`.
- Verified with `packages/tools/test/beats.test.ts`.

```text
$ bun test packages/tools/test/beats.test.ts
(pass) Task 032 Step 2: music_beats tool > decodes 120 BPM click track with ffmpeg, caches in .myofis-clips.json, and rejects missing/traversal track [609.00ms]

 1 pass
 0 fail
 19 expect() calls
Ran 1 test across 1 file. [846.00ms]
```
