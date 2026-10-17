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

## Decisions taken beyond the spec (Phase 4)
- **Briefs live in `projects/<slug>/brief.yaml`** (`PROJECTS_DIR`), Zod-validated (`ProjectBrief` in packages/shared/src/marketing.ts). Extra fields beyond spec §9: `call_to_action`, `facts`, `style_notes`. A hand-edited invalid file returns 409; agents just see "no brief".
- **Marketing's knowledge comes only from `RunAssignment.project_context`** (briefs, feature log, decided drafts), sent only to agents with `read_brief`/`save_draft`… tools. `save_draft` refuses failed self-checks, phrases quoted in `do_not`, and 12-word copies of `good_examples`. Drafts reach the hub via the sequenced `run.draft` message; the hub caps 30 drafts per run.
- A `style_guide` draft, once approved, becomes the brief's `style_notes` (owner's request: analyse a writing style, then write like it). Approving with a changed body records `edited` and keeps `original_body`.
- **Merged PRs are found by polling Gitea** (`ReleaseWatcher`, every 5 min) because the hub is local-only. The first look at a project only records existing merges. A `feature_note` job runs with a fixed prompt (`FEATURE_NOTE_PROMPT`) and only `gitea_ci_status` + `add_feature_note`, never OpenCode. `feature.released` queues a Tester `feature_screenshot` job (its screenshot lands on the log entry) and a Marketing `announcement` job.
- **Chat** (owner request) = jobs of type `chat` with `input.thread_id` and `input.history` (last 10 exchanges); no new tables. The reply is the run's output from the reducer state. Built-in **English Coach** agent (owner request) for speaking practice; browser speech-to-text and read-aloud are in apps/web/src/speech.ts.
- **Telegram** (`apps/hub/src/telegram.ts`): long polling (no public URL needed); token encrypted in `settings`; callback data `a:<approval>:<y|n>:<hmac12>`; only the owner's chat id is obeyed; `/id` answers anyone (setup). `TELEGRAM_API_BASE` points tests at a fake.
- **Budgets**: `daily_token_budget` 0 = no limit. Over budget → `budget.exceeded` once per day, jobs stay queued, the runtime stops early (`budget_left_tokens`), and the sweep emits `agent.idle` after midnight KL or when the budget is raised.
- Newly seeded agents take the provider + model most existing agents use (the owner's choice) before the old ranking.

## Decisions taken beyond the spec (Phase 5)
- `AUTH_MODE=cf-access` (apps/hub/src/auth.ts) verifies `Cf-Access-Jwt-Assertion` or the `CF_Authorization` cookie with `jose`. It checks: RS256, issuer `https://<team>`, the AUD, and `email` == `OWNER_EMAIL`. JWKS come from `https://<team>/cdn-cgi/access/certs` (`CF_ACCESS_CERTS_URL` overrides it for tests). There is no token login in this mode, and logout returns `/cdn-cgi/access/logout`.
- Runners behind Access send `CF-Access-Client-Id/Secret` (env `CF_ACCESS_CLIENT_ID/SECRET`) on pairing, WS and uploads. Their own runner token is still required.
- Replay (`apps/web/src/office/replay.ts`, pure and tested; `views/ReplayView.vue`) rebuilds state from every event before the window and caps gaps at 4 s. It uses its own OfficeWorld, never the live store.
- Agent memory: replaced in Phase 4.5 by Hermes-style memory (see below).
- **One-line runner install** (owner request, Phase 5 extra):
  - `apps/hub/src/installer.ts` serves `GET /install.sh` and `GET /install.ps1` (templates in `apps/hub/src/installer/`, with the hub URL taken from the request's Host / X-Forwarded-Proto) plus `/install/runner.js` (Bun.build of the runner, cached for 60 s) and `/install/worker.mjs`.
  - Every one of these needs a **live, unused pairing code**; the code is only consumed by the pairing itself.
  - The script installs to `~/.agent-office-runner` (`app/runner.js`, `browser/worker.mjs`, `.env`, `data/`), runs `runner.js --pair-only` (a no-op when already paired, so re-running updates), then registers start-at-login with no admin rights: a Startup-folder `.vbs` on Windows, a systemd `--user` unit on Linux, launchd on Mac. `AGENT_OFFICE_NO_SERVICE=1` skips that step (used by the e2e check).
  - The runner reports `capabilities.programs` (git, node, ffmpeg, blender…, found via `Bun.which`), shown on the Runners page. Jobs are not routed by programs yet.
  - Reaching the hub from the LAN needs `HUB_HOST=0.0.0.0` + `PUBLIC_BASE_URL`; the page warns when the URL is loopback.
- **Hermes Agent** (Nous Research) joins as an OpenAI-compatible provider (preset "Hermes Agent", model `hermes-agent`, `hermes gateway` on :8642). It runs its own tools on its own PC, outside our approvals. Guide: docs/hermes-agent.md.
- Skipped on purpose: the Docker sandbox (owner: no Docker) and Langfuse (optional).

## Decisions taken beyond the spec (Phase 4.5: Hermes-style learning)
Owner asked to follow Nous Research's **Hermes Agent** closely. Logic in `packages/shared/src/memory.ts` + `skills.ts`, tools in `packages/tools/src/memory.ts`, hub side in `apps/hub/src/learning.ts`.
- **Memory = two bounded stores in `settings`**: `memory.agent.<id>` (own notes, 2200 chars) and `memory.user` (owner profile shared by all agents, 1375 chars). `memory` tool: add / patch{old_text} / remove{old_text} or several `operations` at once (all-or-nothing); when full it returns the current entries so the model consolidates in one call. Every write is scanned (injection phrases, invisible unicode, secrets). The legacy `remember` tool and the `agent_memory` table were removed (migration 0005; spec §table list deviates on purpose).
- **Frozen snapshot**: `RunAssignment.memory` is rendered once at run start (`memoryNote` in the runner) with usage %; writes during the run do not change the prompt.
- **`memory.write_approval`** (Skills page switch): memory ops become `proposals` rows the owner approves.
- **Skills** = `skills/<name>/SKILL.md` (`SKILLS_DIR`, agentskills.io / Hermes frontmatter). Agents only *propose* (`skill_manage` → sequenced `run.skill` → `proposals` + `skill.proposed`); the owner approves on `/skills` (diff + warnings for download/delete commands). Owner can import any SKILL.md (`POST /api/skills`). The prompt carries only the index (progressive disclosure); `skill_view` loads one.
- **`session_search`**: FTS5 table `search_index` (custom migration 0004) filled when a run ends (`indexRun`, backfilled at boot). Query words are quoted and OR-ed, never raw FTS syntax. Runner calls `POST /api/runner/search`.
- **Background review** (`wantsReview`): after 5+ tool calls or every 5th chat message, a short `generateText` pass with only the learning tools asks "anything worth saving?". Off per agent with `config.self_review = false`. Tokens count toward the budget.
- Web: `views/SkillsView.vue` (`/skills`), `components/office/MemoryStores.vue` in the agent panel, pure `diff.ts`.

## Decisions taken beyond the spec (after Phase 5: owner's improvement list, 2026-10-17)
- **Nightly backup** (`apps/hub/src/backup.ts`): `VACUUM INTO` + copies of `projects/` and `skills/` into `data/backups/<YYYY-MM-DD>/`, checked every 10 min, runs once a day after `BACKUP_HOUR` (3, KL), keeps `BACKUP_KEEP` (14). Failure → Telegram. `GET/POST /api/backups`; card in Settings → Integrations. Workspaces and `data/files` are not backed up.
- **Skill usage** is computed, not stored: `Learning.skillsWithUsage()` reads `agent.tool_call` events for `skill_view` plus run status / rejected drafts of those runs. `stale` after 60 days unused, or ≥3 runs with ≥50% bad.
- **Researcher** (`packages/agents/src/researcher.ts`) with `web_search` + `web_fetch` (`packages/tools/src/research.ts`).
  - `web_fetch` follows redirects by hand and refuses private/loopback addresses (DNS-resolved) unless the exact host is on the agent's `http_allowlist`. It converts HTML to text itself (no library), wraps the output as UNTRUSTED and flags injection with `memoryContentProblem`.
  - `web_search` goes runner → `POST /api/runner/web-search` → hub tries providers in order (owner choice: no monthly limits first): **DuckDuckGo lite HTML** (no key, unofficial, 20/min cap, ads = `y.js` links dropped, CAPTCHA page → next) → **SearXNG** (owner-hosted URL, `format=json`; guide docs/searxng.md, no Docker) → Tavily/Brave key. `settings.integrations.web_search` = `{provider (first), searxng_url, key_provider, key_enc}`; old `{provider: brave|tavily}` rows are read as `key_provider`. Keys never leave the hub. `WEB_SEARCH_API_BASE` points tests at fakes. When every provider fails the tool tells the agent to use web_fetch. Owner rejected r.jina.ai (it sends every URL to a third party).
- **consult_agent** (ask and wait):
  - The runner sends sequenced `run.consult`, and the hub creates a `consult` job (`input.parent_run_id`, `consult_id`) for the target. When that run ends, `#afterRun` sends `consult.answer` (the run's output) to the asking run.
  - One level only: consult jobs get no `consult_agent` / `handoff`. A run waiting on a consult does not count toward runner capacity, otherwise a one-slot runner deadlocks.
  - When the asking run ends, its open consult jobs are cancelled. The runner gives up after `timeout_minutes` (default 10).
  - An answer lost to a disconnect just times out.
- **Owner preferences per agent** (`AgentConfig.preferences`: language / tone / length / emoji / format / notes). `preferencesPrompt()` (shared, tested) is appended last to the prompt in the AI SDK runtime, the review pass and OpenCode. It is set in the office agent panel (`components/office/AgentPrefs.vue`). `AgentsView` keeps it when saving.
- **Cloudflare is live**: `https://myofis.bijokdev.com` goes through the existing dashboard-managed tunnel `cloudflaretunnel` (Windows service on this PC) → `http://127.0.0.1:8788`. Access app "MyOfis" allows the owner's email only.
  - The hub runs `AUTH_MODE=cf-access` (team `bbjokdev.cloudflareaccess.com`), so localhost cannot log in. The owner uses the domain everywhere.
  - A "no login on localhost" bypass was blocked by Claude Code's safety classifier; do not re-add it without the owner explicitly granting it.
  - The domain serves the **built** UI: run `bun run --cwd apps/web build` after UI changes.
- **Screenshots now need a preview hub**: start a throwaway hub with `AUTH_MODE=local`, the same `LOCAL_AUTH_TOKEN` (read from `.env`, never printed), temp `DATABASE_PATH` / dirs, `WEB_DIST_DIR=apps/web/dist`, port 8811. Then `node apps/web/scripts/shots.mjs --base http://127.0.0.1:8811 …`.

## Decisions taken beyond the spec (Publisher: website posts, 2026-10-17)
Owner request: chat with one agent, send photos + points, get a post for the project's own website. Owner choices: **approve first**, **an endpoint inside each site's backend** (not hub-held Firebase keys), **agent sees the photos** (canopy-ai/Gemma reads images; verified 2026-10-17).
- This deviates on purpose from spec §8 "Marketing never publishes": a `web_post` draft is published **only when the owner approves it** (`POST /api/drafts/:id/decide` → `Publisher.publish`). A failed publish keeps the draft `approved` with `publish_error`; `POST /api/drafts/:id/publish` retries. Status becomes `published` with `published_url`.
- **Contract:** `GET/POST <url>`, HMAC-SHA256 `v1=` over `"<ts>.<body>"`, 5-minute window. See `docs/website-publishing.md`. The secret is per project, in `projects.publish` (migration 0006, encrypted). "Test" stores the site's `{site_name, post_types}`; only then does `project_context.projects[].publish` tell agents the site accepts posts.
- **Photos:** `POST /api/uploads` (raw image body, ≤10 MB, `uploads` table + `FILES_DIR/uploads/`). Chat jobs carry `input.attachments` (≤4). The runner fetches them with `GET /api/runner/uploads/:id?run_id=` (only photos attached to that running job) and sends them as image parts. If the model fails before any output, it retries once without the photos.
- **Tool `draft_web_post`** (in `CONTENT_TOOLS`): checks the site's post types, the self-check, the brief's do_not list, and `cover_photo` (the index of the attached photos). It sends `run.draft` with `kind: web_post`, `platform: website` and `meta: WebPost`.
- Built-in agent **Publisher** (`packages/agents/src/publisher.ts`). UI: the 📷 button and thumbnails in Chat, web posts in DraftCard (cover, chips, link, Publish again), and Projects → Brief → **Website** tab (`components/PublishSettings.vue`).
- **SmashPoint side** (other repo): `worker/src/agentOffice.ts`.
  - It verifies the signature, uploads the cover to storage.bijokdev.com, and writes Firestore via a service account (`FIREBASE_SERVICE_ACCOUNT` secret, jose RS256 → OAuth token) as `posts/ao-<draft>`, which makes retries idempotent.
  - Needs `AGENT_OFFICE_SECRET` and `SITE_URL`; the owner must run `wrangler secret put` + `deploy`.
  - Signature compatibility was tested against a local `wrangler dev`.

## Status and next steps (handoff, 2026-10-17)
Read this first when picking the project up in a new session.
**PENDING (read first, updated 2026-10-17 end of session)**
- Code: everything built and green: 214 tests, typecheck and web build OK. The domain serves the latest build.
- Owner to do:
  - (done 2026-10-17: `consult_agent` added to Marketing + Researcher in the owner DB; Researcher prompt updated to read named sites with web_fetch and fall back when search is off; DB backup in data/backups/before-researcher-patch-*.db)
  - Add a Brave or Tavily key in Settings → Integrations → Web search.
  - Test with `docs/cuba-sistem.md` through https://myofis.bijokdev.com.
  - Sign off Phases 4, 5 and 4.5.
  - Rotate the canopy-ai key.
  - Commit.
  - Say "padam backup": Claude then deletes the old `.env` copy at `%TEMP%\env.backup`.
- Gemini queue:
  - 003 and 004 reviewed and passed (scripts untouched, wiring intact). Owner: `git rm -r --cached shots-004` (now in .gitignore);

  - next: hand over 005 (3 files), then 006 (whole-app UX polish; office pan/recenter and chat stick-to-bottom logic already fixed by Claude).
- Publisher (website posts) built and **live** 2026-10-17: smashpoint-api Worker deployed (https://smashpoint-api.hazman5001.workers.dev, endpoint /agent-office/publish), secrets AGENT_OFFICE_SECRET + FIREBASE_SERVICE_ACCOUNT set (token + Firestore read verified), SmashPoint project created in the hub and connected (Test passed). Owner should delete the downloaded service-account JSON from Documents. First real publish = owner's own test.
- Next requested: a "Browse" tab on Skills with popular public SKILL.md skills (one-click install, with licence + source shown).
- Not started:
  - "Kerani" camera-rental agent: ask the owner where bookings are stored (Google Calendar / Sheet / own site DB / WhatsApp only).
  - 3D (OpenSCAD/Blender).
  - Routing jobs by runner `programs`.
  - `git worktree` workspaces (low value).


**Phases**
- Phases 1–3: done and signed off by the owner.
- Phase 4: built and waiting for the owner's sign-off. 175 tests pass (incl. `apps/hub/test/acceptance-phase4.test.ts`); typecheck and build are green.
- Phase 5: built (cf-access, tunnel docs, remote runners, replay, agent memory) and waiting for the owner's sign-off. The real-world check in docs/cloudflare-tunnel.md §5 needs the owner's domain.
- Phase 4.5 (Hermes-style learning) and the improvement list (backup, Researcher, consult_agent, preferences, one-line runner install, Cloudflare live): built, 214 tests green. Gemini: 003 to review ("semak 003"), then 004, then 005.
- UI helper: the owner relays UI tasks to Gemini (Antigravity) from `tasks/gemini/NNN-*.md`; Claude reviews the diff, tests and screenshots. Task 001 passed review; task 002 passed; 003 (work pages) is with Gemini; 004 (Skills + Memory look) is ready to hand over.

**Owner's environment**
- Hub on :8788, web dev on :5180. Never kill workerd or the canopynet dev servers.
- All agents use the `canopy-ai` provider (owner's own server), including Marketing and English Coach.
- Telegram bot **@MyOfis_monmon_bot** is connected (token encrypted in `settings`; a test message was delivered).
- Gitea is not set up yet; it is faked in tests.
- The owner restyled `apps/web/src/style.css`, `views/DashboardView.vue` and `components/office/OfficeCanvas.vue` themselves (a "Linear/Vercel" look). Keep their edits; change only logic in those files.

**Done 2026-10-17 (after the handoff note): chat stays in the job pipeline but is hidden from the Board**
- New `apps/web/src/jobs.ts`: pure `isChatJob(j)` (`type === "chat"`) and `boardJobs(jobs)` (drops chat).
- `DashboardView.vue`: the kanban (`byColumn`) and `stats` use `boardJobs(office.jobsNewestFirst)`. Add a small "+ N chat messages" line (chat jobs created today) under the Done today tile, linking to `/chat`.
- `apps/hub/src/telegram.ts`, `run.failed` case: skip the ❌ notice when the job's type is `chat` (the owner sees it in the chat). Approvals, drafts, reports and budget notices stay.
- Tests:
  - `apps/web/test/jobs.test.ts`;
  - in `apps/hub/test/telegram.test.ts`, a failing chat job sends no ❌ message.
- Then add one line about this to the README "Chat" section.

**Open questions for the owner** (skills, memory, Researcher and consult are done; 3D and the camera-rental "Kerani" agent are still open: ask where bookings are stored)
- Is "Hermes" (set up on another PC) Nous Research's *Hermes Agent* or just a *Hermes model*?
  - Hermes model: add it as a provider.
  - Hermes Agent: a runner-side runtime like OpenCode, and/or import its SKILL.md skills.
- What next? The recommended order is Phase 4.5 first, then Phase 5:
  - **Phase 4.5:**
    - a Researcher agent with web search/fetch;
    - SKILL.md skills that the owner approves;
    - agents asking each other and waiting for the answer;
    - 3D models via OpenSCAD/Blender scripts;
    - the Hermes import.
  - **Phase 5:** Cloudflare Tunnel + Access, a second runner, replay mode.

**Waiting for the owner's OK**
- Two LEARNINGS.md proposals (write them only after the owner agrees):
  1. Inline shell edit scripts (`bun -e '…'`, heredocs) break on quotes; use the Edit/Write tools.
  2. Zod fields with defaults differ between `z.input` and `z.output`; use the output type for validated data passed around (e.g. `FeatureNoteData`).
- The owner should rotate the canopy-ai API key (it was pasted in chat once).

**Owner's guide**
- `docs/panduan-agent-office.html` (Manglish, open in a browser). A copy was also published as a claude.ai artifact on the old account.
- Update it when features change.

## Commands
- `bun install` — install
- `bun run dev` — hub + web (Vite on :5180 proxies to hub on :8787)
- `bun run dev:runner` — runner daemon
- `bun test` — all tests
- `bun run typecheck` — strict TS across workspaces
- `bun run db:generate` — regenerate Drizzle migration after editing `apps/hub/src/db/schema.ts`
