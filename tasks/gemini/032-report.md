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


## Step 5 — Wiring, prompts & built-in skill
- Updated `packages/shared/src/programs.ts`, `packages/tools/src/index.ts`, `packages/agents/src/editor.ts`, `packages/agents/src/tiktok.ts`, `packages/agents/src/index.ts`, `apps/hub/test/manual.test.ts`, and `apps/hub/test/memory.test.ts` (added `"beat-montage-bm"` to `BUILTIN_SKILLS` expectations).
- `bun test apps/hub/test/manual.test.ts`:
```text
 3 pass
 0 fail
 18 expect() calls
```
- `bun test apps/hub/test/memory.test.ts`:
```text
 6 pass
 0 fail
 36 expect() calls
Ran 6 tests across 1 file. [4.62s]
```

## Step 6 — Studio beat ticks
- Added `BeatAnalysisSchema` (`packages/shared/src/beats.ts`), `beats()` / `setBeats()` / `music_beats` on `info()` (`apps/hub/src/studio.ts`), `"beats"` action on `/api/runner/video-data` (`apps/hub/src/http.ts`), `"beats"` in `ToolContext.videoData` (`packages/tools/src/types.ts`), and Beat ticks lane in `apps/web/src/views/VideoStudioView.vue` (`apps/web/src/api/http.ts`).
- `bun test apps/hub/test/beats.test.ts`:
```text
 1 pass
 0 fail
 6 expect() calls
Ran 1 test across 1 file. [933.00ms]
```

## Step 7 — Real Check & Final Verification

### Real Check (120 BPM click track + 3 color clips → `music_beats` → `montage_plan` → `video_edit`)
Raw output:
```text
BEATS: {"bpm":120,"confidence":1,"beatsCount":16,"firstBeats":[0.0232,0.4876,0.9985,1.4861,1.9969,2.4845,2.9954,3.483,3.9938,4.5047,4.9923,5.5031],"bars":[0.9985,2.9954,4.9923,6.9892]}
PLANNED_CUTS: [0.999,1.997]
PLAN_CLIPS: [{"video":1,"start":0,"end":0.999,"speed":1,"zoom":"in"},{"video":2,"start":0,"end":0.998,"speed":1,"zoom":"out"},{"video":3,"start":0,"end":0.998,"speed":1,"zoom":"in"}]
EDIT_OUT: {"ok":true,"summary":"rendered beat-montage-tiktok_fhd.mp4 (3s, 0.32 MB)","output":{"video_id":"upl_test","file":"beat-montage-tiktok_fhd.mp4","preset":"TikTok FHD 1080×1920 (9:16)","seconds":3,"size_mb":0.32,"encoder":"NVIDIA GPU (h264_nvenc)"}}
FFPROBE: {
    "streams": [
        { "codec_name": "h264", "width": 1080, "height": 1920, "r_frame_rate": "30/1" },
        { "codec_name": "aac", "r_frame_rate": "0/0" }
    ],
    "format": { "duration": "3.000000", "size": "332547", "bit_rate": "886792" }
}
SCENE_CUTS_PTS: [1,2]
SIDE_BY_SIDE:
  cut#1: planned=0.999s | detected_scene=1.000s | delta=0.001s
  cut#2: planned=1.997s | detected_scene=2.000s | delta=0.003s
```
- Real track from owner's music folder: NOT RUN (owner's `data/` not touched).

### Final Verification
- `bun run typecheck`:
```text
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```
(exit 0)
- `bun test`:
```text
 428 pass
 1 skip
 0 fail
 4604 expect() calls
Ran 429 tests across 78 files. [312.29s]
```
- `bun run --cwd apps/web build`:
```text
✓ built in 2.77s
```


---

## Fixes after review

Addressed every defect listed in `tasks/gemini/032-review.md`:

1. **Short clips never push later cuts off the beat** — `packages/shared/src/montage.ts:116-181`, `packages/shared/src/montage.ts:223-244`
   - `pickBest()` skips clips shorter than `segDur` whenever a long-enough alternative exists; when no eligible clip is long enough (or the closing loop segment uses a short clip 0), `buildSegmentClips()` keeps exact finished duration `segDur` using `speed = dur / segDur` (`>= 0.5`) or looping the clip.
   - Tested in `packages/shared/test/montage.test.ts` with a `0.3 s` clip (mixed with `10 s` clips AND all-`0.3 s` clips): every cut lands on its beat (`± 1 frame`).
2. **`cut_every` 2/4 aligned in phase with bars & always ends on a bar** — `packages/shared/src/montage.ts:56-114`
   - `buildCutBoundaries()` aligns beat selection phase to `firstBarIdx` (`((i - firstBarIdx) % cutEvery + cutEvery) % cutEvery === 0`) and ensures `endLimit` (whole bar) is always the final cut boundary.
   - Tested with bars at `0.5, 2.5, 4.5, 6.5` and `cut_every: 2` → exact cuts `[0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5]`, `total_seconds: 6.5`.
