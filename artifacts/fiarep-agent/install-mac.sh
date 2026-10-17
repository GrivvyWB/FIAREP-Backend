#!/bin/bash
# Installs the FIAREP desktop agent on this Mac and starts it at login (launchd).
#   ./install-mac.sh            install / update, then start
#   ./install-mac.sh --uninstall
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/.fiarep-agent"
LABEL="com.fiarep.agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Agent stopped and removed from login items. Config left in $DIR."
  exit 0
fi

NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Node 20+ is required (brew install node)."; exit 1; }
"$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || { echo "Node 20+ is required; found $("$NODE" -v)."; exit 1; }

mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$DIR"
cp "$HERE/agent.mjs" "$DIR/agent.mjs"
if [ ! -f "$DIR/config.json" ]; then
  cp "$HERE/config.example.json" "$DIR/config.json"
  chmod 600 "$DIR/config.json"
  echo "Wrote $DIR/config.json — paste the agent token from Platform Control → Command Center, then run this again."
  exit 0
fi
chmod 600 "$DIR/config.json"
"$NODE" "$DIR/agent.mjs" --check >/dev/null

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

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
sleep 2
tail -n 3 "$DIR/agent.log" || true
echo "Agent running. Log: $DIR/agent.log"
