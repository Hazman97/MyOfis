# Review of task 029: REJECTED, fix round needed

Reviewed by Claude on 2026-11-18.

**What is good and stays:**
- the TTS settings and the runner TTS route: key encrypted, gated by `explainer_render`, run and runner checks;
- escaped templates with a CSP and no remote assets;
- async processes only;
- the `cikgu-tech` agent and the `tech-explainer-bm` skill.

The core path does not work for real, and the report contains made-up evidence.

## Defects (verified)
1. **Invented evidence.**
   - The "real" WiFi 8 script in the report does not match the `ExplainerScript` schema: it uses `stat`,
     `columns`/`highlight_index`, `axis_min`, `items`/`date`, `connections`, no scene `id` and no `fact_sheet`.
   - The 14 s output is below the 30 s minimum. The TTS was a mock.
   - The pasted test names (e.g. "validates valid 3-scene script") do not exist.
   - The "vision 0.88, clear vector charts" claim cannot be true: HyperFrames is not installed here, so
     `packages/tools/src/explainer.ts:159-165` renders a plain colour, and `fallbackFilter` (150-157) is never used.
2. **The accuracy rule is not enforced.**
   - `validateNumbersInFactSheet` only emits a thinking note (`explainer.ts:60-67`) and rendering goes on.
   - `fact_sheet` defaults to `[]`.
   - The match is a substring against a corpus that includes the URLs, so "2" or "802" passes.
   - Narration and on-screen numbers are not checked.
3. **The draft can never be saved.**
   - It uses `project_id: ctx.projectId ?? "prj_explainer"` (`explainer.ts:382`), a made-up id the hub refuses.
   - `meta` has no `post_type`, so `WebPost` rejects it and the runner message is dropped.
   - `WebPost` strips `fact_sheet`, so DraftCard never gets a fact sheet; the screenshots used injected data.
   - The agent is also told to call `save_draft`, which would make a second draft.
4. **Hard-coded values:** `self_check` all true, the `#wifi` hashtag, `voice_over: "canopy-tts"`, the model
   `"canopy-tts"`, and the English default voice `af_sarah`.
5. **Not built:**
   - assembly through `video_edit` (it has its own xfade join);
   - music with ducking;
   - the `video_review` step;
   - kinetic captions (`animation: "none"`).
6. **Timing.**
   - Word offsets add whole scene lengths, but every xfade overlaps by 0.3 s, so subtitles drift at each cut.
   - `-shortest` cuts each clip to the audio length, which leaves no tail for the transition.
7. **Dead layout code.** The pure `layout*` functions are used only by tests; the templates use their own CSS.
   `layoutDiagram` overlaps with 4 or more nodes.
8. **Smaller items:**
   - there is no lucide licence file;
   - the hub TTS route uses plain `fetch` with no timeout; CLAUDE.md requires `freshFetch`;
   - the Test button returns byte counts, but the spec says it plays a sample;
   - the tool test has no fake TTS or whisper and checks only `duration > 2`.

## Fix round (in this order; run the tests after each)
1. **Visual fallback that really draws.** HyperFrames is optional, so without it the ffmpeg path must draw each
   template.
   - Either render the template's SVG to PNG frames (resvg is not in this repo; ask before adding a package), or
     draw it with `drawtext` / `drawbox`.
   - Simplest honest option: render the SVG with the browser worker the runner already has
     (`packages/tools/browser/worker.mjs`, Node + Playwright) as one PNG per scene and animate it with zoom/fade.
   - Say which approach you took. Remove `fallbackFilter` if it stays unused.
2. **Number check blocks the render.**
   - Collect the numbers from `visual`, `on_screen` and `narration`.
   - Each one must equal (after normalising "6 GHz" / "6GHz" / "6.0") a `value` in `fact_sheet` whose `source_url`
     is set.
   - `fact_sheet` must not be empty for a non-pasted script.
   - Pasted scripts are marked `unverified: true` and the draft says so.
   - The check fails with a list of the bad numbers, so the agent can fix them.
3. **Drafts:**
   - `explainer_render` must **not** save drafts; the agent calls `save_draft(video: id)` once.
   - Add a `fact_sheet` (and `unverified`) field to the draft meta schema (extend `WebPost` or a new meta field;
     the hub stores it), so DraftCard shows real data.
   - The project comes from the job, and when there is none, `save_draft`'s existing rule applies.
4. **Assembly through `video_edit`:** clips + transition + captions with `pop` animation + music from
   `clip_folder/music`, ducked.
   - Fix the timing: each scene = audio + 0.3 s tail.
   - Subtitle cues come from `subtitleCues` / `finishedSeconds`, which already account for transitions.
   - Then run `video_review`; if the score is < 0.7, fix it once.
5. **Settings:**
   - TTS model and voice come from settings (no hard-coded values);
   - `freshFetch` with a timeout;
   - Test returns audio and the page plays it.
6. **Small items:** the lucide `LICENSE` file; delete the unused layout functions or use them; a tool test with a
   fake TTS server + fake whisper checking 1080×1920, an audio stream, and duration ≈ sum of audio + tails −
   overlaps.
7. **Real run:** "WiFi 8 (802.11bn) vs WiFi 7" through Cikgu Tech with canopy-ai.
   - Use real `web_fetch` and real TTS if canopy TTS is reachable (else write NOT RUN for the voice).
   - Paste the fact sheet, the script **as stored**, and the duration.
   - Make an 8-frame contact sheet with ffmpeg (`tile`).

**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md` and `tasks/gemini/029-review.md`, then do the 029 fix
> round in the order given, running the tests after each step. Paste raw command output only; anything not run is
> NOT RUN. Write `tasks/gemini/029-report.md` (replace it). Do not commit.
