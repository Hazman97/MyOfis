# Task 004: polish the Skills page, the agent Memory panel and "Connect a PC"

You are working in the Agent Office repo (Bun + Vue 3 + Tailwind 4). Read `CLAUDE.md` first. Match the look you already built in Dashboard, AppShell, Drafts and Chat, and use only the `style.css` tokens (`accent`, `signal`, `danger`, `info`, `muted`, `faint`, `line`, `surface`, `sunken`, plus the `card`, `btn`, `input` and `sign` classes). Claude reviews your work, so stay inside the scope below.

## Background (what these screens are)
Agents now learn like Hermes Agent:
- **Memory:** each agent keeps short **notes** (max 2200 characters). All agents share a short **profile of the owner** (max 1375 characters). The owner can edit, remove or add entries.
- **Skills:** agents propose reusable **skills** (SKILL.md files). The owner approves or rejects every new skill, improvement ("patch") or delete on the Skills page. When "Ask me before agents change their memory" is on, memory changes wait there too.

## Scope: edit ONLY these files
- `apps/web/src/views/SkillsView.vue`
- `apps/web/src/components/office/MemoryStores.vue`
- `apps/web/src/views/AgentsView.vue` (part C only: one checkbox)
- `apps/web/src/views/RunnersView.vue` (part D)

Do not touch anything else: no other views or components, no `style.css` tokens, router, hub, runner, packages, tests or `package.json`. Do not run `git commit`.

## Golden rule
Change **only the `<template>`** (markup, classes, inline SVG icons), and `<style>` if you add one. Do **not** change `<script setup>`:
- no new imports, refs, functions or API calls;
- **exception:** you may import icons from `lucide-vue-next` (already a dependency).

Keep every `v-if`, `v-for`, `:key`, `v-model`, `@click`, `@submit`, `@change`, `:disabled`, `id`/`for` pair, `role`, `aria-*` and `aria-label` working exactly as now. The logic is tested and reviewed; only the look changes.

## A. Skills page (SkillsView.vue)
The page has a header with an "Import SKILL.md" button, an import form, the tabs **Waiting / Skills / History**, a memory-approval checkbox, and three lists.

1. **Header and import form**
   - Give the Import button an icon (`Upload` or `FilePlus`).
   - The import form should read as a calm "paste box": a monospace textarea on the `sunken` background, a short help line, and the buttons right-aligned.
2. **Tabs row**
   - Keep the pill style used in Drafts.
   - Turn the "Ask me before agents change their memory" checkbox into a nice **switch** (a styled `<label>` around the same `<input type="checkbox">`; keep the input, `:checked`, `@change` and `:disabled` exactly).
   - Add a small help tooltip or sub-line: "Off: agents save notes right away. On: you approve each change here."
   - **Phone (390 px):** the switch wraps under the tabs; no horizontal scroll.
3. **Proposal cards (Waiting / History)**
   - **Header:** avatar, title, agent name and time. Add a coloured chip by type:
     - New skill: `info`
     - Improve skill: `accent`
     - Delete skill: `danger`
     - Memory change: `signal`

     Derive the chip from `p.kind` / `p.action` in the template only.
   - **"Why:"** reads like a quote: a left border, muted text.
   - **Warnings:** amber boxes with a warning icon, clearly visible. These matter: they flag skills that tell the agent to download or delete things.
   - **Diff block** (`c.type === 'diff'`):
     - added lines get a green-ish background (`info-soft`), removed lines `danger-soft`;
     - a "⋯ N unchanged lines" gap row is quiet;
     - the block uses a monospace font, scrolls inside itself, and has a max height.
     - Keep the `<pre>`. Inside a `<pre>`, do not add whitespace or newlines between the `<template>`/`<span>` tags; it would show up as blank lines.
   - **Memory ops list** (`c.type === 'ops'`): show each op as a row with a small action chip (add / patch / remove). Removed text is struck through in `danger`; new text is in `info`.
   - **Footer:** Reject (left, ghost or danger outline) and Approve (right, primary).
   - **History** cards are calmer (muted), with the approved/rejected chip.
