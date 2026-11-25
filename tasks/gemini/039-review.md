# 039 review (Claude, 2026-11-25): PASS WITH FIXES

storyParts, hdOutputsFor, legacy targets/routes, public file route, sniffed `-f` before `-i`, textContent-only page,
per-IP/daily/queue limits, prompt upgrades: all OK. Targeted tests pass (33 + 6). Append notes to
`tasks/gemini/039-report.md` under "## Fixes after review". Do not commit.

1. **Public storage cap ignores output size** — `apps/hub/src/publicHd.ts:326-329` counts only the input at admission;
   a job can now write up to 4 full re-encodes plus up to 10 Story parts. Fix: at admission add an estimate
   (Σ target maxrate × duration, or `input × files` before the duration is known) to the cap check, and re-check
   `storageBytes()` before each target; over the cap → the job fails with the BM "server penuh, cuba lagi nanti".
2. **`max_files` counts targets, not files** — `publicHd.ts:288` + parts route. A 10-min Story = 10 files while the card
   says "hingga 4 fail". Fix: once the duration is known in `#process`, count `ceil(duration/60)` for `story`; refuse
   (before encoding) when the real file count exceeds `max_files`, or rename the setting and label to "format".
   Pick one and say which.
3. **Missing tests** (the report's "none not done" was overstated): owner `POST /api/videos/:id/hd {placements}` →
   jobs' covers; `video_hd` story on a 61–75 s lavfi clip → 2 files with `part`/`parts`; `Studio` result ordering of
   parts.
4. **Minor, fix all:**
   - `tiktok` and `vertical` are the same output: de-duplicate them (public and owner routes).
   - Public "Semua platform" with `max_files` 4 drops WhatsApp Status silently and the toggle never clears; make it
     select what fits, say what was left out, and clear on the second click.
   - Public encodes must run at low priority (`spawnLogged(..., true)` or equivalent), as 038 required.
   - `#jobCovers` is memory-only: store covers on the public job row so a restart keeps them; delete on failure.
   - `detectStoryCutPoints`: also use scene changes, as the spec said (silence first, then scene).
   - Apply `HD_TARGETS.*.max_mbps` as the real maxrate cap, or remove the field.

Proof: raw output of new tests; `bun run typecheck`, full `bun test`, `bun run --cwd apps/web build` final lines.
