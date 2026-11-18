# 029 report (fix round)

## Step 1 (Visual fallback that really draws) — DONE
- Added `?t=` initial seek support to `renderInfographicHtml` in `packages/shared/src/motionExplainer.ts` so headless Chromium renders the completed infographic frame cleanly when HyperFrames CLI is absent.
- Replaced the plain-color `ffmpeg` fallback in `packages/tools/src/explainer.ts` with `packages/tools/browser/worker.mjs` (Node + Playwright) rendering a 1080×1920 PNG per scene, animated with `ffmpeg` `zoompan`, and removed the dead `fallbackFilter` variable.
- `bun test packages/shared/test/explainer.test.ts packages/tools/test/explainer.test.ts`:
```
 13 pass
 0 fail
 74 expect() calls
Ran 13 tests across 2 files. [12.14s]
```

## Step 2 (Number check blocks the render) — DONE
- Added `pasted` flag to `ExplainerScript` (`packages/shared/src/explainer.ts`), `extractTextNumbers()`, and `normalizeFactToken()` so every number in `visual`, `on_screen`, and `narration` must match a `value` in `fact_sheet` with `source_url` (normalizing `"6 GHz"` / `"6GHz"` / `"6.0"`).
- Non-pasted scripts with empty `fact_sheet` or unverified numbers are rejected with `ToolDenied` in `packages/tools/src/explainer.ts`, listing the bad numbers; `pasted: true` sets `unverified: true`.
- `bun test packages/shared/test/explainer.test.ts packages/tools/test/explainer.test.ts`:
```
 14 pass
 0 fail
 80 expect() calls
Ran 14 tests across 2 files. [12.08s]
```

## Step 3 (Drafts) — DONE
- Removed `ctx.saveDraft(...)` (and hardcoded `prj_explainer`, `#wifi`, `self_check`, `voice_over`) from `explainer_render` (`packages/tools/src/explainer.ts`); `explainer_render` now pushes `{ id, name, content_type, fact_sheet, unverified }` to `ctx.renders` and returns `video_id`.
- Extended `WebPost` (`packages/shared/src/marketing.ts`) with `fact_sheet` and `unverified`; updated `save_draft` (`packages/tools/src/content.ts`) to automatically attach `fact_sheet`/`unverified` from `ctx.renders` when `video` is saved.
- Moved the Fact Sheet block in `apps/web/src/components/DraftCard.vue` outside the `isWebPost` gate so it renders on video drafts too, with an explicit `"Skrip tampalan (belum disahkan)"` badge when `unverified` is true.
- `bun test packages/shared/test/explainer.test.ts packages/tools/test/explainer.test.ts`:
```
 14 pass
 0 fail
 84 expect() calls
Ran 14 tests across 2 files. [12.27s]
```
- `bun run typecheck`:
```
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```

## Step 4 (Assembly through `video_edit` + timing + `video_review`) — DONE
- Fixed scene clip muxing in `packages/tools/src/explainer.ts` using `apad=whole_dur=${sceneDur}` + `-t ${sceneDur}` (removed `-shortest`) so every clip keeps its `+ 0.3s` tail for `xfade`.
- Replaced manual xfade/subtitle assembly with `video_edit` primitives (`buildEditArgs`, `subtitleCues`, `finishedSeconds`, `captionsAss` with `pop` animation, and optional ducked music from `clip_folder/music`).
- Added `videoReviewTool` execution after assembly; if `score < 0.7`, re-assembles once with `normalize_audio: true` and re-reviews.
- `bun test packages/tools/test/explainer.test.ts`:
```
 5 pass
 0 fail
 17 expect() calls
Ran 5 tests across 1 file. [17.32s]
```
- `bun run typecheck`:
```
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```


---

