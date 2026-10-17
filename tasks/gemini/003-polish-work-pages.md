# Task 003: polish the work pages + Skills in the menu

You are working in the Agent Office repo (Bun + Vue 3 + Tailwind 4). Read `CLAUDE.md` first and follow the look you already built (Dashboard, AppShell, `style.css` tokens). Claude reviews your work, so stay inside the scope below.

## Scope: edit ONLY these files
- `apps/web/src/components/shell/AppShell.vue` (part A)
- `apps/web/src/views/ChatView.vue`
- `apps/web/src/views/DraftsView.vue`
- `apps/web/src/components/DraftCard.vue`
- `apps/web/src/views/ProjectsView.vue`
- `apps/web/src/components/BriefPanel.vue`
- `apps/web/src/views/AgentsView.vue`

Do not touch anything else. That includes:
- `AgentPanel.vue`, `ReplayView.vue` and any new `SkillsView.vue` (Claude is working on these);
- `style.css` tokens, the router, hub, runner, packages, tests, `maps/` and `package.json`.

Do not run `git commit`.

## Golden rule for B–F
In every file except AppShell, change **only the `<template>`** (markup, classes, icons) and the `<style>` blocks if any. Do **not** change `<script setup>`: no logic, refs, functions, API calls or imports.
- **Icons:** if you need a new icon, use an inline SVG like you did in ReplayView, or reuse an icon the file already imports.
- **Keep wiring:** keep every `v-model`, `@click`, `@submit`, `v-if`/`v-for`, `:key`, `id`/`for` pair, `aria-*` and `role` working exactly as now.

## A. Skills in the menu (AppShell.vue: script changes allowed here)
Claude is adding a **Skills** page at `/skills`: agents propose `SKILL.md` skills and the owner approves them. Add it to the nav:
- **Desktop sidebar:** in the "Team" group after "Schedules", label "Skills", icon `Sparkles` from `lucide-vue-next`, with a badge.
- **Phone "More" sheet:** the same item, with the badge.
- **Badge count:** `Object.keys(office.state.pending_skills ?? {}).length`. Follow the existing `badgeOf` pattern by adding a `"skills"` badge kind. The field may be missing until Claude's change lands, so keep the `?? {}`.

## B. Chat page (ChatView.vue)
Make it feel like a modern chat app (Linear/Vercel style, like your Dashboard):
- **Agent list (left, desktop):** clearer active state and a subtle hover.
- **Message bubbles:** owner on the right in the accent colour, agent on the left. Comfortable max width, good line height, timestamps small and quiet. Keep the "Listen" and "details" actions under agent bubbles.
- **Typing indicator:** the three dots must still show while `live(m).status` is queued/running.
- **Composer:** the mic, textarea and send button align nicely. While listening, the mic button looks clearly "recording" (pulse or red ring) using the existing `listening` ref. The hint text stays small.
- **Starters (empty state):** make them look like suggestion cards.
- **Phone (390 px):** no horizontal scroll, and the composer stays usable above the bottom tab bar.

## C. Drafts (DraftsView.vue + DraftCard.vue)
- **Tabs and project filter:** the same pill style as the Office/Board toggle.
- **Draft card:**
  - a clear header (platform chip, kind, project, time);
  - the editable text area looks like a writing surface;
  - the self-check chips are compact, and a failed check is clearly red;
  - the notes warning box is amber;
  - the footer holds Copy (left) and Reject/Approve (right).
  - Decided drafts look calmer (muted) but still readable.
- **Empty state:** friendly, with an inline SVG icon.

## D. Projects (ProjectsView.vue + BriefPanel.vue)
- **Project cards:** show live site / repo / brief status at a glance. "Brief · empty" is visibly a to-do (amber), and the Brief / Feature log buttons sit in a neat footer.
- **BriefPanel:**
  - sections (The product / Facts / Voice / Posts you like) read as clear groups with headings;
  - platform toggle chips look pressed when on;
  - example-post textareas are comfortable to paste into;
  - the feature log reads as a vertical timeline.

## E. Agents (AgentsView.vue)
- **Agent cards:** avatar, name, role, status badge, model chip and the budget bar are cleanly aligned. Show "no limit" nicely when the budget is 0.
- **Edit side panel:** group the fields (Identity / Brain / Permissions / Instructions) with small section headings.

## F. Everywhere
- Light and dark mode both look good. Do not hard-code colours: use the token classes (`bg-surface`, `text-muted`, `border-line`, `text-accent`, …).
- No horizontal scroll at 390 px wide.
- Focus rings stay visible for keyboard users.

## Acceptance (Claude checks)
- `bun run --cwd apps/web typecheck` passes.
- `bun test apps/web` passes.
- `<script setup>` is unchanged in every file except AppShell.vue (Claude diffs this).
- Only the 7 files above changed.
- Screenshots of /chat, /drafts, /projects (+ Brief panel) and /agents look right on desktop and phone, in light and dark.

When done, list what you changed per file.
