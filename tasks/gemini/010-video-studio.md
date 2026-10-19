# Task 010: polish the Video Studio (apps/web/src/views/VideoStudioView.vue)

You are working in the Agent Office (MyOfis) repo, a Vue 3 + Tailwind 4 app. Claude built the **Video Studio** (`/studio/:id`). It opens from a draft's video ("Open in Video Studio") or from a video Editor made in Chat. The page shows:
- a preview;
- a **timeline** (clip bars + caption markers);
- the **clips** list (file, start, end, speed, order);
- the **captions** list (text, from, to, where);
- **settings** (format, fit, frame rate, file name, mute, loudness);
- **Render again**, which renders on the owner's PC without AI;
- **Edit fully in OpenCut** and **Use my own edit**.

The logic is done and tested. Your job is to make it feel like a real, friendly video editor on desktop and phone (think CapCut-lite).

## Scope: edit ONLY `apps/web/src/views/VideoStudioView.vue`
Never delete, rename or move any file. Do not touch `api/http.ts`, `opencut.ts`, the hub, the router or tests. Do not run `git commit`.

## Hard rules
1. **Keep the logic and data flow:**
   - `load`, `resetPlan`, the `plan` object, `durations` / `onMeta` (the hidden `<video>` elements that read source lengths);
   - `lengths`, `total`, `tooLong`, `renderAgain` (it validates with `EditPlan.safeParse`), the `job` watcher that opens the new video, `useOwnEdit`, `openInOpenCut`;
   - the `?draft=` handling.

   You may move markup around, split it into sections and add pure UI state, for example which clip is selected.
2. **Keep the section ids** `preview` and `edit`, and keep every control. Labels stay in English.
3. Use only the design system in `apps/web/src/style.css`:
   - tokens: `bg-surface`, `text-muted`, `text-accent`…;
   - classes: `card`, `btn`, `chip`, `label`, `input`, `sign`.

   No new packages.

## What to improve
1. **Timeline:**
   - taller bars with the clip number, length (s) and a small speed badge;
   - clicking a bar selects that clip and scrolls to its row (highlight the row);
   - a time ruler under the bars (0 s … total);
   - caption markers sit on their own lane under the ruler, and clicking one focuses that caption.
2. **Preview:**
   - a vertical (9:16) frame for vertical presets and 16:9 for `youtube_1080p`, so the owner sees the target shape. Use the CSS aspect ratio; the video sits inside with `object-contain`;
   - a small overlay chip with the preset label.
3. **Clips and captions:**
   - compact rows on desktop, cards on phone;
   - drag handles are not needed (keep the ↑ ↓ buttons), but make them 40 px tap targets on phone;
   - a "Set start/end from player" button per clip: it reads the preview `<video>`'s `currentTime` into start or end. This is a small helper you add: the time of the source preview is fine as an approximation; say so in a tooltip.
4. **Render again:**
   - a sticky action bar at the bottom on phone (above the tab bar) with **Render again** + **Undo changes**;
   - while rendering, show a progress bar fed by the existing text (`jobAgent?.thinking` contains "Rendering …%": parse the number if present).
5. **Unsaved changes:** a small "Edited" chip when `plan` differs from `info.render.plan`.
6. **OpenCut panel:** a small card explaining the 3 steps (download → edit in OpenCut → Use my own edit) with icons.
7. **Phone (390 px):** no horizontal page scroll; everything reachable; tap targets at least 40 px.

## Check before you hand back
1. `bun run --cwd apps/web typecheck` and `bun run --cwd apps/web build` pass.
2. Open `/studio/<an upload id>` (any video upload) at desktop width and 390 px, light and dark:
   - change a clip and a caption;
   - Undo restores;
   - the timeline updates.
3. Tell the owner you are done. Claude will review the diff and run a real render.
