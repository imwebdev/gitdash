#!/usr/bin/env bash
# install.sh
#
# One-shot installer for gitdash. Re-runnable: detects existing install and
# updates in place (rebuilds, restarts the systemd unit).
#
# Usage:
#   ./install.sh                # full install with auto-start on boot
#   ./install.sh --no-linger    # skip the sudo loginctl enable-linger step
#   ./install.sh --no-start     # install unit but don't enable/start it
#   ./install.sh --help

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/gitdash"
SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ENV_FILE="$CONFIG_DIR/env"
SERVICE_NAME="gitdash"
SERVICE_FILE="$SYSTEMD_DIR/$SERVICE_NAME.service"
TEMPLATE="$REPO_DIR/scripts/gitdash.service"

WANT_LINGER=1
WANT_START=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-linger)  WANT_LINGER=0; shift ;;
    --no-start)   WANT_START=0; shift ;;
    --help|-h)
      grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown flag: $1 (try --help)" >&2; exit 2 ;;
  esac
done

bold()  { printf "\033[1m%s\033[0m\n" "$*"; }
green() { printf "\033[0;32m%s\033[0m\n" "$*"; }
red()   { printf "\033[0;31m%s\033[0m\n" "$*"; }
dim()   { printf "\033[2m%s\033[0m\n" "$*"; }

step() { echo; bold "▸ $*"; }

# ─────────────────────────────────────────────────────────
# If an existing systemd unit is running, stop it first so the port-7420
# preflight check passes during a re-run (update). We restart it at the end.
EXISTING_SERVICE_RAN=0
if command -v systemctl >/dev/null 2>&1 && \
   systemctl --user is-active "$SERVICE_NAME" >/dev/null 2>&1; then
  dim "Existing gitdash service is running — stopping it for the duration of the install"
  systemctl --user stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  EXISTING_SERVICE_RAN=1
fi

step "1/6 Preflight checks"
"$REPO_DIR/scripts/preflight.sh" || {
  red "Preflight failed. See messages above. Aborting install."
  if [[ $EXISTING_SERVICE_RAN -eq 1 ]]; then
    dim "Restarting the previously-running service"
    systemctl --user start "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi
  exit 1
}

# Without a git identity, the very first Commit & push from the dashboard
# fails with the cryptic "Author identity unknown" block. Set defaults from
# the gh-authenticated account using the GitHub noreply email so the user's
# real address never lands in commit metadata.
if ! git config --global --get user.email >/dev/null 2>&1 || \
   ! git config --global --get user.name >/dev/null 2>&1; then
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    GH_LOGIN="$(gh api user --jq '.login' 2>/dev/null || echo "")"
    GH_ID="$(gh api user --jq '.id' 2>/dev/null || echo "")"
    GH_NAME="$(gh api user --jq '.name // .login' 2>/dev/null || echo "")"
    if [[ -n "$GH_LOGIN" && -n "$GH_ID" ]]; then
      git config --global user.email "${GH_ID}+${GH_LOGIN}@users.noreply.github.com"
      git config --global user.name "${GH_NAME:-$GH_LOGIN}"
      green "  set git user.email = ${GH_ID}+${GH_LOGIN}@users.noreply.github.com (GitHub noreply)"
      green "  set git user.name  = ${GH_NAME:-$GH_LOGIN}"
    fi
  else
    dim "  gh not authenticated — git user.email/user.name not set."
    dim "  Run manually before first commit:"
    dim "    git config --global user.email \"you@example.com\""
    dim "    git config --global user.name  \"Your Name\""
  fi
fi

# ─────────────────────────────────────────────────────────
step "2/6 Installing dependencies"
cd "$REPO_DIR"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

# ─────────────────────────────────────────────────────────
step "3/6 Building"
# Clean any prior build artifacts so env vars + chunks always come from
# the current source tree (avoids stale .next on update re-runs).
rm -rf .next
npm run build

# ─────────────────────────────────────────────────────────
step "4/6 Configuration"
mkdir -p "$CONFIG_DIR"

# Pin the node that built the native modules (e.g. better-sqlite3) so the
# systemd service uses the same node binary at runtime — otherwise systemd's
# minimal PATH (/usr/bin:/bin) picks up a system node with a mismatched
# NODE_MODULE_VERSION and the .node files fail to load (ERR_DLOPEN_FAILED).
#
# Also include $HOME/.local/bin so `gh` (typically installed there) is
# reachable from the service — without this the clone-section returns 502
# with `spawn gh ENOENT` even though `gh` is happy from an interactive shell.
NODE_DIR="$(dirname "$(command -v node 2>/dev/null || echo /usr/bin/node)")"
SERVICE_PATH="$NODE_DIR:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"

