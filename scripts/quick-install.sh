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
#   7. On Linux with systemd: installs a systemd --user service so gitdash
#      runs in the background, survives SSH logout, and auto-starts on boot.
#      Offers `sudo loginctl enable-linger` so the service starts pre-login.
#      If UFW is active, offers to open port 7420.
#      On macOS / systemd-less Linux: falls back to exec'ing the launcher
#      in the foreground (Ctrl-C stops it).
#   8. Prints next steps + URLs
#
# On Linux, if any of {git, node, gh} are missing, the script offers to
# install them automatically via apt or dnf (requires sudo). Decline to
# fall back to manual install hints.
#
# Non-goals: Windows support, auto-brew on macOS.

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
  local missing=()

  step "Checking prerequisites"

  if ! have git; then
    fail "git not found"
    missing+=(git)
  else
    ok "git: $(git --version | awk '{print $3}')"
  fi

  if ! check_node; then
    if have node; then
      fail "node $(node --version) is too old; gitdash needs >= 20"
    else
      fail "node not found"
    fi
    missing+=(node)
  else
    ok "node: $(node --version)"
  fi

  if ! have gh; then
    fail "gh (GitHub CLI) not found"
    missing+=(gh)
  else
    ok "gh: $(gh --version | head -n 1)"
  fi

  if [ "${#missing[@]}" -eq 0 ]; then
    return 0
  fi

  # Offer auto-install on Linux with apt/dnf. Leave macOS manual (brew).
  if [ "$os" = "linux" ] && { have apt-get || have dnf; }; then
    echo
    warn "Missing: ${missing[*]}"
    printf "  I can install them for you using sudo %s.\n" "$(have apt-get && echo apt || echo dnf)"
    local ans=""
    if [ -t 0 ]; then
      read -rp "  Install missing tools now? [Y/n] " ans
    elif [ -r /dev/tty ]; then
      read -rp "  Install missing tools now? [Y/n] " ans </dev/tty
    else
      warn "No TTY available for confirmation — skipping auto-install"
      ans="n"
    fi
    ans="${ans:-Y}"
    if [[ "$ans" =~ ^[Yy] ]]; then
      auto_install_linux "${missing[@]}"

      # Re-verify after install
      local still_missing=()
      have git || still_missing+=(git)
      check_node || still_missing+=(node)
      have gh || still_missing+=(gh)

      if [ "${#still_missing[@]}" -eq 0 ]; then
        ok "All prerequisites satisfied"
        return 0
      fi

      fail "Still missing after auto-install: ${still_missing[*]}"
      for t in "${still_missing[@]}"; do
        case "$t" in
          git)  install_hint_git  "$os" ;;
          node) install_hint_node "$os" ;;
          gh)   install_hint_gh   "$os" ;;
        esac
      done
      die "Auto-install did not get everything. Install the rest manually, then re-run."
    fi
  fi

  # Fallback: print manual install hints and die
  for t in "${missing[@]}"; do
    case "$t" in
      git)  install_hint_git  "$os" ;;
      node) install_hint_node "$os" ;;
      gh)   install_hint_gh   "$os" ;;
    esac
  done
  die "Install the missing tools above, then re-run this script."
}

# ---- auto-install (Linux apt/dnf) ------------------------------------------
auto_install_linux() {
  local tools=("$@")
  if have apt-get; then
    auto_install_apt "${tools[@]}"
  elif have dnf; then
    auto_install_dnf "${tools[@]}"
  fi
}

auto_install_apt() {
  local tools=("$@")
  step "Installing missing prerequisites via apt"
  sudo apt-get update -qq
  local tool
  for tool in "${tools[@]}"; do
    case "$tool" in
      git)
        sudo apt-get install -y git
        ;;
      node)
        # NodeSource official 20.x repo — ensures we get node >= 20
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
        ;;
      gh)
        # GitHub CLI's official apt repo (gh is not in Ubuntu's default repos)
        have wget || sudo apt-get install -y wget
        sudo mkdir -p -m 755 /etc/apt/keyrings
        wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
          | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
        sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
          | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
        sudo apt-get update -qq
        sudo apt-get install -y gh
        ;;
    esac
  done
}

