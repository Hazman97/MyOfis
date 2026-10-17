# Task 007: polish the screens Claude added on 2026-10-17

You are working in the Agent Office repo (Bun + Vue 3 + Tailwind 4). Read `CLAUDE.md` first. Match the look you built in tasks 001–006. Claude reviews your work.

**Do 005 and 006 first if they are not done yet.**

## Scope: edit ONLY these files
- `apps/web/src/components/SkillCatalog.vue` (part A)
- `apps/web/src/components/FacebookSettings.vue` (part B)
- `apps/web/src/components/PublishSettings.vue` (part B)
- `apps/web/src/components/DraftCard.vue` (part C)

## Golden rules
1. Change **only `<template>` and `<style>`**. In `<script setup>`, only new `lucide-vue-next` icon imports are allowed.
2. Keep every `v-model`, `@click`, `@submit`, `@change`, `v-if`/`v-else-if`/`v-for`, `:key`, `:disabled`, `id`/`for` pair, `ref`, `role` and `aria-*` exactly as they are.
3. In DraftCard there are two body boxes:
   - the decided card shows `{{ draft.body }}` (the final text);
   - "Show original" shows `{{ draft.original_body }}`.

   **Do not swap them** (this happened before).
4. Use only the `style.css` tokens and the `card` / `btn` / `input` / `chip` / `sign` classes. No new colours or dependencies.
5. Do not edit anything else, and do not run `git commit`.

## A. Skills → Browse (`SkillCatalog.vue`)
It lists about 230 public skills (Anthropic + Hermes Agent) with search, source/category filters and Install.
- **Toolbar:** the search field grows, and the filters and reload button sit in one row (they wrap on phone). Use a `Search` icon inside the field.
- **Skill rows:** use a compact card.
  - Name in mono; the source chip (Anthropic / Hermes) uses a different subtle style for each source.
  - The licence chip is amber when `!s.open_license`, with its existing tooltip.
  - The description is clamped to 2 lines (`line-clamp-2`).
  - The "Read ↗" link and the Install button sit on the right, and stack under the text on phone.
- **Installed:** a quiet check chip.
- **Warnings** after install: amber, with a warning icon.
- **Loading:** while `loading && !skills.length`, show 5 skeleton rows instead of only the text.

## B. Website and Facebook settings (`PublishSettings.vue`, `FacebookSettings.vue`)
These sit in Projects → Brief → **Website** tab: the website endpoint first, then the Facebook Page.
- Make them two clear cards, each with a header: icon (`Globe` / `Facebook` or `Share2`), a title, and a status chip — "Connected" (accent) or "Not connected" (muted).
- The connected banners (site name + post types; Page name) look like a success row with a check icon.
- Secret / token fields: keep `type="password"`. The hint text sits under the field.
- Footer buttons as in Settings → Integrations: Remove on the left, Test and Save on the right.

## C. Draft card (`DraftCard.vue`)
- **Pending website post:** the edit form (cover, summary, type, tags, date, time, location) should look like a tidy form.
  - Cover on top, with "Change cover" / "Remove cover" as small buttons over the image's bottom corner.
  - Two columns on desktop, one on phone.
  - Keep every input's `id`/`for` pair.
- **Live post:**
  - the "View it on the website / Facebook →" link is a small accent link with an external-link icon;
  - "Approved but not on the website yet" stays amber, and the publish error stays red;
  - the **Edit live post** and **Take down** buttons in the footer: Take down is a quiet danger (ConfirmButton as is), Edit is normal.
- **Caption with a photo:** the photo thumbnail sits neatly above the text, with rounded corners and a max height.

## Check before you hand back
1. `bun run typecheck`: no errors.
2. `bun test`: all pass.
3. List the files you changed. It must be exactly the 4 above. Confirm "script unchanged except icon imports".
