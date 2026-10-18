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

## Outage watch + Replit republish (backup relay)

When `relay` is set in the config, the Mac checks `watch.url` (fiarep.com/api/healthz) every minute.
After 3 failed checks it reports the outage to the backup relay (Cloudflare Worker, see `artifacts/fiarep-relay`),
your phone gets a push, you approve with Face ID in Command Center, and the Mac clicks **Republish** on Replit,
then waits for fiarep.com to answer and reports back. Approvals are checked on the Mac against
`trustedConfirmKeys`; with none pinned, nothing is republished.

Sites are listed in `watch.sites` (FIAREP and SetupRides by default), each with its own Replit page.
One-time Replit sign-in per site: `node ~/.fiarep-agent/republish.mjs --login --site FIAREP` (and `--site SetupRides`):
sign in, open that app's Replit page, close the window. Test without clicking: `… --check --site FIAREP`.
Replit's security check may ask "Verify you are human": the window is visible and the Mac waits (up to 10 min)
for you to do it on the Mac, then carries on. Away from the Mac? Use "Open Replit" in Command Center.
Replit has no documented republish API — if Replit changes its page and `--check` stops finding the button, it needs updating.
The Mac must be awake (System Settings → Energy: prevent sleep when plugged in).
