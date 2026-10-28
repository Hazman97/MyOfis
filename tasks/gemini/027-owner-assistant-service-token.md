# Task 027: let one Cloudflare service token act for the owner (Claude's test access) — SECURITY-SENSITIVE

Read `tasks/gemini/SUPERVISOR.md` first. Write `tasks/gemini/027-report.md`. Do not commit.
**This changes authentication. Claude will review every line. Keep it minimal.**

## Why
The owner (2026-10-28, explicit "ya") wants Claude to run tests (chat jobs, uploads, reading runs) **in the real
MyOfis** so he can watch them in his office, instead of a separate preview hub. Today `AUTH_MODE=cf-access`
(`apps/hub/src/auth.ts`) accepts only a Cloudflare Access JWT whose `email` is `OWNER_EMAIL` (or an enabled
member). A Cloudflare Access **service token** `myofis-aws-runner` already exists and the myofis Access app has a
**Service Auth** policy for it (used by the AWS runner). Requests made with that token reach the hub with a
`Cf-Access-Jwt-Assertion` JWT that has **no email** but a `common_name` = the token's client ID.
Do NOT add any path that works without Cloudflare (no localhost bypass: that was refused before).

## Build
1. Env `OWNER_SERVICE_TOKENS` (comma-separated client IDs, e.g. `xxxx.access`); empty/unset = feature off
   (default). Documented in `.env.example`.
2. In `identify()` (cf-access mode only): after the **existing** JWT verification (RS256, issuer, AUD — unchanged
   and still mandatory), if the token has no `email` and its `common_name` is exactly one of `OWNER_SERVICE_TOKENS`,
   return the owner identity with a marker `via: "service_token"` and `actor: "assistant"`. Anything else behaves
   exactly as today. Check Cloudflare's docs for the exact claim name for service tokens and test both the claim
   present/absent and a different client ID.
3. **Deny list for the assistant** (403 even though it is the owner): members (`/api/members*`), rooms
   create/update/members, integrations/settings that store secrets (Telegram, web search keys, social accounts,
   Zernio, Facebook/Threads/TikTok connections, publish secrets), providers create/update/delete and model scans
   that store keys, runners pairing-code/revoke, backups, `storage/open`, `pause`, skill import/catalog install,
   approving drafts that publish, and approvals of `review`/`dangerous` tool calls. It MAY: create chat jobs and
   jobs, upload files, read state/events/runs/drafts/uploads/videos, cancel runs it started, edit agent prompts/
   config **except** `auto_publish`, `runner_id`, tools, provider keys. Implement as one small middleware with the
   list in one place, tested route by route.
4. **Visible and auditable:** every request by the assistant is logged in the hub log with method + path (no
   bodies), events/jobs it creates carry `created_by: "assistant"` (or equivalent) so the UI can show a small
   "🤖 Claude" chip on those jobs/chats, and Settings → Integrations shows "Assistant access: on (token …last6)".
5. Telegram: when the assistant starts a job, nothing new is sent (avoid noise) unless the job itself reports.

## Tests (apps/hub/test, cf-access test helpers already exist in members.test.ts)
Owner email JWT unchanged; service token with configured client ID → owner+assistant; unknown client ID → 401;
missing/invalid signature/wrong AUD → 401 (unchanged); feature off when env empty; every deny-list route → 403 for
the assistant and allowed for the owner; jobs created by the assistant carry the marker; no request without a
valid Access JWT ever passes.

## Check
`bun run typecheck`, full `bun test`, `bun run --cwd apps/web build`. In the report, list every route you put on the
deny list and every route you left allowed for the assistant, so Claude can review them one by one.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, then do `tasks/gemini/027-owner-assistant-service-token.md` (security-sensitive:
> keep it minimal, list every allowed/denied route in the report). Write `tasks/gemini/027-report.md`. Do not commit.
