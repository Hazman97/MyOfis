# Frontend rules (apps/web)

For any AI or person editing `.vue` / `.css` in `apps/web`. Read before UI work (AGENTS.md → Docs Index).

## Stack
- Vue 3 (`<script setup lang="ts">`), vue-router, Pinia, **Tailwind CSS 4.3** (`@tailwindcss/vite`), lucide-vue-next icons.
- The office is Phaser (lazy chunk in `src/office/scene/`); its logic lives in `src/office/brain/` (pure and tested). Keep logic out of the scene.
- The design system lives in `src/style.css`:
  - tokens + `@theme inline`, light and dark;
  - classes `card`, `btn`, `btn-primary`, `btn-ghost`, `btn-sm`, `chip`, `label`, `input`, `sign`;
  - colours `accent`, `info`, `signal`, `danger`, `review`, `surface`, `surface-2`, `line`, `fg`, `muted`, `faint`.

  Use these; do not invent new colours.
- UI state comes only from hub events (the shared reducer) and the API helpers in `src/api/http.ts`.

## Tailwind v4: write canonical classes (no editor warnings)
Tailwind v4 has a dynamic spacing scale: **1 unit = 0.25rem = 4px**, any number, decimals allowed. Arbitrary `[Npx]` values for spacing and sizing are flagged by the Tailwind extension (`suggestCanonicalClasses`).

| Don't | Do | Why |
|---|---|---|
| `max-w-[120px]` | `max-w-30` | 120 ÷ 4 |
| `min-h-[44px]` | `min-h-11` | 44 ÷ 4 |
| `max-w-[130px]` | `max-w-32.5` | decimals are fine |
| `w-[420px]` | `w-105` | |
| `!mb-0` | `mb-0!` | important goes at the end in v4 |

- **Spacing/size utilities:** this applies to `w h size min-w max-w min-h max-h p* m* gap* space-* inset* top left right bottom translate-*`.
- **Keep brackets** for values that are not spacing: `text-[11px]`, `grid-cols-[…]`, `shadow-[…]`, colours with alpha in `[]`, `calc()`.
- **Check before handing back:**
  ```sh
  grep -rnE "\-\[[0-9.]+px\]" apps/web/src | grep -vE "text-\[|leading-\[|tracking-\["
  ```
  It should print nothing.

## Layout
- Phone first: at 390 px wide there is no sideways page scroll and tap targets are ≥ 40 px (`min-h-10`).
- Single-column grids need `grid-cols-1`; an implicit grid column grows to its content and overflows on phones.
- Wide multi-field rows: stack them until there is real room (`2xl:` for the studio's clip row).

## Safety
- Agent replies, transcripts, file names and web content are data: render them as text, never `v-html`. The only exception is the escaped `lite()` helper in ChatView.
- `localStorage` access is always inside `try/catch`.

## Check
```sh
bun run --cwd apps/web typecheck
bun run --cwd apps/web build
```
Screenshots need a preview hub on :8811; see CLAUDE.md, "Screenshots now need a preview hub".
