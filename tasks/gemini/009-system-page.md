# Task 009: polish the System page (apps/web/src/views/SystemView.vue)

You are working in the Agent Office (MyOfis) repo, a Vue 3 + Tailwind 4 app. Claude built a new page, **System** (`/system`, menu System → System). It shows the whole system on one page:
- overview counts;
- an architecture diagram;
- the stack with versions;
- the database ERD;
- agents, tools and events;
- the main flow;
- connected integrations;
- safety.

All of it is read live from `GET /api/system`, `/api/agents` and `/api/tools`. The data and wiring are right. Your job is to make the page look polished and easy to read on desktop and phone.

## Scope: edit ONLY these two files
- `apps/web/src/views/SystemView.vue`
- `apps/web/src/components/MermaidDiagram.vue` (styling only)

Never delete, rename or move any file. Do not touch the hub, `api/http.ts`, the router, other views or tests. Do not run `git commit`.

## Hard rules
1. **Keep the data wiring:**
   - the `onMounted` loading of `api.system()`, `api.agents()` and `api.tools()`;
   - the computed values (`overview`, `erd`, `stack`, `toolsByCategory`, `eventGroups`);
   - the `fullErd` toggle.

   Do not hard-code numbers, versions, tables, agents or tools: they must keep coming from the API.
2. **Keep the section ids:** `overview`, `architecture`, `stack`, `database`, `agents`, `tools`, `events`, `flows`, `integrations`, `safety`. Keep the "Manual" and "Text for AI" (`/aitext`) buttons.
3. **Diagrams stay mermaid.** You may edit the `ARCHITECTURE` and `FLOWS` mermaid text for layout and readability: shorter labels, `classDef` colours, grouping. **Do not remove any box or arrow meaning.** Keep `securityLevel: "strict"` and the lazy `import("mermaid")`. Keep the light/dark theme switching in MermaidDiagram.
4. Use only the design system in `apps/web/src/style.css`:
   - tokens: `bg-surface`, `text-muted`, `text-accent`, `border-line`…;
   - classes: `card`, `chip`, `sign`, `btn`, `label`.

   No new npm packages, no external fonts or scripts.
5. English for UI text, as in the rest of the app.

## What to improve
1. **Page navigation:** a sticky row of small section links (Overview · Architecture · Stack · Database · Agents · Tools · Events · Flow · Safety) under the header.
   - Desktop: a horizontal bar.
   - Phone: a horizontally scrollable chip row.
   - It highlights the section in view.
2. **Overview cards:** an icon per card and subtle accent colours. Keep it 2 columns on phone and 4 on desktop.
3. **Diagrams:**
   - a little more padding;
   - an "Open full size" button per diagram that shows it in a full-screen overlay (Esc / ✕ closes it; scrollable on phone);
   - on phone, a hint "Swipe to see the whole diagram".
4. **ERD:**
   - a short legend (PK, FK, ||--o{ = one-to-many);
   - keep the "Show every column" toggle and the "All tables and columns" details list;
   - style the table cards (column types muted, PK in accent, FK lines in info colour).
5. **Agents:** show each agent's avatar sprite if easy (the office assets are at `/api/office/assets/…`). Otherwise use a coloured initial circle. Keep name, role, provider · model and tools count. Disabled agents stay faded.
6. **Tools and events:**
   - category headers with an icon and count;
   - tool chips show the description on hover and on tap (phone).
7. **Safety:** a 2-column grid of small cards with an icon each.
8. **Loading and error states:** skeleton cards while loading; the error message stays.
9. **Phone (390 px):**
   - no horizontal page scroll (only the diagrams scroll inside their box);
   - the bottom tab bar never covers content;
   - tap targets at least 40 px.

## Check before you hand back
1. `bun run --cwd apps/web typecheck` and `bun run --cwd apps/web build` pass.
2. Look at `/system` at desktop width and at 390 px, light and dark:
   - all ten sections are there;
   - the diagrams render;
   - the "Show every column" toggle redraws the ERD.
3. Tell the owner you are done. Claude will review the diff, run the tests and take screenshots.
