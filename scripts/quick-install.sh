#!/usr/bin/env bash
#
# gitdash quick-install — one-liner setup
#
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/imwebdev/gitdash/main/scripts/quick-install.sh)
#
# What it does (idempotent — safe to re-run):
#   1. Verifies OS (linux/macos) and tools (node>=20, git, gh)
#   2. Walks you through `gh auth login` if not signed in
#   3. Runs `gh auth setup-git` so https pushes use your gh token
#   4. Clones or updates gitdash under $XDG_DATA_HOME/gitdash
#   5. Installs deps + builds
#   6. Symlinks a `gitdash` launcher into ~/.local/bin
#   7. Prints next steps
#
# Non-goals: systemd units, Windows support, auto-sudo for package install.
# Those are separate features tracked in their own issues.

set -euo pipefail

REPO_URL_DEFAULT="https://github.com/imwebdev/gitdash.git"
REPO_URL="${GITDASH_REPO:-$REPO_URL_DEFAULT}"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gitdash"
BIN_DIR="$HOME/.local/bin"
BRANCH_DEFAULT="main"
BRANCH="${GITDASH_BRANCH:-$BRANCH_DEFAULT}"

# ---- tiny output helpers ---------------------------------------------------
if [ -t 1 ]; then
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_RESET=$'\033[0m'
else
  C_BOLD=""; C_DIM=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_RESET=""
fi

step() { printf '\n%s→%s %s\n' "$C_BOLD" "$C_RESET" "$1"; }
ok()   { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
fail() { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$1" >&2; }
die()  { fail "$1"; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# ---- OS detection ----------------------------------------------------------
detect_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "macos" ;;
    *)       echo "unsupported" ;;
  esac
}

install_hint_gh() {
  case "$1" in
    linux)
      echo "    sudo apt install gh       # Debian/Ubuntu"
      echo "    sudo dnf install gh       # Fedora/RHEL"
      echo "    https://cli.github.com/manual/installation"
      ;;
    macos)
      echo "    brew install gh"
      ;;
  esac
}

install_hint_node() {
  case "$1" in
    linux)
      echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
      echo "    # restart shell, then:"
      echo "    nvm install 20 && nvm use 20"
      ;;
    macos)
      echo "    brew install node@20"
      echo "    # or via nvm: https://github.com/nvm-sh/nvm"
      ;;
  esac
}

install_hint_git() {
  case "$1" in
    linux) echo "    sudo apt install git    # or dnf/pacman equivalent" ;;
    macos) echo "    xcode-select --install   # or brew install git" ;;
  esac
}

# ---- prerequisite checks ---------------------------------------------------
check_node() {
  have node || return 1
  local major
  major=$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')
  [ "$major" -ge 20 ]
}

check_prereqs() {
  local os="$1"
  local missing=0

  step "Checking prerequisites"

  if ! have git; then
    fail "git not found"
    install_hint_git "$os"
    missing=$((missing + 1))
  else
    ok "git: $(git --version | awk '{print $3}')"
  fi

  if ! check_node; then
    if have node; then
      fail "node $(node --version) is too old; gitdash needs >= 20"
    else
      fail "node not found"
    fi
    install_hint_node "$os"
    missing=$((missing + 1))
  else
    ok "node: $(node --version)"
  fi

  if ! have gh; then
    fail "gh (GitHub CLI) not found"
    install_hint_gh "$os"
    missing=$((missing + 1))
  else
    ok "gh: $(gh --version | head -n 1)"
  fi

  if [ "$missing" -gt 0 ]; then
    die "Install the missing tools above, then re-run this script."
  fi
}

# ---- gh auth ---------------------------------------------------------------
ensure_gh_auth() {
  step "Checking GitHub authentication"
  if gh auth status >/dev/null 2>&1; then
    ok "gh is authenticated"
  else
    warn "gh is not authenticated — launching interactive login"
    printf '    %sWhen prompted, choose GitHub.com + HTTPS + your preferred method.%s\n' "$C_DIM" "$C_RESET"
    if ! gh auth login; then
      die "gh auth login did not complete. Re-run when you're ready."
    fi
    ok "gh authenticated"
  fi

  # gh auth setup-git is safe to run repeatedly — it just (re)registers the
  # credential helper. This is the specific fix for the "SSH URL, no key on
  # GitHub" trap users hit when pushing.
  if gh auth setup-git >/dev/null 2>&1; then
    ok "git credential helper wired to gh token (HTTPS pushes will just work)"
  else
    warn "gh auth setup-git failed — you may still hit auth errors on push"
  fi
}

# ---- clone / update --------------------------------------------------------
fetch_repo() {
  step "Fetching gitdash source"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [ -d "$INSTALL_DIR/.git" ]; then
    ok "Existing install at $INSTALL_DIR — pulling latest"
    git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only --quiet origin "$BRANCH"
  else
    ok "Cloning to $INSTALL_DIR"
    git clone --quiet --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

# ---- build -----------------------------------------------------------------
build_gitdash() {
  step "Installing dependencies (this is the slow part)"
  (cd "$INSTALL_DIR" && npm install --no-audit --no-fund --silent)
  ok "dependencies installed"

  step "Building"
  (cd "$INSTALL_DIR" && npm run build --silent)
  ok "build complete"
}

# ---- launcher symlink ------------------------------------------------------
install_launcher() {
  step "Installing launcher"
  mkdir -p "$BIN_DIR"
  local target="$INSTALL_DIR/bin/gitdash"
  local link="$BIN_DIR/gitdash"
  if [ -L "$link" ] || [ -e "$link" ]; then
    rm -f "$link"
  fi
  ln -s "$target" "$link"
  chmod +x "$target"
  ok "$link → $target"

  # PATH hint
  case ":$PATH:" in
    *":$BIN_DIR:"*) ok "$BIN_DIR is on PATH" ;;
    *)
      warn "$BIN_DIR is not on PATH yet"
      printf '    add this to your shell rc:\n'
      printf '    %sexport PATH="$HOME/.local/bin:$PATH"%s\n' "$C_DIM" "$C_RESET"
      ;;
  esac
}

# ---- finale ----------------------------------------------------------------
print_next_steps() {
  local port="${GITDASH_PORT:-7420}"
  printf '\n%sgitdash installed.%s\n\n' "$C_GREEN$C_BOLD" "$C_RESET"
  printf '  Start it:   %sgitdash start%s\n' "$C_BOLD" "$C_RESET"
  printf '  Stop it:    Ctrl-C in that terminal\n'
  printf '  Dashboard:  %shttp://127.0.0.1:%s%s\n' "$C_BOLD" "$port" "$C_RESET"
  printf '  Source:     %s\n' "$INSTALL_DIR"
  printf '  Re-install: re-run this command; it is idempotent.\n\n'
}

# ---- main ------------------------------------------------------------------
main() {
  printf '%sgitdash quick-install%s\n' "$C_BOLD" "$C_RESET"
  printf '%starget:%s %s\n' "$C_DIM" "$C_RESET" "$INSTALL_DIR"

  local os
  os="$(detect_os)"
  if [ "$os" = "unsupported" ]; then
    die "Unsupported OS: $(uname -s). Linux and macOS only for now. Windows tracked in #21."
  fi
  ok "OS: $os"

  check_prereqs "$os"
  ensure_gh_auth
  fetch_repo
  build_gitdash
  install_launcher
  print_next_steps
}

main "$@"
