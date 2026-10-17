# FIAREP desktop agent

Lets the Command Center on your phone run a fixed set of things on this Mac.
It only calls out to FIAREP (long-poll); nothing connects in.

## Install (Mac, Node 20+)

1. Platform Control → Command Center → Computers → **Add computer**. Copy the token (shown once).
2. `cd artifacts/fiarep-agent && ./install-mac.sh` — creates `~/.fiarep-agent/config.json`.
3. Edit `~/.fiarep-agent/config.json`:
   - `token` — the token from step 1
   - `trustedConfirmKeys` — your phone's Face ID key (Platform Control → Phones, or "Share Face ID key" in the app). With a key here, anything that needs approval must carry that phone's Face ID signature, checked on this Mac.
   - `folders`, `apps`, `tasks` — the only things it can touch. Tasks are argv arrays (no shell); `{param}` placeholders must match the param's `pattern`; `"confirm": true` makes a task wait for Face ID.
4. `./install-mac.sh` again — starts it now and at every login. Log: `~/.fiarep-agent/agent.log`.

`node ~/.fiarep-agent/agent.mjs --check` prints what the config allows.
`./install-mac.sh --uninstall` stops it.
