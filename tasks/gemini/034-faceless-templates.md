# Task 034: faceless formats (story, Top 5 list, before/after, quote) with Malay voice-over

Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md` and `tasks/gemini/029-review.md` first. Write
`tasks/gemini/034-report.md` (a note after each step). Do not commit.
**It depends on 029's fix round passing review.** It reuses that pipeline: the script schema, TTS, the visual
fallback, `video_edit` assembly and `video_review`.

## Why
In 2026, formats beat sounds. The faceless formats that do best are:
- story narration;
- ranked lists ("Top 5…");
- before/after reveals;
- quote edits.

The owner wants a whole video from one script with a Malay voice-over, using his own clips where they fit.

## Build
1. **Script schema** (shared, pure, tested): extend the 029 `ExplainerScript`, or add a sibling `FacelessScript`.
   Say which and why.
   - `format`: `story | list | before_after | quote`.
   - **Per format:**
     - **story:** hook, 4–8 beats of narration, a twist line, an ending question.
     - **list:** a title, then N = 3–7 items `{rank, title, one_line}` counted down to #1, with a "#1 bikin
       terkejut" style reveal.
     - **before_after:** before `{clip | still, caption}`, after `{…}`, and the change.
     - **quote:** 1–3 quotes `{text, by?}`, ≤ 25 words each, never made up as real people's words. If `by` is a
       real person, the quote must have a `source_url`; otherwise it is the agent's own words with no name.
   - Every scene can use a clip from the job (`video: n`, cut by the planner) or a motion template (029's, plus new
     ones below).
2. **New motion templates** (same rules as 029: escaped, offline, safe areas, a real fallback):
   - `rank_card` (big #N + title);
   - `split_before_after` (wipe reveal);
   - `quote_card` (big quote marks, word-by-word reveal);
   - `story_text` (2–4 words at a time, centred).
3. **Tool `faceless_render`:**
   - Script → TTS per scene → visual or clip per scene → assembly through `video_edit` (karaoke subtitles from 033
     if present, else `pop`) → `video_review`.
   - It returns the upload like `video_edit` does. **It does not save drafts.**
4. **Agent "Pencerita"** (`faceless`, seeded **disabled**, approve-first):
   - **Tools:** `clip_library`, `faceless_render`, `video_review`, `save_draft`, `read_past_drafts`, `web_search`,
     `web_fetch`, `memory`, `skill_view`.
   - **Flow:** pick the format from the owner's prompt, or rotate formats when run by a schedule → write the
     script (BM) → for facts, the same fact rules as 029 → render → review → `save_draft` (caption: hook, 2 lines,
     a question, 3–5 hashtags).
   - Skill `faceless-formats-bm`: structures, hooks per format, length (list 45–75 s, story 60–120 s), and what
     not to do (fake quotes, fake "true story" claims).
5. **Schedule:** job type `faceless_post`, daily 21:00, seeded off.

## Tests and proof
- Schema per format, quote attribution rules, template layout (long titles), and a `faceless_render` test with a
  fake TTS + fake whisper (1080×1920, audio present, duration ≈ audio + tails).
- **Real runs:** one `list` and one `story` through Pencerita with canopy-ai and real TTS if reachable.
  - Paste the scripts as stored, the durations and 8-frame contact sheets; anything not run is **NOT RUN**.
- `bun run typecheck`, the full `bun test`, the web build: raw final lines.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, `tasks/gemini/029-review.md`, then do
> `tasks/gemini/034-faceless-templates.md` step by step, tests after each, notes appended to `tasks/gemini/034-report.md`.
> Paste raw output only; anything not run is NOT RUN. Do not commit.