4. **Skills tab**
   - Each skill is a row/card:
     - the name in mono, the description below it;
     - a chevron that rotates when open (the button already has `aria-expanded`);
     - the delete action is small and quiet until hovered (it stays a button with its `aria-label`).
   - The opened SKILL.md is shown in a readable mono block on `sunken`.
5. **Empty states** for Waiting, History and Skills: an inline SVG or lucide icon in a rounded square, like the Drafts empty state.

## B. Memory panel (MemoryStores.vue)
This sits inside the agent side panel (the panel that opens when you click a character in the office). It is narrow, about 380 px.

- **Section title "Memory":** keep it, with a one-line muted hint under it: "What this agent remembers between jobs."
- **Store cards:** two of them, "Own notes" and "About you (shared by all agents)":
  - a small icon each (`NotebookPen` for notes, `UserRound` for the profile);
  - the usage `used/limit` in mono;
  - a thin progress bar: amber over 85%, as now.
- **Entries:** comfortable rows.
  - The edit and remove actions appear as small icon buttons (`Pencil`, `X`) that show on row hover. On touch screens (`@media (hover: none)`) they are always visible.
  - Keep the `aria-label`s.
- **Edit and add mode:** the textarea plus save/cancel. Make save look like a small primary button and cancel a ghost button.
- **"+ add":** a quiet full-width button at the bottom of each card, with a `Plus` icon.
- **"Nothing saved yet.":** faint and italic.

## C. "Learn after work" switch (AgentsView.vue: template only)
The edit form already has `form.self_review` (boolean) in its script. It is saved with the agent. Add a control for it:
- **Where:** inside the block shown when `form.runtime === 'ai-sdk'`, next to the max-steps field. Use the same switch style as the Skills page.
- **Markup:** `<input id="ag-self-review" type="checkbox" v-model="form.self_review">` with `<label for="ag-self-review">Learn after work</label>`.
- **Hint:** "After a big job or every 5th chat message, the agent looks back and may save a note or propose a skill. Costs a few extra tokens."
- If task 003 also changed this file, keep its changes. Add only this control.

## D. "Connect a PC" on the Runners page (RunnersView.vue: template only)
Clicking **Connect a PC** makes a pairing code and shows a one-line install command for Windows and one for Linux/Mac. The owner pastes it on another PC. When that PC joins, the panel switches to "<name> is connected".

Make the panel feel like a guided step, not a wall of text:
- **Steps:** use a numbered 1-2-3 layout:
  1. Copy the command for the other PC's OS.
  2. Paste it in a terminal there.
  3. Wait here.
- **Code and countdown:** the code is mono and large, and the countdown is a small pill.
- **Command rows:** keep each `<pre>` + Copy button row. The Copy button turns into a check mark ("Copied") when `copied` matches.
- **Loopback warning (`v-if="loopback"`):** an amber callout, as now. Keep all its text.
- **"Waiting for the PC to connect…" line:** keep the spinner. Add a soft pulsing dot, or a hint that it can take about 30 seconds.
- **Success state (`v-if="joined"`):** a celebratory but calm card: a big check icon, the PC name and the Close button.
- **"Run from a copy of this repo instead":** a quiet disclosure (keep `aria-expanded`).
- **Runner cards:** the `programs` chips (git, node, ffmpeg…) are a quieter style than the runtime chips. Optionally give each a tiny icon, e.g. `GitBranch` for git or `Film` for ffmpeg; otherwise text only.
- **Phone (390 px):** command rows scroll horizontally inside the `<pre>`, never the page.

## Check before you hand back
1. `bun run typecheck`: no errors.
2. `bun test`: all pass.
3. Screenshots (Git Bash):
   `MSYS_NO_PATHCONV=1 node apps/web/scripts/shots.mjs --out shots-004 --routes /skills,/runners --variants desktop-light,desktop-dark,phone-dark`
   Look at them yourself.
4. Open the office, click an agent, and check the Memory section in light and dark mode.
5. List the files you changed. It must be exactly the four files above.
