#!/bin/sh
# Agent Office runner installer (Linux / macOS / WSL). Served by the hub with the URL and
# pairing code filled in. Re-running it updates the runner and keeps the existing pairing.
set -eu

HUB='__HUB__'
CODE='__CODE__'
DIR="${AGENT_OFFICE_DIR:-$HOME/.agent-office-runner}"
NAME="${RUNNER_NAME:-$(hostname)}"

say() { printf '%s\n' "[agent-office] $*"; }

get() {
  if [ -n "${CF_ACCESS_CLIENT_ID:-}" ]; then
    curl -fsSL -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET:-}" "$1" -o "$2"
  else
    curl -fsSL "$1" -o "$2"
  fi
}

# 1. Bun
if command -v bun >/dev/null 2>&1; then
  BUN="$(command -v bun)"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN="$HOME/.bun/bin/bun"
else
  say "installing Bun (https://bun.sh)…"
  curl -fsSL https://bun.sh/install | bash
  BUN="$HOME/.bun/bin/bun"
fi

# 2. Files from the hub
say "downloading the runner from $HUB"
mkdir -p "$DIR/app" "$DIR/browser" "$DIR/data" "$DIR/workspaces"
get "$HUB/install/runner.js?code=$CODE" "$DIR/app/runner.js.new"
get "$HUB/install/worker.mjs?code=$CODE" "$DIR/browser/worker.mjs"
mv -f "$DIR/app/runner.js.new" "$DIR/app/runner.js"

# 3. Settings (Bun loads .env from the working directory)
umask 077
{
  echo "HUB_URL=$HUB"
  echo "RUNNER_NAME=$NAME"
  echo "RUNNER_STATE_PATH=./data/runner-state.json"
  echo "WORKSPACES_DIR=./workspaces"
  if [ -n "${CF_ACCESS_CLIENT_ID:-}" ]; then
    echo "CF_ACCESS_CLIENT_ID=$CF_ACCESS_CLIENT_ID"
    echo "CF_ACCESS_CLIENT_SECRET=${CF_ACCESS_CLIENT_SECRET:-}"
  fi
} > "$DIR/.env"

# 4. Pair (skipped when this PC is already paired with this hub)
say "pairing as \"$NAME\""
(cd "$DIR" && PAIRING_CODE="$CODE" "$BUN" app/runner.js --pair-only)

# 5. Start now and at every boot
if [ -n "${AGENT_OFFICE_NO_SERVICE:-}" ]; then
  say "done. Start it with: cd \"$DIR\" && \"$BUN\" app/runner.js"
elif [ "$(uname -s)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.agent-office.runner.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.agent-office.runner</string>
  <key>ProgramArguments</key><array><string>$BUN</string><string>$DIR/app/runner.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/data/runner.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/runner.log</string>
</dict></plist>
EOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  say "done. The runner starts at login (launchd). Log: $DIR/data/runner.log"
elif command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  UNIT="$HOME/.config/systemd/user/agent-office-runner.service"
  mkdir -p "$(dirname "$UNIT")"
  cat > "$UNIT" <<EOF
[Unit]
Description=Agent Office runner
After=network-online.target

[Service]
WorkingDirectory=$DIR
ExecStart=$BUN $DIR/app/runner.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable agent-office-runner.service >/dev/null
  systemctl --user restart agent-office-runner.service
  say "done. The runner runs as a user service. Logs: journalctl --user -u agent-office-runner -f"
  say "to keep it running while you are logged out: sudo loginctl enable-linger $(id -un)"
else
  (cd "$DIR" && nohup "$BUN" app/runner.js >> data/runner.log 2>&1 &)
  say "done. The runner is running now (no systemd found, so it will not start at boot)."
  say "start it again with: cd \"$DIR\" && \"$BUN\" app/runner.js"
fi
