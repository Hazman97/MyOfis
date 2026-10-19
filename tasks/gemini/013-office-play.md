# Task 013: polish the office "play" controls

Claude added ways to play with the agents in the pixel office (Dashboard → Office):
- **tap** an agent: it hops with an emote;
- **drag** it somewhere: pantry = coffee, meeting room = meeting, another agent = chat, whiteboard = opens Drafts, your desk = opens Chat;
- **long-press or right-click** it: a ring menu with Chat · New job · Pause · Memory · Poke (`components/office/AgentRadialMenu.vue`);
- **your own character** (navy suit, "your name (you)") walks where you tap the floor, or with the arrow/WASD keys. When it stands next to an agent, a "💬 Chat with X" button appears at the bottom of the office (in `views/DashboardView.vue`).

The logic is done and tested. Make the menu and the chip look delightful and add a small "how to play" hint.

## Scope: edit ONLY
- `apps/web/src/components/office/AgentRadialMenu.vue` (styling and markup)
- new file `apps/web/src/components/office/OfficePlayHint.vue` (a small dismissible card)
- in `apps/web/src/views/DashboardView.vue`, ONLY:
  - the "💬 Chat with {{ nearName }}" button's markup and classes;
  - placing `<OfficePlayHint />` inside the office `<section>`.

The owner restyled DashboardView himself: do not change anything else in it. Never delete, rename or move files. No new packages. Do not run `git commit`.

## Hard rules
- **AgentRadialMenu:** keep the props (`agentId`, `x`, `y`), the emits (`close`, `memory`, `poke`), the `items` list and `pick()`, the Escape handler, the `fixed` positioning at `x`/`y`, and `@contextmenu.prevent` on the backdrop (without it, right-click closes the menu).
- Use the design system in `apps/web/src/style.css` (tokens + `card`, `btn`, `chip`). Light and dark.

## What to improve
1. **Ring menu:**
   - a pop-in animation (scale + fade, items staggered);
   - each item a round button with icon + tiny label, readable on the pixel office;
   - the agent's name in the middle as a small pill;
   - "Pause" turns into "Enable" with a different colour when the agent is paused;
   - a 44 px minimum on phone;
   - keep it inside the viewport near the screen edges (shift `left`/`top` by up to 60 px if needed).
2. **"Chat with X" chip:** a friendly floating pill with the agent's avatar initial, a soft shadow, a little bounce when it appears.
3. **OfficePlayHint:** a small card in the office's top-left corner with 4 lines:
   - Tap = poke;
   - Drag = move (pantry · meeting · whiteboard · your desk);
   - Hold / right-click = menu;
   - Tap floor / arrows = walk.

   An ✕ hides it. Remember that in `localStorage` (`myofis-play-hint`), wrapped in try/catch. On phone it is collapsible.

## Check before you hand back
- `bun run --cwd apps/web typecheck` and `bun run --cwd apps/web build` pass.
- On the Office tab, desktop and 390 px, light and dark:
  - right-click / long-press an agent: the menu shows at the pointer, and each item works;
  - walk next to an agent: the chip appears;
  - the hint card shows and hides.
- Tell the owner you are done; Claude reviews the diff.
