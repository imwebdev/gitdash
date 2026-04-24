#!/usr/bin/env bash
# uninstall.sh
#
# Cleanly removes the gitdash systemd unit. Optionally also wipes the SQLite
# database and the persistent CSRF/env config. Does NOT delete the repo itself.
#
# Usage:
#   ./uninstall.sh                # remove unit only, keep config and DB
#   ./uninstall.sh --purge        # also delete config + DB (irreversible)
#   ./uninstall.sh --no-linger    # also disable user lingering (sudo)
#   ./uninstall.sh --help

set -euo pipefail

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/gitdash"
SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_NAME="gitdash"
SERVICE_FILE="$SYSTEMD_DIR/$SERVICE_NAME.service"

LAUNCHD_LABEL="com.gitdash"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"

case "$(uname -s)" in
  Linux)  PLATFORM="linux"  ;;
  Darwin) PLATFORM="macos"  ;;
  *)      PLATFORM="unknown" ;;
esac

# State dir is platform-aware, matching lib/db/schema.ts default.
if [[ "$PLATFORM" == "macos" ]]; then
  STATE_DIR="${XDG_STATE_HOME:-$HOME/Library/Application Support}/gitdash"
else
  STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/gitdash"
fi

PURGE=0
DISABLE_LINGER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge)      PURGE=1; shift ;;
    --no-linger)  DISABLE_LINGER=1; shift ;;
    --help|-h)
      grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown flag: $1 (try --help)" >&2; exit 2 ;;
  esac
done

green() { printf "\033[0;32m%s\033[0m\n" "$*"; }
dim()   { printf "\033[2m%s\033[0m\n" "$*"; }

if [[ "$PLATFORM" == "linux" ]]; then
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl --user is-enabled "$SERVICE_NAME" >/dev/null 2>&1 || \
       systemctl --user is-active "$SERVICE_NAME" >/dev/null 2>&1; then
      systemctl --user disable --now "$SERVICE_NAME" 2>/dev/null || true
      green "Stopped + disabled $SERVICE_NAME"
    fi
  fi

  if [[ -f "$SERVICE_FILE" ]]; then
    rm -f "$SERVICE_FILE"
    command -v systemctl >/dev/null 2>&1 && systemctl --user daemon-reload || true
    green "Removed $SERVICE_FILE"
  fi
elif [[ "$PLATFORM" == "macos" ]]; then
  if launchctl list "$LAUNCHD_LABEL" >/dev/null 2>&1; then
    launchctl unload "$LAUNCHD_PLIST" >/dev/null 2>&1 || true
    green "Unloaded LaunchAgent $LAUNCHD_LABEL"
  fi
  if [[ -f "$LAUNCHD_PLIST" ]]; then
    rm -f "$LAUNCHD_PLIST"
    green "Removed $LAUNCHD_PLIST"
  fi
else
  dim "Unknown platform ($(uname -s)); skipping service teardown."
fi

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

if [[ $DISABLE_LINGER -eq 1 && "$PLATFORM" == "linux" ]]; then
  sudo loginctl disable-linger "$USER" 2>/dev/null && green "Disabled user linger" || \
    dim "Could not disable linger (may require sudo or wasn't enabled)"
elif [[ $DISABLE_LINGER -eq 1 ]]; then
  dim "--no-linger has no effect on $PLATFORM (LaunchAgents don't use linger)."
fi

echo
green "Uninstall complete. The repo itself is still here at:"
echo "  $(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Delete it manually if you want to remove gitdash entirely."
