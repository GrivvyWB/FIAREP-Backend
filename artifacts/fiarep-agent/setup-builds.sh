#!/bin/bash
# Command Center builds: sets them up on this Mac and on the AWS server (for when the Mac sleeps).
#   bash setup-builds.sh            (installer 148 runs this)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/.fiarep-agent"
IP="3.145.105.47"; KEY="$DIR/aws-key.pem"
NODE="$(command -v node)"

add_tasks() { # $1 = config.json, $2 = node path, $3 = agent dir
  "$2" -e '
const fs=require("fs"); const [cfgPath,node,dir]=process.argv.slice(1);
const c=JSON.parse(fs.readFileSync(cfgPath,"utf8")); c.tasks=c.tasks||{};
const b=dir+"/build.mjs";
c.tasks["fiarep-build"]={description:"Build a change to FIAREP with Claude Code (in the background; the phone is told when it is ready)",command:[node,b,"start","{request}"],params:{request:{description:"What to build, in plain words",pattern:"[^\\x00-\\x1f]{3,2000}"}},confirm:false,timeoutSec:60};
c.tasks["fiarep-build-status"]={description:"Where a FIAREP build is: what changed, typecheck, ready or not",command:[node,b,"status","{id}"],params:{id:{description:"Build id, or latest",pattern:"latest|b[0-9]{10}[a-z0-9]{3}"}},confirm:false,timeoutSec:30};
c.tasks["fiarep-ship"]={description:"Ship a ready FIAREP build: commit, push to GitHub, Republish on Replit (and the phone update on the Mac)",command:[node,b,"ship","{id}"],params:{id:{description:"Build id",pattern:"b[0-9]{10}[a-z0-9]{3}"}},confirm:true,timeoutSec:3000};
c.tasks["fiarep-discard"]={description:"Throw a FIAREP build away",command:[node,b,"discard","{id}"],params:{id:{description:"Build id",pattern:"b[0-9]{10}[a-z0-9]{3}"}},confirm:false,timeoutSec:60};
fs.writeFileSync(cfgPath,JSON.stringify(c,null,2));
' "$1" "$2" "$3"
}

echo "== This Mac"
cp "$HERE/build.mjs" "$DIR/build.mjs"
[ -f "$DIR/build.json" ] || echo '{ "repo": "~/Desktop/FIAREP-Backend", "standalone": "~/Desktop/fiarep-standalone" }' > "$DIR/build.json"
add_tasks "$DIR/config.json" "$NODE" "$DIR" && echo "Build tasks added to the Mac agent."
command -v pnpm >/dev/null || echo "!! pnpm not found on the Mac (npm i -g pnpm)."
if command -v claude >/dev/null; then echo "Claude Code: $(claude --version 2>/dev/null)"; else echo "Installing Claude Code…"; npm i -g @anthropic-ai/claude-code >/dev/null 2>&1 && echo "Claude Code installed — run 'claude' once in Terminal to sign in." || echo "!! Couldn't install Claude Code: npm i -g @anthropic-ai/claude-code"; fi
launchctl kickstart -k "gui/$(id -u)/com.fiarep.agent" 2>/dev/null && echo "Mac agent restarted."

echo "== AWS server"
if [ ! -f "$KEY" ]; then echo "!! No AWS key at $KEY — the server part is skipped (run installer 12 first)."; exit 0; fi
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "ubuntu@$IP")
scp -q -i "$KEY" "$HERE/build.mjs" "ubuntu@$IP:.fiarep-agent/build.mjs" || { echo "!! AWS server not reachable."; exit 0; }
# GitHub sign-in for pushing from the server: the same one this Mac uses.
CRED="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | awk -F= '/^username=/{u=$2} /^password=/{p=$2} END{ if(u&&p) print "https://"u":"p"@github.com" }')"
REMOTE_URL="$(git -C "$HOME/Desktop/FIAREP-Backend" remote get-url origin)"
"${SSH[@]}" CRED="$CRED" REMOTE_URL="$REMOTE_URL" bash -s <<'REMOTE'
set -uo pipefail
cd ~/.fiarep-agent
NODE="$(command -v node)"
if [ -n "${CRED:-}" ]; then git config --global credential.helper store; umask 077; printf '%s\n' "$CRED" > ~/.git-credentials; fi
[ -d ~/fiarep-build-repo/.git ] || git clone -q "$REMOTE_URL" ~/fiarep-build-repo && echo "FIAREP repo on the server: ready."
[ -f build.json ] || echo '{ "repo": "~/fiarep-build-repo" }' > build.json
command -v pnpm >/dev/null || sudo npm i -g pnpm >/dev/null 2>&1 || npm i -g pnpm >/dev/null 2>&1
command -v claude >/dev/null || sudo npm i -g @anthropic-ai/claude-code >/dev/null 2>&1 || npm i -g @anthropic-ai/claude-code >/dev/null 2>&1
command -v pnpm >/dev/null && echo "pnpm: ok" || echo "!! pnpm missing on the server"
command -v claude >/dev/null && echo "Claude Code: $(claude --version 2>/dev/null)" || echo "!! Claude Code missing on the server"
REMOTE
ssh -i "$KEY" "ubuntu@$IP" bash -s <<REMOTE2
NODE="\$(command -v node)"
"\$NODE" -e '
const fs=require("fs"); const [cfgPath,node,dir]=process.argv.slice(1);
const c=JSON.parse(fs.readFileSync(cfgPath,"utf8")); c.tasks=c.tasks||{};
const b=dir+"/build.mjs";
c.tasks["fiarep-build"]={description:"Build a change to FIAREP with Claude Code (in the background; the phone is told when it is ready)",command:[node,b,"start","{request}"],params:{request:{description:"What to build, in plain words",pattern:"[^\\\\x00-\\\\x1f]{3,2000}"}},confirm:false,timeoutSec:60};
c.tasks["fiarep-build-status"]={description:"Where a FIAREP build is: what changed, typecheck, ready or not",command:[node,b,"status","{id}"],params:{id:{description:"Build id, or latest",pattern:"latest|b[0-9]{10}[a-z0-9]{3}"}},confirm:false,timeoutSec:30};
c.tasks["fiarep-ship"]={description:"Ship a ready FIAREP build: commit, push to GitHub, Republish on Replit",command:[node,b,"ship","{id}"],params:{id:{description:"Build id",pattern:"b[0-9]{10}[a-z0-9]{3}"}},confirm:true,timeoutSec:3000};
c.tasks["fiarep-discard"]={description:"Throw a FIAREP build away",command:[node,b,"discard","{id}"],params:{id:{description:"Build id",pattern:"b[0-9]{10}[a-z0-9]{3}"}},confirm:false,timeoutSec:60};
fs.writeFileSync(cfgPath,JSON.stringify(c,null,2));
' "\$HOME/.fiarep-agent/config.json" "\$NODE" "\$HOME/.fiarep-agent" && echo "Build tasks added to the server agent."
systemctl --user restart fiarep-agent.service && echo "Server agent restarted."
REMOTE2
echo
echo "Last step, once on each computer: sign Claude Code in."
echo "  Mac:    claude        (then /login, then /exit)"
echo "  Server: ssh -i ~/.fiarep-agent/aws-key.pem ubuntu@$IP   then   claude   (/login, /exit)"
