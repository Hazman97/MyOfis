# External Agents in the Office

External agents let outside AI workers—such as **canopy workers** (Claude Code processes running on the owner's PC powered by `canopy-ai` on AWS in `~/.canopy-worker/`), Gemini CLI, or Hermes—appear live in the 3D and pixel office alongside built-in agents.

When an external worker starts a session, calls tools (`Bash`, `Read`, `Edit`, `Grep`, `WebFetch`, etc.), or finishes, it posts lightweight activity events to `/api/external/activity`. The hub translates those into the same reducer events (`job.created`, `job.queued`, `run.started`, `agent.thinking`, `agent.tool_call`, `agent.tool_result`, `run.finished`, `run.failed`) that drive the office characters and the Work Feed.

---

## 1. Create an External Agent & Get Its Token

### Via the Web UI
1. Open **Agents** (`/agents`) as the owner.
2. Click **New external agent** (or click **New agent** and check **External worker**).
3. Enter a **Name** (e.g. `Canopy Worker 1`), **Slug** (e.g. `canopy-worker-1`), and **Role** (e.g. `Canopy worker · Qwen 27B`), then click **Save agent**.
4. Copy the one-time **External token** shown on the agent's card (you can rotate it anytime by clicking **Token** on the card).

### Via the Hub API
```bash
# 1. Create the external agent (owner only)
curl -X POST http://127.0.0.1:8788/api/agents \
  -H "Authorization: Bearer $HUB_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "canopy-worker-1",
    "name": "Canopy Worker 1",
    "role": "Canopy worker · Qwen 27B",
    "kind": "external"
  }'

# 2. Issue or rotate its external token (shown once; hub stores only SHA-256 hash)
curl -X POST http://127.0.0.1:8788/api/agents/<agent_id>/external-token \
  -H "Authorization: Bearer $HUB_ADMIN_TOKEN"
```

---

## 2. Configure Claude Code Hooks (`~/.canopy-worker/config/settings.json`)

Set the environment variables for your worker process (or inline in the hook command):

```bash
export MYOFIS_URL="http://127.0.0.1:8788"
export MYOFIS_EXTERNAL_TOKEN="<paste-one-time-external-token>"
```

Add the `hooks` block to `~/.canopy-worker/config/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun run C:/Users/Hazman/Documents/GitHub/MyOfis/scripts/external-agent-hook.ts"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bun run C:/Users/Hazman/Documents/GitHub/MyOfis/scripts/external-agent-hook.ts"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bun run C:/Users/Hazman/Documents/GitHub/MyOfis/scripts/external-agent-hook.ts"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun run C:/Users/Hazman/Documents/GitHub/MyOfis/scripts/external-agent-hook.ts"
          }
        ]
      }
    ]
  }
}
```

### How the Hook Script Behaves
- **Non-blocking**: Uses a 2-second timeout (`AbortSignal.timeout(2000)`), swallows all network/parse errors, and always exits `0` so it never slows down or breaks a worker.
- **No secrets or file contents**: Only sends the tool name and a short safe summary (e.g. last path segments or command binary name). File contents (`content`, `new_string`, `old_string`), stdout/stderr, URL query strings, and secret tokens (`sk-...`, `Bearer ...`, `TOKEN=...`) are never transmitted.

---

## 3. Direct API Reference (`POST /api/external/activity`)

Other outside agents (Gemini CLI, Hermes, custom scripts) can post directly to `POST /api/external/activity` on `http://127.0.0.1:8788` or through the public domain (no Cloudflare Access user session is required; the Bearer token authenticates the external agent).

- **Headers**: `Authorization: Bearer <MYOFIS_EXTERNAL_TOKEN>`, `Content-Type: application/json`
- **Limits**: Body ≤ 16 KB, rate limit 20 events/second per token (`429` when exceeded).
- **Stale sessions**: Any running external session with no activity for **30 minutes** is automatically marked `failed` with `"lost contact"` by `sweep()`.
- **Implicit start**: If a non-`start` event arrives for an unknown `session_id`, the hub starts the session automatically with title `"(external work)"`.

```json
{
  "session_id": "sess-01",
  "event": "tool",
  "tool": "Edit",
  "input_summary": "apps/hub/src/core.ts"
}
```

