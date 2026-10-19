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
- **Nightly backup** (`apps/hub/src/backup.ts`): `VACUUM INTO` + copies of `projects/` and `skills/` into `data/backups/<YYYY-MM-DD>/`, checked every 10 min, runs once a day after `BACKUP_HOUR` (3, KL), keeps `BACKUP_KEEP` (14). Failure → Telegram. `GET/POST /api/backups`; card in Settings → Integrations. Workspaces are not backed up. `data/files` (uploads, renders, artifacts) is mirrored into `data/backups/files/` (new or changed files only, `*.part` skipped, never pruned; `mirror()`).
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

## Decisions taken beyond the spec (owner's "proceed kesemuanya" list, 2026-10-17)
- **Telegram chat** (`apps/hub/src/telegram.ts`): any owner message or photo (albums are collected for 1.5 s) goes to the current agent as a chat job with `input.source = "telegram"`. The answer is sent back when the run ends.
  - Default agent: Publisher. Switch with `/agent <slug>`, `/agents`, `/project <slug>` and `/new`; state is kept in the `settings` key `telegram.chat`.
  - Photos: `getFile` + `/file/bot…`, the largest size, saved as uploads.
  - Every new draft arrives as a card with signed `d:<draft>:<y|n>:<hmac>` buttons. Approving runs `hub.afterApprove` (website post → publish, Facebook caption → Page).
- **Edit before approve:** `DraftDecision.approve` takes `title` and `meta: WebPostEdit` (no defaults, so unsent fields are never wiped). Changing any of them makes the status `edited`. DraftCard edits the title, summary, type, date, time, place, tags and cover.
- **Skills → Browse** (`apps/hub/src/skillCatalog.ts`): catalogues `anthropics/skills` + `NousResearch/hermes-agent` (229 skills).
  - The list is built from the GitHub tree + raw SKILL.md, cached for 24 h in `FILES_DIR/skill-catalog.json`.
  - Licences come from LICENSE.txt or frontmatter; docx/pdf/pptx/xlsx/anatomy are flagged as limited.
  - Install copies the SKILL.md only, with warnings. `parseSkill` now reads YAML block scalars (`description: >`).
- **Kerani** (`packages/agents/src/kerani.ts`, schedule 08:00 daily, seeded off, job type `bookings_report` → sent to Telegram):
  - tool `read_bookings` → runner → `POST /api/runner/site-data` (only agents that have the tool) → `Publisher.siteData`;
  - a signed GET `?resource=bookings&from&to`; **for GET requests the signed message is `<ts>.<query string>`**;
  - the SmashPoint Worker returns bookings, weekly regulars projected onto the dates, opening hours and free slots (max 14 days).
- **Change live posts:** `Publisher.updatePublished` / `takeDown` send POST `action: update | delete` (the Worker PATCHes or DELETEs `posts/ao-<draft>`). Owner routes: `/drafts/:id/update-published`, `/drafts/:id/take-down`.
  - Agent tools `update_web_post` and `take_down_web_post` are risk **review**, so the owner approves them. They use `project_context.projects[].published_posts`.
  - A taken-down draft goes back to `approved` and can be published again.
- **Facebook Page** (`apps/hub/src/social.ts`): a Page id + Page token (encrypted) per project, in `settings` `social.facebook.<project>`.
  - Approving a `platform: facebook` caption posts to `/{page}/photos` (when `save_draft` got `cover_photo`) or to `/{page}/feed`.
  - `FACEBOOK_GRAPH_BASE` points tests at a fake. Instagram is not done (it needs a public image URL). Guide: docs/facebook-page.md.
- **Instagram + Threads** (Phase A of "all social media", 2026-10-17):
  - `Social` stores `social.instagram.<project>` (IG user id found via the Page token: `GET /{page}?fields=instagram_business_account`) and `social.threads.<project>` (its own token, checked with `/me`).
  - IG and Threads only take photos by public URL. `Publisher.uploadMedia` sends the photo to the website endpoint (`action: upload_media`); the SmashPoint Worker stores it on storage.bijokdev.com and returns the URL.
  - Posting is create container → poll `status_code` / `status` until FINISHED → publish → read the permalink.
  - `hub.afterApprove` / `POST /drafts/:id/publish` call `social.post()` for any connected platform. `project_context.projects[].social` tells agents where approved captions go.
  - `THREADS_GRAPH_BASE` is for tests. Threads tokens expire after about 60 days (no auto-refresh yet).
  - Next phases (owner chose): B = YouTube/Shorts via Google API + video uploads; C = TikTok via a browser agent (logged-in Chrome, stops before Post until approval).