## Step 5 — TTS Settings (`model`, `voice`, `freshFetch`, Audio Playback)
- `apps/hub/src/integrations.ts`: Added `model` to `StoredTts`, `TtsSettingsInput`, `TtsPublic`, and `ttsSettings` (`plan()` / `set()`), and removed the hardcoded `"af_sarah"` default (defaults to `""`).
- `apps/hub/src/http.ts`: Switched `/api/runner/tts` and `/api/settings/integrations/tts/test` from `fetch` to `freshFetch(..., { timeoutMs: 30_000 })`, used configured `plan.model` and `plan.voice` (omitting them when empty instead of hardcoding `"canopy-tts"` / `"af_sarah"`), and updated `/api/settings/integrations/tts/test` to return `content_type` and `audio_base64` alongside `bytes` and `duration_estimate_s`.
- `apps/web/src/api/http.ts` & `apps/web/src/views/IntegrationsView.vue`: Added `model` field to `TtsSettings` / `ttsForm`, removed hardcoded `"af_sarah"` default/placeholder, and wired `testTts()` to render `<audio :src="ttsAudioUrl" controls autoplay>` so the sample plays in the browser.
- `apps/hub/test/tts.test.ts`: Added assertions for `model`, `voice`, `content_type`, and `audio_base64`.

```text
$ bun run typecheck
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
(exit 0)

$ bun test apps/hub/test/tts.test.ts
(pass) Hub TTS Integration (Task 029) > settings save, mask secret key, and return hint [296.00ms]
(pass) Hub TTS Integration (Task 029) > test route invokes endpoint and returns audio stats [235.00ms]
(pass) Hub TTS Integration (Task 029) > runner route /api/runner/tts requires authentication and gates by agent tool [500.00ms]
 3 pass
 0 fail
 26 expect() calls

$ bun run --cwd apps/web build
✓ 4101 modules transformed.
✓ built in 3.18s
```

---

## Step 6 — Small Items (Lucide LICENSE, Dead Layout Cleanup, HTTP TTS + Whisper Tool Test)
- `packages/shared/src/explainerIcons.LICENSE.txt` & `packages/shared/src/explainerIcons.ts`: Added full Lucide ISC license text file next to `explainerIcons.ts` and referenced it in the header comment.
- `packages/shared/src/explainer.ts` & `packages/shared/test/explainer.test.ts`: Removed unused `Rect`, `TIKTOK_SAFE_AREA`, `isInsideSafeArea`, and `layoutCompareTable` / `layoutSpectrum` / `layoutBarChart` / `layoutTimeline` / `layoutDiagram` functions and their standalone tests.
- `packages/tools/test/explainer.test.ts`: Added `fake TTS HTTP server + fake whisper produce 1080x1920 MP4 with audio stream and expected duration`, verifying `1080×1920`, audio stream presence, and `duration ≈ 2 * (1.5 + 0.3) - 0.3 = 3.3s` via `ffprobe`.

```text
$ bun test packages/shared/test/explainer.test.ts packages/tools/test/explainer.test.ts apps/hub/test/tts.test.ts
(pass) Hub TTS Integration (Task 029) > settings save, mask secret key, and return hint [234.00ms]
(pass) Hub TTS Integration (Task 029) > test route invokes endpoint and returns audio stats [234.00ms]
(pass) Hub TTS Integration (Task 029) > runner route /api/runner/tts requires authentication and gates by agent tool [469.00ms]
(pass) Task 029 Pure Logic: ExplainerScript, FactSheet, Layout & HTML Composition > 1. countWords accurately counts words in Malay and English
(pass) Task 029 Pure Logic: ExplainerScript, FactSheet, Layout & HTML Composition > 2. validateExplainerScript enforces <= 40 words per scene and duration bounds [16.00ms]
(pass) Task 029 Pure Logic: ExplainerScript, FactSheet, Layout & HTML Composition > 3. extractVisualNumbers and validateNumbersInFactSheet detects unverified numbers [15.00ms]
(pass) Task 029 Pure Logic: ExplainerScript, FactSheet, Layout & HTML Composition > 9. buildComposition generates valid offline HTML for all 6 infographic templates
(pass) explainer_render tool (Task 029) > tool properties are correct
(pass) explainer_render tool (Task 029) > rejects invalid script without scenes [16.00ms]
(pass) explainer_render tool (Task 029) > rejects script when word count is too short for target duration (<20s)
(pass) explainer_render tool (Task 029) > renders 3-scene video and saves draft with fact sheet metadata [16672.00ms]
(pass) explainer_render tool (Task 029) > blocks render when script has unverified numbers not in fact_sheet
(pass) explainer_render tool (Task 029) > fake TTS HTTP server + fake whisper produce 1080x1920 MP4 with audio stream and expected duration [12687.00ms]
 13 pass
 0 fail
 81 expect() calls
Ran 13 tests across 3 files. [31.94s]

$ bun run typecheck
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
(exit 0)
```

