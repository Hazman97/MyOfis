# Task 006: whole-app UX polish pass (patterns people expect)

You are working in the Agent Office repo (Bun + Vue 3 + Tailwind 4). Read `CLAUDE.md` first. You already built the look (tasks 001–005); this pass makes the app **feel** like a polished modern product (think Linear, Vercel, Slack, ChatGPT) on desktop **and** phone. Claude reviews your work.

**If task 005 is not done yet, do it first** (`tasks/gemini/005-polish-prefs-usage-settings.md`), then this one.

## Already fixed by Claude (do not redo, just keep working)
- **Office:** zoom and pan no longer jump back to the centre. `game.recenter()` now exists.
- **Chat:** it no longer pulls you to the bottom while you read older messages. A "New reply ↓" button appears instead (`newBelow`, `scrollDown(true)`, `onScroll`).

## Golden rules
1. Change **only `<template>` and `<style>`**. In `<script setup>` the only changes allowed are new icon imports from `lucide-vue-next`.
   - **One exception:** in `OfficeCanvas.vue` you may call the existing `game?.recenter()` from a new button.
2. Keep every `v-model`, `@click`, `@submit`, `@keydown`, `@scroll`, `v-if`/`v-for`, `:key`, `:disabled`, `ref="…"`, `id`/`for` pair, `role` and `aria-*` working exactly as now. Do not rename or remove refs.
3. Use only the `style.css` tokens and the `card`, `btn`, `input`, `chip` and `sign` classes. **No new colours, fonts or dependencies.** Do not edit `style.css`, the router, stores, `api/`, hub, runner, packages or tests.
4. The owner restyled `DashboardView.vue`, `OfficeCanvas.vue` and `style.css` himself. Keep that look and only add what is listed below.
5. Do not run `git commit`. Put screenshots outside the repo, or let Claude take them.

## Files you may edit (templates)
- `views/`: `ChatView`, `DraftsView`, `SkillsView`, `ProjectsView`, `AgentsView`, `RunnersView`, `IntegrationsView`, `ApprovalsView`, `JobView`, `RunView`, `NewJobView`, `SchedulesView`, `ReplayView`, `DashboardView` (small additions only).
- `components/`: `DraftCard`, `BriefPanel`, `PublishSettings`, `ApprovalCard`, `EventTimeline`, `SidePanel`, `PageHeader`, `shell/AppShell`.
- `components/office/`: `AgentPanel`, `AgentPrefs`, `MemoryStores`, `OfficeCanvas` (the recenter button only).

## What to do

### A. Chat (`ChatView.vue`), the page used most
1. **"New reply ↓" pill** (already wired):
   - floating, centred, above the composer;
   - small shadow, accent border, subtle bounce-in;
   - must not cover the last message on phone.
2. **Message groups:** consecutive messages from the same side sit closer; show the timestamp on hover (desktop) or under the last bubble of a group.
3. **Typing indicator:** three animated dots in an agent bubble (keep the existing condition).
4. **Markdown-ish replies:** headings, bullets and code are readable inside agent bubbles (spacing, font sizes). Do not add a Markdown library.
5. **Photos:**
   - thumbnails in owner bubbles get rounded corners, and open full size in a new tab (already a link);
   - the pending photo strip above the composer gets a clear remove "×";
   - the 📷 button shows a small count badge when photos are attached.
6. **Composer:**
   - the textarea grows from 1 to 6 lines (CSS only: `field-sizing: content` with a max-height fallback);
   - on phone it stays above the keyboard and the bottom nav (`padding-bottom: env(safe-area-inset-bottom)`);
   - the send button is clearly disabled when empty.
7. **Empty state:** starter suggestions as tappable cards (keep the existing `v-for` and `@click`).
8. **Thread list (desktop):** the active thread is highlighted; titles truncate with a `title` tooltip; there is a subtle "New" button.

### B. Office (`OfficeCanvas.vue`)
- Add a **"Center"** button next to the zoom −/+ buttons, calling `game?.recenter()`. Use the `LocateFixed` icon with `aria-label="Center the office"`.
- Group zoom −, +, Center as one segmented control, bottom-right, with a tooltip on each (`title`).
- Under the controls, a tiny one-time hint: "Drag to move · scroll buttons to zoom". Use `v-if` on something that already exists, or show it always but very faint.

### C. Everywhere (consistency pass)
1. **Loading:** where a list loads (Drafts, Skills, Runners, Approvals, Projects, Agents), show skeleton rows (pulsing `bg-surface-2` blocks) instead of a blank page, using an existing loading condition if there is one. If none exists, skip it; do not add script.
2. **Empty states:** every list has an icon, one-line title, one helpful sentence and, where one exists already, the action button. Make them consistent across pages.
3. **Buttons:**
   - one primary action per area;
   - destructive actions use `btn-danger` or `ConfirmButton`;
   - every icon-only button has `aria-label` + `title`;
   - busy buttons show a spinner (`LoaderCircle` with `animate-spin`) using the existing `busy` / `saving` / `sending` refs.
4. **Focus:** visible focus ring on all interactive elements (`focus-visible:ring-2 ring-accent/50`); tab order is logical.
5. **Long text:** names, URLs, titles and paths truncate with a `title` tooltip or wrap (`break-words`); nothing overflows horizontally at 390 px.
6. **Side panels** (`SidePanel` users): sticky header with title and close button; the body scrolls, the header does not. On phone the panel is full width.
7. **Tables and lists:** row hover state; key numbers in `tabular-nums`; secondary info `text-muted`; dates use the existing formatters.
8. **Reduced motion:** wrap animations with `motion-safe:`.
9. **Dark mode:** check every changed screen in dark. No low-contrast grey on grey.

### D. Mobile (390 px) checklist
- No horizontal scroll on any page.
- Tap targets are at least 40 px tall.
- The bottom tab bar never hides content: pages have bottom padding.
- Inputs use 16 px font, so iOS does not zoom on focus.

## Check before you hand back
1. `bun run typecheck`: no errors.
2. `bun test`: all pass.
3. List every file you changed. For each one, write one line saying what changed, and confirm "script unchanged except icon imports".
4. Tell the owner you are done. Claude takes the screenshots, because the hub now needs Cloudflare login.
