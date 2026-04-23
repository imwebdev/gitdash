#!/usr/bin/env bash
# scripts/preflight.sh
#
# Verifies the host has everything gitdash needs. Used by install.sh.
# Can also be run standalone:  ./scripts/preflight.sh
#
# Exits 0 on full pass, 1 if anything is missing.

set -uo pipefail

PASS="\033[0;32m✓\033[0m"
FAIL="\033[0;31m✗\033[0m"
WARN="\033[0;33m!\033[0m"

errors=0
warnings=0

check() {
  # check "label" "command" [remediation]
  local label=$1 cmd=$2 remedy=${3:-}
  if eval "$cmd" >/dev/null 2>&1; then
    printf "  ${PASS} %s\n" "$label"
  else
    printf "  ${FAIL} %s\n" "$label"
    [[ -n "$remedy" ]] && printf "      → %s\n" "$remedy"
    errors=$((errors+1))
  fi
}

warn() {
  local label=$1 cmd=$2 remedy=${3:-}
  if eval "$cmd" >/dev/null 2>&1; then
    printf "  ${PASS} %s\n" "$label"
  else
    printf "  ${WARN} %s\n" "$label"
    [[ -n "$remedy" ]] && printf "      → %s\n" "$remedy"
    warnings=$((warnings+1))
  fi
}

echo
echo "Required tools"
echo "──────────────"
check "git installed" "command -v git" "Install git: apt install git / brew install git"
check "node installed" "command -v node" "Install Node.js 20+ from https://nodejs.org or via nvm"
check "npm installed" "command -v npm" "Comes with Node.js"

if command -v node >/dev/null 2>&1; then
  node_version=$(node --version | sed 's/v//' | cut -d. -f1)
  if [[ "$node_version" -lt 20 ]]; then
    printf "  ${FAIL} node version >= 20 (found v%s)\n" "$node_version"
    printf "      → Upgrade Node.js. Recommended: nvm install 20 && nvm use 20\n"
    errors=$((errors+1))
  else
    printf "  ${PASS} node version >= 20 (found v%s)\n" "$node_version"
  fi
fi

echo
echo "GitHub access (required for repo comparison)"
echo "──────────────"
check "gh CLI installed" "command -v gh" "Install GitHub CLI: https://cli.github.com — apt install gh / brew install gh"
check "gh authenticated" "gh auth status" "Run: gh auth login   (choose GitHub.com → HTTPS → login with browser)"

echo
echo "System integration"
echo "──────────────"
check "systemctl available" "command -v systemctl" "systemd required for auto-start. Manual launch via ./bin/gitdash start still works."
check "port 7420 free" "! ss -tln 2>/dev/null | grep -q ':7420 '" "Port 7420 is in use. Stop the other service or set GITDASH_PORT=<other> before running install."

echo
echo "Optional"
echo "──────────────"
warn "VS Code (\`code\`) available" "command -v code" "Default editor is \`code\`. Override with GITDASH_EDITOR=<your-editor> if you use something else."
warn "x-terminal-emulator available" "command -v x-terminal-emulator" "Used for the 'Open in terminal' button. Override with GITDASH_TERMINAL=<gnome-terminal|kitty|alacritty|...> if needed."

echo
if [[ $errors -gt 0 ]]; then
  echo "─────────────────────────────────────────"
  printf "${FAIL} %d required check(s) failed. Fix the above and re-run.\n" "$errors"
  echo
  exit 1
fi

if [[ $warnings -gt 0 ]]; then
  printf "${WARN} %d optional check(s) failed — see notes above. Continuing.\n" "$warnings"
fi
echo "All required checks passed."
echo
exit 0
