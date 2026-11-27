# 061: Motion-graphic videos with Remotion + Remocn templates

Owner (2026-11-27): use https://github.com/Remocn/remocn (MIT, 935 Remotion components) in our system: animated
hooks, promos, announcements, IG stories/highlight covers, intros/outros, "new feature" videos — made from the
project's Brand Kit, ready to post.

Read first: `tasks/gemini/SUPERVISOR.md`, CLAUDE.md "Brand Kit, offline templates & Grid Planner (task 040)",
"Design Studio (task 041)", "Video HD", "Playwright does not work under Bun on Windows" (Node worker), GPU lock,
`052-watermark-intro-outro.md`, `062-skill-packs-copywriting-motion.md` (motion skills), Remocn's craft rules
(remocn.dev/docs/craft and /docs/guides/non-generic-ai-video).

## Licence check first (stop if it fails)
- Remocn components: MIT — keep their licence headers; list every copied component in
  `packages/motion/THIRD_PARTY.md` with its source URL.
- **Remotion itself has its own licence** (free for individuals and small companies up to a stated team size; paid
  "company licence" otherwise). Read remotion.dev/license today, quote the exact rule and date in the report, and
  confirm the owner's use fits (individual / ≤ 3 people). If it does not fit, stop and report.
- Fonts: only our bundled OFL fonts (`assets/fonts`). No remote fonts or assets at render time.

## Design: fixed templates, agents only fill data
Agents never write React. A new workspace package `packages/motion` (a Remotion project) holds **our own
compositions** built from vendored Remocn components (copied with `shadcn add @remocn/<name>` once, then committed;
pin versions). Each composition has a **zod props schema** in `packages/shared/src/motion.ts` (pure, shared by
hub/web/tools). Brand Kit → colours/fonts/logo props.

Templates (each 9:16 1080×1920 unless noted; 30 fps; duration from props within limits):
1. `hook_text` — 2–4 s kinetic hook (one key word marked with weight/accent, per Remocn rules) to put **before** a
   clip (used by Quick Post / Editor as an intro).
2. `promo_card` — price/slot/offer: title, 1–3 lines, price, CTA, optional photo; 6–10 s.
3. `announcement` — "Baru!"/event/closing notice with date & place; 6–10 s.
4. `story_frames` — 1–5 animated IG/FB Story frames from text + photos (9:16, ≤ 15 s each).
5. `highlight_cover` — still PNG 1080×1920 (icon + label) and a 2 s animated version; batch from a list of names
   (owner's IG highlight redesign).
6. `intro_outro` — logo reveal + project name / outro with CTA (replaces 052's static card when available; 052 keeps
   the PNG path as fallback).
7. `feature_video` — 15–30 s from a `feature_log` entry (+ its screenshot): title, 3 bullets, screenshot frame;
   16:9 and 9:16.
8. `caption_overlay` — animated captions for a given video + `subtitleCues` (TikTok-style word pop), an alternative
   to ASS captions for short clips (≤ 60 s).
Craft rules enforced in a pure `checkMotionProps()` (tested): one accent colour, no gradient text, no all-caps
decorative text, text fits (measure with the same `fitFontSize` approach as `design.ts`), contrast AA vs the
background, safe areas for TikTok/Reels UI.

## Rendering
- Node worker mode `{mode: "motion", composition, props, out}` using Remotion's Node renderer APIs
  (`@remotion/bundler` + `@remotion/renderer`, check current API names), Chromium from the existing Playwright
  install where possible (or Remotion's own headless shell — say which and its disk size). Bundle once and cache
  by `packages/motion` content hash in `%LOCALAPPDATA%/MyOfis/motion-bundle/`.
- Runs under `withGpuLock`, `concurrency` 2–4 (setting), low priority. JS in the page is ours only; network
  requests during render are blocked except local `file:`/`data:` of the job's own assets.
- Direct job `motion_render` (0 tokens) + tool **`motion_render {template, props, video?}`** for Editor, TikTok
  Poster, Misi 1K, Pengurus Sosial, Publisher and a new built-in agent **Motion** (`motion`, seeded disabled, skills
  `remotion-video-agent`, `motion-director` from 062, `hook-caption-bm`). Output = MP4 (H.264, AAC silent or the
  given music) / PNG for stills, uploaded via the existing parts path and usable as `save_draft` video or as an
  intro/outro clip in `video_edit` (new `EditPlan.prepend` / `append` upload ids).
- Program `motion` reported by the runner when Node + Remotion deps are present; jobs routed there.

## UI
- Design Studio gets a **Motion** tab: pick template → form from the zod schema → live preview with
  `@remotion/player` (lazy chunk) → Render → save to draft / download. Highlight covers: paste a list of names →
  grid preview → download all (zip) or save as drafts.
- Quick Post (047): optional "Tambah hook animasi" (template 1) before the clip.

## Tests
`checkMotionProps` cases; props schemas reject bad input (long text, bad colours, too many photos); the worker
refuses network requests (fake page asset pointing to http → render still succeeds without it); one real render
per template at low resolution (skipped only when Node/Remotion missing) with duration ±1 frame and a non-blank
frame check; `EditPlan.prepend` argv; tool → direct job → upload → draft.

## Proof
Raw new tests, `bun run typecheck`, full `bun test`, web build final lines; contact sheet (3 frames per template)
with the SmashPoint Brand Kit, plus a highlight-cover grid for: "Akad", "Sanding", "Us", "Honeymoon", "SmashPoint".
Anything not run is NOT RUN. Do not commit.
