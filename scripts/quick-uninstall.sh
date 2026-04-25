#!/usr/bin/env bash
# gitdash quick-uninstall for Linux + macOS.
#
# Usage (from any shell):
#   bash <(curl -fsSL https://raw.githubusercontent.com/imwebdev/gitdash/main/scripts/quick-uninstall.sh)
#   bash <(curl -fsSL https://raw.githubusercontent.com/imwebdev/gitdash/main/scripts/quick-uninstall.sh) --purge
#
# What it does:
#   1. Locates the gitdash install (env GITDASH_HOME, then ~/gitdash, then
#      legacy ~/.local/share/gitdash)
#   2. Delegates to that install's ./uninstall.sh (cross-platform)
#   3. Forwards --purge if you passed it
#
# It does NOT delete the source tree itself - the repo is left in place so
# you can re-install with `cd ~/gitdash && ./install.sh` later. Delete the
# directory yourself if you want it gone.

set -euo pipefail

C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[0;33m'; C_RED=$'\033[0;31m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
ok()   { printf "%s[ok]%s %s\n" "$C_GREEN"  "$C_RESET" "$*"; }
warn() { printf "%s[!]%s %s\n"  "$C_YELLOW" "$C_RESET" "$*"; }
die()  { printf "%s[x]%s %s\n"  "$C_RED"    "$C_RESET" "$*" >&2; exit 1; }
dim()  { printf "%s%s%s\n"      "$C_DIM"    "$*"        "$C_RESET"; }

# Pass through every CLI arg to the underlying uninstall.sh
ARGS=("$@")

# ---------- locate the install ----------------------------------------------
DEFAULT_INSTALL_DIR="$HOME/gitdash"
LEGACY_INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gitdash"

if [[ -n "${GITDASH_HOME:-}" ]]; then
  INSTALL_DIR="$GITDASH_HOME"
elif [[ -d "$DEFAULT_INSTALL_DIR/.git" ]]; then
  INSTALL_DIR="$DEFAULT_INSTALL_DIR"
elif [[ -d "$LEGACY_INSTALL_DIR/.git" ]]; then
  INSTALL_DIR="$LEGACY_INSTALL_DIR"
else
  die "Could not find a gitdash install. Looked in:
    \$GITDASH_HOME (unset)
    $DEFAULT_INSTALL_DIR
    $LEGACY_INSTALL_DIR
  If gitdash is installed somewhere else, set GITDASH_HOME=/path/to/gitdash and re-run."
fi

ok "Found install at $INSTALL_DIR"

UNINSTALLER="$INSTALL_DIR/uninstall.sh"
if [[ ! -x "$UNINSTALLER" ]]; then
  die "Found install dir but no executable uninstall.sh at $UNINSTALLER"
fi

# ---------- delegate to in-tree uninstaller ---------------------------------
"$UNINSTALLER" "${ARGS[@]}"

echo
ok "Done. Source tree at $INSTALL_DIR was NOT deleted."
dim "    rm -rf \"$INSTALL_DIR\"   # if you also want the source gone"
