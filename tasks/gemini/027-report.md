# Task 027 Report — Owner Assistant Service Token (`SECURITY-SENSITIVE`)

> [!IMPORTANT]
> **Security-Sensitive Change (AGENTS.md Rule #13):** This task modifies `AUTH_MODE=cf-access` authentication (`apps/hub/src/auth.ts`) and adds a scoped assistant actor (`via: "service_token"`, `actor: "assistant"`). No path works without a valid RS256 Cloudflare Access JWT verified against the team JWKS, issuer, and AUD.

## Changed Files
- `.env.example` — Documented `OWNER_SERVICE_TOKENS` (comma-separated Cloudflare Access Service Token client IDs; empty = off).
- `apps/hub/src/env.ts` — Added `OWNER_SERVICE_TOKENS` to `EnvSchema` and parsed `cfAccess.ownerServiceTokens`.
- `apps/hub/src/auth.ts` — Extended `Identity` with `via?: "service_token"` and `actor?: "assistant"`; matched `payload.common_name` via constant-time `safeEqual` when `payload.email` is absent after mandatory `jwtVerify()`; added single-place `ASSISTANT_DENY_RULES`, `isAssistantDenied()`, `assertAssistantAgentPatch()`, and `assistantGuard` middleware.
- `apps/hub/src/http.ts` — Mounted `assistantGuard` on `/api/*`, enforced `assertAssistantAgentPatch` on `PATCH /api/agents/:id`, restricted `POST /api/jobs/:id/cancel` and `POST /api/runs/:id/cancel` to jobs started by the assistant, stamped `created_by: "assistant"` on jobs/chats started by the assistant, and returned `assistant: { enabled, tokens }` on `GET /api/settings/integrations`.
- `apps/hub/src/core.ts` & `apps/hub/src/repo.ts` — Propagated `created_by: "assistant"` into `job.created` events and `toJob()`.
- `packages/shared/src/entities.ts`, `packages/shared/src/events.ts`, `packages/shared/src/reducer.ts` — Added optional `created_by?: "owner" | "assistant"` to `Job`, `job.created`, and `JobView`.
- `apps/web/src/api/http.ts`, `apps/web/src/views/IntegrationsView.vue`, `apps/web/src/views/DashboardView.vue`, `apps/web/src/views/ChatView.vue` — Displayed `"Assistant access: on (token …last6)"` in Settings → Integrations and `"🤖 Claude"` chip on assistant-created jobs and chat messages.
- `apps/hub/test/assistant-auth.test.ts` — Added 3 test suites (185 assertions) covering JWT verification edge cases, every deny-list route, and every allowed assistant route.

## Every Route on the Deny List (`403` for `actor: "assistant"`)

| Category | Denied Routes |
|---|---|
| Members | `GET /api/members`, `POST /api/members`, `PATCH /api/members/:id`, `PUT /api/members/:id/shares` |
| Rooms & Moving | `POST /api/rooms`, `PATCH /api/rooms/:id`, `PUT /api/rooms/:id/members`, `POST /api/agents/:id/move`, `POST /api/projects/:id/move` |
| Kill Switch / Pause | `POST /api/settings/pause` |
| Integrations & Secrets | `GET /api/settings/integrations`, `PUT /api/settings/integrations/web-search`, `POST /api/settings/integrations/web-search/test`, `PUT /api/settings/integrations/telegram`, `POST /api/settings/integrations/telegram/test`, `PUT /api/settings/integrations/gitea`, `POST /api/settings/integrations/gitea/test` |
| Social Connections (Zernio/TikTok) | `GET /api/social-accounts`, `POST /api/social-accounts/zernio`, `POST /api/social-accounts/:id/refresh`, `PATCH /api/social-accounts/:id`, `DELETE /api/social-accounts/:id` |
| Project Publish & Social Secrets | `GET /api/projects/:id/publish`, `PUT /api/projects/:id/publish`, `POST /api/projects/:id/publish/test`, `GET /api/projects/:id/facebook`, `PUT /api/projects/:id/facebook`, `POST /api/projects/:id/facebook/test`, `GET /api/projects/:id/tiktok`, `PUT /api/projects/:id/tiktok`, `POST /api/projects/:id/tiktok/test`, `GET /api/projects/:id/instagram`, `POST /api/projects/:id/instagram/connect`, `PUT /api/projects/:id/instagram`, `GET /api/projects/:id/threads`, `PUT /api/projects/:id/threads` |
| Memory Write-Approval Toggle | `PUT /api/memory/settings` |
| Providers (Write / Scan / Models / Check) | `POST /api/providers`, `PATCH /api/providers/:id`, `DELETE /api/providers/:id`, `POST /api/providers/:id/models`, `POST /api/providers/:id/test`, `POST /api/providers/:id/scan`, `POST /api/providers/check` |
| Runners Pairing & Revoke | `POST /api/runners/pairing-code`, `POST /api/runners/:id/revoke` |
| Backups & Local Folder Open | `GET /api/backups`, `POST /api/backups`, `POST /api/storage/open` |
| Skills Install / Import / Delete / Assign | `GET /api/skills/catalog`, `POST /api/skills/catalog/install`, `POST /api/skills`, `DELETE /api/skills/:name`, `PUT /api/skills/:name/agents`, `PUT /api/agents/:id/skills`, `POST /api/proposals/:id/decide` |
| Draft Approval / Publish / Schedule / Takedown | `POST /api/drafts/:id/decide`, `POST /api/drafts/:id/publish`, `POST /api/drafts/:id/schedule`, `PATCH /api/drafts/:id/account`, `POST /api/drafts/:id/update-published`, `POST /api/drafts/:id/take-down` |
| Tool Approval (`review`/`dangerous`) | `POST /api/approvals/:id/decide` |
| Agent Create / Delete / External Token | `POST /api/agents`, `DELETE /api/agents/:id`, `POST /api/agents/:id/external-token` |
| Restricted Agent Patch Fields | `PATCH /api/agents/:id` when body contains `provider`, `runner_id`, `tools`, `permission_level`, or changes `config.auto_publish`, `config.clip_folder`, `config.runtime`, `config.external` |
| Cancelling Owner's Jobs / Runs | `POST /api/jobs/:id/cancel` and `POST /api/runs/:id/cancel` when `job.input.created_by !== "assistant"` |

## Every Route Left Allowed for the Assistant

| Category | Allowed Routes |
|---|---|
| Identity & Read State | `GET /api/auth/me`, `GET /api/state`, `GET /api/events`, `GET /api/settings`, `GET /api/rooms`, `GET /api/system`, `GET /api/storage`, `GET /api/tools`, `GET /api/opencut`, `GET /api/manual`, `GET /api/office/assets/:name` |
| Chat & Jobs | `POST /api/chat`, `GET /api/chat/threads`, `GET /api/chat/threads/:id`, `GET /api/jobs`, `POST /api/jobs`, `POST /api/jobs/:id/cancel` *(only jobs created by `"assistant"`)* |
| Runs & Artifacts | `GET /api/runs`, `GET /api/runs/:id`, `POST /api/runs/:id/cancel` *(only runs of jobs created by `"assistant"`)*, `GET /api/artifacts/:runId/:name` |
| File Uploads & Videos | `POST /api/uploads`, `PUT /api/uploads/parts/:key`, `GET /api/uploads/:id`, `GET /api/videos`, `GET /api/videos/:id`, `POST /api/videos/:id/transcribe`, `GET /api/tiktok-hd`, `POST /api/videos/:id/tiktok-hd`, `POST /api/videos/:id/render`, `PATCH /api/drafts/:id/video` |
| Agents & Memory | `GET /api/agents`, `GET /api/agents/:id`, `PATCH /api/agents/:id` *(prompts/role/budget/non-sensitive config only)*, `GET /api/agents/:id/memory`, `PUT /api/agents/:id/memory/:target`, `GET /api/memory/settings` |
| Projects, Docs & Log | `GET /api/projects`, `POST /api/projects`, `PATCH /api/projects/:id`, `GET /api/projects/:id/brief`, `PUT /api/projects/:id/brief`, `GET /api/projects/:id/features`, `POST /api/projects/:id/features`, `GET /api/docs`, `POST /api/docs`, `GET /api/docs/search`, `GET /api/docs/:id/text`, `GET /api/log`, `POST /api/log`, `PATCH /api/log/:id` |
| Read-only Drafts, Approvals, Skills, Providers, Runners, Schedules | `GET /api/drafts`, `GET /api/approvals`, `GET /api/skills`, `GET /api/skills/assignments`, `GET /api/proposals`, `GET /api/providers`, `GET /api/providers/presets`, `GET /api/runners`, `GET /api/schedules`, `POST /api/schedules`, `PATCH /api/schedules/:id`, `DELETE /api/schedules/:id`, `POST /api/schedules/:id/run-now` |

## Commands Run
- `bun test apps/hub/test/assistant-auth.test.ts` → `3 pass, 0 fail, 185 expect() calls`
- `bun run typecheck` → Exit 0
- `bun run --cwd apps/web build` → Exit 0

## What I Did NOT Do or Could Not Check
- Live Cloudflare Access tunnel token verification against `myofis.cloudflareaccess.com` (tested using a local RS256 JWKS server in `apps/hub/test/assistant-auth.test.ts`).

