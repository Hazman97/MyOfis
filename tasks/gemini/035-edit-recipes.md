# Task 035: edit "recipes" (save an edit that worked, reuse it on new clips)

Read `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md` first. Write `tasks/gemini/035-report.md` (a note
after each step). Do not commit. Do it after 033 (it uses `loop` / karaoke if present).

## Why
The owner wants his own "CapCut templates": take a video whose edit worked well and make the same style from new
clips with one tap (in the Studio) or one word to an agent ("guna resepi pantai").

## Facts from the code
- The Video Studio (`/studio/:uploadId`, `apps/hub/src/studio.ts`):
  - `uploads.render` stores `RenderInfo {plan, attachments}`;
  - "Render again" = job `video_render` (direct, no LLM).
- `EditPlan` is in `packages/shared/src/video.ts`.

## Build
1. **Pure** `toRecipe(plan)` / `applyRecipe(recipe, videos[])` (shared, tested).
   - **A recipe keeps the style and drops the content:**
     - preset, fit, fps;
     - transition;
     - subtitle style and theme;
     - caption positions, animations and timing as *slots* (e.g. hook 0–2 s; a line every bar or every N s);
     - the music volume and the "music: any track" flag;
     - zoom pattern, speed pattern, segment lengths (or "follow beats" when the plan came from `montage_plan`);
     - loop;
     - overlay slots (motion templates with their settings, not their text).
   - **It drops:** the video numbers, the times inside the source clips, the caption texts and the track name.
   - `applyRecipe` fills the slots from the new videos (round-robin; the start is spread inside long clips) and
     marks the caption slots `{needs_text: true}`. It returns `{plan, missing: ["hook", "line 1"…]}`.
   - **Tests:**
     - round trip on 3 different saved plans;
     - fewer videos than segments;
     - a montage recipe re-runs the beat planner when given a track.
2. **Storage:** a migration with a table `edit_recipes` (id, workspace_id, name, description, recipe JSON,
   source_upload_id, uses, created_at). Room-scoped like uploads.
   - Routes (owner and room members, same guards as Studio): `GET /api/recipes`, `POST /api/recipes {name,
     from_upload_id}`, `PATCH` (rename), `DELETE`.
3. **Tools:**
   - `recipe_list` (the room's recipes, with a one-line description);
   - `recipe_apply {recipe, videos[], texts{slot: text}, track?}` → an EditPlan ready for `video_edit`. It refuses
     while a caption slot has no text and lists the missing slots.
   - Give them to Editor, Misi 1K and Pencerita via the upgrade mechanism.
   - Prompt line: "if the owner names a recipe (resepi), use recipe_apply".
4. **Studio** (logic + plain UI; Gemini polish later):
   - "Simpan sebagai resepi" on a rendered video;
   - a recipe picker on a new upload → fill the texts → Render (`video_render` job);
   - the use count goes up on each render.

## Tests and proof
- Pure tests, route guards (another room → 404), tool tests.
- **Real:** save a recipe from one of the owner's Studio renders on a preview hub copy (temp DB; never the
  owner's DB), apply it to 2 `testsrc2` clips, render, and show both plans side by side.
- `bun run typecheck`, the full `bun test`, the web build: raw final lines. A screenshot of the Studio recipe
  picker.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/035-edit-recipes.md` step by
> step, tests after each, notes appended to `tasks/gemini/035-report.md`. Use a temp DB, never the owner's. Paste raw
> output only. Do not commit.
