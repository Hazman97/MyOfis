# Task 022: UX fixes from the owner's audit + Social accounts look

A full audit of the app (2026-10-20) found UX problems. Claude already fixed the logic bugs. What is left is UI work. All parts are UI only: keep every `api.*` call, prop, emit, `v-model` and computed exactly as they are.

## Part A: Chat on the phone (`apps/web/src/views/ChatView.vue`)
1. **Earlier conversations on the phone.** Under 1024 px the "Conversations" list is hidden (`<aside class="max-lg:hidden">`), and phone users can only press "+ New".
   - Add a "Conversations" button next to "+ New" on small screens.
   - It opens the same list as a sheet or drawer, so you can tap an earlier thread.
   - Reuse the existing list markup and handlers. Do not add new data loading.
2. **Desktop:** the Conversations list sits under the long agent list, below the fold. Make it reachable without scrolling the whole agent list, for example by giving the agent list a max height with its own scroll.
3. **The running pill hides Send.** On the phone the floating "N running · N waiting" pill (`components/shell/WorkQueue.vue`) covers the Send button while a reply runs. Move it, or give the chat composer enough bottom space on small screens.

## Part B: Rooms look like rooms (`components/shell/AppShell.vue`, `views/DashboardView.vue`)
- Inside a room the dashboard still says "HQ WORKSPACE" / "HQ FLOOR DECK", and the sidebar says "MYOFIS HQ".
  - Show the current room's name instead. It is available from `me.ts` (current room id) and `GET /api/rooms` (already used by `RoomSwitcher.vue`; reuse its data the same way).
  - Keep "HQ" when the room is HQ.
- In DashboardView change only these labels. The owner styled that file.
- An empty room (no agents) shows an empty office and an empty New job page. Add a friendly empty state with a link to `/agents` ("Move or add agents to this room").

## Part C: Office polish (`components/office/OfficeCanvas.vue`, `views/DashboardView.vue`)
- Phone: the "How to play" pill overlaps the "N agents on duty" text. Fix the layout.
- The hint "scroll buttons to zoom" is wrong, because the mouse wheel zooms too. Change it to "Scroll or use the buttons to zoom · drag to move".
- "Office Play Controls" covers the top-left of the office until dismissed. Make it smaller or collapsed by default after the first visit (`localStorage`, wrapped in try/catch).

## Part D: Sidebar (`components/shell/AppShell.vue`)
At 900 px window height the "Manual" link sits under the fixed bottom panel (New job, Today, Runners, Pause). Make the nav scroll above that panel so every link is reachable.

## Part E: Video Studio (`views/VideoStudioView.vue`)
- The 9:16 preview shows a letterboxed 16:9 video even when Fit is "Crop". When fit is crop, use `object-fit: cover` on the preview. Keep contain for blur and pad.
- For your own clip (never rendered, `info.known === false`) the main button says "Render again". Label it "Render" instead.

## Part F: Settings → Social accounts (`views/SocialAccountsView.vue`)
Claude built it; give it the same look as the other Settings pages:
- connection cards;
- account rows with the editable name, @username, followers, and an on/off switch styled like the other switches in the app (keep the checkbox's `@change`);
- a "needs reconnecting" warning chip;
- an empty state explaining Zernio in two lines;
- phone 390 px friendly.

Also style the TikTok "Posts to …" row on draft cards (`components/DraftCard.vue`, the block with `showAccount`), and the account picker in `views/AgentsView.vue` (`ag-tiktok-account`) and `views/SchedulesView.vue` (`sc-account`), so they match their surroundings.

## Rules
- Follow `docs/FRONTEND.md`: design tokens, canonical Tailwind v4 classes (no `-[Npx]` for spacing or sizes). English UI text.
- Do not edit `packages/`, `apps/hub/`, `apps/runner/`, `api/http.ts`, `socialTargets.ts`, `workFeed.ts`, `runStatus.ts` or anything under `office/brain` / `office/scene3d/office3d.ts`, `plan.ts`, `character.ts`.
- No new packages. Never delete or move files. Do not run `git commit`. Delete your screenshot PNGs from `apps/web/` when you are done (put them outside the repo).

## Check before you hand back
- `bun run --cwd apps/web typecheck`, `bun test apps/web` and `bun run --cwd apps/web build` pass.
- Screenshots at desktop and 390 px, light and dark:
  - Chat (with a few threads);
  - Dashboard inside a room;
  - Settings → Social accounts;
  - Drafts with a TikTok draft;
  - Video Studio.
  Use the preview hub (see CLAUDE.md "Screenshots now need a preview hub").
- Tell the owner you are done; Claude reviews the diff and screenshots.
