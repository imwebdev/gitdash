# 🚀 gitdash

> A local dashboard for every git repo on your machine. Tells you what to do — push, pull, commit, or nothing — in plain English. One button per repo.

**Built for Claude Code users who hop between machines** and want to know, at a glance, what's out of sync with GitHub.

---

## ⚡ Install in 30 seconds

### ✅ What works today

Pick the row that matches you:

| Your setup | Supported? | What to do |
|---|---|---|
| 🐧 **Linux** (Ubuntu, Debian, Fedora, Arch, etc.) | ✅ Yes | Follow the **Linux** steps below |
| 🪟 **Windows 10 / 11 with WSL 2** (Ubuntu inside Windows) | ✅ Yes | Open your WSL terminal, then follow the **Linux** steps below |
| 🪟 **Windows without WSL** (PowerShell, CMD, Git Bash) | ❌ Not yet | Install WSL 2 first — see [Windows note](#-windows-note) below. Native Windows support tracked in [#21](https://github.com/imwebdev/gitdash/issues/21) |
| 🍎 **macOS** | ❌ Not yet | Tracked in [#21](https://github.com/imwebdev/gitdash/issues/21) |

> ⚠️ **If you're on Windows PowerShell and pasted the command below**, you got an error like `The token '&&' is not a valid statement separator`. That's expected — `install.sh` is a bash script and will not run in PowerShell. Use WSL.

---

### 🐧 Linux (and Windows with WSL)

In a **bash** or **zsh** terminal (on the Linux machine itself, or inside your WSL Ubuntu session), copy and paste this:

```bash
git clone https://github.com/imwebdev/gitdash.git && cd gitdash && ./install.sh
```

That's it. The installer prints a URL when it's done — open it in your browser.

> ❓ **Don't have `git`, `node 20+`, or `gh` installed yet?** Skip down to [Prereqs](#-prereqs).

---

### 🪟 Windows note

gitdash has **no native Windows installer yet**. You have two choices:

1. **Install WSL 2** (recommended, 5 minutes): open PowerShell **as Administrator** and run `wsl --install`, reboot when it finishes, set up an Ubuntu username/password when prompted. Then type `wsl` in a new PowerShell window (or launch "Ubuntu" from Start) — you're now in a Linux shell, and the **Linux** steps above work.
2. **Wait for native support** — track [#21](https://github.com/imwebdev/gitdash/issues/21).

Do **not** try to run `install.sh` from PowerShell, CMD, or plain Git Bash — it uses `systemd` (Linux-only) to keep itself running after you close the terminal.

---

## 🎨 What you'll see

Every repo on your machine, sorted by what it needs:

| | Section | What it means |
|---|---|---|
| 🔴 | **Need attention** | Mid-flight merge or rebase — finish what you started |
| 🟠 | **Diverged from GitHub** | Both you and GitHub have new commits — needs a merge |
| 🟢 | **Want to be pushed** | You've committed locally — click **Push** |
| 🔵 | **Have incoming changes** | GitHub has new commits — click **Pull** |
| 🟡 | **Have unsaved changes** | Files edited, not committed — click **Commit & push** |
| ✅ | **Need no updates** | In sync, nothing to do |

**Each row has at most three buttons:** the colored primary action (Push / Pull / Merge / Commit & push), a 🔄 refresh icon, and an ↗ icon to open the repo on GitHub. Nothing else.

---

## 🔄 Update gitdash

```bash
cd /path/to/gitdash && git pull && ./install.sh
```

Re-running the installer is safe — it stops, rebuilds, and restarts cleanly.

---

## 🗑️ Remove gitdash

```bash
cd /path/to/gitdash && ./uninstall.sh           # service only
cd /path/to/gitdash && ./uninstall.sh --purge   # also wipe the database
```

The repo files stay where they are — delete them yourself if you want.

---

## 🆘 Help — something broke

| Symptom | Fix |
|---|---|
| `forbidden host` in browser | Use `127.0.0.1:7420` or your LAN IP, not a public domain |
| `Application error: client-side exception` | Hard-refresh your browser (Ctrl/Cmd+Shift+R) |
| Repos all show "no updates needed" but you suspect they shouldn't | Click the 🔄 on any row to refresh manually. The classifier defaults to "no updates" when it can't reach GitHub |
| Push fails with `repository scope` error | Run `gh auth refresh -s repo` |
| Port 7420 in use | Edit `~/.config/gitdash/env`, change `GITDASH_PORT`, then `systemctl --user restart gitdash` |
| Service not running | `systemctl --user status gitdash` shows what's wrong; `journalctl --user -u gitdash -n 50` shows recent logs |
| Anything else | `journalctl --user -u gitdash -f` and reproduce |

---

## 📦 Prereqs

You need these three tools before running `install.sh`:

- **Node.js 20+** — install via [nvm](https://github.com/nvm-sh/nvm) (recommended) or [from nodejs.org](https://nodejs.org)
- **git** — `apt install git` / `dnf install git` / `pacman -S git`
- **GitHub CLI (`gh`)** — [official install](https://github.com/cli/cli#installation), then run **`gh auth login`** and follow the prompts (choose GitHub.com → HTTPS → login with browser)

The installer's preflight check tells you exactly which one is missing if any.

---

## ⚙️ Daily commands

```bash
systemctl --user status gitdash        # is it running?
systemctl --user restart gitdash       # restart
systemctl --user stop gitdash          # stop
journalctl --user -u gitdash -f        # live logs (Ctrl+C to exit)
```

---

## 🛠️ Configuration (optional)

Edit `~/.config/gitdash/env` to override defaults:

```bash
GITDASH_PORT=7420                      # change if 7420 is taken
GITDASH_BIND=0.0.0.0                   # use 127.0.0.1 to lock to localhost only
```

Then `systemctl --user restart gitdash`.

For folder-scan rules and editor/terminal overrides see [`CLAUDE.md`](./CLAUDE.md).

---

## 📜 License

MIT (see `LICENSE` if/when added).
