# Task 012: add the new features to the user manual (docs/manual.html)

`docs/manual.html` is the owner's manual (casual Malay/Manglish, 36 sections, sidebar, search, light/dark). It is shown in the app at **Manual**. Several features were built after it was written. Add them, in the same style and design as the existing sections.

## Scope: edit ONLY `docs/manual.html`
- Never delete, rename or move any file. Do not touch app code. Do not run `git commit`.
- **Keep all 36 existing sections, their ids and every fact.** You may add a line or a "Lihat juga" link to an existing section.
- Keep the search, the phone menu, the theme toggle and the section highlighting working. No external scripts or fonts.

## Where the facts come from (read these; do not invent anything)
- `README.md` sections: "Editor: videos for TikTok, Reels and Shorts" (incl. **Video Studio** and OpenCut), "Ketua: ask the whole office" (incl. **Morning briefing**), "System page", "Backups", "Telegram as your office phone".
- `CLAUDE.md` decisions: Instagram + Threads, Token health, Editor / local video pipeline, Video Studio, Members and workspaces, **Rooms**, Morning briefing, Manual page, `/aitext`, **Playing in the office**, **Project Assistant**, **Scheduled posts**.
- `docs/video-editor.md`, `docs/facebook-page.md` (Instagram & Threads, token renewal).

## New sections to add (each with a sidebar link in the right group, an icon and a short "Lihat juga" line)
| id | Title | Must cover |
|---|---|---|
| `editor` | Editor (video) | send videos in Chat (2 GB, parts) / Telegram (20 MB); what Editor does; presets; NVENC GPU; video drafts; limits (cannot see frames, no music yet) |
| `studio` | Video Studio | Open in Video Studio; timeline, clips, captions, format/fit/fps; **Render again** = no AI, 0 tokens, the draft switches; **Edit fully in OpenCut** → **Use my own edit**; OpenCut watcher on Telegram |
| `instagram` | Instagram & Threads | IG uses the Page token, Business/Creator, photo needed; Threads own token, renewed weekly by the hub; token warnings on Telegram |
| `ketua` | Ketua & taklimat pagi | ask the whole office (consult_team, meeting room); combined answer format; "ok proceed"; morning briefing 07:30, turn on in Schedules, what it contains |
| `rooms` | Rooms (bilik) | HQ / rooms / personal; make a room, daily limit on your AI, Move to room, members in a room; owner enters every room; safe tools in shared rooms; the room switcher |
| `members` | Members (kawan) | 2 steps to invite (Members + Cloudflare Access email); what members can and cannot see; shared agents + daily limits; personal room with their own keys; disable |
| `play` | Main dalam office | tap = poke + emote (4 cepat = marah 💢); long-press / right-click = ring menu (Chat, New job, Pause, Memory, Poke); drag an agent and drop it (pantry, meeting room, library, another agent, whiteboard → Drafts, your desk → Chat); your own character (tap the floor or arrow keys/WASD), "Chat with X" chip; heart when a draft is approved |
| `project-assistant` | Project Assistant | send PDFs/DOCX (minutes, brochures) in Chat (25 MB) or Telegram (20 MB); it reads, summarises and fills the project Log (actions, dates, decisions, risks, meetings); Projects → Docs / Log; 08:00 reminders on Telegram; Monday 08:30 status (turn on in Schedules); scanned PDFs without text cannot be read |
| `schedule-post` | Jadual post | **Schedule…** next to Approve: pick a time (up to 60 days); website + connected Facebook/Instagram/Threads only; Telegram says when it is out or failed; Cancel schedule / Publish now on the card |
| `system` | System page & Text for AI | what the System page shows; `/aitext` link for other AIs (needs the Cloudflare bypass for that path) |

Also update the existing sections:
- `backup`: photos and videos are mirrored once into `data/backups/files/`.
- `telegram`: video drafts arrive with the video; the morning briefing comes here.
- `peta` (menu map): add Rooms, Members, System, Manual and Video Studio.

## Check before you hand back
1. Open the file in a browser at desktop width and 390 px, light and dark.
2. Search "studio", "room", "kawan", "instagram", "poke", "minit" and "jadual": they find the new sections.
3. Count: 36 old ids + 10 new ids, and every old id is unchanged.
4. Tell the owner you are done. Claude will compare the facts with README / CLAUDE.md and with the previous version from git.
