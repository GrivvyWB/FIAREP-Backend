#!/bin/bash
# Puts your Gemini API key on fiarep.com from the Terminal (instead of Replit Secrets).
#   bash set-gemini-key.sh            set or replace the key
#   bash set-gemini-key.sh --clear    remove it
# Asks for your Platform Control sign-in (the same name and code as the website)
# and the key; nothing you type is shown or saved on this Mac. fiarep.com checks
# the key with Google, then stores it encrypted. A GEMINI_API_KEY in Replit Secrets wins over it.
set -euo pipefail
API="${FIAREP_API:-https://fiarep.com/api}"
command -v node >/dev/null || { echo "Node.js is needed (brew install node)."; exit 1; }
read -r -p "Platform Control name [FIAREP Platform Owner]: " NAME
NAME="${NAME:-FIAREP Platform Owner}"
read -r -s -p "Platform Control code: " CODE; echo
if [ "${1:-}" = "--clear" ]; then KEY=""; else
  read -r -s -p "Gemini API key (aistudio.google.com → Get API key): " KEY; echo
  [ -n "$KEY" ] || { echo "No key typed."; exit 1; }
fi
export NAME CODE KEY API CLEAR="${1:-}"
node -e '
  const { NAME, CODE, KEY, API, CLEAR } = process.env;
  (async () => {
    const login = await fetch(`${API}/v1/platform/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: NAME, code: CODE }) });
    const l = await login.json().catch(() => ({}));
    if (!login.ok) { console.log(`Sign-in refused: ${l.error || login.status}`); process.exit(1); }
    const r = await fetch(`${API}/v1/platform/command/keys/gemini`, { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${l.accessToken}` }, body: JSON.stringify({ key: CLEAR === "--clear" ? null : KEY }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { console.log(`Not saved: ${d.error || r.status}`); process.exit(1); }
    console.log(d.set ? `Saved. Gemini key …${d.last4} is on fiarep.com (Platform Control → Command Center → Engine shows it).` : "Gemini key removed.");
    if (d.note) console.log(d.note);
  })().catch((e) => { console.log(`Could not reach ${API}: ${e.message}`); process.exit(1); });'