auto_install_dnf() {
  local tools=("$@")
  step "Installing missing prerequisites via dnf"
  local tool
  for tool in "${tools[@]}"; do
    case "$tool" in
      git)
        sudo dnf install -y git
        ;;
      node)
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash -
        sudo dnf install -y nodejs
        ;;
      gh)
        sudo dnf install -y 'dnf-command(config-manager)' || true
        sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
        sudo dnf install -y gh
        ;;
    esac
  done
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

# ---- systemd user service (Linux only) -------------------------------------
# Returns 0 if the service was installed + started, 1 if systemd isn't usable
# on this box (macOS, minimal WSL, container without cgroups, etc.).
setup_systemd_service() {
  # systemd present?
  command -v systemctl >/dev/null 2>&1 || return 1

  # Is there a reachable user systemd instance? If XDG_RUNTIME_DIR isn't set
  # or the user manager isn't running, every `systemctl --user` call will
  # hang or fail. show-environment is the cheapest probe.
  systemctl --user show-environment >/dev/null 2>&1 || return 1

  local config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/gitdash"
  local systemd_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  local env_file="$config_dir/env"
  local service_file="$systemd_dir/gitdash.service"
  local template="$INSTALL_DIR/scripts/gitdash.service"

  if [ ! -f "$template" ]; then
    warn "systemd template not found at $template — skipping service setup"
    return 1
  fi

  step "Installing systemd user service"

  mkdir -p "$config_dir" "$systemd_dir"

  # Env file: keep existing (to preserve CSRF token) or create fresh
  if [ -f "$env_file" ]; then
    ok "existing env at $env_file — keeping"
  else
    local csrf_token
    csrf_token="$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')"
    cat > "$env_file" <<EOF
# gitdash environment — sourced by the systemd service.
# Edit values below to override defaults. Restart after changes:
#   systemctl --user restart gitdash

GITDASH_CSRF_TOKEN=$csrf_token
GITDASH_PORT=${GITDASH_PORT:-7420}
GITDASH_BIND=${GITDASH_BIND:-0.0.0.0}
EOF
    chmod 600 "$env_file"
    ok "wrote $env_file (mode 600)"
  fi

  # Render service file with absolute install path
  sed "s|{{REPO_DIR}}|$INSTALL_DIR|g" "$template" > "$service_file"
  ok "wrote $service_file"

  # If an older instance is running, stop it so enable --now can rebind port
  if systemctl --user is-active gitdash >/dev/null 2>&1; then
    systemctl --user stop gitdash >/dev/null 2>&1 || true
  fi

  systemctl --user daemon-reload
  if systemctl --user enable --now gitdash >/dev/null 2>&1; then
    ok "gitdash service enabled and started"
    return 0
  else
    warn "systemctl --user enable --now gitdash failed — falling back to foreground"
    return 1
  fi
}

# Enable lingering so the service survives logout + auto-starts on boot.
# Prompts for sudo once. No-op if already enabled.
enable_linger_if_wanted() {
  command -v loginctl >/dev/null 2>&1 || return 0
  if loginctl show-user "$USER" 2>/dev/null | grep -q "Linger=yes"; then
    ok "linger already enabled for $USER"
    return 0
  fi

  echo
  printf '  %sEnable linger?%s (gitdash keeps running after you logout, and\n' "$C_BOLD" "$C_RESET"
  printf '  starts automatically on boot. Needs sudo once, no password the\n'
  printf '  next time you run this script.)\n'
  local ans=""
  if [ -t 0 ]; then
    read -rp "  Enable linger? [Y/n] " ans
  elif [ -r /dev/tty ]; then
    read -rp "  Enable linger? [Y/n] " ans </dev/tty
  fi
  ans="${ans:-Y}"
  if [[ "$ans" =~ ^[Yy] ]]; then
    if sudo loginctl enable-linger "$USER"; then
      ok "linger enabled"
    else
      warn "enable-linger failed. Run manually later:  sudo loginctl enable-linger \$USER"
    fi
  else
    warn "linger skipped — gitdash will stop when you close your last session"
  fi
}

