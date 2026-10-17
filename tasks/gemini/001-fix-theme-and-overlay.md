# Task 001: fix the theme toggle and the office overlay

You are working in the Agent Office repo (Bun + Vue 3 + Tailwind 4). Read `CLAUDE.md` first and follow its rules. Claude reviews your work afterwards, so stay inside the scope below.

## Scope: edit ONLY these files
- `apps/web/index.html`
- `apps/web/src/components/shell/AppShell.vue`
- `apps/web/src/components/office/OfficeCanvas.vue`

Do not touch anything else: no hub, runner, packages, tests, `maps/`, `style.css` tokens or `package.json`. Do not run `git commit`.

## 1. The theme choice must survive a reload
`AppShell.vue` saves the choice to `localStorage["ao:theme"]` ("light" | "dark"), but nothing reads it back.

- In `apps/web/index.html`, add a small inline `<script>` in `<head>` that runs **before the app loads**, so there is no flash of the wrong theme:
  - If `localStorage.getItem("ao:theme")` is "light" or "dark", set `document.documentElement.dataset.theme` to that value.
  - Wrap the `localStorage` read in try/catch (private mode can throw).
  - If nothing is saved, leave `data-theme` unset, so the OS setting applies.
- In `AppShell.vue`, initialise `isDark` from the same rule (saved value first, then the OS preference).

## 2. Remove the fake version badge
In `AppShell.vue`, remove the `v4.0` badge next to "Agent Office". The app version is not 4.0, so the badge misleads. Keep "MyOfis" as the small caption under the name: "MyOfis HQ" is fine.

## 3. The office overlay must not cover the map
In `OfficeCanvas.vue`:
- **The "HQ FLOOR DECK · N agents on duty" pill:** move it out of the canvas. Put it in a slim bar **above** the canvas, inside the same rounded card, not overlapping any pixels of the map.
- **The −/+ zoom buttons:** move them back to the **bottom-right** corner of the canvas, small and semi-transparent (they were there before).
- **Phone (< 640 px):** the bar must stay one line (truncate text), and nothing may cover the top row of the map (file cabinets, owner's desk).

## Acceptance (Claude checks all of these)
- `bun run --cwd apps/web typecheck` passes.
- `bun test apps/web` passes.
- **Reload with dark selected:** still dark, with no light flash first. Same for light.
- **No horizontal scroll** on a 390 px wide phone.
- **Only the 3 files above changed.** Check with `git status`.

When done, reply with a short list of what you changed per file.
