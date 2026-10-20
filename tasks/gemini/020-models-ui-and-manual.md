# Task 020: models UI polish + manual for this week's features

Two parts, both UI and docs only. The logic is done and tested; keep it.

## Part A: AI providers page and the model picker
The owner switches agents between providers and models, and tests and scans them. Claude built working, plain UI. Make it clear and pleasant.

### Scope: edit ONLY
- `apps/web/src/views/ProvidersView.vue`: the scan results under each provider, the "Check connection" row in the side panel, and the "Scan models" button.
- `apps/web/src/components/ModelPicker.vue`: the provider/model selects, the "Auto" line, the Load/Test buttons and the test result box.

**Keep:**
- every `api.*` call and its arguments (`checkProvider`, `scanProvider`, `providerModels`, `testModel`, `createProvider`, `updateProvider`);
- `v-model:provider` / `v-model:model`;
- the `choice` / `custom` logic (Auto → ranked list → "Other…");
- the `watch` that sets Auto when the provider changes.

### What to build
1. **Scan results** (ProvidersView, per provider):
   - a compact summary "N of M models work with tools · saved";
   - working models as chips with their seconds, the best first (the list is already ranked);
   - a collapsible "Not working" list with the short reason;
   - a progress feel while scanning (it takes up to a minute).
2. **Check connection:** a clear green / red line with the model count or the error.
   - Keep the outside-endpoint hint under Base URL readable (two short lines).
3. **ModelPicker:**
   - Provider and Model side by side on desktop, stacked on phone;
   - when Model = Auto, a small "Auto" badge plus the try-order line;
   - the test result as a small card: ✅ works with tools (seconds) / ⚠️ answers but no tools / ❌ error, with the reply in mono, wrapped.
4. **Phone (390 px):** no sideways scroll; tap targets ≥ 40 px. Light and dark.

## Part B: manual (`docs/manual.html`)
Add these sections in the same style as the others: id, a sidebar link in the right group, an icon, and a "Lihat juga" line. Use only facts from the files listed under each; do not invent anything. Keep all existing sections, ids and facts.

| id | Title | Facts from |
|---|---|---|
| `tiktok` | Ejen TikTok | `docs/tiktok-agent.md`; CLAUDE.md "TikTok agent" |
| `studio-pro` | Studio Pro (OpenChatCut) | CLAUDE.md "OpenChatCut". Also: open the project editor in OpenChatCut first to watch live; edits are committed step by step; Export there, then "Use my own edit" in the Video Studio. |
| `models` | Model AI: Auto, 9Router, Test & Scan | CLAUDE.md "Switching models", "Model auto", "Scan", 9Router notes. Also: 9Router listens on 127.0.0.1 only. |
| `run-status` | Status kerja, had & Stop | CLAUDE.md "Run limits". Also: the status card phases (queued with place and reason, running step and timer, quiet after 2 minutes, failed / stopped with the reason, Try again) and the Work queue in the sidebar. |
| `motion` | Gerak dalam video | CLAUDE.md "Motion in renders": zoom in/out, transitions, caption fade/pop. |

**Update the menu map** section (`peta`): add Video Studio (already there?), the Work queue, and Settings → AI providers (Scan models).

## Rules
- Follow `docs/FRONTEND.md`: design tokens, canonical Tailwind v4 classes (no `-[Npx]` for spacing or sizes). English UI text in the app; the manual stays in Malay like the rest.
- Never delete, rename or move files. No new packages. Do not run `git commit`. Do not edit `packages/`, `apps/hub/`, `apps/runner/` or `api/http.ts`.

## Check before you hand back
- `bun run --cwd apps/web typecheck` and `bun run --cwd apps/web build` pass.
- Open Settings → AI providers and an agent's edit form at desktop width and 390 px, light and dark.
- The manual: search finds "auto", "9router", "openchatcut", "stop" and "zoom"; the old ids are unchanged.
- Tell the owner you are done; Claude reviews the diff.
