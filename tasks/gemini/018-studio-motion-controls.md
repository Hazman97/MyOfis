# Task 018: motion controls in the Video Studio (zoom, transitions, text animation)

The owner wants videos that look less static while staying automatic.

Claude added three options to the edit plan and is building the ffmpeg side now. You add the controls in the Video Studio, so the owner can set them by hand and see what Editor or the TikTok agent chose.

## The contract (already in the code; do not change it)
`packages/shared/src/video.ts`:
- **`Clip.zoom`:** `"none" | "in" | "out"` (default `"none"`). A slow Ken Burns zoom over that clip.
- **`Caption.animation`:** `"none" | "fade" | "pop"` (default `"none"`).
  - fade = fades in and out;
  - pop = grows in quickly, then fades out.
- **`EditPlan.transition`:** `{ type: "none" | "fade" | "dissolve" | "slide" | "zoom", seconds: 0.2–1.5 }` (default `{type: "none", seconds: 0.5}`).
  - Each transition overlaps two clips, so the video gets **shorter** by `seconds` per cut.
- **Helpers:** `finishedSeconds(plan, lengths)` and `transitionSeconds(plan, lengths)`. Use `finishedSeconds` for the total length shown in the studio (it already accounts for transitions).
- Plans stored before today may lack these fields. When the studio loads a plan, run it through `EditPlan.parse(...)` so the defaults appear. `resetPlan()` in VideoStudioView is the place.

## Scope: edit ONLY
- `apps/web/src/views/VideoStudioView.vue`. Keep all existing logic; Claude added `zoom: "none"` / `animation: "fade"` to a few object literals, so keep those.
- Optional new small components under `apps/web/src/components/studio/` (e.g. `MotionControls.vue`).

Never delete, rename or move files. No new packages. Do not run `git commit`. Do not edit `packages/`, `apps/hub/`, `apps/runner/` or `api/http.ts`.

## What to build
1. **Per clip** (in each clip row): a compact "Zoom" segmented control (None / In / Out) with a small icon (`ZoomIn` / `ZoomOut` from lucide). Show it on the timeline block too, for example a tiny ↗ / ↘ badge.
2. **Transitions** (a small card near Output settings, or under the timeline):
   - **type** as chips: None · Fade · Dissolve · Slide · Zoom;
   - **seconds** slider 0.2–1.5 (step 0.1), shown only when the type is not None;
   - a helper line: "Each cut overlaps by X s, so the video is about Y s" (use `finishedSeconds`);
   - on the timeline, a small diamond between clips when a transition is on.
3. **Per caption:** an "Animation" select (None / Fade / Pop) next to the position.
4. **Total length:** wherever the studio shows the total and checks the preset limit, use `finishedSeconds(plan, lengths)`.
5. **Phone (390 px):** no horizontal scroll; tap targets ≥ 40 px. Light and dark.

## Rules
- Use the design system in `apps/web/src/style.css` (tokens; `card`, `btn`, `chip`, `label`, `input`, `sign`). English UI text.

## Check before you hand back
- `bun run --cwd apps/web typecheck` and `bun run --cwd apps/web build` pass.
- Open `/studio/<id>` at desktop width and 390 px, light and dark:
  - set zoom on a clip;
  - turn on a fade transition and watch the total change;
  - set a caption to Pop.
- Tell the owner you are done; Claude reviews the diff.