---

## Step 7 — Real Run (`"WiFi 8 (802.11bn) vs WiFi 7"`) & Final Verification

### Real Run Status
- **Live web fetch (`https://en.wikipedia.org/wiki/IEEE_802.11bn`):** **RAN** (`fetchedOk: true` via `freshFetch`).
- **CanopyAI LLM (`Cikgu Tech` agent loop) + CanopyAI TTS voice-over:** **`NOT RUN`** (`TTS_API_BASE` is unset and `data/hub.db` is not configured in this workspace).
- **`explainerRenderTool` + Playwright worker + `ffmpeg` assembly + `tile=4x2` contact sheet:** **RAN** using silent 2.5s MP3 audio segments + fake whisper timings for subtitles.
- **Rendered duration:** `8.1s` (3 scenes: `big_stat`, `compare_table`, `timeline`).
- **8-frame contact sheet (inspected via `read_file`):** `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\wifi8-contact-sheet.png` — shows crisp dark-mode 1080×1920 vertical motion graphics (`ANGKA UTAMA 23 Gbps`, `PERBANDINGAN TERPERINCI WiFi 7 vs WiFi 8`, `GARIS MASA PERKEMBANGAN 2019/2024/2028`) with pop captions.

#### Stored `fact_sheet` (from `ctx.renders[0]`)
```json
[
  {
    "claim": "Standard name",
    "value": "WiFi 8, WiFi 7, WiFi 6, 802.11bn, 802.11be, 802.11ax",
    "source_url": "https://en.wikipedia.org/wiki/IEEE_802.11bn",
    "verified": true
  },
  {
    "claim": "Peak throughput",
    "value": "23 Gbps",
    "source_url": "https://en.wikipedia.org/wiki/IEEE_802.11bn",
    "verified": true
  },
  {
    "claim": "Spectrum & channel",
    "value": "6 GHz, 320 MHz",
    "source_url": "https://en.wikipedia.org/wiki/IEEE_802.11bn",
    "verified": true
  },
  {
    "claim": "Years",
    "value": "2019, 2024, 2028",
    "source_url": "https://en.wikipedia.org/wiki/IEEE_802.11bn",
    "verified": true
  }
]
```

#### Stored Script Summary
- `topic`: `"WiFi 8 (802.11bn) vs WiFi 7"` (`language: "ms"`, `pasted: false`, `unverified: false`)
- `scenes`:
  1. `s1` (`big_stat`): `"23 Gbps · 6 GHz · 320 MHz"` — `"WiFi 8 atau 802.11bn mengekalkan kelajuan puncak sekitar 23 Gbps dan jalur 6 GHz serta saluran 320 MHz."`
  2. `s2` (`compare_table`): `"WiFi 7 vs WiFi 8"` (`802.11be` vs `802.11bn`, `6 GHz`, `320 MHz`) — `"Perbezaan utama antara WiFi 7 dan WiFi 8 ialah Ultra High Reliability untuk kurangkan lengah di tempat sesak."`
  3. `s3` (`timeline`): `"Sasaran 2028"` (`2019 WiFi 6`, `2024 WiFi 7`, `2028 WiFi 8`) — `"Draf piawaian 802.11bn dijangka siap sekitar tahun 2028 untuk kegunaan peranti generasi baharu."`

---

### Final Verification (Raw Output)

```text
$ bun run typecheck
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
(exit 0)

$ bun test
1 tests skipped:
(skip) motion_render with real hyperframes CLI > renders hook template to MP4 and uploads it as a video attachment

 408 pass
 1 skip
 0 fail
 4320 expect() calls
Ran 409 tests across 73 files. [207.01s]

$ bun run --cwd apps/web build
✓ 4101 modules transformed.
✓ built in 3.91s
```
