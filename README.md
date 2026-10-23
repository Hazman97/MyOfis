# Agent Office

A personal AI agent orchestration system for a single owner. You create agents, give them jobs, approve risky actions, and watch them work in a pixel-art office. The full spec is in [SPEC.md](SPEC.md).

**Status: Phase 5 done: every phase of the spec is built (Phases 4 and 5 await the owner's sign-off).**
- **Exposure (Phase 5):**
  - `AUTH_MODE=cf-access` (Cloudflare Access JWT verified against your team and email);
  - a Cloudflare Tunnel guide, and runners on other machines through the tunnel ([docs/cloudflare-tunnel.md](docs/cloudflare-tunnel.md));
  - **Replay** of past runs in the office at 1x/4x/16x;
  - **learning like Hermes Agent**: bounded memory (own notes + your shared profile), SKILL.md skills you approve, search over past work;
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
bun run dev           # hub + Vite on http://127.0.0.1:5180 + the runner, in one terminal
bun run dev:no-runner # the same without the runner (when it runs elsewhere, e.g. PM2)
```

**Always on (PM2, this PC):**
- `C:\Users\Hazman\ecosystem.config.js` has three entries: `9router` (127.0.0.1:20128 only), `myofis-hub` and `myofis-runner`. `pm2-startup.ps1` starts them at boot.
- Use PM2 or `bun run dev`, not both: they share port 8788 and the runner token.
- For development: `pm2 stop myofis-hub myofis-runner`, then `bun run dev`.

**In the background without PM2 (no terminal windows):** `scripts\background.ps1 start | stop | restart | status | logs | autostart`. It starts the hub and runner hidden, writes `data/logs/*.log` and, with `autostart`, adds a hidden Startup-folder entry (no admin). The same rule applies: not together with `bun run dev` or PM2.

**Production-ish:**

```sh
bun run build         # builds apps/web/dist
bun run start:hub     # hub serves the UI on http://127.0.0.1:8787
```

The hub binds to `127.0.0.1` only. Never expose it directly. For access from your phone or other machines, put it behind Cloudflare Tunnel + Access: [docs/cloudflare-tunnel.md](docs/cloudflare-tunnel.md).

## Pair a runner

The runner is a separate process that **connects out** to the hub, so the runner PC needs no open ports. It runs the same way on this PC or on another machine.

**Another PC, one line (recommended).**
1. Open **Runners → Connect a PC**. The page shows a pairing code (single use, 10 minutes) and two commands.
2. Paste the matching command into a terminal on the other PC:
   ```powershell
   irm "http://192.168.1.50:8788/install.ps1?code=XXXX-XXXX" | iex     # Windows
   ```
   ```sh
   curl -fsSL "http://192.168.1.50:8788/install.sh?code=XXXX-XXXX" | sh   # Linux / Mac
   ```
3. The installer:
   - installs Bun if it is missing;
   - downloads the runner from the hub as one bundled file into `~/.agent-office-runner`;
   - pairs it;
   - starts it at every boot or login: a hidden launcher in the Startup folder on Windows, a systemd user service on Linux, launchd on Mac. No admin rights needed.
4. The page shows "… is connected" when the PC is in.

Re-running the command with a new code updates the runner and keeps the same pairing.

For the other PC to reach the hub on your WiFi, set `HUB_HOST=0.0.0.0` and `PUBLIC_BASE_URL=http://<this PC's IP>:8788` in `.env`. Anyone on your network can then reach the login page. From outside your home, use Cloudflare Tunnel ([docs/cloudflare-tunnel.md](docs/cloudflare-tunnel.md)).

**Extra programs on the runner PC.**
- Browser checks need Node 22+ and Playwright: `cd ~/.agent-office-runner && npm i playwright && npx playwright install chromium`.
- The Coder needs `npm i -g opencode-ai`.

The Runners page shows which helper programs each PC has (git, node, ffmpeg, blender…). Jobs follow them: an agent with video tools goes to a PC with ffmpeg, git tools to one with git, browser checks to one with node, and the Coder (OpenCode) to one with opencode. If no online PC has them, the job runs anywhere and the tool says what is missing.

**From a copy of the repo (this PC, development).**
1. Open **Runners → Connect a PC → Run from a copy of this repo instead**.
2. Then run:
   ```sh
   HUB_URL=http://127.0.0.1:8787 RUNNER_NAME=main-pc PAIRING_CODE=XXXX-XXXX bun run start:runner
   ```

The runner stores its long-lived token in `data/runner-state.json`. Later starts only need `bun run start:runner` (or `bun run dev:runner`).

You can revoke a runner from the Runners page. Each run gets its own folder under `workspaces/<agent>/<run_id>/`.

**Hermes Agent on another PC** can join as a provider instead: see [docs/hermes-agent.md](docs/hermes-agent.md).

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

**Playing with the agents** (only in your browser; real work always wins):
- **Tap** an agent: it hops with an emote (❗ ❤ ♪ 😄). Poke it four times and it gets angry 💢. An agent also hops with a heart when you approve its draft.
- **Drag** an agent and drop it somewhere:
  - pantry: coffee break;
  - meeting room: sits in a meeting;
  - another agent: the two chat;
  - library: reads;
  - whiteboard: opens **Drafts**;
  - your desk: opens **Chat** with it.

  After a few seconds it walks back to its work.
- **Long-press** or **right-click** an agent: a ring menu with **Chat · New job · Pause · Memory · Poke**.
- **Your character** (navy suit, "your name (you)") walks where you tap the floor, or with the **arrow keys / WASD**. Next to an agent, that agent turns to you and **💬 Chat with …** appears.

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

## Replay

**Replay** (`/replay`, or **Replay in the office** on any finished run) rebuilds the office as it was and lets the characters re-enact a run or a time range at 1x/4x/16x. Long waits are shortened. It uses its own copy of the state, so the live office is untouched.

Not built, on purpose: the Docker sandbox (you chose no Docker) and Langfuse tracing (optional in the spec).

## Learning: memory, skills, past work (Hermes Agent style)

Agents with the learning tools (Coach and Marketing by default; add them to any agent in **Agents**) get better over time, in the way Nous Research's Hermes Agent does:
- **Memory.** Each agent keeps short **notes** for itself (2200 characters). All agents share one short **profile of you** (1375 characters), e.g. "prefers casual Manglish", "no emoji on Facebook".
  - Both are loaded at the start of every job.
  - When a store is full, the agent merges old entries instead of piling up.
  - Anything that looks like an injected instruction or a secret is refused.
  - To see or edit them, click the agent in the office and open its **Memory** section.
- **Skills.** Reusable procedures saved as `skills/<name>/SKILL.md` (the same format as Hermes Agent).
  - Agents *propose* new skills or improvements, and nothing is saved until you approve it on **Skills** (`/skills`), which shows a diff and warnings.
  - You can also paste in a SKILL.md, for example one from your Hermes setup.
  - Agents see only the list of skills, and open the full text when a task needs it.
- **Past work.** `session_search` finds earlier jobs and chats ("the caption we did last week").
- **Looking back.** After a big job (5+ tool calls) or every 5th chat message, the agent takes a short extra pass to decide whether anything is worth saving. Turn it off per agent with **Learn after work** (`self_review`).
- **Switch "Ask me before agents change their memory".** It is on the Skills page. When it is on, memory changes wait there for your approval too.

## Researcher, asking each other, and "How you like it"

- **Researcher** searches the web and reads pages, then answers with sources.
  - Search works with **no setup**: the hub uses DuckDuckGo first, then your own **SearXNG** ([docs/searxng.md](docs/searxng.md), no Docker), then a Tavily or Brave key if you add one (Settings → Integrations → **Web search**). Keys stay encrypted in the hub; runners never see them.
  - Reading a page (`web_fetch`) works without a key.
  - Web content is treated as untrusted data: suspicious pages are flagged, and local or private addresses are refused unless you list the host in the agent's HTTP allowlist.
- **consult_agent:** an agent asks a colleague and waits for the answer, e.g. Marketing asks Researcher for today's rental prices before writing a promo.
  - The question shows up as a small "Question from …" job for the other agent.
  - It goes one level only: whoever answers cannot ask further.
  - Give the tool to an agent in **Agents → Edit → Tools**.
- **How you like it:** click an agent in the office and pick language (Manglish / BM / English), tone, reply length, emoji and format, plus free notes such as "Panggil saya boss".
  - It applies to every job and chat from then on, on top of the agent's role.
  - What all agents should know about **you** goes in the shared **About you** memory instead.

## Publisher: posts for your own websites

Chat with **Publisher** (here or in Telegram), press 📷 to add photos (up to 4), and write a few points. Before approving you can edit every field (title, summary, date, time, place, tags, cover); after publishing, **Edit live post** and **Take down** change the website, and Publisher can do the same from chat (you approve the change first). Publisher looks at the photos, asks about anything missing, then writes the website post (title, summary, Markdown body, tags, event date/time/place, cover photo) and a matching social caption. Both wait in **Drafts**. **Approve** publishes the post to the website; if the site is down, the draft shows the error and **Publish again**. **Schedule…** next to Approve picks a time (up to 60 days ahead): the draft is approved now and goes out then (website and connected Facebook / Instagram / Threads). Telegram tells you when it is out or if it failed; the card lets you cancel the schedule or publish now.

Each website exposes one signed endpoint. Set it per project in **Projects → Brief → Website**, then press **Test**. SmashPoint's is in its Worker. The setup and the contract for other sites are in [docs/website-publishing.md](docs/website-publishing.md).

## System page

**System → System** shows the whole system on one page, read live from the running hub:
- counts;
- an architecture diagram;
- the stack with versions;
- the database ERD;
- agents, tools and events;
- the main flow;
- what is connected;
- the safety rules.

## Notulis: meeting recordings → notes

Record a meeting on your phone and send the file to **Notulis** (Chat, up to 2 GB; Telegram voice notes / audio up to 20 MB). Pick the project first and write the names and terms in the message.
- whisper transcribes it **on your PC** (offline, about 2 minutes per hour of audio on the GPU) with settings that stop the invented lines quiet recordings give.
- Notulis writes the notes: summary, what changed against the project's documents, decisions and action items marked **(sahkan)** where unsure. It saves the transcript and the notes in **Projects → Docs**, and the decisions and actions in the **Log**.
- Ask later ("apa keputusan pasal kipas?") and it answers from the transcript with the time in the recording.

Without MyOfis: right-click a recording → **Send to → Transkrip (Whisper)** gives `.txt` + `.srt` next to the file. See [docs/notulis.md](docs/notulis.md).

## Project Assistant: your project's memory

Use it when you lead a project for a client (e.g. "MARDI Automatic Goat Shed Gate").
1. Make the project in **Projects** (optionally inside its own Room).
2. In **Chat**, pick **Project Assistant**, choose the project, and attach the files: minutes, brochures, specs (PDF, DOCX, TXT, MD, up to 25 MB). Or forward them to the Telegram bot (up to 20 MB).
3. The files are read **on your PC** and indexed page by page. The assistant then:
   - summarises each file;
   - logs the decisions, action items (who / due date), meetings, risks and dates;
   - answers your questions with the file and page.

Tell it updates in plain words ("site visit siap", "client nak solar") and it keeps the log current. **Projects → (project) → Docs / Log** shows every file, a search box, the summaries and the log, where you can add or tick items.

Two things happen on their own:
- **Every morning at 08:00** Telegram lists the actions and dates due within 2 days or overdue.
- **Every Monday at 08:30** (turn it on in **Schedules**) the assistant sends a weekly status.

Scanned PDFs without a text layer cannot be read: send the original file.

## Ketua: ask the whole office

Chat with **Ketua** (or `/agent ketua` in Telegram) when you want the team's view, for example "nak buat sistem booking kamera, okay ke?". Ketua picks the colleagues who matter (Researcher, Coder, Marketing, Kerani…) and asks them **at the same time** (`consult_team`). In the office they walk to the meeting room. Then you get one answer: a short verdict, each colleague's point, the risks and a numbered plan. Say "ok proceed" and Ketua hands the work to the right agents.

**Morning briefing.** In **Schedules**, turn on Ketua's 07:30 "Taklimat pagi". Every morning the hub gathers the facts and Ketua sends a short summary to Telegram:
- yesterday's finished and failed work;
- drafts and approvals waiting for you;
- today's bookings (asked from Kerani);
- AI cost, and rooms near their limit.

## Editor: videos for TikTok, Reels and Shorts

Chat with **Editor** and attach videos:
- web chat: up to 10 files, 2 GB each, sent in 32 MB parts;
- Telegram: up to 20 MB.

Say what you want ("compress untuk TikTok", "highlight 30 saat dari 1:20, slow motion, tulis …"). Editor cuts, reframes (crop / blur / pad) and exports with **ffmpeg on the runner PC**, using the NVIDIA GPU (h264_nvenc) when there is one. Presets: `tiktok_fhd` 1080×1920, `reels`, `youtube_shorts`, `youtube_1080p`, `square`. It then saves a video draft with a caption per platform. In **Drafts** you play it, **Download video**, and approve it. TikTok and YouTube posting are not connected yet. Guide: [docs/video-editor.md](docs/video-editor.md).

**Two ways in.** Chat with Editor, or open **Video Studio** from the menu and add a video there.

**Transcripts and suggestions.** Editor transcribes speech with **whisper.cpp on your PC** (free, GPU) and measures the pauses. Unless you said exactly what to make, it then shows 2–3 **edit options** as cards (tight cut + subtitles, a 30 s highlight, just compress). Pick one in Chat, or use it in the Video Studio. The studio can also **Transcribe**, make a **Tight cut** (no pauses, no "um") and turn on **Subtitles** without the AI. Setup: docs/video-editor.md → Transcripts.

**Video Studio.** Open it from the menu, a draft's video, or a video Editor made in Chat. It shows how the video was edited: a timeline, the clips (start, end, speed, order), the captions, the format, fit and frame rate. Change anything and press **Render again**: it renders on your PC without the AI and uses no tokens, and the draft switches to the new video.

For heavier edits, **Edit fully in OpenCut**:
1. The video downloads and opencut.app opens.
2. Drag the video in, edit it and export it.
3. Press **Use my own edit** to put the export on the draft.

The hub checks OpenCut's GitHub once a day and tells you on Telegram when it releases something new or its API plans change.

## TikTok agent: your clips, posted every day

Drop your own clips (scenery, walking, static shots) into a folder on the runner PC. The **TikTok** agent then:
1. picks clips for a theme;
2. cuts a 7–15 s vertical video with a hook text (and music from `music\`);
3. writes a Bahasa Malaysia caption;
4. posts it through **Zernio**. Connect it in Projects → Brief → TikTok.

With **Post without approval** (Agents → TikTok, daily limit 1–15), it posts straight away and tells you on Telegram. Otherwise it waits in Drafts. A daily 20:00 schedule is ready, switched off. Guide: [docs/tiktok-agent.md](docs/tiktok-agent.md).

## Telegram as your office phone

Message the bot like a colleague:
- Text or photos (albums too) go to **Publisher** by default. Its answer comes back in Telegram.
- Commands: `/agent <slug>` and `/agents` (talk to someone else), `/project <slug>`, `/new` (fresh conversation), `/status`.
- Every new draft arrives as a card with **✅ Approve** / **❌ Reject**:
  - approving a website post publishes it;
  - approving a Facebook caption posts it to the project's Page, when one is connected (docs/facebook-page.md).

## Kerani: bookings

**Kerani** reads SmashPoint's bookings (through the same signed endpoint as Publisher) and writes a short report:
- today's games;
- who has not paid, with tap-to-send WhatsApp reminder links;
- free slots;
- anything odd.

Ask it in Chat or Telegram, or turn on its 08:00 schedule in **Schedules** (the report then comes to Telegram).

## Skills: Browse

**Skills → Browse** lists about 230 public skills from Anthropic and Hermes Agent, with their licences. **Install** copies the SKILL.md into your library. Skills marked "limited" have source-available terms.

## Backups

Every night after 3 am (Malaysia time) the hub saves a copy of the database, `projects/` and `skills/` to `data/backups/<date>/` and keeps 14 days (`BACKUP_HOUR`, `BACKUP_KEEP`, `BACKUP_DIR` in `.env`). Photos, videos and run artifacts (`data/files`) are mirrored once into `data/backups/files/`: new files only, never pruned. A failed backup is reported on Telegram. **Settings → Integrations → Backups** lists them and has **Back up now**.

To restore:
1. Stop the hub.
2. Copy `agent-office.db` over `data/agent-office.db`, and the folders back.
3. Start the hub.

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
