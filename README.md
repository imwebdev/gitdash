# gitdash

A local dashboard that shows every git repo on your machine and tells you, in plain English, what to do with it: push, pull, commit, merge, or nothing. One button per repo. No bulk operations, no surprises.

**Designed for Claude Code users who hop between machines** and want to know — at a glance — which repos are out of sync with GitHub, where their unsaved work is, and whether anyone (including past-you on a different computer) pushed something they need to pull down.

> Linux only for now. macOS/Windows support is on the roadmap.

---

## What you'll need before installing

You can copy-paste each block. Skip any tool you already have.

### 1. Node.js 20 or newer

Check: `node --version` → should print `v20.x.x` or higher.

If not installed, the easiest path is [nvm](https://github.com/nvm-sh/nvm):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
exec $SHELL                  # reload your shell so nvm is on PATH
nvm install 20
nvm use 20
```

### 2. Git

Check: `git --version`

If not installed:
- **Ubuntu/Debian:** `sudo apt install git`
- **Fedora/RHEL:** `sudo dnf install git`
- **Arch:** `sudo pacman -S git`
- **macOS:** `xcode-select --install` (or `brew install git`)

### 3. GitHub CLI (`gh`)

This is how gitdash compares your local repos with GitHub.

Check: `gh --version`

If not installed:
- **Ubuntu/Debian:** [official install instructions](https://github.com/cli/cli/blob/trunk/docs/install_linux.md#debian-ubuntu-linux-raspberry-pi-os-apt)
- **Fedora/RHEL:** `sudo dnf install gh`
- **Arch:** `sudo pacman -S github-cli`
- **macOS:** `brew install gh`

### 4. Sign `gh` in to your GitHub account

This is the part most beginners get stuck on. Run this once:

```bash
gh auth login
```

Choose, in order:
1. **GitHub.com**
2. **HTTPS** (easier than SSH for first-timers)
3. **Yes** (authenticate Git with your GitHub credentials)
4. **Login with a web browser**

Copy the one-time code it shows you, press Enter, and your browser will open. Paste the code, click Authorize, and come back to the terminal. You should see `✓ Authentication complete`.

Verify it worked:

```bash
gh auth status
```

Should show `✓ Logged in to github.com account <your-username>`.

---

## Install gitdash

### Linux / macOS

```bash
git clone https://github.com/imwebdev/gitdash.git
cd gitdash
./install.sh
```

…or paste the one-liner (same thing, without the clone step):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/imwebdev/gitdash/main/scripts/quick-install.sh)
```

That's it. The installer will:

1. Verify all the above prereqs
2. Install node dependencies and build
3. Generate a persistent CSRF token (so your browser doesn't get logged out on every restart)
4. **Linux:** install a systemd user service so gitdash auto-restarts on crash; optionally enable lingering (so it survives logout and reboot — asks for `sudo`)
5. **macOS:** install a LaunchAgent at `~/Library/LaunchAgents/com.gitdash.plist` so gitdash auto-starts at login and restarts on crash. Logs go to `~/Library/Logs/gitdash.log`.

### Windows (WSL)

Native Windows support isn't shipped yet. The supported path is:

1. Install WSL2 + Ubuntu: `wsl --install` in an admin PowerShell, reboot, launch Ubuntu once to finish setup.
2. Inside Ubuntu, follow the Linux install steps above. gitdash runs on `http://127.0.0.1:7420` from Windows Chrome/Edge too — WSL forwards loopback automatically.

Native Windows (PowerShell installer + service) is tracked for a follow-up once the WSL path is stable for Windows users.

When it finishes you'll see something like:

```
  gitdash installed and running

  Open in browser:
    http://127.0.0.1:7420
    http://192.168.1.6:7420  (other devices on your network)
```

**Open the URL** and you should see your repos sorted into actionable groups:

- 🔴 **Need attention** — merge or rebase mid-flight
- 🟠 **Diverged from GitHub** — both you and GitHub have new commits
- 🟢 **Want to be pushed** — you've committed locally
- 🔵 **Have incoming changes** — GitHub has new commits
- 🟡 **Have unsaved changes** — files edited but not committed
- ✅ **All synced** — nothing to do

---

## Using gitdash

### "I just sat down at a different computer"

1. Look for the **blue "Pull"** buttons. Click each — they download the new commits.
2. Look for the **yellow "Commit & push"** buttons. Click them, type a quick message, and your work goes to GitHub.

### "I don't know what 'commit' means"

In gitdash, "Commit & push" does this in one step:
1. Stages every changed file in the repo (`git add -A`)
2. Wraps them up with the message you type (`git commit`)
3. Sends them to GitHub (`git push`)

Before it runs, gitdash shows you exactly which files will be sent and **warns you in red if any of them look like secrets** (`.env`, `*.key`, `*.pem`, anything matching `credentials`/`secrets`) or are over 10MB. You can cancel.

### Per-row `⋯` menu

Each repo row has a dot-dot-dot button on the right. Click it for:

- **Fetch from GitHub** — refresh remote state without pulling
- **Open in editor** — opens VS Code (override with `GITDASH_EDITOR=...`)
- **Open in terminal** — opens a terminal in the repo directory
- **Open on GitHub** — jumps to the repo in your browser
- **Copy clone URL** — handy when setting up a new machine

---

## Daily commands

```bash
systemctl --user status gitdash       # is it running?
systemctl --user restart gitdash      # restart (after editing ~/.config/gitdash/env)
systemctl --user stop gitdash         # stop
systemctl --user start gitdash        # start
journalctl --user -u gitdash -f       # live logs (Ctrl+C to exit)
```

## Updating gitdash

```bash
cd /path/to/gitdash
git pull
./install.sh                          # re-runnable; rebuilds and restarts
```

## Uninstalling

```bash
./uninstall.sh                        # remove the service, keep config + database
./uninstall.sh --purge                # also delete ~/.config/gitdash and ~/.local/state/gitdash
```

---

## Configuration

The installer creates `~/.config/gitdash/env`. Edit it to override defaults:

```bash
GITDASH_CSRF_TOKEN=…             # auto-generated; keep secret
GITDASH_PORT=7420                # change if 7420 is taken
GITDASH_BIND=0.0.0.0             # 127.0.0.1 to lock to localhost only
# GITDASH_EDITOR=code            # default; try `nvim`, `subl`, `idea` etc.
# GITDASH_TERMINAL=x-terminal-emulator   # try `kitty`, `gnome-terminal`, `alacritty`
# GITDASH_DB=/custom/path/gitdash.sqlite
```

After changing, restart: `systemctl --user restart gitdash`.

To control which folders gitdash scans, drop a `~/.config/gitdash/config.json`:

```json
{
  "roots": ["/home/you/code", "/home/you/work"],
  "maxDepth": 6,
  "excludePatterns": ["node_modules", ".cache", "vendor"]
}
```

---

## Troubleshooting

**Browser shows "forbidden host"**
Your browser is hitting gitdash on a hostname/IP that isn't in the allowlist (loopback, RFC1918, link-local, or 100.64/10 CGNAT). Use `127.0.0.1` or your LAN IP, not a public domain.

**`Application error: a client-side exception has occurred`**
Hard-refresh your browser (Ctrl/Cmd+Shift+R). Stale client JS is the #1 cause after an update.

**Repos show as "unknown" with nothing happening**
You probably haven't run `gh auth login`. Check with `gh auth status`. If it fails, re-run `gh auth login`.

**`Repository scope` error or push fails with auth error**
Your `gh` token is missing the `repo` scope. Fix:
```bash
gh auth refresh -s repo
```

**Port 7420 is already in use**
Edit `~/.config/gitdash/env`, set `GITDASH_PORT=7421` (or whatever's free), then `systemctl --user restart gitdash`.

**Service won't start — check logs**
```bash
journalctl --user -u gitdash -n 50 --no-pager
```

**"Open in editor" doesn't open my preferred editor**
Set `GITDASH_EDITOR` in `~/.config/gitdash/env` to the binary name (must be on `PATH`). Restart the service.

**It worked yesterday but now nothing loads**
The first thing to check is whether the service is running and the build is current:
```bash
systemctl --user status gitdash
cd /path/to/gitdash && git log -1 --format='%h %s'
```
If you pulled new code, re-run `./install.sh` to rebuild.

---

## Architecture (briefly)

- **Next.js 15 + React 19**, server-side rendered, single page (`app/page.tsx`).
- **SQLite** (`better-sqlite3`) for persistence at `~/.local/state/gitdash/gitdash.sqlite`. Stores repo discovery, snapshots, action history, and the GitHub API ETag cache.
- **Background scheduler** runs three loops: directory discovery (10 min), local `git status` snapshots (on-demand + post-action), and remote comparison via `gh api` (staggered, ETag-cached).
- **Live updates** stream from server to browser via Server-Sent Events.
- **Action pipeline** — every push/pull/commit-push spawns a real `git` subprocess (no `bash -c`, no shell injection), streams stdout to the browser, and refreshes that one repo afterward.
- **Security** — host header allowlist (private nets only), CSRF on all mutating routes, no shell, action whitelist.

For more detail see [`CLAUDE.md`](./CLAUDE.md).

---

## Roadmap

Track in [GitHub Issues](https://github.com/imwebdev/gitdash/issues). Next up:

- Click-to-expand row detail (recent commits + actions) — #8
- "GitHub not connected" onboarding banner — #9
- Section for "Local only — no GitHub remote" repos — #10
- Status pills replacing arrows — #11

## License

MIT — see `LICENSE` if/when added.
