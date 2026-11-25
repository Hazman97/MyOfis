# Task 043: Make the 040 templates look like real posts (layout quality) + Design Studio defaults

Read `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md` (honesty rules) first. Write
`tasks/gemini/043-report.md` (a note after each step). Do not commit.

## Why
The owner rendered his first real post in `/design` (quote, post_4x5, project SmashPoint) and called it a **fail**.
The PNG is technically correct, but:
- the quote sits in the top half and the **bottom ~50 % of the canvas is empty white**;
- there is no background, no shape, no brand feeling: it looks like a text document, not a post;
- the fields were prefilled with **sample text from another business** ("Sewa Kamera MY", "Set Vlog Lengkap"…) while the project was SmashPoint, and every template's sample fields were sent with the render.

The 040 contact sheet (`…/screenshots/040-contact-sheet.png`) shows the same problem in most templates:
- `list_top`: the title is at the top, the items are small in the middle, big gaps above and below;
- `tip_carousel` cover: one small title on a big gradient;
- `promo` without a photo: a lone ✦ icon as a placeholder;
- `testimonial`: a big empty card under the text;
- `story_frame`: the headline is tiny for 1080×1920;
- body text everywhere is ~24–30 px, which is unreadable once Instagram shows the post at ~1/3 size on a phone.

## Rules (apply to all 9 templates; `packages/shared/src/design.ts`)
1. **Fill the canvas.** No template may leave more than ~25 % of the canvas height as one empty band. Centre the main
   block vertically (or spread it with `justify-content: space-between` between header / main / footer).
2. **Text fills its box.** `fitFontSize` must choose the **largest** size that fits the real free area (not a fixed
   small max). Raise the maxima: quote up to 104 px, headlines up to 120 px (post) / 132 px (story), list items and
   body up to 52 px.
3. **Minimum sizes at 1080 px width:** body / list / author ≥ 34 px, small labels (chips, handle) ≥ 26 px. Add a pure
   test that parses every `font-size:Npx` in every template's HTML (short and long sample text, every size) and fails
   below these minima.
4. **Never a plain flat page.** When there is no photo, each template draws a brand background made in code: e.g. a
   soft gradient of `primary`/`secondary`, large faint shapes (circle, blob, the big quote mark at 30–40 % size and
   low opacity), or a subtle dot/grid pattern. Keep it offline (CSS/SVG only), no remote URLs, no scripts.
5. **Photos.** `quote`, `announcement`, `tip_carousel` (cover) and `promo` accept `photos[0]` as a full-bleed
   background with a brand-colour overlay that keeps text contrast ≥ 4.5:1 (reuse the 040 WCAG helper). `promo`
   without a photo uses the rule-4 background, never a lone icon.
6. **Brand footer always.** Show the project name when the Brand Kit has no handle and no logo (today the footer
   disappears and the post has no owner).
7. Keep everything else from 040: escaping, zero scripts, zero remote URLs, story safe areas, highlight circle-safe area,
   `meta.images` order for carousels.

## Design Studio (`apps/web/src/views/DesignStudioView.vue`)
- Remove the hard-coded sample business text. Fields start **empty with placeholders**; the author/name field defaults
  to the selected project's name.
- Send **only the chosen template's fields** to `design_render` (today every template's sample fields go along).
- When the project has no Brand Kit, show a small note above the preview: "Projek ini belum ada Brand Kit — guna warna
  asal. Tetapkan di Projects → Brand." with a link.
- The preview must look exactly like the PNG (same HTML), including the new backgrounds.

## Proof
- A **before/after contact sheet** of all 9 templates, each with **short text** (3–5 words) and **long text** (near the
  limit): 18 renders before, 18 after. No overflow and no empty half in any "after" tile. List the PNG paths.
- A **phone check**: the same "after" PNGs scaled to 360 px wide (how an IG feed shows them). Text must be readable;
  say which ones you checked by eye.
- Re-render the owner's exact case (quote, post_4x5, SmashPoint, "Video yang kemas bermula dari pencahayaan natural dan
  audio yang jelas.") and show before vs after.
- Tests: the font-size minima test, and the existing 040/041 tests still green.
- Screenshots of `/design` (desktop 1440 + phone 390, light + dark) with a project that has no Brand Kit.
- `bun run typecheck`, the full `bun test`, `bun run --cwd apps/web build`: raw final lines.

Use temp DBs and dirs, never the owner's `data/`. Real renders go outside the repo.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/043-template-design-quality.md`
> step by step, tests after each, notes appended to `tasks/gemini/043-report.md`. The owner called the first real post a
> fail because half the canvas was empty and it looked like a document. Every template must fill the canvas, use big
> readable text and a brand background. Prove it with before/after contact sheets (short + long text). Use temp DBs
> and dirs, never the owner's. Paste raw output only; anything not run is NOT RUN. Do not commit.
