# Task 011: polish Rooms, Members and the room switcher

You are working in the Agent Office (MyOfis) repo, a Vue 3 + Tailwind 4 app. Claude added:
- **Rooms** (`/rooms`, `views/RoomsView.vue`): HQ (the owner's main room), rooms per sub-business (e.g. "Sewa Baju") shared with friends, and each member's personal room. The owner makes rooms, sets each room's daily token limit and picks its members.
- **Members** (`/members`, `views/MembersView.vue`): invite friends by email, disable them, share HQ agents with a daily limit, and see their usage today.
- **Room switcher** (`components/RoomSwitcher.vue`): in the sidebar under the logo and in the phone top bar. Choosing a room sets the `ao_room` cookie and reloads.
- **Move to room** (`components/MoveToRoom.vue`): on agent cards (`views/AgentsView.vue`) and project cards (`views/ProjectsView.vue`), owner only.

The logic works and is tested. Your job is to make these feel polished and obvious on desktop and phone.

## Scope: edit ONLY these files
- `apps/web/src/views/RoomsView.vue`
- `apps/web/src/views/MembersView.vue`
- `apps/web/src/components/RoomSwitcher.vue`
- `apps/web/src/components/MoveToRoom.vue`

Never delete, rename or move any file. Do not touch `api/http.ts`, `me.ts`, the router, AppShell, other views, the hub or tests. Do not run `git commit`.

## Hard rules
1. **Keep the logic.** Keep every API call and its arguments:
   - `api.rooms`, `createRoom`, `updateRoom`, `setRoomMembers`;
   - `api.members`, `inviteMember`, `updateMember`, `setMemberShares`;
   - `api.moveAgent`, `moveProject`;
   - `enterRoom()`.

   Keep the reactive state (`picks`, `budgets`, `draft`) and the success and error messages.
2. Rooms stay ordered HQ → rooms → personal. Keep the "you are here" marker and the Enter button.
3. Use only the design system in `apps/web/src/style.css`:
   - tokens: `bg-surface`, `text-muted`, `text-accent`…;
   - classes: `card`, `btn`, `chip`, `label`, `input`, `sign`.

   No new packages. English UI text.

## What to improve
1. **RoomSwitcher:**
   - a nicer custom dropdown (keyboard accessible: arrow keys, Enter, Esc) showing an icon per kind (🏢 HQ, 🚪 room, 👤 personal), the room name, and for rooms "N members";
   - the current room is highlighted;
   - compact mode (phone top bar) shows the icon and a short name only.
2. **RoomsView:**
   - room cards with a coloured top strip per kind;
   - a progress bar for "tokens left today" against the daily limit;
   - member avatars (initials circles);
   - a clear empty state that explains the 3 steps: make a room → move agents/projects in (Agents / Projects → Move to room) → add members.
3. **MembersView:**
   - one card per member with initials avatar, email, status chip and tokens today;
   - shared agents as toggle rows with a compact limit input;
   - a short "How to invite" box with the 2 steps (add here + add the email in Cloudflare Access).
4. **MoveToRoom:** a small, quiet control (an icon button that opens the select); confirm before moving ("Move Publisher to Sewa Baju?").
5. **Phone (390 px):** no horizontal page scroll; tap targets at least 40 px; the switcher fits in the top bar next to the theme and pause buttons.

## Check before you hand back
1. `bun run --cwd apps/web typecheck` and `bun run --cwd apps/web build` pass.
2. Look at `/rooms`, `/members` and `/agents` at desktop width and 390 px, light and dark; open the switcher and switch rooms.
3. Tell the owner you are done. Claude will review the diff and the screenshots.