- **Editor / local video pipeline** (owner, 2026-10-17: "buat dulu tanpa login"; later the owner wants TikTok **API** posting instead of the browser agent). Guide: docs/video-editor.md.
  - Videos are uploads too (`uploads.run_id`, migration 0007). They arrive in parts (`PUT /api/uploads/parts/:key?name&total&offset`, ≤ `UPLOAD_PART_BYTES` 32 MB) because Cloudflare refuses bodies over 100 MB. `UploadParts` (apps/hub/src/uploads.ts) handles them: a retried part is ignored, a gap answers 409. The limit is 2 GB.
  - `fileResponse` serves uploads with Range (video seeking) and `?download=1`.
  - Runner side: `downloadUpload` streams to a file; `uploadVideo` sends parts to `PUT /api/runner/uploads/parts/:key` (only agents with `video_edit`). The hub keeps a draft's `meta.video_upload_id` only if this run rendered that video or it is attached to the job.
  - Tools in `packages/tools/src/video.ts`:
    - `video_probe` (ffprobe + scene changes);
    - `video_edit` (EditPlan → `buildEditArgs`, pure and tested; ASS captions via `captionsAss`; tries h264_nvenc first and falls back to libx264; progress shown as `agent.thinking`).
    - Presets are in `packages/shared/src/video.ts`. ffmpeg runs without a shell, with a scrubbed env, and cwd = `<workspace>/media`.
  - `save_draft(video)` takes a render or an attached video. `cover_photo` must be an image. Kind `video` was added. Attachment numbers are shared by photos and videos (`filesNote` lists them in the prompt); only images go to the model (max 4).
  - A chat reply without files carries the thread's last files (`input.attachments_carried`). This also fixes Publisher losing the photo after asking a question.
  - Telegram: `video`/`document` up to 20 MB (bot download limit). Video drafts are sent with `sendVideo` (≤ 50 MB) before the card.
  - Editor cannot see frames (tool results with images would become huge text on OpenAI-compatible providers). Future: vision frames once the owner has a strong local model; music/voice-over; TikTok Content Posting API (needs a TikTok developer app + OAuth; unaudited apps post private-only) and YouTube Data API.

## Decisions taken beyond the spec (Ketua, token health, files backup, 2026-10-18)
- **Ketua** (`packages/agents/src/ketua.ts`, owner chose "Agent Ketua" over a group chat): the owner asks one agent; it picks 2–4 colleagues and asks them in parallel with **`consult_team`** (`packages/tools/src/handoff.ts`: up to 6 questions, `Promise.all` over `ctx.consult`), then answers with one combined reply (Ringkasan / Pandangan pasukan / Risiko / Langkah seterusnya). It hands work over only after the owner agrees.
  - Consult jobs never get `consult_team` (one level).
  - The consults are children of Ketua's job, so the office already sends them to the meeting room (`busyFamilies`).
- **Token health** (`Social.checkTokens`, server timer every 6 h, first run 1 min after boot, `tokenCheckMs` for tests):
  - Threads tokens are renewed weekly via `GET <threads root>/refresh_access_token?grant_type=th_refresh_token`; `expires_at` is stored and shown in SocialSettings.
  - Facebook Page tokens are checked with `GET /{page}?fields=name`.
  - Each problem goes to Telegram once a day.
- **Backups mirror `data/files`** into `BACKUP_DIR/files/` (see the Nightly backup note above).
- The runner sends photos to the model as `file` parts (the AI SDK deprecated `image` parts).
- **System page** (`/system`, Stage 1 of the 2026-10-19 plan).
  - `GET /api/system` (`apps/hub/src/systemInfo.ts`) returns: versions (from the package.json files), the DB schema read with Drizzle `getTableConfig` (plus the FTS `search_index`), counts, and connected integrations (booleans only).
  - `views/SystemView.vue` draws the architecture, ERD and flow with **mermaid** (`components/MermaidDiagram.vue`: lazy chunk, `securityLevel: "strict"`, follows light/dark, scrolls sideways on phones).
  - Next: Stage 2 Video Studio (plus the OpenCut button and watcher), then Stage 3 members and shared agents. Plan file: `~/.claude/plans/pasted-content-id-923a-agent-mellow-parrot.md`.
  - Gemini 009 polishes the page.
