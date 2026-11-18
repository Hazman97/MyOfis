# Task 032: beat-sync montage (one clip per beat, text changes on the bar)

Read `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md` (honesty rules) first. Write
`tasks/gemini/032-report.md`; append a note after every Build step so the work survives a stop. Do not commit.
**Do 031 first** (it touches `packages/tools/src/video.ts` too).

## Why
Beat-synced montages are still one of the strongest short-video formats (2026 research, owner request 2026-11-18):
- one cut per beat (or per 2 or 4 beats);
- the text changes on the bar;
- 5–9 words per line;
- a text-first opening and a seamless loop.

We have the clip folder and music (`clip_library`, `EditPlan.music`), but **no beat detection anywhere**.

## Facts from the code
- `packages/tools/src/clips.ts`: `clip_library` (list / pick / use), `musicTracks(dir)` (the `music/` subfolder),
  and the clip index `.myofis-clips.json` (with descriptions).
- `packages/shared/src/video.ts`: `EditPlan` (clips ≤ 80, `transition`, `captions`, `music {track, volume_db}`,
  `subtitles`), `Clip` (start/end/speed/zoom/fit), `finishedSeconds` / `transitionSeconds`.
- `packages/tools/src/video.ts`: `buildEditArgs` (music: looped, faded, `amix` under the clip sound),
  `ffmpegBin()`, async `spawn()`, `mediaDir(ctx)`, `videoEditTool`.
- **No new packages.** ffmpeg decodes the audio, and beat detection is pure TS.

## Build
1. **Pure beat detection** (`packages/shared/src/beats.ts`, tested). Input: mono float32 PCM at 22050 Hz.
   1. Onset strength: spectral flux on a short FFT (write a small radix-2 FFT, about 40 lines), hop 512.
   2. Tempo: autocorrelation of the onset envelope in 70–180 BPM, preferring 90–140 (halve or double into that
      range).
   3. Beat times: dynamic programming over the onset envelope with the tempo (the Ellis 2007 style), so beats stay
      evenly spaced but snap to real onsets.
   4. Downbeats / bars: assume 4/4, and pick the phase (0–3) whose beats have the highest mean onset strength.
   - Returns `{bpm, beats: number[], bars: number[], confidence}`. The confidence is low when the autocorrelation
     peak is weak; the tool then says so.
   - **Tests:**
     - a synthetic click track at 120 BPM → bpm 120 ± 1, beats within 20 ms;
     - 100 BPM with a little noise;
     - silence → confidence 0 and no beats;
     - a test for halving/doubling.
2. **Tool `music_beats {track}`** (`packages/tools/src/beats.ts`):
   - It needs the agent's `clip_folder`; the track must be in `music/` (the same name check as `EditPlan.music`).
   - ffmpeg `-i <track> -ac 1 -ar 22050 -f f32le <tmp.raw>` (async spawn, into `mediaDir`), then
     `detectBeats`.
   - The result is cached in the clip index by file name + size + mtime.
   - It returns bpm, the beat count, the first 64 beats and the bars, plus `duration`.
3. **Pure montage planner** (`packages/shared/src/montage.ts`, tested): `planMontage({beats, bars, clips:
   [{video, duration, description?}], target_seconds, cut_every: 1|2|4, lines: string[], hook?: string, loop:
   boolean})` → `EditPlan` with:
   - **Clips:** consecutive segments whose lengths equal the beat gaps (× `cut_every`).
     - Each segment takes the next clip (round-robin, never the same clip twice in a row).
     - The start is inside the clip, varied so a long clip gives different parts.
     - Speed 1. `zoom` alternates in/out for still shots.
   - **Music:** the track from 0, with no fade-in, so the first cut lands on beat 1 (keep `volume_db`).
   - **Captions:**
     - `hook` from 0 to the first bar (text-first opening);
     - then one `lines[i]` per bar, each shown from bar i to bar i+1, 5–9 words (the planner splits longer
       lines);
     - animation `pop`, position middle.
   - **Length:** cut to `target_seconds`, rounded to a whole bar.
   - **`loop: true`:** the last segment reuses the first clip's opening frames, so the end flows into the start,
     and the music ends on a bar.
   - **Transitions:** `none` (hard cuts land on beats; xfade would blur them).
   - **Tests:**
     - cuts equal the beat times (± one frame at 30 fps);
     - captions change exactly on bars;
     - no clip repeats back to back;
     - the total stays ≤ 80 clips (raise `cut_every` automatically, and say so);
     - loop mode.
4. **Tool `montage_plan`** (input = the planner input plus `track`, `clips` from the job's attachments, `lines`,
   `hook`) returns the EditPlan for `video_edit`. **It does not render.** The agent can look at the plan, then call
   `video_edit`.
5. **Wiring:**
   - `programs.ts`: both tools need ffmpeg.
   - Add both tools to Editor and Misi 1K (`tiktok`) through `BuiltinAgent.upgrade`.
   - Prompt upgrade, replaced only when unedited, as before: for montage requests ("montaj", "ikut beat"), do
     `clip_library pick` → `music_beats` → write 4–8 short BM lines (5–9 words) → `montage_plan` → `video_edit` →
     `video_review` → `save_draft`.
   - New built-in skill `beat-montage-bm`: when to use 1/2/4 beats per cut (fast songs → 2), line-writing rules,
     the hook first, loop.
6. **Studio:** when a plan has music, the timeline shows beat ticks (read from `music_beats` through the existing
   video-data route; add an action `beats` gated by the tool). Logic only; Gemini UI polish later.

## Tests and proof
- Unit tests as above, and `bun run typecheck`, the **full** `bun test`, `bun run --cwd apps/web build` (paste the
  raw final lines).
- **Real check:**
  - generate a 120 BPM click track with ffmpeg (`aevalsrc`) plus 3 `testsrc2` clips;
  - run `music_beats` → `montage_plan` → `video_edit`;
  - ffprobe the output, then show with `ffmpeg -vf "select='gt(scene,0.3)',showinfo"` that the scene cuts fall on
    the beat times (paste the times side by side).
- **Real track:** one royalty-free song from the owner's music folder, if one exists; else **NOT RUN**.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/032-beat-sync-montage.md` one
> Build step at a time, running the tests after each and appending a note to `tasks/gemini/032-report.md`. No new
> packages. Paste raw command output only; anything not run is NOT RUN. Do not commit.
