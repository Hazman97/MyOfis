# Agent Office (MyOfis): system overview (2026-10-19)

This document gives another AI or a reviewer the whole system in one read, so they can suggest improvements. The detailed spec is in [SPEC.md](SPEC.md). Decisions and status are in [CLAUDE.md](CLAUDE.md). The owner's manual (Manglish) is [docs/manual.html](docs/manual.html), also shown in the app at `/manual`.

## 1. What it is

Agent Office is a **personal "office" of AI agents** for one owner: a solo developer in Malaysia who runs small web products, a badminton court business (SmashPoint) and a camera-rental business.

- **Agents** are workers. Each has a role, a system prompt, an LLM, a list of tools and a pixel-art character.
- **The owner gives them work** in several ways:
  - chat, in the web app or Telegram, with photos and videos;
  - jobs;
  - schedules (cron);
  - events, such as a merged PR.
- **Watching and approving.**
  - The owner watches the agents walk around a 2D pixel office.
  - Risky actions wait for approval in the browser or on Telegram.
  - Anything that goes public (website posts, social posts) is published only when the owner approves the draft.
- **Ownership.** Everything is self-hosted, single-user and local-first. The hub runs on the owner's PC (reachable at `https://myofis.bijokdev.com` through Cloudflare Tunnel + Access). Runners can run on other machines.

**Main goals**
1. Do real work with minimal babysitting:
   - code fixes and PRs;
   - smoke tests and a morning health report;
   - marketing copy and website posts;
   - social posts and short videos;
   - booking reports, web research;
   - English practice.
