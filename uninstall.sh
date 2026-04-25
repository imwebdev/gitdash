#!/usr/bin/env bash
# uninstall.sh
#
# Cleanly removes gitdash. Works on Linux (systemd) and macOS (launchd-less
# foreground process). Optionally also wipes the SQLite database and the
# persistent CSRF/env config. Does NOT delete the repo itself.
#
# Usage:
#   ./uninstall.sh                # remove service/process + launcher, keep config and DB
#   ./uninstall.sh --purge        # also delete config + DB (irreversible)
#   ./uninstall.sh --no-linger    # also disable user lingering (Linux, sudo)
#   ./uninstall.sh --help

set -euo pipefail

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/gitdash"
SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/gitdash"
SERVICE_NAME="gitdash"
SERVICE_FILE="$SYSTEMD_DIR/$SERVICE_NAME.service"
LAUNCHER="$HOME/.local/bin/gitdash"

PURGE=0
DISABLE_LINGER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge)      PURGE=1; shift ;;
    --no-linger)  DISABLE_LINGER=1; shift ;;
    --help|-h)
      # Only print the leading docstring block (stop at the first non-comment
      # line). Avoids leaking inline section-divider comments below.
      awk '/^#!/ {next} /^# / || /^#$/ {sub(/^# ?/, ""); print; next} {exit}' "$0"
      exit 0
      ;;
    *) echo "Unknown flag: $1 (try --help)" >&2; exit 2 ;;
  esac
done

green() { printf "\033[0;32m%s\033[0m\n" "$*"; }
dim()   { printf "\033[2m%s\033[0m\n" "$*"; }

case "$(uname -s)" in
  Linux*)  OS="linux"  ;;
  Darwin*) OS="macos"  ;;
  *)       OS="other"  ;;
esac

# ---------- Linux: stop + disable systemd unit -------------------------------
if [[ "$OS" = "linux" ]] && command -v systemctl >/dev/null 2>&1; then
  if systemctl --user is-enabled "$SERVICE_NAME" >/dev/null 2>&1 || \
     systemctl --user is-active "$SERVICE_NAME" >/dev/null 2>&1; then
    systemctl --user disable --now "$SERVICE_NAME" 2>/dev/null || true
    green "Stopped + disabled $SERVICE_NAME"
  fi
  if [[ -f "$SERVICE_FILE" ]]; then
    rm -f "$SERVICE_FILE"
    systemctl --user daemon-reload 2>/dev/null || true
    green "Removed $SERVICE_FILE"
  fi
fi

# ---------- macOS: kill any running gitdash foreground process ---------------
# macOS doesn't (yet — see #21) get a launchd plist; users run `gitdash start`
# in a shell. The actual long-running process is `next start` bound to 7420.
if [[ "$OS" = "macos" ]]; then
  # pgrep -f matches against the full command line. Match the next.js process
  # bound to gitdash's port to avoid killing unrelated `next` instances.
  pids=$(pgrep -f "next.*start.*-p[[:space:]]+7420" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    # Force-kill anything still hanging on
    # shellcheck disable=SC2086
    pgrep -f "next.*start.*-p[[:space:]]+7420" >/dev/null 2>&1 && kill -9 $pids 2>/dev/null || true
    green "Stopped running gitdash process(es)"
  else
    dim "No running gitdash process found"
  fi
fi

# ---------- Cross-platform: remove the ~/.local/bin/gitdash launcher ---------
# quick-install.sh symlinks the launcher there on both Linux and macOS.
if [[ -L "$LAUNCHER" || -f "$LAUNCHER" ]]; then
  rm -f "$LAUNCHER"
  green "Removed launcher $LAUNCHER"
fi

# ---------- --purge: wipe config + state -------------------------------------
if [[ $PURGE -eq 1 ]]; then
  if [[ -d "$CONFIG_DIR" ]]; then
    rm -rf "$CONFIG_DIR"
    green "Removed $CONFIG_DIR"
  fi
  if [[ -d "$STATE_DIR" ]]; then
    rm -rf "$STATE_DIR"
    green "Removed $STATE_DIR (SQLite database, action history, GH ETag cache)"
  fi
else
  dim "Kept $CONFIG_DIR and $STATE_DIR (use --purge to delete)"
fi

# ---------- Linux: optional disable-linger -----------------------------------
if [[ "$OS" = "linux" && $DISABLE_LINGER -eq 1 ]]; then
  sudo loginctl disable-linger "$USER" 2>/dev/null && green "Disabled user linger" || \
    dim "Could not disable linger (may require sudo or wasn't enabled)"
fi

echo
green "Uninstall complete. The repo itself is still here at:"
echo "  $(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Delete it manually if you want to remove gitdash entirely."
