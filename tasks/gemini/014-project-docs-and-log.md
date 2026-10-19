# Task 014: polish the project Docs and Log tabs

Claude added the **Project Assistant**: the owner sends a project's files (minutes, brochures, specs) in Chat or Telegram, and the assistant reads them, summarises them and keeps a **project log** (decisions, action items with who and due date, meetings, risks, dates). Two new tabs show this under **Projects → (project) → Docs / Log**:
- `apps/web/src/components/ProjectDocs.vue`: search box, "Add document", one card per file (title, pages, date, download, summary, page text on click);
- `apps/web/src/components/ProjectLog.vue`: an add form (type, what, who, due) and groups (Action items, Important dates, Decisions, Risks, Meetings, Notes) with a tick to mark done, and colours for overdue (red) and due soon (amber).

The logic works and is tested. Make the two tabs clear and pleasant on desktop and phone: the owner uses them to run a real client project.

## Scope: edit ONLY
- `apps/web/src/components/ProjectDocs.vue`
- `apps/web/src/components/ProjectLog.vue`

Never delete, rename or move files. No new packages. Do not run `git commit`.

## Hard rules
- **Keep every API call and its arguments:**
  - ProjectDocs: `api.docs`, `api.searchDocs`, `api.docText`, `api.uploadImage` + `api.addDoc`;
  - ProjectLog: `api.log`, `api.addLog`, `api.updateLog`.

  Keep the props (`project`), the search, the add flows and the error messages.
- Keep the overdue / due-soon logic in `dueClass`, the `KINDS` list and the "Show done items" switch.
- Use the design system in `apps/web/src/style.css` (tokens + `card`, `btn`, `chip`, `label`, `input`, `sign`). Light and dark. English UI text.

## What to improve
1. **Docs:**
   - a header row with the document count and total pages;
   - file-type icons (PDF / DOCX / TXT);
   - the summary in a readable box (keep line breaks), collapsed to 4 lines with "Show more";
   - search hits grouped by document, with the page number as a chip; clicking opens that page's text in a nicer reader (page header, monospace off, max height, scroll);
   - an empty state that explains the 3 ways to add files (Chat, Telegram, Add document).
2. **Log:**
   - an "Upcoming" strip at the top: the next 5 open actions and dates sorted by due date, with relative labels ("overdue 2 days", "today", "in 3 days");
   - each group as a compact list with a coloured kind icon;
   - owner as a small initials chip;
   - the add form collapses into a "+ Add item" button on phone.
3. **Phone (390 px):** no horizontal scroll; tap targets at least 40 px.

## Check before you hand back
- `bun run --cwd apps/web typecheck` and `bun run --cwd apps/web build` pass.
- Open a project → Docs and Log at desktop width and 390 px, light and dark. Add a log item, tick it done and untick it.
- Tell the owner you are done; Claude reviews the diff.
