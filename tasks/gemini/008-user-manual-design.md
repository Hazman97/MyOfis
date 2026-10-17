# Task 008: make the user manual beautiful (docs/manual.html)

You are working in the Agent Office (MyOfis) repo. `docs/manual.html` is the owner's user manual: one self-contained HTML page in casual Malay/Manglish, with 36 sections, a sidebar, search and a light/dark theme. Claude wrote the content from the real code, so **the facts are right**. Your job is to make it look and read like a polished product manual (think Stripe docs, Linear docs, Notion help center) without losing a single fact.

## Scope: edit ONLY `docs/manual.html`
- **Never delete, rename or move this file or any other file.** Last time the manual disappeared from disk; that must not happen again. Save your changes into the same file.
- Do not touch the app code (`apps/`, `packages/`), other docs or tests. Do not run `git commit`.

## Hard rules (content)
1. **Keep every section and its `id`**: exactly `apa`, `masuk`, `peta`, `rutin`, `office`, `panel`, `agents`, `chat`, `publisher`, `drafts`, `projects`, `marketing`, `kerani`, `researcher`, `facebook`, `jobs`, `consult`, `memory`, `skills`, `prefs`, `approvals`, `telegram`, `schedules`, `budget`, `pause`, `replay`, `runners`, `settings`, `backup`, `hermes`, `searxng`, `gemini`, `maint`, `masalah`, `rahsia`, `istilah`) and the sidebar links to them.
2. **Keep every fact:** names, commands, slugs, cron values, limits (2200 / 1375 characters, 20 searches/minute, 14 days…), URLs, menu and button labels (in English, as in the app), statuses and table rows. You may reword a sentence for readability, but never drop or change a fact.
3. Keep the language: casual Malay/Manglish for explanations, English for UI labels and code.
4. Keep the scripts working: search box (`#q`), phone menu (`#menu`, `.links`, `nav.toc.open`), theme toggle (`#theme`, `data-theme`, localStorage key `myofis-manual-theme`), section highlighting. You may restyle them.
5. Self-contained: no external scripts or fonts (no CDN). Inline SVG and CSS only. The office image stays `../maps/preview.png`.

## What to improve
1. **Visual design:**
   - a consistent type scale, generous spacing, nicer section headers (icon + number);
   - an icon (inline SVG) per sidebar group and section;
   - colour-coded callouts (tip / note / warn / danger) with an icon each.
2. **Quick start at the top:** a "Mula dalam 5 minit" card row right after the hero, linking to Cara masuk, Chat, Publisher, Telegram and Drafts.
3. **Diagrams (inline SVG, both themes):**
   - (a) the system: Browser/Telegram → Hub → Runner → AI, plus the SmashPoint Worker → Firestore/Storage;
   - (b) the Publisher flow: photo → Publisher → Drafts/Telegram → Approve → website + social;
   - (c) the approval rule (safe / review / dangerous × agent permission).
4. **Agent cards:** a bigger avatar-style emoji, the role, a "Bila guna" line, and its tools as chips (keep all tools listed).
5. **Tables:**
   - zebra rows and a sticky header inside wide tables;
   - on phone, tables scroll sideways inside their own box (already set; keep it working).
6. **Telegram section:** show the commands as a mock chat bubble conversation, in addition to the table (keep the table).
7. **Each section ends with a small "Lihat juga" line** linking to 1–3 related sections.
8. **Print:** add `@media print` so the manual prints cleanly (hide the sidebar, search and buttons; show the link URLs for external links).
9. **Phone (390 px):**
   - no horizontal page scroll;
   - the ☰ menu works;
   - tap targets are at least 40 px.

## Check before you hand back
1. Open the file in a browser at desktop width and at 390 px, in light and dark mode.
2. The search for "telegram", "kerani" and "backup" still filters sections.
3. Count the sections: still 36, with the same ids.
4. Tell the owner you are done (Claude will review it and compare the facts with the previous version from git).
