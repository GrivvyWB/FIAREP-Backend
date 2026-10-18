#!/bin/bash
# Puts the FIAREP backup relay on your Cloudflare account (free plan) and
# connects your Mac agent to it. Run on the Mac from artifacts/fiarep-relay:
#   ./setup.sh
# Safe to run again: it reuses the same tokens and storage.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$HOME/.fiarep-agent"
SECRETS="$AGENT_DIR/relay-secrets.json"
WR="npx --yes wrangler@4"
cd "$HERE"
mkdir -p "$AGENT_DIR"; chmod 700 "$AGENT_DIR"

echo "1/5 Cloudflare sign-in (a browser window opens the first time)…"
$WR whoami >/dev/null 2>&1 || $WR login

echo "2/5 Storage (KV)…"
if grep -q 'REPLACE_WITH_KV_ID' wrangler.toml; then
  OUT="$($WR kv namespace create RELAY 2>&1 || true)"
  KV_ID="$(printf '%s' "$OUT" | grep -oE '[0-9a-f]{32}' | head -1 || true)"
  if [ -z "$KV_ID" ]; then
    KV_ID="$($WR kv namespace list 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const l=JSON.parse(s);const n=l.find(x=>/RELAY/.test(x.title));console.log(n?n.id:"")}catch{console.log("")}})')"
  fi
  [ -n "$KV_ID" ] || { echo "Could not create or find the KV namespace:"; echo "$OUT"; exit 1; }
  sed -i '' "s/REPLACE_WITH_KV_ID/$KV_ID/" wrangler.toml
fi
echo "   KV: $(grep -oE '[0-9a-f]{32}' wrangler.toml | head -1)"

echo "3/5 Deploying the relay…"
DEPLOY="$($WR deploy 2>&1)" || { echo "$DEPLOY"; exit 1; }
URL="$(printf '%s' "$DEPLOY" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)"
[ -n "$URL" ] || { echo "$DEPLOY"; echo "Deployed, but could not read the URL above — paste it to Claude."; exit 1; }
echo "   $URL"

echo "4/5 Tokens…"
if [ -f "$SECRETS" ]; then
  AGENT_TOKEN="$(node -e 'console.log(require(process.argv[1]).agentToken)' "$SECRETS")"
  SERVER_TOKEN="$(node -e 'console.log(require(process.argv[1]).serverToken)' "$SECRETS")"
else
  AGENT_TOKEN="$(openssl rand -hex 32)"; SERVER_TOKEN="$(openssl rand -hex 32)"
  node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({agentToken:process.argv[2],serverToken:process.argv[3]}),{mode:0o600})' "$SECRETS" "$AGENT_TOKEN" "$SERVER_TOKEN"
fi
printf '%s' "$AGENT_TOKEN" | $WR secret put AGENT_TOKEN >/dev/null
printf '%s' "$SERVER_TOKEN" | $WR secret put SERVER_TOKEN >/dev/null
curl -fsS "$URL/health" >/dev/null && echo "   relay answers"

echo "5/5 Connecting the Mac agent…"
if [ -f "$AGENT_DIR/config.json" ]; then
  node -e '
    const fs=require("fs"); const p=process.argv[1]; const c=JSON.parse(fs.readFileSync(p,"utf8"));
    c.relay={url:process.argv[2],token:process.argv[3]};
    if(!c.watch||!Array.isArray(c.watch.sites)) c.watch={sites:[{name:"FIAREP",url:"https://fiarep.com/api/healthz"},{name:"SetupRides",url:"https://setuprides.com/api/healthz"}],everySec:60,failuresBeforeAlert:3};
    fs.writeFileSync(p, JSON.stringify(c,null,2)+"\n",{mode:0o600});' "$AGENT_DIR/config.json" "$URL" "$AGENT_TOKEN"
  launchctl kickstart -k "gui/$(id -u)/com.fiarep.agent" 2>/dev/null && echo "   agent restarted" || echo "   (agent not installed as a login item yet — run artifacts/fiarep-agent/install-mac.sh)"
else
  echo "   No ~/.fiarep-agent/config.json yet — run artifacts/fiarep-agent/install-mac.sh first, then this again."
fi

cat <<EOF

Done. Last step — in Replit → Secrets, add these two, then Republish once:
  RELAY_URL           $URL
  RELAY_SERVER_TOKEN  $SERVER_TOKEN
EOF
