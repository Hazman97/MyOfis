# Task 024: motion text / kinetic typography in MyOfis with HyperFrames

Read `tasks/gemini/SUPERVISOR.md` first (rules + the report). Write `tasks/gemini/024-report.md`. Do not commit.

## Why
The owner wants TikTok-style videos with **moving text** (hooks, kinetic captions, title cards, lists, countdowns,
lower thirds, intro/outro) made by agents. MyOfis already cuts, captions (whisper word times), zooms, crossfades
and exports TikTok HD with ffmpeg (`packages/tools/src/video.ts`, `packages/shared/src/video.ts`). What is missing
is motion graphics. **HyperFrames** (github.com/heygen-com/hyperframes, Apache-2.0) renders an HTML composition
(GSAP/CSS timelines registered in `window.__timelines`, `data-start` / `data-duration` / `data-track-index` /
`data-width` / `data-height`) to MP4 with headless Chrome + FFmpeg; it needs Node 22+. Read its README and CLI
docs (hyperframes.heygen.com) before you design anything; do not guess flags.
The heavy rendering runs on the **AWS runner** (48 CPU, Linux; see `CLAUDE.md` and the AWS runner notes) and must
also work on the owner's Windows PC runner.

## Build
1. **Templates first** (`packages/tools/src/motion/templates/*.html` + a pure `packages/shared/src/motion.ts`):
   `hook` (big 1–3 line hook, pop-in), `kinetic_captions` (word-by-word from a Transcript, highlight the spoken
   word; reuse `subtitleCues`/`packTranscript` ideas), `title_card`, `list` (3–7 points, one by one),
   `countdown`, `lower_third`, `outro_cta`. Each takes typed params (Zod): text, colours from a small palette,
   font (bundled Noto Sans / Inter-like, no web fonts), duration, size (`tiktok_fhd` 1080×1920 default,
   `square`, `youtube_1080p`). Malay text, emoji and long words must not overflow at 1080 px wide.
   `buildComposition(template, params)` is pure and tested (HTML out, all user text **escaped**).
2. **Tool `motion_render`** (`packages/tools/src/motion.ts`, risk safe, category write):
   `{template, params, background?: {video N | colour | image N}, transparent?: boolean}` → writes the
   composition into `<workspace>/media/motion-<n>/`, runs the HyperFrames CLI **without a shell** with the scrubbed
   env (like `spawn()` in video.ts), progress as `agent.thinking`, then uploads the MP4 with `ctx.uploadVideo`
   (so it becomes "video N" for `video_edit` and `save_draft(video: "last")`).
   - **Safety:** compositions are generated from templates only (no free HTML from the model in this task);
     Chrome must not load anything from the network (block it via the renderer's options, or a local-only
     server); the working folder is inside the run's workspace; time limit 15 min.
   - Overlay on footage: either the template renders with a transparent background and `video_edit` overlays it
     (add an `overlays` field to `EditPlan`, pure + tested in `buildEditArgs`), or HyperFrames composes the
     footage itself. Pick one, justify in the report, test it.
3. **Program detection:** the runner reports `hyperframes` when the CLI is found (like ffmpeg/whisper in
   `packages/shared/src/programs.ts` and the runner's capabilities); `requiredPrograms()` maps `motion_render` →
   `hyperframes` + `ffmpeg`.
4. **Agents:** give `motion_render` to Editor and TikTok Poster through the existing `BuiltinAgent.upgrade`
   mechanism, and add a short built-in skill `motion-text-tiktok` (`BUILTIN_SKILLS`): when to use which template,
   hook rules (3 words in 2 seconds, same idea as the caption), BM examples.
5. **Server setup script** `scripts/runner-video-setup.sh` (Linux, run by the owner or Claude on the AWS runner,
   idempotent, `set -euo pipefail`, prints each step, **pinned versions**, no `@latest`):
   Node 24.22.1 from nodejs.org with SHA-256 check into `/opt` (symlinks in `/usr/local/bin`), the Chrome
   libraries for Amazon Linux 2023 (`dnf`), Noto fonts (incl. emoji), the HyperFrames CLI at a pinned version in
   the user's npm prefix, then one test render of the `hook` template and an `ffprobe` of the result.
   Never touch vLLM, Caddy or anything under `/etc/vllm`. Document it in `docs/video-editor.md`.

## Tests
`packages/shared/test/motion.test.ts` (escaping, sizes, word timing for kinetic captions, all templates build),
`packages/tools/test` for the tool's argv (no shell, scrubbed env, network blocked), and an `EditPlan.overlays`
case in the existing video tests. A real render test runs only when the `hyperframes` CLI is on PATH (skip otherwise,
like the ffmpeg tests).

## Check before you hand back
`bun run typecheck`, `bun test` (full), `bun run --cwd apps/web build`. If you can install HyperFrames on this PC,
render each template once (outside the repo) and list the files + durations in the report.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, then do `tasks/gemini/024-motion-text-hyperframes.md`.
> Write `tasks/gemini/024-report.md` when done. Do not commit.
