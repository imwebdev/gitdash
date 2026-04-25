# 🚀 gitdash

> A local dashboard for every git repo on your machine. Tells you what to do — push, pull, commit, or nothing — in plain English. One button per repo.

**Built for Claude Code users who hop between machines** and want to know, at a glance, what's out of sync with GitHub.

---

## ⚡ Install

**Pick your operating system and follow only the steps in that section.**

- [🐧 Linux — install](#-linux--install)
- [🪟 Windows — install](#-windows--install)
- [🍎 macOS — install](#-macos--install)

---

## 🐧 Linux — install

Works on Ubuntu, Debian, Fedora, Arch, and most other mainstream distros.

### 🛑 First — make sure you're actually at a Linux prompt

The install command below only works when you are **inside a Linux shell**, not inside Windows PowerShell or CMD.

Look at your prompt right now:

| Your prompt looks like… | What it is | Paste the command here? |
|---|---|---|
| `chirag@ubuntu:~$` or `[root@server ~]#` | ✅ Linux shell | **Yes** |
| `PS C:\Users\you>` | ❌ Windows PowerShell | **No** — see below |
| `C:\Users\you>` | ❌ Windows CMD | **No** — see below |
| `MINGW64 ~` or `MSYS …` | ❌ Git Bash for Windows | **No** — doesn't have `systemd` |

**If you have a remote Linux box** (cloud VM, home server, etc.) and you SSH in from another machine:

- **From Windows via PuTTY:** open PuTTY → enter host → click Open → **paste in the PuTTY window** (right-click pastes).
- **From Windows via Terminal / PowerShell's built-in ssh:** run `ssh you@your-server-ip` first, confirm the prompt changes to `user@host:~$`, **then** paste.
- **From macOS:** open Terminal → `ssh you@your-server-ip` → paste after the prompt changes.

**If you don't have a Linux box** and just want to run gitdash on your own machine, go to the section for your OS:
- Windows → [🪟 Windows — install](#-windows--install)
- macOS → [🍎 macOS — install](#-macos--install)

### Paste one of these at your Linux prompt

**Quick install (recommended):**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/imwebdev/gitdash/main/scripts/quick-install.sh)
```

**Or clone-then-install (if you want the source tree):**

```bash
git clone https://github.com/imwebdev/gitdash.git && cd gitdash && ./install.sh
```

The installer prints a URL when it's done — open it in your browser.

> ❓ Missing `git`, `node 20+`, or `gh`? See [Prereqs](#-prereqs).

---

## 🪟 Windows — install

### One command. Paste into PowerShell.

Open **PowerShell** (press `Win + R`, type `powershell`, press Enter) and paste this:

```powershell
iwr -useb https://raw.githubusercontent.com/imwebdev/gitdash/main/scripts/quick-install.ps1 | iex
```

That's it. The script handles everything:

1. If WSL (the Linux layer Windows uses) isn't installed, it installs it for you — it will ask Windows for admin permission (click **Yes** on the UAC prompt), run `wsl --install`, and tell you to reboot.
2. After you reboot and Ubuntu is set up (it asks for a Linux username + password the first time), **paste the same PowerShell command again**. It will detect WSL is ready and install gitdash.
3. When it's done, open a new PowerShell window, type `wsl`, then type `gitdash start`, and open http://127.0.0.1:7420 in any Windows browser.

### Common errors you can ignore now

If you previously tried the Linux command in PowerShell and got `The token '&&' is not a valid statement separator` or `The '<' operator is reserved for future use` — that's PowerShell rejecting bash syntax. Use the PowerShell command above instead. It's native PowerShell and paste-safe.

### Why does Windows need WSL?

gitdash uses Linux-only features (`systemd`, bash scripts). It can't run on Windows natively today. Native Windows support is tracked in [#21](https://github.com/imwebdev/gitdash/issues/21). WSL is Microsoft's official "run Linux inside Windows" feature — it's a one-time setup, then gitdash behaves identically to a real Linux install.

---

## 🍎 macOS — install

Open **Terminal** (⌘+Space → type "Terminal" → Enter) and paste:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/imwebdev/gitdash/main/scripts/quick-install.sh)
```

The installer detects macOS, checks your prereqs (`git`, `node 20+`, `gh` — install with `brew install ...` if missing), walks through `gh auth login`, clones gitdash to `~/.local/share/gitdash`, builds it, and drops a `gitdash` launcher into `~/.local/bin`.

Start it with:

```bash
gitdash start
```

…then open http://127.0.0.1:7420 in Safari / Chrome / Arc / whatever.

### macOS limitations today

- **No auto-start on login** — native `launchd` integration is tracked in [#21](https://github.com/imwebdev/gitdash/issues/21). You run `gitdash start` manually each time.
- **No `brew install gitdash` formula yet** — use the one-liner above.

### Alternative: run gitdash on a remote Linux box, view from Mac

If you already have a Linux server (cloud VM, home server, Raspberry Pi, etc.), install gitdash there instead — the installer binds `0.0.0.0` by default, so your Mac can open the LAN URL it prints.

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
cd gitdash && git pull && ./install.sh
```

Re-running the installer is safe — it stops, rebuilds, and restarts cleanly.

---

## 🗑️ Remove gitdash

```bash
cd gitdash && ./uninstall.sh           # service only
cd gitdash && ./uninstall.sh --purge   # also wipe the database
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

## 🤖 Claude Code SessionStart hook

`gitdash status` prints a one-line repo summary to stdout, making it useful as a Claude Code `SessionStart` hook. When Claude Code opens a project that gitdash tracks, you see the current sync state immediately in the session banner.

Add this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "gitdash status --cwd $CLAUDE_PROJECT_DIR"
          }
        ]
      }
    ]
  }
}
```

Sample output lines:

```
✓ gitdash: in sync · main
↑ gitdash: 3 ahead · main
↓ gitdash: 2 behind · main
⇅ gitdash: 3 ahead, 2 behind · main
✗ gitdash: 4 uncommitted change(s) · feature/my-branch
⚠ gitdash: no upstream · main
```

If gitdash hasn't scanned the directory yet, or the path isn't a git repo, the command prints nothing and exits 0 — it never pollutes your session with errors.

---

## 📜 License

MIT (see `LICENSE` if/when added).