# Always rewrite the env file so PATH stays current with the install-time
# node — but preserve the existing CSRF token (rotating it would break any
# already-loaded browser tab).
if [[ -f "$ENV_FILE" ]]; then
  EXISTING_CSRF="$(grep -E '^GITDASH_CSRF_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
  if [[ -n "$EXISTING_CSRF" ]]; then
    CSRF_TOKEN="$EXISTING_CSRF"
    dim "  Config exists at $ENV_FILE — keeping CSRF token, refreshing PATH"
  else
    CSRF_TOKEN=$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')
    dim "  Config exists at $ENV_FILE — generating CSRF token, refreshing PATH"
  fi
else
  CSRF_TOKEN=$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')
fi

cat > "$ENV_FILE" <<EOF
# gitdash environment — sourced by the systemd service.
# Edit values below to override defaults. Restart the service after changes:
#   systemctl --user restart gitdash

GITDASH_CSRF_TOKEN=$CSRF_TOKEN
GITDASH_PORT=7420
GITDASH_BIND=0.0.0.0
# GITDASH_EDITOR=code
# GITDASH_TERMINAL=x-terminal-emulator
# GITDASH_DB=$HOME/.local/state/gitdash/gitdash.sqlite

# Pin the node used at install time — prevents better-sqlite3 /
# NODE_MODULE_VERSION mismatch when systemd's minimal PATH would
# otherwise pick up an older apt-installed node. Also adds
# \$HOME/.local/bin so gh (and other user-installed CLIs) resolve.
PATH=$SERVICE_PATH
EOF
chmod 600 "$ENV_FILE"
green "  Wrote $ENV_FILE (mode 600; PATH pinned to $NODE_DIR)"

# ─────────────────────────────────────────────────────────
step "5/6 Installing systemd user service"
if ! command -v systemctl >/dev/null 2>&1; then
  red "  systemctl not available — skipping unit install."
  red "  Run manually:  ./bin/gitdash start"
  exit 0
fi

mkdir -p "$SYSTEMD_DIR"
sed "s|{{REPO_DIR}}|$REPO_DIR|g" "$TEMPLATE" > "$SERVICE_FILE"
green "  Wrote $SERVICE_FILE"

systemctl --user daemon-reload

if [[ $WANT_START -eq 1 ]]; then
  systemctl --user enable --now "$SERVICE_NAME"
  green "  Enabled + started: systemctl --user status $SERVICE_NAME"
else
  systemctl --user enable "$SERVICE_NAME"
  dim "  Enabled (not started). Start with: systemctl --user start $SERVICE_NAME"
fi

# ─────────────────────────────────────────────────────────
step "6/6 Auto-start on boot (lingering)"
if [[ $WANT_LINGER -eq 1 ]]; then
  if loginctl show-user "$USER" 2>/dev/null | grep -q "Linger=yes"; then
    dim "  Already enabled."
  else
    echo "  This lets gitdash start at boot without an active login session."
    echo "  Requires sudo:"
    if sudo -n loginctl enable-linger "$USER" 2>/dev/null; then
      green "  Enabled (no password prompt)."
    else
      echo
      sudo loginctl enable-linger "$USER" || {
        red "  Skipped — you can enable later with: sudo loginctl enable-linger $USER"
      }
    fi
  fi
else
  dim "  Skipped (--no-linger). gitdash will only run while you're logged in."
fi

# ─────────────────────────────────────────────────────────
echo
green "──────────────────────────────────────────────────"
green "  gitdash installed and running"
green "──────────────────────────────────────────────────"
PORT=$(grep -E '^GITDASH_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '"' )
PORT=${PORT:-7420}
LAN_IP=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))\.' | head -1 || true)
echo
echo "  Open in browser:"
echo "    http://127.0.0.1:$PORT"
[[ -n "$LAN_IP" ]] && echo "    http://$LAN_IP:$PORT  (other devices on your network)"
echo
echo "  Useful commands:"
echo "    systemctl --user status gitdash       # is it running?"
echo "    systemctl --user restart gitdash      # restart"
echo "    systemctl --user stop gitdash         # stop"
echo "    journalctl --user -u gitdash -f       # live logs"
echo "    ./install.sh                          # update + restart (re-runnable)"
echo "    ./uninstall.sh                        # remove cleanly"
echo
