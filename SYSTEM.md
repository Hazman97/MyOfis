# Agent Office — system overview (2026-10-17)

This document gives another AI or reviewer the whole system in one read, so they can suggest improvements. The detailed spec is in [SPEC.md](SPEC.md). Decisions and status are in [CLAUDE.md](CLAUDE.md).

## 1. What it is

Agent Office is a **personal "office" of AI agents** for one owner: a solo developer in Malaysia who runs small web products and a camera-rental business.

- **Agents** are workers. Each has:
  - a role, a system prompt and an LLM;
  - a list of tools and a pixel-art character.
- **The owner gives them work** in several ways:
  - jobs;
  - chat;
  - schedules (cron);
  - events, such as a merged PR.
- **Watching and approving.** The owner watches the agents walk around a 2D pixel office. Risky actions wait for his approval in the browser or on Telegram.
- **Ownership.** Everything is self-hosted, single-user and local-first. The hub runs on the owner's PC. Runners can run on other machines.

**Main goals**
1. Do real work with minimal babysitting: fix bugs and open PRs, run smoke tests, write the morning health report, write marketing copy, and practise English with the owner.
2. Be safe:
   - no secrets leaked;
   - no work outside the workspace;
   - risky actions approved first;
   - content the agents read is treated as DATA, not instructions.
3. Be fun and legible: the office view shows what every agent is doing right now.

**Hard constraints from the owner**
- **No Docker, anywhere.**
- He commits by hand.
- The UI talks to him in Malay/Manglish; code and docs are in English.

## 2. Architecture

```
 Browser (Vue 3 + Phaser office)          Telegram bot (long polling)
        │  HTTP + WebSocket (events)              │
        ▼                                         ▼
 ┌──────────────────────── HUB (Bun + Hono, :8788) ─────────────────────────┐
 │ SQLite (Drizzle) · event store (append-only) · shared reducer → state    │
 │ scheduler (cron) · approvals · budgets · ReleaseWatcher (polls Gitea)    │
 │ Content (briefs/drafts/feature log) · Learning (memory/skills/FTS5)      │
 │ auth: token or Cloudflare Access JWT · secrets AES-256-GCM               │
 └───────────────▲──────────────────────────────────────────────────────────┘
                 │ WebSocket, sequenced messages (run.assign / run.event / ...)
 ┌───────────────┴────────── RUNNER (Bun daemon, 1..n machines) ─────────────┐
 │ per-run workspace folder · runtimes: ai-sdk (Vercel AI SDK v7) | opencode │
 │ | mock · tools (packages/tools) via runTool() · Node worker for Playwright│
 └───────────────────────────────────────────────────────────────────────────┘
```

**Monorepo (Bun workspaces)**

| Path | What |
|---|---|
| `apps/hub` | API, event store, scheduler, approvals, Telegram, Gitea polling, learning |
| `apps/runner` | Pairs with the hub, executes runs, holds provider keys in memory only |
| `apps/web` | Vue 3 + Tailwind 4 SPA and the Phaser 3 office (pure "brain" + thin scene) |
| `packages/shared` | Zod schemas, events, protocol, **pure reducer** (shared by hub and web), memory/skills helpers |
| `packages/tools` | Every tool an agent can call, plus `runTool()` (validate → risk → approval → execute → events) |
| `packages/agents` | Built-in agent definitions (prompts, tools, schedules) |
| `maps/` | Office art generated from code (Tiled map + atlases) |
| `projects/<slug>/brief.yaml` | Marketing briefs per product |
| `skills/<name>/SKILL.md` | Approved skills (Hermes / agentskills.io format) |
| `tasks/gemini/` | UI tasks the owner relays to Gemini; Claude reviews them |

**Event sourcing.**
- Every change is an event in `events`, with an autoincrement id.
- UI state comes only from `reducer(state, event)`.
- The web client replays the events over WebSocket with `since=`.
- Replay mode (`/replay`) rebuilds the office for any time window.

**Event types (24)**
- Jobs: `job.created`, `job.queued`, `job.cancelled`.
- Runs: `run.started`, `run.finished`, `run.failed`.
- Agent activity: `agent.thinking`, `agent.message`, `agent.tool_call`, `agent.tool_result`, `agent.needs_approval`, `agent.handoff`, `agent.idle`.
- Approvals and artifacts: `approval.decided`, `artifact.created`.
- Runners and system: `runner.online`, `runner.offline`, `system.paused`, `budget.exceeded`.
- Marketing: `draft.created`, `draft.decided`, `feature.released`.
- Learning: `skill.proposed`, `skill.decided`.

