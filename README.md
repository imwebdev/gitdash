# 🚀 gitdash

> A local dashboard for every git repo on your machine. Tells you what to do — push, pull, commit, or nothing — in plain English. One button per repo.

**Built for Claude Code users who hop between machines** and want to know, at a glance, what's out of sync with GitHub.

> 🐧 Linux only right now. macOS + Windows on the way ([#21](https://github.com/imwebdev/gitdash/issues/21)).

---

## ⚡ Install in 30 seconds

Copy and paste this:

```bash
git clone https://github.com/imwebdev/gitdash.git && cd gitdash && ./install.sh
```

That's it. The installer prints a URL when it's done — open it in your browser.

> ❓ **Don't have `git`, `node 20+`, or `gh` installed yet?** Skip down to [Prereqs](#-prereqs).

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