2. Be safe:
   - no secrets leaked;
   - no work outside the workspace;
   - risky actions approved first;
   - content the agents read (files, web pages, photos, videos, colleagues' answers) is treated as DATA, not instructions.
3. Be fun and legible: the office view shows what every agent is doing right now, and replay shows any past window.

**Hard constraints from the owner**
- **No Docker, anywhere.**
- The UI talks to him in Malay/Manglish; code and docs are in English.
- He reviews and pushes to `main` himself, or asks Claude to.

## 2. Architecture

```
 Browser / phone (Vue 3 + Phaser office)      Telegram bot (long polling)
        │  HTTPS (Cloudflare Access) + WebSocket (events)     │
        ▼                                                     ▼
 ┌──────────────────────────── HUB (Bun + Hono, :8788) ─────────────────────────────┐
 │ SQLite (Drizzle) · event store (append-only) · shared reducer → state            │
 │ scheduler (cron) · approvals · budgets · ReleaseWatcher (polls Gitea)            │
 │ Content (briefs/drafts/feature log) · Learning (memory/skills/FTS5)              │
 │ Publisher (website endpoint, uploads) · Social (Facebook/Instagram/Threads)      │
 │ web search (DuckDuckGo → SearXNG → Brave/Tavily) · backups · token health        │
 │ auth: token or Cloudflare Access JWT · secrets AES-256-GCM                       │
 └───────────────▲───────────────────────────────────────▲──────────────────────────┘
                 │ WebSocket, sequenced messages          │ signed HTTPS (HMAC)
 ┌───────────────┴──── RUNNER (Bun daemon, 1..n PCs) ──┐  ┌─┴──────────────────────────┐
 │ per-run workspace · runtimes: ai-sdk | opencode |   │  │ Owner's websites, e.g. the │
 │ mock · tools via runTool() · Node worker            │  │ SmashPoint Worker: posts,  │
 │ (Playwright) · ffmpeg (NVENC) for video             │  │ bookings, media storage    │
 └─────────────────────────────────────────────────────┘  └────────────────────────────┘
```

**Monorepo (Bun workspaces)**

| Path | What |
|---|---|
| `apps/hub` | API, event store, scheduler, approvals, Telegram, Gitea polling, learning, publishing, social, uploads, backups |
| `apps/runner` | Pairs with the hub (or installs with one line: `install.ps1` / `install.sh`), executes runs, holds provider keys in memory only |
| `apps/web` | Vue 3 + Tailwind 4 SPA and the Phaser 3 office (pure "brain" + thin scene) |
| `packages/shared` | Zod schemas, events, protocol, **pure reducer** (shared by hub and web), memory/skills helpers, video presets |
| `packages/tools` | Every tool an agent can call, plus `runTool()` (validate → risk → approval → execute → events) |
| `packages/agents` | Built-in agent definitions (prompts, tools, schedules) |
| `maps/` | Office art generated from code (Tiled map + atlases) |
| `projects/<slug>/brief.yaml` | Briefs per product |
| `skills/<name>/SKILL.md` | Approved skills (Hermes / agentskills.io format) |
| `docs/` | Guides (website publishing, Facebook/Instagram/Threads, video editor, SearXNG, Hermes, Cloudflare), the manual, a Colab notebook for testing local models |
| `tasks/gemini/` | UI tasks the owner relays to Gemini; Claude reviews them |

**Event sourcing**
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
- Content: `draft.created`, `draft.decided`, `feature.released`.
- Learning: `skill.proposed`, `skill.decided`.

**Database tables**
- Core: `events`, `jobs`, `runs`, `agents`, `providers`, `runners`, `pairing_codes`, `approvals`, `schedules`, `projects`, `settings`.
- Content: `feature_log`, `content_drafts` (with `meta`, `published_url`, `publish_error`, `publish_at` for scheduled posts), `uploads` (photos and videos; `run_id` for renders).
- Learning: `proposals`, `search_index` (FTS5).
- Per-project and integration settings live in `settings`, encrypted where secret. This covers Telegram, web search, social tokens, memory stores and the Telegram chat state.

## 3. Agents (built in)

| Agent | Role | Typical trigger | Key tools |
|---|---|---|---|
| **Ketua** | Head of office: asks the right colleagues **in parallel**, then gives one combined answer (verdict, each view, risks, plan); hands work over after the owner agrees | Chat | `consult_team`, `consult_agent`, `handoff`, briefs |
| **Publisher** | Website posts from the owner's photos + points (event date/time/place, cover); one caption per connected social account; changes or takes down live posts | Chat / Telegram | `draft_web_post`, `update_web_post`, `take_down_web_post`, `save_draft` |
| **Editor** | Video editor: cut, join, reframe (crop/blur/pad), captions, slow motion, loudness, export (TikTok FHD, Reels, Shorts, YouTube, square) with ffmpeg on the runner PC (NVENC when there is one) | Chat / Telegram | `video_probe`, `video_edit`, `save_draft` |
| **Marketing** | Copy per product, writing-style analysis, posts in that style, release announcements | Job, weekly schedule (off), `feature.released` | `read_brief`, `read_feature_log`, `read_past_drafts`, `save_draft` |
| **Researcher** | Web research with sources | Chat, consults | `web_search`, `web_fetch`, `write_report` |
| **Kerani** | SmashPoint bookings: today's courts, regulars, free slots, payment status; morning report | Chat, schedule 08:00 (off) | `read_bookings`, `write_report` |
| **Coder** | Fix issues, open PRs | Job / Gitea issue | OpenCode runtime or git_* + edit tools; push and PR are done by our code, never by the LLM |
| **Tester** | Nightly smoke tests, feature screenshots | Schedule, `feature.released` | `browser_check`, `http_check`, `write_report` |
| **Pak Guard** | Morning DevOps health report | Schedule 08:00 | `system_metrics`, `http_check`, `gitea_ci_status`, `write_report` |
| **Coach** | English speaking practice (mic + read-aloud in the browser) | Chat | learning tools |
| **Echo** | Test agent | Job | (none) |

Most agents also get the learning tools (`memory`, `session_search`, skills).

**Custom agents.** The owner can create more agents in the UI (Agents → New agent). Each picks:
- a provider and model, and the runtime;
- the tools, as checkboxes grouped by category;
- `shell_allowlist`, `read_paths`, `http_allowlist`;
- `max_steps`, `self_review`, the permission level and a daily token budget;
- **preferences**: language, tone, length, emoji, format and notes, appended last to the prompt.

**Built-in agents in the owner's DB.** They are seeded by slug on boot and never overwritten. A tool added later must be ticked by hand on agents that already existed.

**Working together.**
- `handoff`: one-way; the first agent does not wait.
- `consult_agent`: ask one colleague and wait.
- `consult_team`: ask up to 6 colleagues at once and wait for all.

Consults are one level deep: a consulted agent cannot consult or hand off. They are child jobs, so the office shows the group in the meeting room. A waiting run does not count toward runner capacity.

**Providers**
- Anthropic, OpenAI, Google, and any OpenAI-compatible provider: the owner's `canopy-ai` server (all agents use it today), OpenRouter, Hermes Agent, or a local Ollama.
- `mock` is for tests only.
- Keys are encrypted at rest and are never sent to the browser.

## 4. Tools (40)

| Group | Tools |
|---|---|
| Files | `read_file`, `write_file`, `edit_file`, `list_dir` |
| Shell | `run_command` (argv only, allowlist, scrubbed env) |
| Git / Gitea | `git_clone`, `git_status`, `git_branch`, `git_diff`, `git_commit`, `git_push`, `gitea_list_issues`, `gitea_comment`, `gitea_create_pr`, `gitea_ci_status` |
| Web checks / ops | `http_check`, `browser_check`, `system_metrics`, `write_report` |
| Research | `web_search` (through the hub; keys never leave it), `web_fetch` (refuses private addresses unless allowlisted; output wrapped as UNTRUSTED) |
| Team | `handoff`, `consult_agent`, `consult_team` |
| Content | `read_brief`, `read_feature_log`, `read_past_drafts`, `save_draft` (self-check, blocks `do_not` phrases and copies of examples; `cover_photo`, `video`), `add_feature_note` |
| Website | `draft_web_post`, `update_web_post` and `take_down_web_post` (risk review: the owner approves), `read_bookings` |
| Video | `video_probe` (ffprobe + scene changes), `video_edit` (edit plan → ffmpeg; h264_nvenc with a libx264 fallback) |
| Learning (Hermes-style) | `memory`, `session_search`, `skills_list`, `skill_view`, `skill_manage` |

**How approval is decided.**
- Each tool returns a risk level: `safe`, `review` or `dangerous`.
- Together with the agent's permission level, that decides whether the call waits for the owner.
- Approvals can be decided in the web app or with Telegram buttons (HMAC-signed callback data).

## 5. Features by phase

- **Phase 1 – core loop**
  - hub, runner pairing, jobs → runs, live event stream;
  - approvals, providers, mock provider.
- **Phase 2 – real agents**
  - the AI SDK runtime and the tools;
  - OpenCode for Coder;
  - workspaces;
  - Gitea integration (faked until the owner installs Gitea);
  - schedules.
- **Phase 3 – office**
  - design system (light and dark);
  - Phaser pixel office drawn in code: characters walk to zones (desk, meeting room, library, file cabinets) according to the latest event; catch-up within 2 s; integer zoom.
- **Phase 4 – business work**
  - briefs, the drafts inbox (approve / edit / reject with feedback), the feature log;
  - style analysis;
  - merged PR → feature note → screenshot + announcement;
  - chat with any agent (hidden from the Board);
  - English Coach;
  - Telegram; daily token budgets.
- **Phase 5 – reach**
  - Cloudflare Tunnel + Access login (JWT verified with `jose`);
  - remote runners with Access service tokens;
  - one-line runner install;
  - replay mode.
- **Phase 4.5 – learning (Hermes Agent style)**
  - bounded memory (agent 2200 / owner profile 1375 characters, frozen snapshot per run, writes scanned for injection and secrets, optional approval);
  - SKILL.md skills (agents propose, the owner approves with a diff; Browse tab with 229 Anthropic + Hermes skills);
  - FTS5 `session_search`;
  - background "anything worth saving?" review.
- **After Phase 5 (owner's lists, 2026-10-17 → 19)**
  - **Backups:** nightly `VACUUM INTO` + briefs and skills (14 days); photos/videos mirrored once into `backups/files/`.
  - **Web search:** DuckDuckGo → SearXNG → Brave/Tavily; Researcher.
  - **Agents working together:** `consult_agent`, `consult_team` and Ketua.
  - **Preferences** per agent.
  - **Publisher**:
    - signed per-site endpoint; the SmashPoint Worker writes Firestore and stores media;
    - full edit before approve;
    - live update / take down.
  - **Kerani:** bookings from the website.
  - **Telegram as the office phone:**
    - chat with any agent, photos/albums/videos up to 20 MB;
    - draft cards with Approve / Reject (approve = publish / post);
    - video drafts arrive with the video.
  - **Social:**
    - Facebook Page;
    - Instagram (same Page token; photos via the site's public storage);
    - Threads (own token, renewed weekly by the hub);
    - Facebook and Threads tokens are checked every 6 h, and problems go to Telegram.
  - **Videos:**
    - uploads up to 2 GB, sent in 32 MB parts (Cloudflare's 100 MB body limit);
    - Range streaming; player + download in Drafts;
    - Editor agent.
  - **Manual in the app** (`/manual`).

## 6. Safety model

- **Data, not instructions.** Content from files, the web, issues, command output, photos, videos and colleagues' answers is DATA. This rule is in every system prompt and also applies to memory and skills.
- **Workspace isolation.** One folder per run. Path guards block `..`, absolute paths outside the workspace and secret files (`.env`, keys).
- **Shell and ffmpeg.** No shell interpreter; argv only, a per-agent allowlist (shell) and a scrubbed environment.
- **Approvals.**
  - Risky tools wait for the owner. A global pause stops everything.
  - Public output (website, Facebook, Instagram, Threads) happens only on approval.
- **Secrets.** Encrypted at rest, held in runner memory only, redacted from events.
  - Website secrets and social tokens stay in the hub; agents never see them.
  - Websites are called with HMAC-signed requests and a 5-minute window.
- **Uploads.**
  - A runner can fetch only files attached to its own running job.
  - Only agents with `video_edit` can upload renders.
  - A draft keeps a video id only if that run made it, or it was attached.
- **Learning writes.** Skills always need approval; memory writes need approval when `write_approval` is on.
- **Auth.** Cloudflare Access (email must equal `OWNER_EMAIL`), or a token locally. Telegram obeys only the owner's chat id.
- Git push and PR creation are code-controlled, never decided by the LLM.

## 7. Quality

- 240 tests (`bun test`), strict TypeScript across all workspaces, Vite build.
- Acceptance tests run the whole loop with the mock provider and fakes for Gitea, Telegram, the Graph/Threads APIs and websites.
- The video tests render with real ffmpeg when it is installed.
- Screenshot check: `apps/web/scripts/shots.mjs` against a throwaway preview hub.
- The office "brain" and replay are pure and unit-tested.

## 8. Known gaps and weak spots (good places to suggest improvements)

1. **Post statistics.** Posts can be scheduled (approve now, post at a set time), but no reach/likes come back for Marketing to learn from.
2. **TikTok and YouTube posting.** Editor's videos are downloaded and posted by hand until the TikTok Content Posting API / YouTube Data API apps exist.
3. **Customer-facing channel.** No WhatsApp agent for SmashPoint customers (questions, free slots, provisional bookings).
4. **Local models.** All agents use one remote provider. Ollama on the owner's RTX 3060 for light work (and vision frames for Editor) is planned; `docs/colab/myofis-local-llm-test.ipynb` tests candidate models.
5. **Editor cannot see frames.** It cuts at given times or scene changes; no auto-subtitles (Whisper), music or voice-over yet.
6. **Briefing depth.** Ketua's 07:30 briefing covers runs, failures, pending items and cost, but not bookings or post results.
7. **Gitea not installed yet.** All Gitea flows (Coder PRs, release watcher) are tested only against a fake.
8. **Isolation without Docker.** Safety rests on path guards plus the allowlist. A low-privilege OS user for the runner was discussed but not built.
9. **Cost visibility.** Token budgets exist per agent per day; there is no cost dashboard per provider.
10. **Memory/skills quality.** No evaluation of whether saved memories or skills improve results; FTS search is keyword-only.
11. **Product, not just a tool.** Members, rooms and shared agents exist, but selling it (like KuasaOS / Sintra) would still need billing and self-service sign-up.
12. **Mobile.** The web app is responsive and Telegram is the mobile channel, but there is no PWA / push notifications.
13. **3D / creative work** (OpenSCAD or Blender scripts) and the camera-rental bookings source are still open.

## 9. Questions to ask a reviewer

- What would make this more useful day to day for a solo dev and small business owner?
- Which gaps above matter most, and what is the simplest design for each?
- Is the safety model enough for agents that push code, run shell commands and post publicly without Docker?
- How should agent memory and skills be measured, so that we know learning helps?
- What would you remove or simplify?

## 10. How to run

```
bun install
bun run dev          # hub :8788 + web :5180
bun run dev:runner   # runner daemon (pair it in the web app → Runners)
bun test             # all tests
bun run typecheck
bun run --cwd apps/web build   # the domain serves the built UI
```

Configuration is in `.env` (see `.env.example`):
- `SECRETS_KEY`, `AUTH_MODE` / `LOCAL_AUTH_TOKEN`;
- Cloudflare Access settings;
- `PROJECTS_DIR`, `SKILLS_DIR`, `FILES_DIR`, `BACKUP_*`, `MANUAL_PATH`.

Telegram, web search, websites and social accounts are set in the app (Settings → Integrations, Projects → Website). Videos need ffmpeg on the runner PC.
