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