**Database tables**
- Core: `events`, `jobs`, `runs`, `agents`, `providers`, `runners`, `pairing_codes`, `approvals`, `schedules`, `projects`, `settings`.
- Marketing: `feature_log`, `content_drafts`.
- Learning: `proposals`, `agent_memory` (legacy), `search_index` (FTS5).

## 3. Agents (built in)

| Agent | Role | Typical trigger | Key tools |
|---|---|---|---|
| **Coder** | Fix issues, open PRs | Job / Gitea issue | OpenCode runtime (`opencode serve` per run) or git_* + edit tools; push and PR are done by our code, never by the LLM |
| **Tester** | Nightly smoke tests, feature screenshots | Schedule, `feature.released` | browser_check (Playwright in a Node worker), http_check, write_report |
| **Pak Guard** | Morning DevOps health report | Schedule 08:00 | system_metrics, http_check, gitea_ci_status, write_report |
| **Marketing** | Copy per product, writing-style analysis, posts in that style, release announcements | Job, weekly schedule (off), `feature.released` | read_brief, read_feature_log, read_past_drafts, save_draft, learning tools |
| **Coach** | English speaking practice (mic + read-aloud in the browser) | Chat | learning tools |
| **Echo** | Summariser / test agent | Job | — |

The owner can create more agents in the UI. Each one picks:
- a provider and model;
- tools;
- `shell_allowlist`, `read_paths`, `http_allowlist`, `max_steps`;
- `runtime`;
- `self_review`;
- a daily token budget.

`handoff` lets an agent pass work to another agent. It is one-way: the first agent does not wait for an answer.

