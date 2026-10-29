# Task 029: Tech explainer videos (infographic + motion + Malay voice-over)

Read `tasks/gemini/SUPERVISOR.md` first. Write `tasks/gemini/029-report.md`. Do not commit.
**Depends on:** 024 (`motion_render`, `EditPlan.overlays`), 026 (`video_review`), canopy 005 (`POST /v1/audio/speech`,
Malay TTS). Read `tasks/gemini/028-review.md`: the same rules apply (no fake data, report only what you ran).

## Why
The owner wants TikTok "tech explainer" videos like popular creators make, e.g. *"WiFi 8 dah sampai? Ni beza dia"*:
a strong hook, then 4–6 animated infographic scenes (frequency spectrum 2.4/5/6 GHz with channel widths, a
WiFi 6 vs 7 vs 8 comparison table, a speed bar chart, a big number, a timeline), a Malay voice-over, word-level
subtitles, 30–75 s, 9:16. Topics change (WiFi, IP address, 5G, USB-C, CPU vs GPU…). The script can come from MyOfis
itself (Researcher) **or** be pasted by the owner from another AI.

## Accuracy first (most important rule)
Tech facts must be right. Every number, date, standard name and spec in a video must come from a source fetched in
this run (`web_fetch`, preferably the standard body or vendor: IEEE, Wi-Fi Alliance, 3GPP, USB-IF, Intel/Qualcomm
docs), or from the owner's pasted script. The fact sheet keeps `{claim, value, source_url}`. Things that are not
final (e.g. a standard still in draft) must be said as such ("dijangka", "draf"). The draft caption ends with
"Sumber:" + 1–3 short source names, and the draft shows the full fact sheet to the owner. A pasted script is marked
"unverified" unless the agent checks it.

## Build
1. **`ExplainerScript` schema** (shared, pure, tested): `{topic, language: "ms"|"en", hook, scenes[1..8], outro,
   sources[]}`; each scene `{narration (spoken), on_screen (short), visual}` where `visual` is one of the templates
   below with typed data. Validation: narration ≤ 40 words/scene, total target 30–75 s, numbers in `visual` must
   appear in the fact sheet (pure check, tested).
2. **New `motion_render` templates** (data-driven, escaped like 024, offline, no network, 1080×1920, safe areas):
   - `spectrum`: frequency axis with bands (e.g. 2.4 / 5 / 6 GHz), channel blocks with widths (20–320 MHz), labels,
     highlighted band animates in.
   - `compare_table`: 2–4 columns × 3–6 rows (e.g. WiFi 6 / 7 / 8 × max speed, bands, channel width, year), cells
     reveal row by row, winner cell highlighted.
   - `bar_chart`: 2–6 bars with value labels and units, bars grow.
   - `big_stat`: one big number + unit + one line (count-up animation).
   - `timeline`: 3–6 dated points.
   - `diagram`: 2–6 nodes (icon + label) with arrows (e.g. phone → router → internet), drawn in sequence.
   Icons: a small bundled SVG set (copy a subset of **lucide** icons, ISC licence, keep the licence file); no remote
   assets. Pure layout functions tested (positions, scaling, long labels wrap/shrink, nothing outside safe areas).
3. **Voice-over through the hub** (keys stay on the hub, like web search):
   - `settings.integrations.tts = {base_url, key_enc, voice, speed}`, card in Settings → Integrations (Test plays a sample).
   - Runner route `POST /api/runner/tts {run_id, text, voice?}` (only agents with `explainer_render`) → hub calls
     `<base_url>/v1/audio/speech` → audio file returned to the runner.
   - `TTS_API_BASE` env for tests (fake server).
   - No TTS configured → the video is made without voice (music + on-screen text) and the report/draft says so.
4. **Tool `explainer_render`** (runner, `packages/tools/src/explainer.ts`):
   - input = an `ExplainerScript`;
   - per scene: TTS → measure the audio length (ffprobe) → scene length = audio + 0.3 s;
   - `motion_render` the visual for that length; word timings for subtitles from whisper on the TTS audio (existing
     `video_transcribe` helpers), or evenly spread when whisper is missing;
   - assemble with `video_edit` (clips + transitions + kinetic captions + optional music from `clip_folder/music`,
     ducked under the voice) → `video_review` → returns the upload like `video_edit` does.
   - Async processes only (no `spawnSync`), reuse `video.ts` helpers, time limits apply.
5. **Agent "Cikgu Tech"** (`packages/agents/src/explainer.ts`, slug `cikgu-tech`, seeded enabled), tools:
   `consult_agent` (asks Researcher for the fact sheet), `web_search`, `web_fetch`, `explainer_render`, `video_review`,
   `save_draft`, `read_past_drafts`, `memory`, `skill_view`. Flow: research → fact sheet → script → (if the owner
   asked to see the script first, show it and wait) → render → review → fix once if score < 0.7 → `save_draft`
   (kind video, platform tiktok, caption: hook + 2 lines + question + 3–5 hashtags + "Sumber: …").
   Pasted script mode: "guna skrip ni" → validate, check numbers with web_fetch when possible, render.
   Approve-first: the agent is seeded with `auto_publish` off; the existing switch still works if the owner turns it on.
6. **Skill `tech-explainer-bm`**: hook formulas for tech ("Ramai tak tahu…", "X vs Y, mana lagi laju?"), one idea per
   scene, explain with an everyday analogy (lebuh raya = channel width), no jargon without a 3-word explanation,
   end with a question. BM examples. Accuracy rule repeated.
7. **Chat UI**: a draft from this agent shows the fact sheet (claims + links) under the video in DraftCard.

## Tests and proof
Pure: schema/validation, number-in-fact-sheet check, every template's layout. Tools: `explainer_render` with a fake
TTS server and fake whisper, real ffmpeg render of a 3-scene script (assert duration ≈ sum of audio + transitions,
1080×1920, audio present). Hub: TTS route gating (only with the tool, key never returned), integration card save/test.
**Real run:** topic "WiFi 8 (802.11bn) vs WiFi 7" through Cikgu Tech with canopy-ai + real web_fetch + real TTS if
canopy 005 is live (else say so). Report the fact sheet with URLs, the script, the render time, an 8-frame contact
sheet, and the review score. `bun run typecheck`, **full** `bun test`, `bun run --cwd apps/web build`; paste the
final lines of each. Screenshots of the TTS card and the DraftCard fact sheet (390 px + desktop, light + dark).

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/029-tech-explainer-video.md`.
> Accuracy and honesty rules come first. Write `tasks/gemini/029-report.md`. Do not commit.
