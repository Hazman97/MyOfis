# Agent Office

A personal AI agent orchestration system for a single owner. You create agents, give them jobs, approve risky actions, and watch them work in a pixel-art office. The full spec is in [SPEC.md](SPEC.md).

**Status: Phase 5 done: every phase of the spec is built (Phases 4 and 5 await the owner's sign-off).**
- **Exposure (Phase 5):**
  - `AUTH_MODE=cf-access` (Cloudflare Access JWT verified against your team and email);
  - a Cloudflare Tunnel guide, and runners on other machines through the tunnel ([docs/cloudflare-tunnel.md](docs/cloudflare-tunnel.md));
  - **Replay** of past runs in the office at 1x/4x/16x;
  - **agent memory** (agents keep short notes across runs; you can delete them).
- **Marketing + chat (Phase 4):**
  - project briefs, a Marketing agent that writes drafts (it never posts), and a drafts inbox where your edits and feedback become its style memory;
  - the feature log (merged PR → Coder's note → Tester screenshot + Marketing announcements);
  - chat with any agent, including an **English Coach** for speaking practice;
  - Telegram approvals and reports, and daily token budgets.
- **Office view (Phase 3):** a pixel-art office (Phaser) where each agent is a character that walks, sits, types, raises a hand for approvals and carries finished work to your desk. Click a character to see its job, live log and budget. The rest of the app was redesigned at the same time.
- **Agents (Phase 2):** Pak Guard (health report), Tester (real-browser smoke tests, screenshots, visual diff) and Coder (OpenCode → branch → PR), with tool permissions, approvals, handoffs, schedules and projects.
- **Acceptance tests:**
  - `apps/hub/test/acceptance.test.ts` (Phase 2): the nightly Tester finds a broken page and hands off to Coder. Coder opens a PR on a branch, and a dangerous command waits for approval.
  - `apps/hub/test/acceptance-phase4.test.ts` (Phase 4): a merged PR produces a feature note, a Tester screenshot and Marketing drafts, all waiting for you.

```
 browser ──HTTP + WS (same origin)──▶ hub (Hono + Bun, SQLite) ◀──WS (runner dials out)── runner(s)
                                       └ append-only events → shared reducer → UI state
```

## Requirements

- [Bun](https://bun.com) 1.3+ (Windows, macOS or Linux)

## Setup

```sh
bun install
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
```

Edit `.env` and set these two values, at minimum:

- `LOCAL_AUTH_TOKEN`: the password you type in the web UI (12+ random characters).
- `SECRETS_KEY`: encrypts provider API keys at rest (32+ random characters). If you change it later, you must re-enter your API keys.

To generate random values: `bun -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`

> **Port clash:** `wrangler dev` also defaults to port 8787. If you use both, set `HUB_PORT=8788` (and `PUBLIC_BASE_URL` to match). For Vite in dev, also set `HUB_DEV_URL=http://127.0.0.1:8788`.

## Run

**Development (hot reload):**

```sh
bun run dev           # hub on :8787 + Vite on http://127.0.0.1:5180 (open this)
```

**Production-ish:**

```sh
bun run build         # builds apps/web/dist
bun run start:hub     # hub serves the UI on http://127.0.0.1:8787
```

The hub binds to `127.0.0.1` only. Never expose it directly. For access from your phone or other machines, put it behind Cloudflare Tunnel + Access: [docs/cloudflare-tunnel.md](docs/cloudflare-tunnel.md).

## Pair a runner

The runner is a separate process that **connects out** to the hub, so no inbound ports are needed. It runs the same way on this PC or on another machine.

1. In the web UI, open **Runners** and click **New pairing code**. Codes are single-use and expire after 10 minutes.
2. From the repo root on the machine that should do the work:

   ```sh
   HUB_URL=http://127.0.0.1:8787 RUNNER_NAME=main-pc PAIRING_CODE=XXXX-XXXX bun run start:runner
   ```

   ```powershell
   $env:HUB_URL="http://127.0.0.1:8787"; $env:RUNNER_NAME="main-pc"; $env:PAIRING_CODE="XXXX-XXXX"; bun run start:runner
   ```

3. The runner stores its long-lived token in `data/runner-state.json`. Later starts only need `bun run start:runner` (or `bun run dev:runner`).

You can revoke a runner from the Runners page. Each run gets its own folder under `workspaces/<agent>/<run_id>/`.

## Add a provider (LLM)

Open **Providers** and pick a preset: Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, DeepSeek, Ollama, LM Studio, or **Custom (OpenAI-compatible)**.

- API keys are encrypted on the hub and never sent back to the browser. The hub passes the key to the paired runner only for the duration of a run.
- Built-in prices exist for Claude models. For other models, add pricing (`model input output`, in USD per 1M tokens), or cost shows as "no price set". Local URLs (Ollama, LM Studio) count as free.
- The `mock` provider needs no key. Use it to test the loop: `mock-echo` (fast), `mock-slow` (good for testing cancel), `mock-fail` (fails on purpose).

## Add an agent

**Agents → New agent**: choose a provider and a model, and write a system prompt. Built-in agent definitions live in [packages/agents](packages/agents) and are seeded on first boot (only Echo in Phase 1). Seeding never overwrites edits you made in the UI.

## Coder with OpenCode

The Coder agent uses [OpenCode](https://opencode.ai) to do the coding. Agent Office keeps control of everything around it:

1. Agent Office clones the project's repo (Projects → repo URL) and creates a branch `agent/<job>-<id>`.
2. OpenCode edits files and runs tests **under the agent's rules**:
   - reading and searching the repo is allowed;
   - editing is allowed when the agent's permission level is `review`;
   - shell commands on the agent's allowlist run directly, and **anything else becomes an approval in the inbox**;
   - `git push`, `git commit`, `git remote`, `git config`, resets and rebases are blocked;
   - web access and folders outside the repo are blocked;
   - `.env` and key files cannot be read.
3. Agent Office commits, pushes the branch and opens the pull request on Gitea. `main` is never pushed.

Setup on each runner machine: `npm install -g opencode-ai`. The runner reports `opencode` under Runners when it finds it.
OpenCode needs an OpenAI-compatible provider (OpenRouter, your own server, Ollama, OpenAI). The real API key never reaches OpenCode: the runner gives it a one-run token for a local proxy instead.
If a repo ships its own `opencode.json` or `.opencode/` folder (plugins could run code on your PC), the run first asks for a **dangerous** approval.

## Office view

The dashboard opens on **Office**. Switch to **Board** (team cards + kanban) at any time; the choice is remembered in this browser. Both views read the same event stream, and the office never changes anything by itself.

| What you see | What it means |
| --- | --- |
| Walks to its desk and sits | a run started (a coffee bubble: the job is queued, waiting for a runner) |
| Typing, monitor flickering | code, shell, git or writing tools |
| Browser bubble | checking a web page |
| Goes to the library | search / reading docs |
| `…` bubble | thinking |
| Hand up with a pulsing **!** | needs your approval. Click it to approve or reject. |
| Carries a file to your desk | run finished; the paper lands in your in-tray |
| Dizzy, red cross on the monitor | run failed |
| Walks a document to another desk | handoff to another agent |
| Pins a note on the notice board | opened a pull request |
| Both in the meeting room | two agents busy on the same handoff chain |
| Pantry, chatting now and then | idle (`zzz` while everything is paused) |
| Walks out of the entrance | over budget or paused |
| Dark desk screens, red server lamp | its runner is offline (one server rack per runner) |

- **Click a character** to open a panel with:
  - the current job, a live log and the last tool calls;
  - tokens and cost today against the budget;
  - **Give a job**, **Cancel run** and **Pause agent** buttons.
- **Navigate:** drag to pan, and use **−/+** to change the zoom.
- **Performance:** rendering drops to 30 fps when the window is not focused, and stops when the tab is hidden.

**Art.** All art is drawn in code (`apps/web/src/office/art/`), so no licence questions. The hub serves the built files from `maps/` (`MAPS_DIR`). To re-skin the office, replace those files; see [maps/README.md](maps/README.md). After changing the art code, rebuild with `bun run --cwd apps/web office:assets`.

## Projects, briefs and Marketing

**Projects → Brief** is everything Marketing may know about a product. It is saved as `projects/<slug>/brief.yaml` and holds:
- what it is, who it is for, prices, location, call to action and other facts;
- tone, and the language per platform (Manglish / Bahasa Melayu / English);
- things never to say: words in "quotes" are blocked word for word;
- **example posts you like**, and **style notes**.

Marketing reads only the brief, the feature log and its past drafts. It has no repo access. Before saving each draft it checks itself: facts from the brief, only released features, no overclaims, and the right tone. The tools also refuse:
- drafts that use a forbidden phrase;
- drafts that copy an example post word for word (12+ words in a row).

**New job → Marketing → Kind of work** offers these job types:
- captions (3 variants);
- short-video script;
- weekly content calendar;
- landing page copy;
- seasonal promo;
- comment/DM replies;
- A/B hooks;
- feature announcement;
- **writing-style analysis**: it studies the example posts and writes a style guide; approving it fills the brief's style notes.

**Drafts** is the inbox. You can edit in place, then **Approve**, which is saved as *edited* with the original kept, or **Reject** with feedback. **Copy** puts the text on your clipboard. Your decisions are fed back to Marketing on later jobs. Nothing is ever published by Agent Office.

**Feature log:**
1. When one of Coder's pull requests (branches `agent/…`, `fix/…`, `feat/…`) is merged in Gitea, the hub notices it within 5 minutes. It polls Gitea, so no webhook or public URL is needed.
2. The hub asks Coder for a plain-language note. Coder checks CI and writes it to `feature_log` and `projects/<slug>/FEATURES.md`.
3. That note triggers a Tester screenshot and Marketing announcement drafts.

You can also add a note yourself in **Projects → Feature log**.

## Chat

**Chat** talks to any agent. Each message is a small job, so it shows in the office, counts toward the budget and still asks for approvals. Chat messages stay off the Board and its stats (the dashboard shows "+ N chat messages" instead), and a failed chat message is not sent to Telegram. Earlier messages in the thread go along with each new one.
- **Marketing:** ask for posts in plain words; whatever it writes lands in Drafts.
- **Coach (English speaking partner):**
  - Practises unscripted conversation: free talk, interviews with unexpected follow-ups, work situations, pitches and quick drills.
  - Each reply answers you, asks a follow-up, then lists **More natural:** fixes and one **Useful phrase**.
  - Press 🎤 to *speak* your answer. This uses your browser's speech-to-text: Chrome and Edge send the audio to their speech service. Tick **Read aloud** to hear replies.

## Telegram

**Settings → Integrations → Telegram:**
1. Create a bot with @BotFather and paste its token.
2. Send `/id` to your bot and paste the chat id it replies with.
3. Press **Send test**.

You then get the following messages:
- approvals with ✅/❌ buttons (signed, and only your chat is accepted);
- morning and nightly reports;
- failures;
- new drafts;
- budget alerts.

Send `/status` for a summary. The bot uses long polling, so it works while the hub runs on 127.0.0.1.

## Budgets

Each agent has a daily token budget (Agents → Edit; `0` = no limit). When the budget runs out:
- the run stops early;
- the agent "goes home" in the office;
- its jobs wait until midnight (Malaysia time) or until you raise the budget.

## Replay and agent memory

**Replay** (`/replay`, or **Replay in the office** on any finished run) rebuilds the office as it was and lets the characters re-enact a run or a time range at 1x/4x/16x. Long waits are shortened. It uses its own copy of the state, so the live office is untouched.

**Agent memory**: agents with the `remember` tool (Coach, Marketing) save short notes that come back in every later run, for example your recurring English mistakes or "no emoji on Facebook". To see or delete them, click the agent in the office: the panel has a **Remembers** section.

Not built, on purpose: the Docker sandbox (you chose no Docker) and Langfuse tracing (optional in the spec).

## Kill switch

**Pause all** in the header cancels running jobs, and new jobs stay queued until you click **Resume all**. To pause one agent, click **Pause agent** on the Agents page.

## Tests & checks

```sh
bun test              # schemas, reducer, tools, hub↔runner loop, Phase 2 + 4 acceptance, drafts, Telegram, office art + brain
bun run typecheck     # strict TS across all workspaces (incl. vue-tsc)
node apps/web/scripts/shots.mjs --out shots --routes "/,/agents" --variants desktop-light,phone-dark   # screenshots (dev server running)
```

The office tests check that every event type has a reaction, and that a character reaches its newest state within 2 seconds even after a burst of events.

## Layout

```
apps/hub      Hono API + WebSockets + SQLite (Drizzle) + dispatch
apps/runner   Runner daemon: pairing, outbound WS, workspaces, runtimes (Vercel AI SDK, mock)
apps/web      Vue 3 + Pinia + Tailwind UI; src/office = pixel art, map, character brain, Phaser scene
docs/         Owner's guide (Manglish), open docs/panduan-agent-office.html in a browser
maps/         Office map (Tiled .tmj), tileset and sprite atlases (built from code, served by the hub)
packages/shared  Zod schemas: entities, events, protocol, reducer, pricing, presets, redaction
packages/agents  Agent definitions (data + system prompts): Echo, Pak Guard, Tester, Coder, Marketing, English Coach
projects/        One folder per project: brief.yaml + FEATURES.md (written by the hub)
packages/tools   Tool layer (Phase 2)
```

After you change `apps/hub/src/db/schema.ts`, run `bun run db:generate` and commit the new migration. Migrations run automatically when the hub starts.