# If UFW is active, offer to open the gitdash port so LAN clients can reach it.
allow_ufw_port() {
  command -v ufw >/dev/null 2>&1 || return 0
  # ufw status requires root on most distros
  if ! sudo -n ufw status 2>/dev/null | grep -q "Status: active"; then
    # Either sudo would prompt (fine to skip silently) or ufw isn't active
    return 0
  fi
  local port="${GITDASH_PORT:-7420}"
  if sudo ufw status 2>/dev/null | grep -qE "^${port}/tcp.*ALLOW"; then
    ok "ufw already allows ${port}/tcp"
    return 0
  fi

  echo
  printf '  UFW firewall is active. Allow port %s/tcp so your browser can reach gitdash?\n' "$port"
  local ans=""
  if [ -t 0 ]; then
    read -rp "  Allow ${port}/tcp? [Y/n] " ans
  elif [ -r /dev/tty ]; then
    read -rp "  Allow ${port}/tcp? [Y/n] " ans </dev/tty
  fi
  ans="${ans:-Y}"
  if [[ "$ans" =~ ^[Yy] ]]; then
    sudo ufw allow "${port}/tcp" >/dev/null && ok "ufw: allowed ${port}/tcp"
  fi
}

# ---- finale ----------------------------------------------------------------
print_next_steps_foreground() {
  local port="${GITDASH_PORT:-7420}"
  printf '\n%sgitdash installed.%s\n\n' "$C_GREEN$C_BOLD" "$C_RESET"
  printf '  Start it:   %sgitdash start%s\n' "$C_BOLD" "$C_RESET"
  printf '  Stop it:    Ctrl-C in that terminal\n'
  printf '  Dashboard:  %shttp://127.0.0.1:%s%s\n' "$C_BOLD" "$port" "$C_RESET"
  printf '  Source:     %s\n' "$INSTALL_DIR"
  printf '  Re-install: re-run this command; it is idempotent.\n\n'
}

print_next_steps_systemd() {
  local port="${GITDASH_PORT:-7420}"
  local lan_ip
  lan_ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))\.' | head -1 || true)"

  printf '\n%sgitdash is running.%s\n\n' "$C_GREEN$C_BOLD" "$C_RESET"
  printf '  Dashboard (this box):  %shttp://127.0.0.1:%s%s\n' "$C_BOLD" "$port" "$C_RESET"
  [ -n "$lan_ip" ] && \
    printf '  Dashboard (LAN):       %shttp://%s:%s%s\n' "$C_BOLD" "$lan_ip" "$port" "$C_RESET"
  printf '\n'
  printf '  Status:     %ssystemctl --user status gitdash%s\n' "$C_DIM" "$C_RESET"
  printf '  Logs:       %sjournalctl --user -u gitdash -f%s\n' "$C_DIM" "$C_RESET"
  printf '  Restart:    %ssystemctl --user restart gitdash%s\n' "$C_DIM" "$C_RESET"
  printf '  Stop:       %ssystemctl --user stop gitdash%s\n' "$C_DIM" "$C_RESET"
  printf '  Source:     %s\n\n' "$INSTALL_DIR"
}

# Start gitdash in the foreground (fallback when systemd isn't available).
# exec'ing so the user sees the server's URL and Ctrl-C works cleanly.
start_gitdash_foreground() {
  local launcher="$INSTALL_DIR/bin/gitdash"
  if [ ! -x "$launcher" ]; then
    warn "Launcher not found or not executable at $launcher — skipping auto-start"
    return 0
  fi

  step "Starting gitdash (foreground — systemd not available on this box)"
  printf '  %sCtrl-C to stop. On a logout, the server will stop too.%s\n\n' \
    "$C_DIM" "$C_RESET"
  exec "$launcher" start
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

  # Opt-out path: no systemd, no foreground exec, just print instructions.
  if [ "${GITDASH_NO_START:-0}" = "1" ]; then
    print_next_steps_foreground
    printf '  %sGITDASH_NO_START=1 set — not auto-starting. Run %sgitdash start%s when ready.%s\n\n' \
      "$C_DIM" "$C_BOLD" "$C_DIM" "$C_RESET"
    return 0
  fi

  # Preferred path: systemd user service (survives logout, auto-starts on boot).
  # Falls through to foreground if systemd isn't usable on this box.
  if [ "$os" = "linux" ] && setup_systemd_service; then
    enable_linger_if_wanted
    allow_ufw_port
    print_next_steps_systemd
    return 0
  fi

  print_next_steps_foreground
  start_gitdash_foreground
}

main "$@"
