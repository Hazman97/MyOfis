# 040 review (Claude, 2026-11-25): PASS WITH FIXES

Escaping, data-URL photos, enum fonts/icons, hex colours, path safety, swap-schedule scoping and old briefs are fine.
Targeted tests pass (11/11). Fix these. Append notes to `tasks/gemini/040-report.md` under "## Fixes after review".
Do not commit. (Template looks are handled separately in 043 — not here.)

1. **Approve can post another room's photo** — `apps/hub/src/content.ts:261-266`, `packages/shared/src/marketing.ts:234`.
   `decideDraft` merges `approve.meta` (`WebPostEdit.images`, `cover_upload_id`) without a room check; later
   `Social.#uploadToZernio` reads each image via `publisher.uploadFile` (no room check). A member in room B can approve
   their draft with an HQ upload id and post the owner's private photo.
   Fix: in `decideDraft`, every id in `meta.images` and `cover_upload_id` must be an upload with
   `workspace_id === draft.workspace_id`, else 400. Test it (cross-room id → 400; same-room → OK).
2. **Brand Kit logo never renders** — `packages/tools/src/design.ts:130-132`, `apps/hub/src/http.ts:499-511`.
   The tool fetches `brand.logo_upload_id` via `GET /api/runner/uploads/:id?run_id=`, which only serves job/run files →
   404, swallowed → no logo, ever. Also hard-codes `image/png`.
   Fix: the runner upload route also serves an upload that equals `brand.logo_upload_id` of a project in the job's
   room; use the upload's real content type. Validate `logo_upload_id` on brief PUT (must be an image upload in the
   same room). Test: a render with a logo contains an `<img src="data:image/...` and the real PNG shows it.
3. **Images get the 2 GB limit and `?attach=1`** — `apps/hub/src/http.ts:603-611`, `apps/hub/src/uploads.ts:47-50`.
   Fix: for image types reject `attach` and cap total at 20 MB. Test both.
4. **Worker defence in depth** — `packages/tools/browser/worker.mjs:49-54`.
   In `html_path` mode use `newContext({ javaScriptEnabled: false })` and allow only the page's own file URL plus
   `data:`; abort every other request (other `file:` paths included). Test: a template HTML referencing another local
   file renders without it.
5. **Tests missing:** a real (non-fake) worker render test that is skipped only when Playwright/Node is unavailable;
   logo; editing `meta.images` on approve.

6. **043 leftovers** (043 passed review otherwise):
   - `quote` shows the project name twice (author line + footer) when the brief has no handle/logo: when the author
     equals the footer text, drop it from the footer (keep the dot + accent line).
   - `testimonial` with short text leaves a big empty band in the middle of the card: centre the quote block
     vertically in the card or grow the font to fill (rule 1 of 043).
   Show both in an updated after-contact-sheet.

Proof: raw output of the new tests, `bun run typecheck`, full `bun test`, `bun run --cwd apps/web build` final lines.
