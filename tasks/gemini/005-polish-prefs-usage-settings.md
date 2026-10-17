# Task 005: polish "How you like it", skill usage, and the new Settings cards

You are working in the Agent Office repo (Bun + Vue 3 + Tailwind 4). Read `CLAUDE.md` first. Match the look you built in tasks 001–004, and use only the `style.css` tokens and the `card`, `btn`, `input` and `sign` classes. Claude reviews your work, so stay inside the scope below.

**Start only after task 004 has passed review**, because both tasks touch `SkillsView.vue`.

## Background
Three new features, all with working logic and plain markup:
1. **"How you like it"** (`components/office/AgentPrefs.vue`):
   - It sits in the agent side panel; click a character in the office to open it.
   - The owner picks language / tone / length / emoji / format with chip buttons, writes free notes, and saves.
   - The agent then follows those choices in every job and chat.
2. **Skill usage**: `GET /api/skills` now returns `usage` for each skill: `{ runs, last_used_at, bad_runs, stale }`.
   - `stale` is a sentence like "not used in 60 days", or `null`.
   - It is already in the `skills` ref of `SkillsView.vue` (`s.usage`), but not shown yet.
3. **Settings → Integrations** has two new cards:
   - **Web search**: Researcher searches DuckDuckGo first (no setup), then the owner's own SearXNG, then a Tavily or Brave key.
   - **Backups**: nightly copies, plus a "Back up now" button.

## Scope: edit ONLY these files
- `apps/web/src/components/office/AgentPrefs.vue` (part A)
- `apps/web/src/views/SkillsView.vue` (part B)
- `apps/web/src/views/IntegrationsView.vue` (part C: only the two new cards, Web search and Backups)

Do not touch anything else. Do not run `git commit`.

## Golden rule
Change **only `<template>`** (and `<style>` if you add one).
- In `<script setup>`, the only change allowed is new icon imports from `lucide-vue-next`.
- Keep every `v-model`, `@click`, `@submit`, `v-if`/`v-for`, `:key`, `:disabled`, `id`/`for` pair, `role`, `aria-*` and `aria-checked` working exactly as now.

## A. "How you like it" (AgentPrefs.vue)
The panel is narrow (about 380 px).
- **Header:** a small `SlidersHorizontal` (or `Wand2`) icon next to the "How you like it" title. Keep the one-line hint.
- **Chip groups:** each group (Bahasa, Nada, Panjang jawapan, Emoji, Format) is one compact row. The label sits above, small and muted, and the chips wrap.
  - The selected chip looks clearly pressed (accent).
  - "Auto" is quieter than the other choices.
  - Keep `role="radio"` and `:aria-checked`.
- **Notes textarea:** looks like a writing surface (`sunken` background) and shows a character count under it, as `{{ prefs.notes.length }}/1500`. Reading `prefs.notes.length` in the template is allowed.
- **"What the agent will be told":** a quiet disclosure; the `<pre>` is readable in light and dark.
- **Save:** a small primary button aligned right. Show the saved message as a small green line.
- If everything is on Auto and the notes are empty, show a soft hint line above Save: "All on Auto: the agent uses its normal style." Use `v-if="!preview"`.

## B. Skill usage (SkillsView.vue, Skills tab)
For each skill card in the Skills tab, using `s.usage` (it may be missing, so guard with `v-if="s.usage"`):
- A quiet meta line under the description:
  - "Used in {{ s.usage.runs }} runs"
  - "· last used {{ fmtTime(s.usage.last_used_at) }}" when `last_used_at` is set (`fmtTime` is already imported);
  - "· never used" when `last_used_at` is null.
- When `s.usage.bad_runs > 0`: a small amber chip "{{ s.usage.bad_runs }} went badly".
- When `s.usage.stale`: a clear amber badge "Stale" on the card header, with `s.usage.stale` as the tooltip (`:title`) and also as small text. The owner should spot stale skills at a glance and can delete them with the existing delete button.

## C. Integrations (IntegrationsView.vue: the Web search and Backups cards only)
- Make both cards match the Gitea and Telegram cards exactly: header icon tile, title, status line, help text, form and footer buttons.
- **Web search** (Claude changed this card on 2026-10-17: "Try first" select, SearXNG address, a key-provider select + key, and a status line "Order: DuckDuckGo → SearXNG"):
  - show the order as small chips joined by arrows instead of plain text (keep the same `webSearch?.order` / `PROVIDER_LABEL` expression);
  - group the SearXNG field and the key fields under a quiet "Fallbacks (optional)" sub-heading;
  - under the key fields, add one muted line with where to get a key:
  - "Tavily: app.tavily.com (1,000 free searches a month, no card)."
  - "Brave: api-dashboard.search.brave.com (needs a card)."

  Text only, no links needed.
- **Backups:**
  - the list of the last 5 backups reads like a small table (date in mono on the left, size and time on the right);
  - the long folder path wraps nicely;
  - "Back up now" shows a spinner icon (`LoaderCircle` with `animate-spin`) while `backingUp` is true.
- **Phone (390 px):** the cards stack, with no horizontal scroll.

## Check before you hand back
1. `bun run typecheck`: no errors.
2. `bun test`: all pass.
3. Screenshots: since the hub now uses Cloudflare login, the screenshot script needs Claude's preview hub. Just tell the owner you are done and Claude will take the screenshots.
4. List the files you changed. It must be exactly the three files above.
