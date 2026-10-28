# Task 025: external agents in the office (watch outside AI workers live)

Read `tasks/gemini/SUPERVISOR.md` first. Write `tasks/gemini/025-report.md`. Do not commit.

## Why
Claude (supervisor) now hands small coding tasks to "canopy workers": Claude Code processes running on the owner's
PC but powered by canopy-ai (Qwen on AWS), each in its own git worktree (`~/.canopy-worker/`). The owner cannot
see what they do. He wants them **in the 3D office** like the built-in agents: walk to a desk when they start,
type while using tools, thought bubbles, success/failure moments, and progress in the Work Feed. Later the same
route can show other outside agents (Gemini CLI, Hermes).

The office is driven only by reducer output (`packages/shared/src/reducer.ts`, `apps/web/src/office/brain/`),
so outside workers must produce **the same events** built-in runs produce (job/run lifecycle, `agent.thinking`,
`agent.tool_call`, `agent.tool_result`, run done/failed). Do not touch the 3D/pixel scene code.

## Build
1. **External agents (hub):** an agent with `kind: "external"` (or an equivalent flag in `AgentConfig`, pick the
   least invasive with a migration only if needed): no provider/model, never dispatched to a runner, never
   seeded. Owner-only routes: create/delete like other agents, plus `POST /api/agents/:id/external-token` →
   shows a random token **once** (store only its hash, like runner tokens).
2. **Activity route** (no Cloudflare Access user needed: the caller runs on the hub PC and calls
   `http://127.0.0.1:8788`; it must also work through the domain with the token):
   `POST /api/external/activity` with `Authorization: Bearer <token>` and JSON
   `{session_id, event: "start"|"thinking"|"tool"|"tool_result"|"done"|"failed", title?, tool?, input_summary?,
   ok?, summary?, output?}`.
   - `start` → a job (`type: "external"`, title, owner workspace) and a run in state running, attributed to the
     agent, `runner_id` null or a fixed pseudo-runner (decide; the Runners page must not list it as a machine).
   - `thinking`/`tool`/`tool_result` → the existing event types with the summaries (truncate to the same limits as
     runner events; never store file contents, only short summaries).
   - `done`/`failed` → finish the run/job with `output`/error like a normal run.
   - Unknown `session_id` on a non-start event → start it implicitly with title "(external work)".
   - A session with no activity for 30 min is failed with "lost contact" by the existing `sweep()`.
   - Rate limit per token (e.g. 20 events/s), body ≤ 16 KB, all strings length-capped. Same workspace scoping and
     event `workspace_id` rules as other events.
3. **Web:** external agents show in the office with a distinct look (pick an existing outfit + a small "AWS" or
   "external" tag on the label) and in Agents (read-only card with the token button). Chat/New job must not offer
   them. Keep UI changes small (logic first; style follows `docs/FRONTEND.md` if present, else existing components).
4. **Reporter script** `scripts/external-agent-hook.ts` (Bun, no deps): reads a Claude Code hook payload from stdin
   (SessionStart, PreToolUse, PostToolUse, Stop; see Claude Code hooks docs for the JSON fields) and POSTs the
   matching activity to `$MYOFIS_URL/api/external/activity` with `$MYOFIS_EXTERNAL_TOKEN`. It must never block or
   fail the worker: 2 s timeout, swallow errors, exit 0. Summaries: tool name + a short safe description (file path
   or command name), never file contents or secrets. Document in `docs/external-agents.md` the `settings.json`
   hooks block to install it (Claude installs it in `~/.canopy-worker/config/settings.json`).

## Tests
Hub test: token creation/hash, auth (no token, wrong token, another agent's token), full session start → tool →
done produces the expected events and job/run states, implicit start, 30-min sweep, rate limit, body limit,
workspace isolation. Reducer test if you add any field. Unit tests for the hook script's payload mapping
(fixtures of each hook type).

## Check
`bun run typecheck`, full `bun test`, `bun run --cwd apps/web build`. Screenshots (preview hub, see CLAUDE.md) of
the office with an external agent mid-task, desktop + 390 px.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, then do `tasks/gemini/025-external-agents-in-office.md`.
> Write `tasks/gemini/025-report.md` when done. Do not commit.
