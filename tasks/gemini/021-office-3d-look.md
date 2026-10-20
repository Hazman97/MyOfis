# Task 021: make the 3D office beautiful (Taskuary look) + the work feed beside it

The owner wants the office to look like Taskuary's: a soft, warm, isometric 3D office (light wood, cream walls, soft shadows, small plants, floating labels), with a list of work on the right.

Claude built the engine. It works, but it is plain: rounded boxes, default colours. Your job is the **look**. The engine, the brain and the data stay as they are.

## How it works (read, do not change)
- `apps/web/src/office/scene3d/office3d.ts` is the **engine**: camera, lights, shadows, room, input, frame loop, characters and labels. **Do not edit.**
- `plan.ts`: from the Tiled map it works out where every piece of furniture stands, its exact footprint (characters walk around it), and which side faces the room. **Do not edit.**
- `character.ts`: the people. **Do not edit.**
- `furniture.ts`: **yours.** What each piece looks like.
- `palette.ts`: **yours.** Every colour.
- `components/office/OfficeCanvas.vue` has the 3D / Pixel switch (3D is the default).

## Part A: furniture (`apps/web/src/office/scene3d/furniture.ts`)
Keep the CONTRACT written at the top of the file exactly:
- `buildFurniture(kind, w, d, pal)` builds in local space:
  - centred on the origin, standing on y = 0;
  - `w` along X and `d` along Z;
  - the side people use toward +Z;
  - **inside ±w/2, ±d/2.**
- Return every monitor in `screens` and every rack LED in `lights` (the engine recolours them).
- `buildChair(style, pal)` builds one chair facing +Z.
- Use `box()` / `mat()` (shared materials) or plain three.js geometry. No downloaded models, textures or fonts; our art is drawn in code.

Make each kind look good and readable from the isometric angle:
- `desk`: a light-wood top, slim legs, a thin monitor with a stand, a keyboard, and maybe a mug or a small plant on some desks (vary by position, e.g. `(w*7+d) % 3`).
- `exec_desk`: the owner's desk. It is U-shaped, so the engine gives it as 3 pieces next to each other: make every piece a darker wood with a modesty panel. One monitor is enough (only when `w >= 2`).
- `meeting_table`: a long table with a soft top.
- `counter`: pantry cabinets plus a top. A 1×1 counter is an appliance: a coffee machine or water dispenser.
- `pantry_table`: a small round or square café table.
- `sofa`: cushions, arms and a back.
- `bookshelf`: shelves with books of different heights and colours.
- `rack`: server racks with LED strips (keep them in `lights`).
- `cabinet`: filing cabinets with drawer lines.
- `planter`: varied plants (a tall leafy one, a round bush, a small pot).
- Chairs: an office chair (`back` / `front`) with a base and casters; `arm` = a soft armchair.

Keep it light: a whole office of ~40 pieces must stay smooth on a laptop. Prefer few segments; share materials through `mat()`.

## Part B: colours (`palette.ts`)
A warm, light Taskuary palette:
- floor: light oak or cream;
- walls: off-white with a slightly darker top;
- zone rugs: subtle;
- wood: honey;
- accents: muted sage or terracotta.

Screen and rack colours must stay distinct: off / working / alert / failed must be easy to tell apart.

## Part C: labels and bubbles (`apps/web/src/style.css`)
Restyle `.office3d-label`, `.office3d-bubble` and `.office3d-bubble.needs-you` (bottom of style.css):
- small white pills with a soft shadow, like Taskuary's "2 agents working" / "Nora needs you";
- dark-mode friendly (use the design tokens).

Do not rename the classes.

## Part D: the work feed (new `apps/web/src/components/office/WorkFeed.vue`)
A list beside the office, like Taskuary's right column.
- **Data:** only from `workFeed(office.state)` and `feedCounts(office.state)` in `apps/web/src/workFeed.ts` (pure, tested; do not change it).
- **Each item:**
  - an icon or colour by `kind` (needs_you, draft, working, queued, done, failed);
  - the title;
  - the agent's avatar or name (`office.agentById[item.agent_id]`, `AgentAvatar`);
  - "x min ago" with `fmtAgo(item.at)` from `format.ts`;
  - tap → `router.push(item.to)`.
- **Header:** chips with the counts.
- **Empty state:** "All quiet".
- **Placement in `views/DashboardView.vue`:** the feed sits to the right of the office canvas on `xl` screens (canvas ~2/3, feed ~1/3, same height) and below it on smaller screens.
  - In DashboardView change **only the layout around the office canvas** to place the feed. The owner styled that file; keep everything else.

## Rules
- Follow `docs/FRONTEND.md`: design tokens, canonical Tailwind v4 classes (no `-[Npx]` for spacing or sizes). English UI text.
- Do not edit `office3d.ts`, `plan.ts`, `character.ts`, `workFeed.ts`, `packages/`, `apps/hub/`, `apps/runner/` or `api/http.ts`. No new packages. Never delete or move files. Do not run `git commit`.

## Check before you hand back
- `bun run --cwd apps/web typecheck`, `bun test apps/web` and `bun run --cwd apps/web build` pass.
- **Screenshot the office:**
  1. Start a preview hub on port 8811 (see "Screenshots now need a preview hub" in CLAUDE.md).
  2. From `apps/web`, run `MSYS_NO_PATHCONV=1 node scripts/office-shot.mjs http://127.0.0.1:8811 shot-3d.png 3d 2` (and with `0` for the whole office). It also prints page errors.
  3. Check that no furniture sticks out into walkways and that the owner can tell which desk monitors are on.
- The Dashboard at desktop and 390 px, light and dark.
- Tell the owner you are done; Claude reviews the diff and the screenshots.
