# Task 025 Report — External Agents in the Office

## Summary
Added end-to-end support for watching external AI workers (such as Claude Code canopy workers) live inside the MyOfis 2D/3D office and Work Feed using the existing event-driven reducer and office brain, without modifying any 2D/3D scene code or requiring a database schema migration.

## Architectural Decisions & Assumptions
1. **Zero-migration external agent representation (`AgentConfig.external` + `kind: "external"`)**:
   - Stored `external: true` inside the existing JSON `agents.config` column and derived `kind: "external" | "builtin"` in `toAgent()`.
   - External agents do not require a provider or model (defaulted to `"external"`), are never seeded, and are excluded from runner dispatch, chat, new job target lists, scheduled jobs, agent-to-agent consults, and handoffs.
2. **External token storage**:
   - `POST /api/agents/:id/external-token` (owner-only) generates a random `myo_ext_<48 hex chars>` token, returns the plaintext token **once**, and stores only `{ hash: sha256(token), hint: "myo_ext_…xxxx", created_at }` under `settings` key `external.token.<agentId>`.
   - Deleting an external agent (`DELETE /api/agents/:id`, owner-only) disables the agent and deletes its token entry from `settings`.
3. **Fixed pseudo-runner (`rnr_external`)**:
   - External activity runs use `runner_id: "rnr_external"`, which is filtered out of `GET /api/runners` and skipped by `boot()` runner offline checks so the Runners page never lists it as a machine.
   - In `apps/web/src/office/brain/world.ts`, external agents always get `runnerOnline: true` so they never show an "offline" badge when idle.

## Files Created / Edited

### Created
- `scripts/external-agent-hook.ts` — Zero-dependency Bun CLI/module that maps Claude Code hook payloads (`SessionStart`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`) to `POST $MYOFIS_URL/api/external/activity` with a 2-second timeout, stripping file contents/diffs/secrets and always exiting `0`.
- `docs/external-agents.md` — Setup guide covering agent creation, token generation, `.claude/settings.json` hook configuration, environment variables, and manual `curl` testing.
- `apps/hub/test/external.test.ts` — 8 test suites (108 assertions) covering external agent lifecycle, token hash storage, `POST /api/external/activity` lifecycle + reducer state transitions, implicit session start, 30-minute `"lost contact"` sweep, rate limiting (20 events/s) + 16 KB body cap, dispatch/chat/schedule rejection, and hook payload mapping/sanitization.
- `tasks/gemini/025-report.md` — This report.

### Edited
- `packages/shared/src/entities.ts` — Added `AgentConfig.external`, `Agent.kind`, `Agent.external_token_hint`, `ExternalActivityEvent`, `ExternalActivityInput`, and `externalToolCategory()`.
- `apps/hub/src/repo.ts` — Mapped `kind: config.external ? "external" : "builtin"` in `toAgent()`.
- `apps/hub/src/scope.ts` — Added `withExternalHint()` to attach `external_token_hint` from `settings` without exposing the token hash.
- `apps/hub/src/core.ts` — Added `EXTERNAL_RUNNER_ID = "rnr_external"`, `EXTERNAL_IDLE_TIMEOUT_MS = 30 * 60_000`, `externalActivity()`, 30-minute idle `"lost contact"` failure in `sweep()`, and guards preventing external agents from being dispatched, chatted with, consulted, or handed off to.
- `apps/hub/src/http.ts` — Added `POST /api/external/activity` (Bearer token auth, ≤ 16 KB body cap, 20/s per-token rate limit, mounted before cookie-CSRF middleware so it works on `127.0.0.1:8788` and through the domain), owner-only `POST /api/agents/:id/external-token` and `DELETE /api/agents/:id`, external agent handling in `POST /api/agents` & `PATCH /api/agents/:id`, schedule guard in `POST /api/schedules`, and filtering of `rnr_external` from `GET /api/runners`.
- `apps/web/src/api/http.ts` — Added `issueExternalToken(id)` and `deleteAgent(id)` API helpers.
- `apps/web/src/office/brain/intent.ts` — Defaulted external agents without an explicit sprite to `"person-4"`.
- `apps/web/src/office/brain/world.ts` — Marked external agents as `runnerOnline: true` in the office world state.
- `apps/web/src/components/office/OfficeCanvas.vue` — Appended `· AWS` to external agent labels in the 2D/3D office (`labelName()`).
- `apps/web/src/components/office/AgentPanel.vue`, `apps/web/src/components/office/AgentRadialMenu.vue`, `apps/web/src/views/ChatView.vue`, `apps/web/src/views/NewJobView.vue`, `apps/web/src/views/SchedulesView.vue`, `apps/web/src/views/DashboardView.vue` — Excluded external agents from chat/job/schedule/handoff pickers and shown an `AWS · external` badge in the office side panel.
- `apps/web/src/views/AgentsView.vue` — Added read-only external agent card (`AWS · external` chip, token hint, one-time token display with copy button, `Token` and `Delete` actions) and external agent creation toggle.

## Verification Commands & Results

1. **Typecheck across all workspaces**:
   ```sh
   bun run typecheck
   ```
   - Result: **Exit 0** (`tsc` passed for `packages/shared`, `packages/agents`, `packages/tools`, `apps/hub`, `apps/runner`, and `vue-tsc --noEmit` passed for `apps/web`).

2. **Unit & integration tests**:
   ```sh
   bun test apps/hub/test/external.test.ts
   bun test
   ```
   - Result: **Exit 0** (`8 pass, 0 fail, 108 expect() calls` in `external.test.ts`; `343 pass, 0 fail, 3684 expect() calls` across all 64 test files).

3. **Frontend production build**:
   ```sh
   bun run --cwd apps/web build
   ```
   - Result: **Exit 0** (`vite build` succeeded cleanly).

4. **Tailwind v4 canonical class check (`docs/FRONTEND.md`)**:
   - Checked `apps/web/src` for arbitrary `[Npx]` spacing utilities (`\-\[[0-9.]+px\]` excluding `text-[`, `leading-[`, `tracking-[`): **0 matches**.

## Screenshots (Desktop 1440×900 & Mobile 390×844, Light & Dark)
Saved in `C:\Users\Hazman\AppData\Local\Temp\myofis-025-screenshots`:
- `C:\Users\Hazman\AppData\Local\Temp\myofis-025-screenshots\office-desktop-light.png`
- `C:\Users\Hazman\AppData\Local\Temp\myofis-025-screenshots\office-desktop-dark.png`
- `C:\Users\Hazman\AppData\Local\Temp\myofis-025-screenshots\office-phone-light.png`
- `C:\Users\Hazman\AppData\Local\Temp\myofis-025-screenshots\office-phone-dark.png`
- `C:\Users\Hazman\AppData\Local\Temp\myofis-025-screenshots\agents-desktop-light.png`
- `C:\Users\Hazman\AppData\Local\Temp\myofis-025-screenshots\agents-desktop-dark.png`
- `C:\Users\Hazman\AppData\Local\Temp\myofis-025-screenshots\agents-phone-light.png`
- `C:\Users\Hazman\AppData\Local\Temp\myofis-025-screenshots\agents-phone-dark.png`

## Not Verified
- Live end-to-end execution of an actual Claude Code CLI session in `~/.canopy-worker/` against the production hub / Cloudflare Access domain (verified via automated integration tests, hook payload transformations, and preview hub on `:8811`).
