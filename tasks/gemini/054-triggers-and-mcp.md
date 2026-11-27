# 054: Triggers (webhook / RSS / email) + MCP servers for agents

Owner (2026-11-27), after research (Lindy, Relevance, FleetQ, n8n): agents should start work by themselves when
something happens, and be able to use outside apps (Google Calendar, Sheets, Notion…) through MCP.

Read first: `tasks/gemini/SUPERVISOR.md`, CLAUDE.md "Run limits", "Members and workspaces" (`MEMBER_TOOLS`,
`restrictedWorkspace`), "OpenChatCut" (`packages/tools/src/openchatcut.ts`: our existing MCP Streamable HTTP
client — reuse it), schedules (`apps/hub/src/scheduler.ts`), `runTool()` risk/approval flow, public route rules
(task 038/049: separate Cloudflare Access Bypass app per public path).

## Part A — Triggers
Table `triggers {id, workspace_id, agent_id, kind: webhook|rss|email, name, enabled, config JSON, secret_enc?,
last_fired_at, fire_count_today, created_at}` (migration). Every firing creates a normal job (`type: "trigger"`,
`input: {trigger_id, kind, payload}`) and an event `trigger.fired`; budgets, run limits and approvals apply as usual.
- **Webhook**: public `POST /hooks/:id` (own Bypass app for path `hooks`; register before `/api`). Auth: header
  `X-MyOfis-Signature: v1=<hmac>` over `<ts>.<body>` (5-min window, same as website publishing) **or** a long random
  token in the URL for tools that cannot sign (owner picks; token shown once, stored hashed). Body ≤ 256 KB JSON or
  form; stored trimmed. Rate limit per trigger (default 30/hour) + `max_per_day`. Payload goes to the agent wrapped
  as UNTRUSTED with `memoryContentProblem` flags (like `web_fetch`).
- **RSS/Atom**: poll every N minutes (15–1440); new items only (store seen GUIDs/links, first poll records
  without firing); `web_fetch` safety rules (no private addresses). One job per new item, max 5 per poll.
- **Email**: depends on 055 (Gmail). Config: Gmail label or search query; fires per new matching message.
  Leave the kind in the schema but hidden in the UI until 055 lands.
- UI: Agents → agent → **Triggers** tab: add/edit, copy URL, test-fire with a sample payload, history (last 20
  firings with job links), enable switch. Telegram notice on a trigger's first failure of the day.

## Part B — MCP servers
- Room setting `mcp.servers.<workspace>` = list of `{id, name, transport: "http"|"stdio", url?, command?, args?,
  headers_enc?, enabled}`. `stdio` only in the owner's private rooms (it runs a program on the runner PC); members'
  rooms: `http` only, and only URLs the owner allow-listed.
- Agent config `mcp: [{server_id, tools: "all" | string[]}]`. At run start the runner connects (reuse the
  OpenChatCut client; one session per run), lists tools, and exposes each allowed one as tool
  `mcp__<server>__<tool>` with its JSON schema (sanitised; names ≤ 64 chars).
- **Every MCP call goes through `runTool()`**: default risk `review` (owner approves); the owner can mark specific
  tools `safe` (read-only ones like `list_events`) per agent. Results are wrapped UNTRUSTED and size-capped (20 KB).
  Secrets (headers) live on the hub, sent to the runner in `run.assign` like provider keys, memory only.
- UI: Settings → Integrations → **MCP servers** (add, test = list tools, enable); Agents form: pick servers and
  tools, mark safe ones.
- Docs `docs/mcp.md`: how to add Google Calendar / Sheets / Notion MCP servers (official or well-known ones —
  check each one's current URL and auth method and write the date checked).

## Tests
Webhook: good signature → job; bad/old signature, wrong token, over size, over rate → refused and no job; payload
marked untrusted. RSS: first poll records only; new item fires once; private address refused. MCP (fake HTTP MCP
server in-process): tools listed and prefixed; `review` tool creates an approval and runs only after approve;
`safe` tool runs directly; stdio refused in a member room; result cap. Cross-room trigger/agent ids → 404.

## Proof
Raw new tests, `bun run typecheck`, full `bun test`, web build final lines; screenshots of the Triggers tab and MCP
settings (360 px + desktop). Anything not run is NOT RUN. Do not commit.
