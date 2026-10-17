# Open Agent Office from your phone (Cloudflare Tunnel + Access)

This guide gets you to the following setup:
- `https://office.yourdomain.com` opens Agent Office from anywhere.
- Only your email can sign in. Cloudflare Access handles the login, and the hub verifies its signed token.
- A runner on another PC can join through the same tunnel.

The hub keeps listening on `127.0.0.1` only, and no router ports are opened. `cloudflared` connects out to Cloudflare.

## What you need
- A domain on Cloudflare (free plan is fine).
- Cloudflare Zero Trust (free for up to 50 users). Your team domain looks like `yourteam.cloudflareaccess.com`.
- The hub PC running the **production** build. Vite's dev server is not for the tunnel:
  ```sh
  bun run build
  bun run start:hub      # serves the UI and the API on HUB_PORT (8788 on this PC)
  ```

## 1. Create the tunnel (on the hub PC)
```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel login                 # pick your domain in the browser
cloudflared tunnel create agent-office   # prints a TUNNEL_ID and writes credentials
cloudflared tunnel route dns agent-office office.yourdomain.com
```

Create `C:\Users\<you>\.cloudflared\config.yml`:
```yaml
tunnel: <TUNNEL_ID>
credentials-file: C:\Users\<you>\.cloudflared\<TUNNEL_ID>.json
ingress:
  - hostname: office.yourdomain.com
    service: http://127.0.0.1:8788
  - service: http_status:404
```

Run it with `cloudflared tunnel run agent-office`. To start it with Windows, install it as a service: `cloudflared service install`.
WebSockets (live office, runners) work through the tunnel without extra settings.

## 2. Protect it with Cloudflare Access
In Zero Trust go to **Access → Applications → Add an application → Self-hosted**:
- Application domain: `office.yourdomain.com`.
- Policy **"Owner"**: Action **Allow**, Include **Emails** = your email.
- Policy **"Runners"**: Action **Service Auth**, Include **Service Token** = a token you create under **Access → Service credentials → Service Tokens**. Copy the Client ID and Client Secret now: the secret is shown once.
- Save. Then open the application's **Overview** and copy the **Application Audience (AUD) tag**.

## 3. Switch the hub to Access sign-in
Set these in the hub's `.env`, then restart `bun run start:hub`:
```ini
AUTH_MODE=cf-access
CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
CF_ACCESS_AUD=<the AUD tag>
OWNER_EMAIL=you@example.com
PUBLIC_BASE_URL=https://office.yourdomain.com
HUB_HOST=127.0.0.1
```

What the hub checks:
- Every request must carry Cloudflare's signed `Cf-Access-Jwt-Assertion`, with the right team, the right AUD, a valid signature and **your** email. Anything else gets a 401, including requests that skip the tunnel.
- The old `LOCAL_AUTH_TOKEN` no longer opens the office in this mode.
- **Log out** also ends the Cloudflare session (`/cdn-cgi/access/logout`).

> Opening `http://127.0.0.1:8788` directly on the hub PC now shows the "Sign in with Cloudflare Access" page, which cannot sign you in there. Use the domain, or switch back to `AUTH_MODE=local` for local work.

## 4. A runner on another PC
On the other machine:
```sh
git clone <this repo> && cd MyOfis && bun install
npm install -g opencode-ai   # only if this runner should run the Coder
npx playwright install chromium   # only if it should run browser checks (needs Node 22+)
```
Its `.env` needs only the runner part:
```ini
HUB_URL=https://office.yourdomain.com
RUNNER_NAME=laptop
PAIRING_CODE=XXXX-XXXX          # Runners page -> New pairing code (10 minutes, single use)
CF_ACCESS_CLIENT_ID=<service token id>
CF_ACCESS_CLIENT_SECRET=<service token secret>
```
Start it with `bun run start:runner`. After pairing, the token is saved in `data/runner-state.json`, so remove `PAIRING_CODE`.

The runner sends the service token on every connection, so Access lets it through. The hub still requires the runner's own token.

**Choosing who runs where:** set an agent's **Runner** in Agents → Edit. Leave it empty to use any free runner.

## 5. Done-when check (spec Phase 5)
1. On your phone (mobile data, not home Wi-Fi), open `https://office.yourdomain.com` and sign in with your email code.
2. Start a job that needs an approval and approve it from the phone (or from Telegram).
3. In Runners, confirm the second machine is **online**. Set an agent's runner to it, give it a job, and watch it run.

## Troubleshooting
- **401 everywhere after switching.** Check `CF_ACCESS_AUD` (it is per application) and `OWNER_EMAIL` (it must be exactly the email you signed in with).
- **The runner says "unauthorized" or keeps reconnecting.** The service token is missing or wrong, or the "Runners" Service Auth policy is not on the same application.
- **"403 cross-origin" on buttons.** `PUBLIC_BASE_URL` must be the https domain you open in the browser.
