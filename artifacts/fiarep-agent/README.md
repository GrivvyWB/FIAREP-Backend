# FIAREP desktop agent

Lets a Command Center phone run a fixed set of things on a computer — Windows, Mac or Linux.
It only calls out to FIAREP (long-poll); nothing connects in.

Every organization has its own Command Center: FIAREP's own (Platform Control → Command Center)
and each client's (fiarep.com → Command Center in their menu, for their administrators). A computer
belongs to the one that added it and is only ever reached from that organization's phones.

## Install (one line, any computer)

1. Command Center → Computers → name it → **Add computer**.
2. Pick Windows PC / Mac / Linux and click the line to copy it. It carries the computer's token
   (shown once) and the Face ID keys of the phones approved so far.
3. Paste it on the computer:
   - **Windows 10 / 11**: Start → type *PowerShell* → Windows PowerShell → paste → Enter.
     No administrator rights; Node.js LTS is installed with winget if it's missing.
     Starts at sign-in from Task Scheduler (task "FIAREP Agent").
   - **Mac**: Terminal → paste → Enter. Starts at login (launchd). Node via Homebrew if missing.
   - **Linux**: terminal → paste → Enter. Needs Node.js 20+. Starts with systemd (user service),
     or cron `@reboot` where there is no systemd.

It writes `~/.fiarep-agent/config.json` (Windows: `%USERPROFILE%\.fiarep-agent\config.json`).
Log: `agent.log` in the same folder.

Approved another phone later? Command Center → Computers → "Approved a new phone? Update a computer":
the same line without a token — it updates the agent and pins every approved phone's Face ID key.

## What it may touch — config.json, on the computer

- `folders` — the only folders it can list and read (Documents and Desktop to start).
- `apps` — the only apps it can open. Mac: the app's name (`"Microsoft Excel"`). Windows: what you'd
  type in Start → Run (`"excel"`, `"winword"`, `"outlook"`, `"explorer"`) or a full path to an .exe.
  Linux: the program's command (`"libreoffice"`).
- `tasks` — named commands, as argv arrays (no shell); `{param}` placeholders must match the param's
  `pattern`; `"confirm": true` makes a task wait for Face ID. On Windows, `.cmd` / `.bat` programs
  (npm, pnpm) are run through cmd.exe automatically.
- `trustedConfirmKeys` — phones' Face ID keys. With a key here, anything that needs approval must
  carry that phone's Face ID signature, checked on this computer — the server alone can't approve it.

The server never changes this file. `node ~/.fiarep-agent/agent.mjs --check` prints what it allows.

Uninstall: the same install line with `FIAREP_UNINSTALL=1` (Mac/Linux: `curl -fsSL …/install.sh | FIAREP_UNINSTALL=1 bash`;
Windows: `$env:FIAREP_UNINSTALL='1'; irm …/install.ps1 | iex`).

## Tim's Mac: outage watch + Replit republish (backup relay)

`./install-mac.sh` from this folder installs the same agent plus Playwright for the Replit republish.
When `relay` is set in the config, the Mac checks `watch.sites` every minute.
After 3 failed checks it reports the outage to the backup relay (Cloudflare Worker, see `artifacts/fiarep-relay`),
your phone gets a push, you approve with Face ID in Command Center, and the Mac clicks **Republish** on Replit,
then waits for the site to answer and reports back. Approvals are checked on the Mac against
`trustedConfirmKeys`; with none pinned, nothing is republished. Only FIAREP's own phones are sent to the relay.

Sites are listed in `watch.sites` (FIAREP and SetupRides by default), each with its own Replit page.
One-time Replit sign-in per site: `node ~/.fiarep-agent/republish.mjs --login --site FIAREP` (and `--site SetupRides`):
sign in, open that app's Replit page, close the window. Test without clicking: `… --check --site FIAREP`.
Replit's security check may ask "Verify you are human": the window is visible and the Mac waits (up to 10 min)
for you to do it on the Mac, then carries on. Away from the Mac? Use "Open Replit" in Command Center.
Replit has no documented republish API — if Replit changes its page and `--check` stops finding the button, it needs updating.
The Mac must be awake (System Settings → Energy: prevent sleep when plugged in).
