# 032 review (Claude, 2026-11-25): PASS WITH FIXES

Committed already (fb95f5f, e355941) without review. Targeted tests pass (10/10), ffmpeg argv + scrubbed env OK,
the `beats` runner action is gated correctly, old prompts kept as V4. But the planner is wrong in the common case
(short owner clips), so fix these before anything else uses montage. Append notes to `tasks/gemini/032-report.md`
under "## Fixes after review". Do not commit.

## Fixes (most severe first)
1. **Short clips push every later cut off the beat** — `packages/shared/src/montage.ts:151`
   `usableDur = Math.min(segDur, src.duration)` shortens the segment and nothing makes up the time. Beats every
   0.5 s, `cut_every: 2`, clips 0.3 s + 10 s → cuts at 0.3, 1.3, 1.6, 2.6… instead of 1, 2, 3…
   Fix: every segment is exactly `segDur`. When picking, skip clips shorter than the segment; if none is long enough,
   use `speed < 1` (min 0.5) or loop the clip. Test with a 0.3 s clip: every cut lands on its beat (±1 frame).
2. **`cut_every` 2/4 is out of phase with bars; the end is not on a bar** — `montage.ts:77`
   The loop starts at `cutEvery - 1`. Bars at 0.5/2.5/4.5/6.5 with `cut_every: 2` → cuts 1…6, none on a bar, video ends
   6.0 not 6.5. Fix: count from the index of the first bar; always add `endLimit` (a bar) as the last cut. Test it.
3. **Loop mode breaks with 2 clips and an even segment count** — `montage.ts:132-138`
   The no-back-to-back rule runs after the loop override and moves the last segment off clip 0 (1,2,1,2,1,2 with
   the last forced to start 0). Fix: decide the last two segments first (last = clip 0 from 0, the one before ≠ 0),
   round-robin the rest. Add a 2-clip loop test.
4. **Existing Misi 1K agents cannot open `beat-montage-bm`** — `packages/agents/src/tiktok.ts:166`
   The skill was only added to fresh-seed `config.skills`; `upgrade` adds tools and prompts, not skills, so
   `skillsFor()` filters it out for the owner's real agent. Fix: teach `BuiltinAgent.upgrade` to add skills once
   (`seeded.skill.<agent>.<skill>`, only when the agent's `skills` is a list; `"all"` already includes it). Test with
   an agent seeded with the old list.
5. **`splitLineWords` returns 4-word chunks; the test was loosened to `>= 4`** — `montage.ts:45-48`
   15 words → 7/4/4. Spec says 5–9. Fix: `per = ceil(n / ceil(n / 9))`, assert `>= 5` (except when the line itself
   has < 5 words). Never loosen a test to match the code.
6. **Without a hook the first line flashes 0→first bar** — `montage.ts:188`. Spec: `lines[i]` runs bar i → bar i+1.
   Split sub-lines must also change on bars (or beats), not at `step` fractions.
7. **Beat ticks keyed by track name only** — `apps/hub/src/studio.ts:123` `music.beats.<ws>.<track>`.
   Add size + mtime to the key (or store them and treat a mismatch as missing). `montage_plan` must also send its
   beats to the hub so the Studio shows ticks without a separate `music_beats` call.

## Proof
- New/updated tests for 1–6 (raw output). Re-run the real ffmpeg check from the report with one ≤ 1 s clip and
  paste the cut times vs the beat times.
- `bun run typecheck`, full `bun test`, `bun run --cwd apps/web build`: raw final lines.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, then `tasks/gemini/032-review.md` and fix every item, tests after each, notes
> appended to `tasks/gemini/032-report.md` under "## Fixes after review". Never loosen a test to make it pass. Paste
> raw output only; anything not run is NOT RUN. Do not commit.

---
## Fixes re-review (Claude, 2026-11-25): PASS
All 7 items fixed and tested; re-run: typecheck OK, 461 pass / 1 skip / 0 fail, web build OK.
Leftover nit (do later, not blocking): `buildSegmentClips` can loop a very short clip (e.g. 0.1 s) into many clips; past
`MAX_CLIPS` they are dropped silently (`montage.ts:299`), so the video ends early and the loop close is lost. Count the
looped pieces when choosing `cut_every`, or skip clips under ~0.25 s, and add a note.