**Providers**
- Anthropic, OpenAI, Google, any OpenAI-compatible provider (e.g. the owner's `canopy-ai` server, OpenRouter), and `mock` for tests.
- Keys are encrypted at rest and are never sent to the browser.

## 4. Tools (31)

| Group | Tools |
|---|---|
| Files | `read_file`, `write_file`, `edit_file`, `list_dir` |
| Shell | `run_command` (argv only, allowlist, scrubbed env) |
| Git | `git_clone`, `git_status`, `git_branch`, `git_diff`, `git_commit`, `git_push` |
| Gitea | `gitea_list_issues`, `gitea_comment`, `gitea_create_pr`, `gitea_ci_status` |
| Web checks | `http_check`, `browser_check` |
| Ops | `system_metrics`, `write_report` |
| Team | `handoff` |
| Marketing | `read_brief`, `read_feature_log`, `read_past_drafts`, `save_draft` (self-check, blocks `do_not` phrases and copies of examples), `add_feature_note` |
| Learning (Hermes-style) | `memory`, `session_search`, `skills_list`, `skill_view`, `skill_manage`, `remember` (legacy alias) |

Each tool returns a risk level: `safe`, `review` or `dangerous`. Together with the agent's permission level, that decides whether the call waits for the owner's approval. Approvals can be decided in the web app or with Telegram buttons (HMAC-signed callback data).

## 5. Features by phase

- **Phase 1 – core loop**
  - hub, runner pairing, jobs → runs, live event stream;
  - approvals, providers, mock provider.
- **Phase 2 – real agents**
  - the AI SDK runtime and the tools;
  - OpenCode for Coder;
  - workspaces;
  - Gitea integration (faked until the owner installs Gitea);
  - schedules, morning report, nightly tests.
- **Phase 3 – office**
  - design system (light and dark);
  - Phaser pixel office drawn in code: characters walk to zones (desk, meeting, library…) according to the latest event; catch-up within 2 s; integer zoom; 30 fps when blurred.
- **Phase 4 – business work**
  - per-project briefs (YAML), the drafts inbox (approve / edit / reject with feedback), the feature log and FEATURES.md;
  - Marketing style analysis; an approved `style_guide` becomes the brief's `style_notes`;
  - Gitea polling for merged PRs → feature note → Tester screenshot + Marketing announcement drafts;
  - chat with any agent (chat messages are jobs, hidden from the Board);
  - English Coach;
  - Telegram notifications, approvals, `/status`;
  - daily token budgets.
- **Phase 5 – reach**
  - Cloudflare Tunnel + Access login (JWT verified with `jose`);
  - remote runners with Access service tokens;
  - replay mode.
- **Phase 4.5 – learning (Hermes Agent style)**
  - **Memory:** two bounded stores injected as a frozen snapshot at run start:
    - `MEMORY` per agent (2200 characters);
    - `USER PROFILE` shared by all agents (1375 characters).
    - `memory` tool actions: add, patch, remove, and atomic multi-op consolidation when a store is full.
    - Writes are scanned for prompt injection, invisible unicode and secrets.
    - Optional `write_approval` stages memory writes for the owner.
  - **Skills:** SKILL.md files with frontmatter (agentskills.io / Hermes format).
    - Progressive disclosure: the prompt holds only the index; `skill_view` loads one skill.
    - Agents propose create/patch/delete with `skill_manage`; the owner approves in an inbox with a diff and warnings for risky content.
    - The owner can import a SKILL.md (e.g. from Hermes).
  - **session_search:** SQLite FTS5 over past runs and chats (title + task + answer), scoped to the agent or the whole office.
  - **Background review:** after a big run (5+ tool calls) or every 5th chat message, a short extra LLM pass with only the learning tools asks "anything worth saving?". Its tokens count toward the budget.
  - Web: the Skills page (`/skills`: inbox with diff, library, import, memory-approval switch) and the Memory section in the agent panel (edit, remove, add).

## 6. Safety model

- Content from files, the web, issues or command output is DATA. This rule is in every system prompt and also applies to memory and skills.
- **Workspace isolation.** One folder per run. Path guards block `..`, absolute paths outside the workspace and secret files (`.env`, keys).
- **Shell.** No shell interpreter; argv only, a per-agent allowlist and a scrubbed environment.
- **Approvals.** Risky tools wait for the owner. A global pause stops everything.
- **Secrets.** Encrypted at rest, held in runner memory only, redacted from events.
- **Learning writes.** Skills always need approval; memory writes need approval when `write_approval` is on.
- **Auth.** Owner token locally, or Cloudflare Access (email must equal `OWNER_EMAIL`).
- Git push and PR creation are code-controlled, never decided by the LLM.

## 7. Quality

- 193 tests (`bun test`), strict TypeScript across all workspaces, Vite build.
- Acceptance tests run the whole loop with the mock provider and a fake Gitea.
- Screenshot check: `apps/web/scripts/shots.mjs`.
- The office "brain" and replay are pure and unit-tested.

## 8. Known gaps and weak spots (good places to suggest improvements)

1. **Agents cannot ask each other and wait.** `handoff` is fire-and-forget; there is no "consult" tool that blocks until another agent answers.
2. **No research agent.** There is no web search or fetch tool for a Researcher; agents only know what is in their prompt, brief, memory and skills.
3. **Single owner, single office.** No multi-user, no roles, no audit export.
4. **Gitea not installed yet.** All Gitea flows (Coder PRs, release watcher) are tested only against a fake.
5. **Isolation without Docker.** The current safety rests on path guards plus the allowlist. A low-privilege OS user for the runner was discussed but not built.
6. **Cost visibility.** Token budgets exist per agent per day; there is no per-provider price table or cost dashboard.
7. **Memory/skills quality.** No evaluation of whether saved memories or skills actually improve results; no automatic expiry of stale memory; FTS search is keyword-only (no embeddings).
8. **Publishing.** Drafts are never posted automatically (by design); the owner copies them by hand. There is no integration with Facebook, TikTok or WhatsApp.
9. **3D / creative work** (OpenSCAD or Blender scripts) was discussed but not built.
10. **Observability.** Events and the run timeline exist; there is no tracing (e.g. Langfuse) and no error alerting beyond Telegram.
11. **Backups.** SQLite plus the `projects/` and `skills/` folders. There is no backup or restore command.
12. **Mobile.** The web app is responsive, but there is no PWA or offline mode. Telegram is the mobile channel.

## 9. Questions to ask a reviewer

- What would make this more useful day to day for a solo dev and small business owner?
- Which gaps above matter most, and what is the simplest design for each?
- Is the safety model enough for agents that push code and run shell commands without Docker?
- How should agent memory and skills be measured, so that we know learning actually helps?
- What would you remove or simplify?

## 10. How to run

```
bun install
bun run dev          # hub :8788 + web :5180
bun run dev:runner   # runner daemon (pair it in the web app → Runners)
bun test             # all tests
bun run typecheck
```

Configuration is in `.env` (see `.env.example`): `SECRETS_KEY`, `OWNER_TOKEN` / `AUTH_MODE`, `PROJECTS_DIR`, `SKILLS_DIR`, Telegram settings, and Cloudflare Access settings.
