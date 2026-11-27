# 052: Brand watermark + intro/outro on videos

Owner (2026-11-27): every posted video can carry the project's logo, and optionally an intro/outro card, added
automatically during the compress step.

Read first: `tasks/gemini/SUPERVISOR.md`, CLAUDE.md "Video HD", "Brand Kit (task 040)", `hdPlan()` /
`buildHdArgs()` (`packages/shared/src/video.ts`), `buildEditArgs`, `design_render` (PNG from templates).
**Depends on the 040 review fix (logo upload served to the runner) and 047 (Quick Post compress step).**

## Settings
`BrandKit.video: { watermark: { enabled, position: "tl"|"tr"|"bl"|"br", size_pct (6–20, default 12), opacity
(0.3–1, default 0.85), margin_pct (default 4) }, intro: { enabled, seconds (1–3) }, outro: { enabled, seconds
(1–4), text?: string (≤ 60) } }`. Edited in Projects → Brand → new "Video" card with a live preview (a still frame
with the logo placed, drawn in the browser — no server render needed).

## Behaviour
- `hdPlan()` gets an optional `brand` input → `buildHdArgs` adds: the logo as an `-i` image input, `scale` to
  `size_pct` of the output width, `format=rgba,colorchannelmixer=aa=<opacity>`, `overlay` at the corner. TikTok
  places its UI on the right and bottom: default `tl` and keep ≥ 12 % from the bottom for `bl`/`br` on 9:16.
- Intro/outro: a PNG card made by `design_render` (new template `video_card`, Brand Kit colours, logo, project name
  or `outro.text`), turned into a still clip of N seconds with silent audio, joined with `concat` (same size/fps
  as the target). Story parts (039 split) get the outro only on the last part.
- Applies to: Quick Post / Bulk compress (per-project switch "Letak logo", default on when enabled in the brand),
  Video HD page (checkbox), and the `video_hd` tool (`brand: true` argument). Never on the public Video HD page.
- The logo must be an image upload in the same room (040 rule); missing logo → skip watermark with a note, never
  fail the render.
- GPU lock and NVENC fallback unchanged.

## Tests
Pure `buildHdArgs` with brand: argv contains the overlay chain with the right position maths for 9:16 and 16:9,
opacity clamp, no overlay when disabled or logo missing; intro/outro concat argv and total duration
(`finishedSeconds`). One real ffmpeg render test (lavfi colour clip + a generated PNG logo) skipped only when
ffmpeg is missing: output duration = input + intro + outro (±0.1 s) and a pixel in the logo corner differs from
the no-brand render.

## Proof
Raw new tests, `bun run typecheck`, full `bun test`, web build final lines; a frame grab PNG of a branded render
(start, middle, end) and the Brand → Video card screenshot. Anything not run is NOT RUN. Do not commit.
