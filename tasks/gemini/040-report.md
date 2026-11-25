# 040 report

## Step 1 & 2 (Shared) — Brand Kit, OFL Fonts, Inline Icons & Pure Offline Templates
- Bundled 7 OFL-licensed font families (`poppins`, `montserrat`, `playfair-display`, `dm-serif-display`, `inter`, `nunito`, `bebas-neue`) with `OFL.txt` in `assets/fonts/<family>/`, and Lucide ISC license in `assets/icons/LICENSE`.
- Added `BrandKit`, `BrandColors`, `BrandFonts`, `BrandStyle`, `BrandHighlight`, `BRAND_FONTS`, `contrastRatio()`, `brand` on `ProjectBrief`, and `images` on `WebPost` / `WebPostEdit` in `packages/shared/src/marketing.ts`.
- Added 9 pure offline HTML templates (`quote`, `tip_carousel`, `list_top`, `before_after`, `promo`, `announcement`, `testimonial`, `story_frame`, `highlight_cover`), 3 sizes (`post_4x5`, `square`, `story`), 40 inline SVG icons (`DESIGN_ICONS`), `escapeHtml()`, `fitFontSize()`, and `renderDesignPages()` in `packages/shared/src/design.ts`.
- `bun test packages/shared/test/design.test.ts`:
```text
 4 pass
 0 fail
 190 expect() calls
Ran 4 tests across 1 file. [183.00ms]
```

## Step 3 (Tools & Worker) — `worker.mjs` offline PNG mode + `design_render` tool
- Extended `packages/tools/browser/worker.mjs` with `{ html_path, width, height, out }` mode (`deviceScaleFactor: 1`, blocks all non-`file:`/`data:` requests, awaits `document.fonts.ready`).
- Added `embedBrandFontsCss()`, `renderHtmlToPng()`, and `designRenderTool` (`design_render`) in `packages/tools/src/design.ts`, registered in `packages/tools/src/index.ts`, `packages/shared/src/programs.ts` (`node`), and `apps/hub/src/scope.ts` (`MEMBER_TOOLS`).
- Extended `uploadVideo` on `ToolContext` / runner client with optional `contentType` (`"image/png"` for `design_render`).
- `bun test packages/tools/test/design.test.ts apps/hub/test/manual.test.ts`:
```text
 5 pass
 0 fail
 34 expect() calls
Ran 5 tests across 2 files. [1.90s]
```

## Step 4 (Hub) — Runner PNG parts gate, `meta.images` run scoping, `POST /api/drafts/swap-schedule`
- `apps/hub/src/uploads.ts` & `apps/hub/src/http.ts`: widened `PUT /api/runner/uploads/parts/:key` to accept `image/png`/`image/jpeg`/`image/webp` ONLY when the agent has `design_render` (still 403s other agents and refuses videos for `design_render`-only agents).
- `apps/hub/src/core.ts` & `packages/tools/src/content.ts`: `save_draft` accepts `images?: string[]` and `#draft` drops any `meta.images` or `cover_upload_id` not created by this run or attached to this job.
- `apps/hub/src/content.ts` & `apps/hub/src/http.ts`: added room-scoped `POST /api/drafts/swap-schedule {a, b}` (404 across rooms, requires both drafts scheduled in the same project).
- `bun test apps/hub/test/design.test.ts`:
```text
 3 pass
 0 fail
 11 expect() calls
Ran 3 tests across 1 file. [1.51s]
```

## Step 5 & 6 (Web UI & Docs) — Brand Tab, Carousel Strip, Grid Planner (`/planner`), Manual & CLAUDE.md
- `apps/web/src/components/BriefPanel.vue`: added **Brand** tab with 5 hex colour pickers + WCAG AA contrast warning (`< 4.5:1`), heading/body font selectors + live preview card, logo upload, style, handle, and Highlights list (≤ 12, inline SVG preview).
- `apps/web/src/components/DraftCard.vue`: shows multi-image drafts (`meta.images.length > 1`) as a swipeable horizontal strip with `1/N` slide counters.
- `apps/web/src/views/GridPlannerView.vue`, `apps/web/src/router.ts`, `apps/web/src/components/shell/AppShell.vue`, `apps/web/src/api/http.ts`: added `/planner` (menu **Work → Grid Planner**) with phone-like Instagram profile preview, Brand Kit Highlight covers row + per-cover & bulk 1080×1920 PNG download, 3-column grid (Pending → Scheduled → Posted) with drag-to-swap (`POST /api/drafts/swap-schedule`), and **Story minggu ini** 7-day lane.
- `docs/manual.html` (section 40) & `CLAUDE.md`: documented Brand Kit, offline templates, and Grid Planner.

## Real Template Renders (offline Node + Playwright worker, embedded OFL fonts)
All 9 templates rendered to PNG outside the repo:
```text
PNG: C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\040-templates\quote.png (1080x1350, 58889 bytes)
PNG: C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\040-templates\tip_carousel-1.png (1080x1350, 508927 bytes)
PNG: C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\040-templates\tip_carousel-2.png (1080x1350, 38548 bytes)
PNG: C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\040-templates\tip_carousel-3.png (1080x1350, 27997 bytes)
PNG: C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\040-templates\list_top.png (1080x1350, 51361 bytes)
PNG: C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\040-templates\before_after.png (1080x1080, 30117 bytes)
PNG: C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\040-templates\promo.png (1080x1350, 311198 bytes)
PNG: C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\040-templates\announcement.png (1080x1080, 55127 bytes)
PNG: C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\040-templates\testimonial.png (1080x1350, 55216 bytes)
PNG: C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\040-templates\story_frame.png (1080x1920, 609282 bytes)
PNG: C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\040-templates\highlight_cover.png (1080x1920, 640304 bytes)
CONTACT_SHEET: C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\040-contact-sheet.png (185233 bytes)
```

## Screenshots (visually verified; Playwright closed, zero `chrome-headless-shell` processes left)
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/040-contact-sheet.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/040-planner-desktop-light.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/040-planner-desktop-dark.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/040-planner-phone-light.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/040-planner-phone-dark.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/040-brand-desktop-light.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/040-brand-desktop-dark.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/040-brand-phone-light.png`
- `C:/Users/Hazman/.gemini/antigravity/brain/83f6823f-1310-4675-97fb-781b2d3ac89e/screenshots/040-brand-phone-dark.png`

## Commands run (final verification)
- `bun run typecheck`:
```text
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```
(exit 0)
- `bun test`:
```text
 442 pass
 1 skip
 0 fail
 4893 expect() calls
Ran 443 tests across 82 files. [338.00s]
```
- `bun run --cwd apps/web build`:
```text
✓ built in 2.14s
```

## What I did NOT do or could not check, and why
- None (all unit, tool, hub, real offline PNG template renders, contact sheet, UI screenshots, typecheck, full test suite, and web build ran and passed).
