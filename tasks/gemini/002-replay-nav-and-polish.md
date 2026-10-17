# Task 002: put Replay in the menu and polish the Replay page

You are working in the Agent Office repo (Bun + Vue 3 + Tailwind 4). Read `CLAUDE.md` first. Claude reviews your work, so stay inside the scope below.

## Scope: edit ONLY these files
- `apps/web/src/components/shell/AppShell.vue`
- `apps/web/src/views/ReplayView.vue` (template and classes only)

Do not touch anything else: no hub, runner, packages, tests, `maps/`, `style.css` tokens, `router.ts` or `package.json`. Do not run `git commit`.

## 1. Replay in the navigation (AppShell.vue)
- **Desktop sidebar:** add **Replay** to the "Office" group, after "Chat", linking to `/replay`. Use the `History` icon from `lucide-vue-next`.
- **Phone "More" sheet:** add the same Replay item (the `moreItems` list).
- The active state must work like the other items (`isActive`).

## 2. Polish ReplayView.vue (visual only)
The page already works: pick a run or a time range, Load replay, Play/Pause, 1x/4x/16x, a progress bar, the office canvas and an event list on the right. Make it look as good as the Dashboard (same card style, spacing and pill buttons as the Office/Board toggle).

Rules:
- Do NOT change anything in `<script setup>`: no logic, refs, functions or imports. Only `<template>` markup and classes.
- Keep every existing `ref`, `v-if`, `@click`, `v-model` and `aria-*` attribute working.
- **Phone (390 px):** the controls wrap nicely, there is no horizontal scroll, and the event list goes below the canvas.
- **Empty state:** before a replay is loaded, show a friendly hint inside the page, for example "Pick a finished run above and press Load replay", with the `History` icon. Do this with a `v-if="!replay"` block that uses only the existing `replay` ref.

## Acceptance (Claude checks)
- `bun run --cwd apps/web typecheck` passes.
- `bun test apps/web` passes.
- Replay shows in the sidebar and in the phone More sheet, and highlights when active.
- `/replay?run=<id>` still loads and plays.
- Only the 2 files above changed.

When done, list what you changed per file.