- **Video Studio** (`/studio/:uploadId`, Stage 2 of the 2026-10-19 plan).
  - **Stored plans.** `uploads.render` (migration 0008) stores `RenderInfo {plan, attachments}`:
    - `video_edit` passes it to `ctx.uploadVideo`;
    - the runner POSTs it to `/api/runner/uploads/:id/render` (only for its own run's upload).
    - Older renders rebuild the plan from the run's `video_edit` tool_call; the owner's own clips start from a whole-video plan.
    - `EditPlan`, `Clip`, `Caption` and `RenderInfo` now live in `packages/shared/src/video.ts`.
  - **Render again** = job type `video_render` (`apps/hub/src/studio.ts`):
    - it runs as the agent that made the video, else Editor;
    - in `core.ts` it skips the provider, key and budget checks, gets only `["video_edit"]`, and prefers runners whose `programs` include ffmpeg;
    - the runner runs `runtimes/direct.ts` (no LLM, 0 tokens);
    - when done, `Studio.afterRender` → `Content.setDraftVideo` swaps the pending draft's video and emits the new **`draft.updated`** event (the reducer sets `pending_drafts[id].updated_at`; DraftsView reloads).
  - **OpenCut** (owner's choice; it has no API yet):
    - "Edit fully in OpenCut" downloads the video and opens opencut.app (`apps/web/src/opencut.ts`);
    - "Use my own edit" uploads the export → `PATCH /api/drafts/:id/video`;
    - `OpencutWatch` (`apps/hub/src/opencutWatch.ts`, `OPENCUT_API_BASE`) checks GitHub releases and the README's Editor API/MCP/headless lines once a day and sends changes to Telegram (`GET /api/opencut`). It never changes code.
  - Gemini 010 polishes the studio UI.
- **Members and workspaces** (Stage 3, 2026-10-19). Migration 0009.
  - **Tables:** `workspaces`, `users` (email, role, workspace_id, disabled), `agent_shares` (agent, workspace, daily_token_budget).
  - **`workspace_id`** (default `owner`) is on agents, providers, projects, jobs, schedules, uploads, proposals, content_drafts and events. Events with `null` are seen by everyone (runner.*, system.paused).
  - **Slugs** are unique per workspace. The FTS `search_index` was rebuilt with a `workspace_id` column.
  - **Auth** (`auth.ts`): `identify()` returns an `Identity`.
    - cf-access: the owner by `OWNER_EMAIL`, else an enabled member in `users`.
    - local mode: always the owner.
    - `requireUser` sets `c.get("me")`; `ownerOnly` guards runners, integrations, pause, backups, skills catalog/import/proposals, system, members and opencut.
  - **`scope.ts`**:
    - `own*()` / `usableAgent()` answer 404 across workspaces;
    - `visibleAgents()` = own agents + shared ones (`shared: true`);
    - `MEMBER_TOOLS` = no files/shell/git/browser/health/skill_manage, because members' agents run on the owner's PC; no OpenCode, no pinned runner.
  - **Events:** each event gets a workspace (from the run → job, payload ids, or agent; `workspaceOf` in `events.ts`). `EventStore.stateFor(ws)` keeps a per-workspace office. The web WebSocket, `/api/state` and `/api/events` are filtered. Telegram handles only the owner's workspace.
  - **Runs** (`#startRun`):
    - the provider and key come from the **agent's** workspace (a shared agent uses the owner's AI);
    - projects, context, memory (`memory.user.<ws>`, `memory.agent.<id>.<ws>`), colleagues and search come from the **job's** workspace;
    - member jobs never get skill_manage or write approval.
  - **Budgets:** a shared agent is checked against the member's daily limit (`#shareLeft`).
  - **Members:** `Members` (`members.ts`) handles invite, disable, shares and usage; owner routes are `/api/members*`. Web: `/members`, `me.ts` hides owner-only menus, shared agents are read-only.
  - The owner must also add each member's email to the Cloudflare Access policy.
  - Test: `apps/hub/test/members.test.ts` (cf-access JWTs, IDOR checks).
- **Rooms** (owner request, same day; migration 0010). A workspace *is* a room. `workspaces.kind`:
  - `hq`: id `owner`, everything from before;
  - `room`: made by the owner for a sub-business, shareable through `room_members`;
  - `personal`: a member's own room.

  Rules:
  - **Current room** = the `ao_room` cookie, checked in `enterRoom()` (`auth.ts`). The owner (admin) may enter every room, a member only their personal room and the rooms they belong to. It is a cookie so `<img>`, `<video>` and the WebSocket follow it; the web sets it in `me.ts enterRoom()` and reloads. `Identity.home_workspace_id` is the default room.
  - **AI:** agents in a `room` use the **owner's** providers (`aiWorkspace()`) within `workspaces.daily_token_budget` (`roomBudgetLeft`, checked at dispatch and folded into `budget_left_tokens`). Providers cannot be added inside such a room. Personal rooms use the member's own keys.
  - **Tools:** agents in personal rooms or in rooms with members get only `MEMBER_TOOLS` (`restrictedWorkspace()`); the owner's private rooms keep every tool. Members in a room may use and edit its agents and projects.
  - **API:** `Rooms` (`rooms.ts`) handles `GET /api/rooms` (rooms you may enter), and owner-only `POST/PATCH /api/rooms`, `PUT /api/rooms/:id/members`, `POST /api/agents/:id/move` (schedules go with the agent) and `POST /api/projects/:id/move` (brief folder and drafts go with it). Moving an agent does not carry its HQ memory notes.
  - **Web:** `RoomSwitcher` (sidebar and phone bar), `/rooms` (`RoomsView`) and `MoveToRoom` on agent and project cards. Gemini 011 polishes them.
- **Morning briefing** (Ketua, job type `daily_briefing`, schedule 07:30 KL, seeded off; reported on Telegram like the other `REPORT_JOB_TYPES`).
  - `briefingFacts()` (`apps/hub/src/briefing.ts`) collects, per room: yesterday's runs by agent, failures, pending drafts/approvals/skill proposals, cost, room limits and enabled schedules.
  - `#startRun` adds the facts to the assignment's `job.input.facts` (the stored job stays clean). The runner's `jobText` appends any `input.facts` as "Facts from the hub (use only these)".
  - Built-in schedules added after an agent was seeded are offered once (switched off), tracked by the `seeded.schedule.<slug>.<type>` settings keys.
- **Playing in the office** (owner request, 2026-10-19). The logic is in the brain (`world.ts`), the scene only forwards input and draws.
  - **Brain API:**
    - `poke(id)`: a jump + emote; 4 pokes in 6 s = `angry`; 300 ms cooldown; ignored while the agent needs approval.
    - `grab` / `holdAt` / `drop`: a held character is skipped by reconcile and tick. `drop` acts on `zoneAt()` (the smallest zone wins, since the whiteboard is inside the meeting room): pantry coffee, meeting room, library, another agent = both chat. It returns a `DropAction` (`{open:"drafts"}` for the whiteboard, `{open:"chat",agent}` for the owner's desk).
    - `setMe` / `meWalkTo` / `meStep` / `nearMe()`: your own character, id `me`, look `boss`, never touched by reconcile. The nearest agent within 40 px turns to face it.
  - **Rules:** every play action goes through `#act` = `#plan([...steps, intentStep(intent)])`, so a real event still re-plans (catch-up rule). The new `Target` kind `{tile}` is not claimed.
  - **Snapshot fields:** `held`, `isMe`, `effect: "jump"`. New bubbles: `heart`, `angry`, `note`, `smile`, `exclaim` (art in `props.ts`, the `boss` outfit in `characters.ts`; regenerate `maps/`).
  - **Reducer:** a `praised` moment on `draft.decided` (not rejected) → heart hop.
  - **Scene input** (`game.ts`, only with `interactive: true`; Replay leaves it off):
    - on an agent: a 6 px move = carry, 500 ms = menu, a right-click = menu, a tap = select + poke;
    - on the floor: a 4 px move = pan, a tap = walk;
    - arrow keys / WASD (not while typing).
  - **Vue:** the menu is emitted in viewport coordinates → `AgentRadialMenu.vue` (fixed; the backdrop must `@contextmenu.prevent` or the opening right-click closes it). Dashboard handles drop actions and the "Chat with X" chip.
  - Gemini 013 styles them.
- **Project Assistant** (owner request, 2026-10-19: leading the MARDI goat-shed gate project; files come in WhatsApp; the company's ProjectFlow has no API).
  - **Storage:** migration 0011 adds `project_docs`, `project_log` and the FTS table `docs_index` (one row per PDF page, or per ~3,500-character chunk of DOCX/TXT/MD).
  - **Reading:** `apps/hub/src/docs.ts` extracts text with `unpdf` + `mammoth` (pinned) on the owner's PC. PDFs without a text layer or damaged PDFs give a clear 400.
  - **Uploads:** `saveUpload` takes documents up to 25 MB (`DOC_TYPES` in `packages/shared/src/docs.ts`). Chat (`POST /api/chat`) and Telegram (document messages, ≤ 20 MB) call `hub.ingestAttachments` before the job, so attachments carry `doc_id` + `pages`, and the runner's `filesNote` tells the model to `doc_read`.
  - **Tools** (`packages/tools/src/docs.ts`): `docs_search`, `doc_read`, `doc_summary`, `project_log_add`, `project_log_list`, `project_log_update`, via `ctx.projectData` → `POST /api/runner/project-data`. Each action needs its tool, and data is scoped to the job's room.
  - **Owner routes:** `/api/docs` (list, add, search, `/:id/text`) and `/api/log` (list, add, `PATCH`).
  - **Agent:** `project-assistant` (`packages/agents/src/projectAssistant.ts`). Its weekly status is job type `project_status` (Monday 08:30, seeded off) with `docs.statusFacts()` injected as `input.facts`; it is reported on Telegram.
  - **Reminders:** a hub timer from 08:00 KL sends `docs.dueSoon("owner", 2)` to Telegram once a day (`settings.reminders.sent`).
  - **Web:** Projects → Docs (`ProjectDocs.vue`) and Log (`ProjectLog.vue`); chat shows documents as chips. Gemini 014 polishes them.
- **Job routing by programs** (2026-10-19): `requiredPrograms()` (`packages/shared/src/programs.ts`) maps tools to programs (video_* → ffmpeg, git_* → git, browser_check → node, runtime opencode → opencode). `#pickRunner` keeps to runners that reported all of them (waiting for a busy one); if no online runner has them, any runner. A pinned runner always wins. The runner now also reports `opencode`.
- **Scheduled posts** (2026-10-19, migration 0012 `content_drafts.publish_at`): approve with `publish_at` (≥ 1 min, ≤ 60 days, only for drafts `hub.canPublish`) → `afterApprove` skips it; a 1-minute timer runs `hub.publishDue()` (clears the time first, so a failure is not retried) and tells the owner on Telegram. `POST /api/drafts/:id/schedule {publish_at|null}` moves or cancels; Publish now clears it. DraftCard: "Schedule…".
- **Editor hears speech** (owner chose option 1 of the 2026-10-19 research: whisper + a skill; Gemini 015 builds the UI in parallel).
  - **whisper.cpp** b5130 / v1.9.4 CUDA 12.4 in `C:\whisper` (model `ggml-large-v3-turbo-q5_0.bin`), found by `whisperBinary()` / `whisperModel()` or `WHISPER_CPP` / `WHISPER_MODEL`; reported as program `whisper`.
  - **Word times:** `-ml 1 -sow -ojf` gives word times, but they touch each other, and `-dtw` gave nothing in this mode. So `video_transcribe` also runs ffmpeg `silencedetect` (`Transcript.silences`).
  - **Pure logic** in `packages/shared/src/transcript.ts`: `packTranscript`, `tightCuts` (fillers always cut; at most 80 clips, `EditPlan.clips` max 80), `subtitleCues` (follows cuts and speed).
  - **Storage:** migration 0013 adds `uploads.transcript` and the table `edit_suggestions`.
  - **Runner route** `POST /api/runner/video-data`: transcript_get / transcript_put / suggestions, only for files of the running job, gated by tool.
  - **Tools:**
    - `video_transcribe` (cached per upload);
    - `suggest_edits` (2–4 options with full plans → the chat thread `suggestions` and `VideoInfo.suggestions`);
    - `video_edit` `subtitles` → "Pop" ASS style.
  - **Direct jobs:** `DIRECT_JOBS` (shared) = `video_render` → video_edit, `video_transcribe` → video_transcribe. No LLM; the Studio's Transcribe = `POST /api/videos/:id/transcribe`; `GET /api/videos` lists the room's videos.
  - **Built-in upgrades:** `BuiltinAgent.upgrade` adds new tools once (`seeded.tool.<slug>.<tool>`) and replaces a prompt only if it equals an older built-in one. `BUILTIN_SKILLS` are written once (`seeded.skill.<name>`): `short-video-editing`.
  - `spawn()` keeps the full stderr in `log`. Scene changes used the 4000-char tail before, a bug fixed here.
- **Skills per agent** (owner request, 2026-10-19).
  - **Config:** `AgentConfig.skills` = `"all"` (the default, includes new skills) or a list of names. `skillsFor()` (shared) filters `RunAssignment.skills`, so `skill_view` / `skills_list` only know the agent's own skills.
  - **Routes** (owner):
    - `GET /api/skills/assignments`;
    - `PUT /api/skills/:name/agents {agent_ids}`: exactly these agents. An agent on "all" that is left out gets a list without the skill; an agent with no skill tools counts as having none. Assigned agents get `skills_list` + `skill_view`.
    - `PUT /api/agents/:id/skills {skills}`.
  - **Saving:** an agent PATCH whose config lacks `skills` keeps the old value (the Agents form). Gemini 016 builds the UI on /skills.
- **`GET /aitext`** (no login, owner request 2026-10-19) serves `SYSTEM.md` (`SYSTEM_DOC_PATH`) as plain text so the owner can give another AI one link. It holds the same content as the public repo, with no secrets. On the domain it needs a Cloudflare Access **Bypass** application for path `aitext` only (the owner sets it in the dashboard); the rest stays behind Access. Keep SYSTEM.md free of secrets and private data.

## Status and next steps (handoff, 2026-10-17)
Read this first when picking the project up in a new session.
**PENDING (read first, updated 2026-10-17 end of session)**
- 2026-10-18: Ketua + consult_team, token health (Threads auto-renew, Facebook check → Telegram), files mirrored in backups, Manual page in the app. 240 tests green, web built. Owner: restart hub + runner (seeds Editor and Ketua, adds /api/manual), then try Chat → Ketua.
- Latest: Editor (local video edit + TikTok FHD export) built, 236 tests green, web built. Owner: restart hub + runner (migration 0007 adds `uploads.run_id`; Editor is seeded on boot), then test in Chat → Editor. Next: TikTok Content Posting API + YouTube Data API (owner must create the developer apps; ask first). Gemini 008 reviewed, committed and pushed. KIV: add Editor + Instagram/Threads sections to docs/manual.html.
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
- Done 2026-10-17 (owner: "proceed kesemuanya"): Telegram chat + draft buttons, full edit before approve, Skills Browse, Kerani (bookings), update/take down live posts, Facebook Page posting. 227 tests. Owner: restart hub + runner; connect the Facebook Page (docs/facebook-page.md); turn on Kerani's 08:00 schedule if wanted. Instagram auto-post is still open.
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
- `docs/manual.html` is the main manual: the hub serves it at `/api/manual` (`MANUAL_PATH`) and the app shows it at **/manual** (menu System → Manual, phone: More → Manual). `docs/panduan-agent-office.html` is the older short guide.
- Update it when features change.

## Commands
- `bun install` — install
- `bun run dev` — hub + web (Vite on :5180 proxies to hub on :8787)
- `bun run dev:runner` — runner daemon
- `bun test` — all tests
- `bun run typecheck` — strict TS across workspaces
- `bun run db:generate` — regenerate Drizzle migration after editing `apps/hub/src/db/schema.ts`
