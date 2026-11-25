# Task 040: Brand Kit, graphic templates (posts, carousels, Story, Highlight covers) and the Grid Planner

Read `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md` (honesty rules) first. Write
`tasks/gemini/040-report.md` (a note after each step). Do not commit. Do it after 039.

## Why
The owner's Instagram used to look messy. He wants every post, Story and Highlight cover to follow one look per
project (colours, fonts, logo, layout), like a tidy creator feed: a 3-column grid where the posts match, and a row
of round Highlight covers in the brand colours. **No AI drawing in this task**: everything is a template drawn in
code, so text is always spelled right and looks the same every time. (Task 041 adds AI pictures inside templates.)

## Facts from the code
- Briefs: `ProjectBrief` in `packages/shared/src/marketing.ts`, stored as `projects/<slug>/brief.yaml`, edited in
  Projects → Brief (`apps/web/src/views/ProjectsView.vue`). Invalid hand edits answer 409.
- Drafts: `content_drafts` with `platform`, `kind` (`DraftKind`), `meta` (`WebPost`: `cover_upload_id`…), status,
  `publish_at` (scheduled posts, `POST /api/drafts/:id/schedule`). Web: `DraftsView.vue`, `DraftCard`.
- Uploads: images via `POST /api/uploads`; the runner uploads files in parts with
  `PUT /api/runner/uploads/parts/:key` (`apps/hub/src/http.ts` ~545), today gated to video tools.
- Rendering HTML to PNG: the runner already spawns a **Node + Playwright** worker
  (`packages/tools/browser/worker.mjs`, because Playwright hangs under Bun on Windows). Reuse that worker.
- Room scoping (`scope.ts`, `own*()`), owner-only guards, and `MEMBER_TOOLS` apply to anything new.

## Build
1. **Brand Kit** (`brand` field on `ProjectBrief`, all optional, Zod-validated):
   `colors {primary, secondary, accent, background, text}` (hex), `fonts {heading, body}` (from the bundled list),
   `logo_upload_id`, `style` (`minimal | bold | soft | playful`), `handle` (e.g. `@neshawoolery`),
   `highlights: [{label, icon}]` (≤ 12). Projects → **Brand** tab: colour pickers with a contrast warning (text on
   background below WCAG AA), font choice with a live sample, logo upload, highlight list.
2. **Fonts:** bundle 6–8 OFL-licensed families as files in `assets/fonts/` (e.g. Poppins, Montserrat, Playfair
   Display, DM Serif Display, Inter, Nunito, Bebas Neue), each with its `OFL.txt`. They must be **embedded in the
   rendered HTML as data URLs**: no network fetch at render time.
3. **Templates** (pure functions in `packages/shared/src/design.ts`: `(template, brand, fields, size) → html`,
   self-contained HTML, escaped text, no scripts, no remote URLs; tested):
   - `quote` (big quote + name), `tip_carousel` (cover + up to 8 slides + end slide with CTA, numbered),
     `list_top` (Top 3/5/10), `before_after` (two photos), `promo` (photo + headline + price/CTA),
     `announcement`, `testimonial`, `story_frame` (photo/video safe areas: keep text out of the top 250 px and
     bottom 340 px of 1920), `highlight_cover` (1080×1920 with the icon centred in the circle-safe area, brand
     background).
   - Sizes: `post_4x5` 1080×1350, `square` 1080×1080, `story` 1080×1920.
   - Text auto-fits (shrink between a max and a min size, then wrap; never overflow: return a `warnings` list
     instead).
   - Icons: an inline SVG set for highlight covers (~40: shop, star, heart, info, calendar, camera, play, quote,
     price, location, gift, faq, review…). Draw them or copy from Lucide (ISC) with its licence in `assets/icons/`.
4. **Tool `design_render`** (`packages/tools/src/design.ts`):
   `{template, size, fields, photos?: attachment numbers}`.
   - Builds the HTML, renders a PNG through the Node worker (new worker mode `{html_path, width, height, out}`, exact
     viewport, deviceScaleFactor 1), and uploads it through the parts route.
   - Widen that route's tool check to `design_render`, image types only for it.
   - Returns `{upload_id, warnings}`; a carousel returns several ids in order.
   - Gate it in `MEMBER_TOOLS` like the other render tools.
5. **Drafts with several images:** `meta.images: string[]` (≤ 10, upload ids, order = carousel order). The hub keeps
   only images this run rendered or that are attached to the job (same rule as `video_upload_id`). DraftCard shows
   them as a swipeable strip.
6. **Grid Planner** (`/planner`, menu Work):
   - pick a project, then see a phone-like Instagram profile preview: the handle, the **Highlight covers row**
     (rendered from the Brand Kit), and a 3-column grid;
   - grid order, newest first: pending → scheduled (by `publish_at`) → published drafts with an image for
     `instagram`, with badges (Pending / time / Posted);
   - drag one scheduled tile onto another to swap their `publish_at` (new owner/room-scoped
     `POST /api/drafts/swap-schedule {a, b}`, both drafts must be scheduled and in the same project);
   - a "Story this week" lane under the grid, by day.
   - The owner can download every Highlight cover as PNG (to set them in the Instagram app; the API cannot set
     Highlights).
7. **Docs:** a manual section "Brand Kit & Grid Planner" (BM) and a CLAUDE.md bullet.

## Tests and proof
- Shared: every template × size renders without overflow warnings for normal text, gives a warning for a
  600-character quote, escapes `<script>` in fields, and contains no `http` URL; brand validation (bad hex refused).
- Tools: `design_render` with a fake worker (args, upload call, carousel order); a **real render** of every
  template on this PC (temp workspace). Put the PNGs in a folder outside the repo and list their paths and sizes.
- Hub: the parts route accepts PNG only for `design_render`, still refuses other agents (403); `swap-schedule`
  across rooms → 404; `meta.images` from another run is dropped.
- Screenshots: Brand tab, Grid Planner (desktop 1440 + phone 390, light + dark), and a contact sheet of the
  rendered templates. Follow the browser rule in SUPERVISOR.md.
- `bun run typecheck`, the full `bun test`, `bun run --cwd apps/web build`: raw final lines.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/040-brand-kit-templates-grid.md`
> step by step, tests after each, notes appended to `tasks/gemini/040-report.md`. Templates are pure, escaped and
> offline (fonts embedded, no remote URLs). Use temp DBs and dirs, never the owner's. Paste raw output only;
> anything not run is NOT RUN. Do not commit.