3. **Loop mode with 2 clips and an even segment count** — `packages/shared/src/montage.ts:246-267`
   - Decides the last two segments first (`segCount - 1 = 0` from `start = 0`, `segCount - 2 != 0`), alternating backwards when `clipCount === 2` and round-robining `0..segCount - 3` otherwise.
   - Tested with 2 clips + 6 segments (`loop: true`): last = clip 1 from `0`, penultimate = clip 2, zero back-to-back repeats.
4. **Existing Misi 1K agents get `beat-montage-bm` via `BuiltinAgent.upgrade.skills`** — `packages/agents/src/index.ts:58-60`, `packages/agents/src/tiktok.ts:140-144`, `apps/hub/src/seed.ts:60-112`
   - Added `skills?: string[]` to `BuiltinAgent.upgrade` and `skills: ["beat-montage-bm"]` to `tiktokUpgrade`.
   - `seed()` adds each upgrade skill once (`seeded.skill.<slug>.<skill>`) when `existing.config.skills` is an explicit list (`"all"` already includes it) and respects subsequent owner removal.
   - Tested in `apps/hub/test/beats.test.ts`.
5. **`splitLineWords` strictly produces 5–9 word chunks** — `packages/shared/src/montage.ts:36-54`
   - Replaced greedy chunking with balanced division (`numChunks = Math.ceil(n / maxWords)`, `base = Math.floor(n / numChunks)`, remainder distributed across first `rem` chunks) so every chunk is strictly `5..9` words for any line with `>= 5` words (`15` words → `8 + 7`, `10` → `5 + 5`, `11` → `6 + 5`, `19` → `7 + 6 + 6`).
   - Tightened test in `packages/shared/test/montage.test.ts` to assert `count >= 5 && count <= 9` (never loosened).
6. **Captions without hook run bar i → bar i+1; split sub-lines snap to beats** — `packages/shared/src/montage.ts:281-342`
   - Without `hook`, `rawBarEdges` starts at `sortedBars[0]` (so `lines[0]` runs `bar 0 → bar 1`, never flashing `0 → bar 0`).
   - Split sub-lines snap their transition timestamps to beat boundaries inside `(bStart, bEnd)` instead of arbitrary fractional steps.
   - Tested in `packages/shared/test/montage.test.ts`.
7. **Beat ticks validated by `size` + `mtime_ms`, and `montage_plan` sends beats to hub** — `apps/hub/src/studio.ts:123-152`, `apps/hub/src/http.ts:576-588`, `packages/tools/src/beats.ts:9-151`
   - `analyzeTrackBeats` returns `size` and `mtime_ms`; both `music_beats` and `montage_plan` send `{ track, size, mtime_ms, beats }` to `videoData("beats", ...)`.
   - `studio.beats()` treats a `size` or `mtime_ms` mismatch as a cache miss (`null`).
   - Tested in `apps/hub/test/beats.test.ts` and `packages/tools/test/beats.test.ts`.

### Targeted Fix Tests (Raw Output)
```text
$ bun test packages/shared/test/montage.test.ts packages/tools/test/beats.test.ts apps/hub/test/beats.test.ts
 10 pass
 0 fail
 143 expect() calls
Ran 10 tests across 3 files. [2.03s]
```

### Real ffmpeg Check With ≤ 1 s Short Clip (`0.6 s` clip + two `4 s` clips, 120 BPM, `cut_every: 2`, `loop: true`)
```text
BEATS: {"bpm":120,"confidence":1,"firstBeats":[0.0232,0.4876,0.9985,1.4861,1.9969,2.4845,2.9954,3.483,3.9938,4.5047,4.9923,5.5031],"bars":[0.9985,2.9954,4.9923,6.9892]}
PLAN_CLIPS: [{"video":2,"start":0,"end":0.999,"speed":1,"zoom":"in"},{"video":3,"start":0,"end":0.998,"speed":1,"zoom":"out"},{"video":1,"start":0,"end":0.6,"speed":0.6012,"zoom":"in"},{"video":2,"start":1.11,"end":2.109,"speed":1,"zoom":"out"},{"video":1,"start":0,"end":0.6,"speed":0.6012,"zoom":"in"}]
PLANNED_CUTS: [0.999,1.997,2.995,3.994] TOTAL_S: 4.992
EDIT_OUT: {"ok":true,"summary":"rendered beat-montage-fix-tiktok_fhd.mp4 (5s, 0.74 MB)"}
DET_EXIT: 0 SCENE_CUTS_PTS: [1,2,3,4]
  cut#1: beat=0.999s | planned=0.999s | detected_scene=1.000s | delta=0.001s
  cut#2: beat=1.997s | planned=1.997s | detected_scene=2.000s | delta=0.003s
  cut#3: beat=2.995s | planned=2.995s | detected_scene=3.000s | delta=0.005s
  cut#4: beat=3.994s | planned=3.994s | detected_scene=4.000s | delta=0.006s
```

### Final Verification After Fixes (Raw Final Lines)
- `bun run typecheck`:
```text
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```
(exit code 0)

- `bun test`:
```text
 461 pass
 1 skip
 0 fail
 5534 expect() calls
Ran 462 tests across 87 files. [355.11s]
```

- `bun run --cwd apps/web build`:
```text
✓ built in 2.83s
```
