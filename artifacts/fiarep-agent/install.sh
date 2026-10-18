#!/bin/bash
# FIAREP desktop agent — one-line install for Mac and Linux.
# Copy the line from Command Center → Computers → Add computer; it looks like:
#   curl -fsSL https://fiarep.com/api/v1/command/agent-files/install.sh | FIAREP_TOKEN='fca_…' FIAREP_KEYS='…' FIAREP_API='https://fiarep.com/api' bash
# Run it again (without FIAREP_TOKEN) to pin a new phone's Face ID key or update the agent.
# Uninstall: curl -fsSL …/install.sh | FIAREP_UNINSTALL=1 bash
set -euo pipefail
API="${FIAREP_API:-https://fiarep.com/api}"
DIR="$HOME/.fiarep-agent"
OS="$(uname -s)"
LABEL="com.fiarep.agent"

if [ "${FIAREP_UNINSTALL:-}" = "1" ]; then
  if [ "$OS" = "Darwin" ]; then
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
  else
    systemctl --user disable --now fiarep-agent.service 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/fiarep-agent.service"
    command -v crontab >/dev/null 2>&1 && { ( crontab -l 2>/dev/null | grep -v 'fiarep-agent' || true ) | crontab - 2>/dev/null || true; }
    pkill -f "$DIR/agent.mjs" 2>/dev/null || true
  fi
  echo "FIAREP agent stopped and removed from startup. Settings left in $DIR."
  exit 0
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ] && [ "$OS" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
  echo "Installing Node.js (Homebrew)…"; brew install node; NODE="$(command -v node || true)"
fi
if [ -z "$NODE" ] || ! "$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  echo "Node.js 20 or newer is needed. Install the LTS version from https://nodejs.org, then run this line again."
  exit 1
fi

mkdir -p "$DIR"; chmod 700 "$DIR"
echo "Downloading the agent from $API…"
curl -fsSL "$API/v1/command/agent-files/agent.mjs" -o "$DIR/agent.new.mjs"
"$NODE" --check "$DIR/agent.new.mjs"
mv "$DIR/agent.new.mjs" "$DIR/agent.mjs"
FIAREP_API="$API" "$NODE" "$DIR/agent.mjs" --setup
chmod 600 "$DIR/config.json"
"$NODE" "$DIR/agent.mjs" --check >/dev/null

if [ "$OS" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/agent.mjs</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StandardOutPath</key><string>$DIR/agent.log</string>
  <key>StandardErrorPath</key><string>$DIR/agent.log</string>
</dict>
</plist>
PLISTEOF
  UIDN="$(id -u)"
  launchctl bootout "gui/$UIDN/$LABEL" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do launchctl print "gui/$UIDN/$LABEL" >/dev/null 2>&1 || break; sleep 1; done
  launchctl bootstrap "gui/$UIDN" "$PLIST" 2>/dev/null || launchctl kickstart -k "gui/$UIDN/$LABEL"
elif command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/fiarep-agent.service" <<UNITEOF
[Unit]
Description=FIAREP desktop agent (Command Center)
After=network-online.target

[Service]
ExecStart=$NODE $DIR/agent.mjs --log $DIR/agent.log
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
UNITEOF
  systemctl --user daemon-reload
  systemctl --user enable --now fiarep-agent.service
  systemctl --user restart fiarep-agent.service
  # Keep running after you log out (asks for your password on some systems; harmless if it fails).
  loginctl enable-linger "$USER" 2>/dev/null || true
else
  # No systemd: start at boot from cron, and start now.
  if command -v crontab >/dev/null 2>&1; then
    ( crontab -l 2>/dev/null | grep -v 'fiarep-agent' || true; echo "@reboot $NODE $DIR/agent.mjs --log $DIR/agent.log # fiarep-agent" ) | crontab - || echo "(could not add it to cron — start it again after a restart with: nohup $NODE $DIR/agent.mjs --log $DIR/agent.log &)"
  else
    echo "(no systemd or cron here — after a restart, start it with: nohup $NODE $DIR/agent.mjs --log $DIR/agent.log &)"
  fi
  pkill -f "$DIR/agent.mjs" 2>/dev/null || true
  nohup "$NODE" "$DIR/agent.mjs" --log "$DIR/agent.log" >/dev/null 2>&1 &
fi
sleep 3
tail -n 3 "$DIR/agent.log" 2>/dev/null || true
echo "FIAREP agent running. It starts by itself when this computer starts. Log: $DIR/agent.log"
echo "What it may touch is in $DIR/config.json (folders, apps, tasks)."
