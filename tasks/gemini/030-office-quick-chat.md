# Task 030: quick chat inside the office (Dashboard), without leaving it

Read `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md` (honesty rules) first. Write
`tasks/gemini/030-report.md`. Do not commit.

## Why
The owner (2026-10-29) wants to chat with an agent right on the 3D office page, for short questions, without opening
the full Chat page. The full Chat page stays for long threads, documents, recordings and suggestions.

## Rules
- **No duplicated chat logic.** First move the send / thread / pending-reply / stop / reply-from-state logic out of
  `apps/web/src/views/ChatView.vue` into a composable (e.g. `apps/web/src/chat/useChatThread.ts`) plus pure helpers
  (tested in `apps/web/test/`). ChatView then uses it and must behave exactly as before (manual check + screenshots).
  The office dock uses the same composable.
- Same threads as the Chat page: the dock continues the agent's latest thread (`api.chatThreads`), so "Open full
  chat" (`/chat?agent=<slug>&thread=<id>`) shows the same conversation. No new hub routes and no new tables
  unless you prove one is needed.
- The owner restyled `DashboardView.vue` and `components/office/OfficeCanvas.vue` himself: add to them, do not
  restyle or remove his parts.
- Works the same in the **3D and Pixel** views. Typing in the dock must never move your character (arrow keys/WASD
  are already ignored while typing; keep it so) and must not trigger office shortcuts.

## Build
1. **Dock** `components/office/QuickChat.vue` on the Dashboard: a small floating panel at the bottom-right (desktop)
   / a bottom sheet (phone, 390 px), collapsible to a round button with an unread dot. It shows the agent's avatar,
   name, status (idle / thinking / needs approval), the last ~6 messages, a text box (Enter sends, Shift+Enter new
   line), the mic button (`speech.ts` dictation, as in Chat), a photo button (same upload path as Chat, ≤ 4), a
   **Stop** button on a pending reply, and "Open full chat ↗".
2. **Choosing the agent:** clicking or selecting an agent in the office switches the dock to that agent; the radial
   menu's "Chat" and the "Chat with X" chip open the dock instead of navigating; dropping an agent on the owner's
   desk (`DropAction {open:"chat"}`) opens the dock too. A small picker in the dock header lists chat-able agents
   (not external agents, same rule as Chat). Remember the last agent and the open/closed state per viewer
   (localStorage in try/catch).
3. **Replies** come from the reducer state like ChatView (no polling loops); markdown rendered the same safe way as
   Chat; long replies are clipped with "more" → full chat. Read-aloud button if Chat has it.
4. **In the office:** while the reply is pending, the agent already shows "thinking" (existing events). When the
   reply arrives, show a short speech bubble (first ~60 characters) over that agent for ~6 s, in both 3D (CSS2D
   bubble style) and Pixel views. The bubble logic goes in the brain/pure code (tested), the scenes only draw it.
5. **Members/rooms:** the dock follows the current room and the same rules as Chat (members see only agents they may
   use; shared agents read-only where Chat says so).
6. Accessibility: focus trap off (it is not a modal), Esc collapses it, labels on buttons, dark mode.

## Tests and proof
Pure tests for the composable helpers and the bubble logic. Hub/web build: `bun run typecheck`, **full** `bun test`,
`bun run --cwd apps/web build`; paste the final lines. Screenshots against a preview hub (see CLAUDE.md "Screenshots
now need a preview hub"): dashboard 3D and Pixel with the dock open and a reply bubble, collapsed button, phone 390 px,
light + dark, and the Chat page before/after the refactor (it must look the same). Say in the report what you did not
check.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/030-office-quick-chat.md`.
> Write `tasks/gemini/030-report.md`. Do not commit.
