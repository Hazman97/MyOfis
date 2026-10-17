# Agent Office — working notes for AI agents

- The full product spec is in [SPEC.md](SPEC.md). Read it before starting any phase. Build one phase at a time; wait for the owner to confirm before moving on.
- Talk to the owner in casual Manglish. Code, comments and docs stay in English.
- Owner commits manually — do not `git commit` unless asked.

## Decisions taken beyond the spec (Phase 1)
- Repo root is this folder (not `agent-office/`). Packages are `@agent-office/*`.
- Extra tables: `providers` (owner can add custom LLM providers; presets listed first, "Custom (OpenAI-compatible)" last) and `pairing_codes`.
- Provider API keys are encrypted at rest with `SECRETS_KEY` (AES-256-GCM), never sent to the browser, sent to paired runners inside `run.assign` and held in memory only.
- `events.id` is an autoincrement integer (monotonic, used by `since=`). Other IDs are ULIDs.
- The reducer in `packages/shared/src/reducer.ts` is pure and shared by hub and web. Never derive UI state from anything but events.
- A `mock` provider exists so the whole loop runs without API keys (also used by tests).

## Decisions taken beyond the spec (Phase 2)
- Owner chose **Vercel AI SDK + our own tools** for all agents (overrides spec §2 "Claude Agent SDK for tool-heavy agents"). Tools live in `packages/tools`; every call goes through `runTool()` (validate → risk → approval → execute → events).
- `agents.config` (migration 0001): per-agent `shell_allowlist`, `read_paths`, `http_allowlist`, `max_steps`.
- Shell commands run without a shell (argv) with a scrubbed env — the runner auto-loads `.env`, so child processes must never inherit it.
- **No Docker, anywhere.** Owner does not want Docker: no docker-compose, no container sandbox. This drops spec §7.8 / Phase 5 "optional Docker sandbox". Safety relies on workspace isolation + path/secret guards + shell allowlist + approvals. Any future isolation must be non-Docker (e.g. a low-privilege OS user for the runner) and asked about first.
- **Playwright does not work under Bun on Windows** (launch hangs; connectOverCDP times out). Browser checks run in a small **Node** worker (`packages/tools/browser/worker.mjs`) spawned by the runner. Runner machines need Node ≥ 22.
- **OpenCode (opencode.ai) is the planned brain of the Coder agent** (owner decision). Runner starts `opencode serve` per run in the workspace; OpenCode permissions are generated from the agent's settings; its "ask" permissions become Agent Office approvals; git push + PR are done by our own code after OpenCode finishes, never by the LLM. Installed via `npm install -g opencode-ai`. Probe script: `apps/hub/scripts/opencode-probe.ts`.
- OpenRouter is configured as a provider (key encrypted in the hub). Free `:free` models are often HTTP 429 (shared upstream pool); `nvidia/nemotron-3-super-120b-a12b:free` worked on 2026-10-16.
- **Use `freshFetch` (packages/shared/src/net.ts) for any call that can come after a long gap**: runner→hub, runner→OpenCode, LLM calls, Gitea. Bun's fetch can reuse a keep-alive socket the server already closed and then wait forever (found in the acceptance test; owner approvals take minutes).
- On Windows, stop child processes with `killTree` (taskkill /T) and wait for exit before deleting their folders (EBUSY otherwise). npm's `opencode` is a launcher; `resolveOpenCode()` finds the real `opencode.exe`.
- The mock provider stays in code for tests only; in the owner's DB it is disabled and agents use real providers (canopy-ai, OpenRouter).
- Gitea is faked in tests until the owner sets one up. Projects get a minimal CRUD in Phase 2 (briefs stay Phase 4).

## Decisions taken beyond the spec (Phase 3)
- **Office art is our own, drawn in code** (owner decision: no licence risk, swappable later). `apps/web/src/office/art/` → `bun run --cwd apps/web office:assets` writes `maps/` (Tiled `office.tmj`, `tiles.png`, character/prop atlases, `preview.png`). A test fails if `maps/` drifts from the code. The hub serves `maps/` at `/api/office/assets/:name` (`MAPS_DIR`), so art swaps need no rebuild.
- The office is driven only by reducer output: `AgentView` gained `thinking` and `moment` (handoff / delivered / failed / pr_opened, tagged with the event id). `apps/web/src/office/brain/` (pure, tested) turns state into characters; `office/scene/game.ts` (Phaser, lazy chunk) only draws. Keep logic out of the scene.
- Catch-up rule: every change replans; the first step must arrive within `CATCH_UP_MS` (2 s), and walking speeds up to make it. Older moments are dropped. `REACTIONS` in `brain/reactions.ts` lists what each event type shows; keep it in sync when adding events.
- Integer zoom only (pixel-perfect); the default rounds up when ≥ 60% of the next step fits, then you pan. 30 fps when the window is blurred (Phaser `fps.limit` + `_limitRate` toggled), paused when hidden (Phaser default).
- The design system lives in `apps/web/src/style.css` (tokens + `@theme inline`; light + dark). Screenshot check: `node apps/web/scripts/shots.mjs` (Node + Playwright; set `MSYS_NO_PATHCONV=1` when calling from Git Bash).

## Commands
- `bun install` — install
- `bun run dev` — hub + web (Vite on :5180 proxies to hub on :8787)
- `bun run dev:runner` — runner daemon
- `bun test` — all tests
- `bun run typecheck` — strict TS across workspaces
- `bun run db:generate` — regenerate Drizzle migration after editing `apps/hub/src/db/schema.ts`
