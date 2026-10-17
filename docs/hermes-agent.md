# Connect your Hermes Agent (on another PC) to Agent Office

Hermes Agent (Nous Research) can run an **OpenAI-compatible API server**. Agent Office talks to any OpenAI-compatible provider, so Hermes becomes one more agent in the office with **no code changes**:
- it shows up as a character;
- you chat with it on Chat;
- you give it jobs and schedules;
- you can hand work off to it.

```
 This PC (hub + runner)                     Other PC (Hermes Agent)
 Agent Office ── HTTP /v1/chat/completions ──▶ hermes gateway :8642
                                               (its own tools, memory, skills)
```

**Important: Hermes runs its own tools on its own PC** (terminal, files, web, memory). Agent Office's approvals, shell allowlist and path guards **do not apply** to what Hermes does there. Agent Office only sees the final answer. Limit what Hermes may do in Hermes's own settings.

## 1. On the other PC: turn on the API server

1. Edit `~/.hermes/.env` and add:
   ```
   API_SERVER_ENABLED=true
   API_SERVER_KEY=<a long random string>
   API_SERVER_HOST=0.0.0.0
   API_SERVER_PORT=8642
   ```
   - To make the key: `openssl rand -hex 32`, or in PowerShell `[guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")`.
   - `API_SERVER_HOST=0.0.0.0` lets other machines on your network reach it. The default `127.0.0.1` allows only that PC.
2. Start it and keep it running:
   ```
   hermes gateway
   ```
   It should print `API server listening on http://0.0.0.0:8642`.
3. Allow port **8642** in that PC's firewall for your **home network only (Private)**. Never forward this port on your router.
4. Find that PC's IP address (`ipconfig` on Windows, `ip a` on Linux), e.g. `192.168.1.50`.

## 2. On this PC: check that it is reachable

```
curl http://192.168.1.50:8642/health        # {"status": "ok"}
curl http://192.168.1.50:8642/v1/models      # lists "hermes-agent"
```

If either check fails:
- check the firewall on the Hermes PC;
- check that both PCs are on the same network;
- check that `hermes gateway` is still running.

If the PCs are not on the same network, use **Tailscale** on both, then use the Tailscale IP (100.x.x.x) instead.

## 3. In Agent Office: add Hermes as a provider

1. Open **Settings → Providers → Add** and pick **Custom (OpenAI-compatible)**.
2. Fill in the form:

   | Field | Value |
   |---|---|
   | Name / slug | `hermes` |
   | Base URL | `http://192.168.1.50:8642/v1` (the `/v1` is required) |
   | API key | the `API_SERVER_KEY` from step 1 |
   | Model | `hermes-agent` |

3. Press **Test**, then **Save**. The key is encrypted on this hub and never shown again.

## 4. Create the Hermes agent

1. Open **Agents → New agent**.
2. Fill in:
   - **Name:** `Hermes` (or anything you like). **Role:** e.g. "Research + general assistant (runs on the other PC)".
   - **Provider:** `hermes`. **Model:** `hermes-agent`.
   - **Tools:** none. Hermes uses its own tools on its PC. Giving it Agent Office tools as well only confuses it.
   - **Learn after work:** off. Hermes already keeps its own memory and skills.
   - **System prompt:** keep it short. Hermes has its own personality and settings, e.g. "Answer for the owner of Agent Office. Keep answers short."
3. Save. Hermes appears in the office and in **Chat**.

## 5. Use it

- **Chat:** pick Hermes in **Chat** and talk to it like you do on the other PC.
- **Jobs:** give it a **New job**. The answer lands in the run like any other agent's (output.md).
- **Schedules:** e.g. a daily research summary.
- **Handoff:** add Hermes to another agent's handoff targets, so that agent can pass work to it.
- **Skills:** to copy Hermes's skills into Agent Office, go to **Skills → Import SKILL.md** and paste a file from the Hermes PC (`~/.hermes/skills/<name>/SKILL.md`).

## Troubleshooting

| What you see | Fix |
|---|---|
| `fetch failed` / timeout | Is `hermes gateway` running? Is the firewall open? Is the IP right? |
| 401 | The API key in the provider doesn't match `API_SERVER_KEY`. |
| 404 or no models | The base URL must end with `/v1`. |
| Long jobs stop | Hermes may run many tools before answering. Raise the agent's max steps, or ask for smaller pieces of work. |

## Other kind of "PC lain": a runner on another machine

This is a different setup. Here the other PC runs **our** runner, so Agent Office's tools, approvals and guards apply, and the agents' work happens on that PC. That setup goes through the Cloudflare tunnel: see [cloudflare-tunnel.md](cloudflare-tunnel.md) §4.
