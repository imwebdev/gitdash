# gitdash quick-uninstall for Windows (PowerShell)
#
# Usage (paste into any normal PowerShell window):
#   iwr -useb https://raw.githubusercontent.com/imwebdev/gitdash/main/scripts/quick-uninstall.ps1 | iex
#
# To also wipe the SQLite database + config inside WSL, set $env:GITDASH_PURGE
# before piping (PowerShell can't pass args through `iwr | iex`):
#   $env:GITDASH_PURGE='1'
#   iwr -useb https://raw.githubusercontent.com/imwebdev/gitdash/main/scripts/quick-uninstall.ps1 | iex
#
# What it does (idempotent):
#   1. Removes the gitdash.cmd shim from %LOCALAPPDATA%\gitdash
#   2. Strips that directory from your user PATH (and current session PATH)
#   3. Runs the cross-platform bash uninstaller inside WSL to clean up the
#      gitdash service + launcher inside Ubuntu
#   4. (Optional) --purge wipes the WSL-side config + SQLite DB
#
# What it does NOT do:
#   - It does not run `wsl --unregister Ubuntu`. That would nuke your entire
#     WSL Ubuntu and anything else you put there. If you genuinely want that,
#     run it yourself: `wsl --unregister Ubuntu`

$ErrorActionPreference = 'Stop'

function Write-Step([string]$msg) { Write-Host "`n-> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "   [ok] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "   [!] $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "   [x] $msg" -ForegroundColor Red }
function Die([string]$msg)        { Write-Fail $msg; exit 1 }

$Purge = $env:GITDASH_PURGE -eq '1'

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "  gitdash uninstaller for Windows " -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
if ($Purge) {
    Write-Host "Mode: --purge (will also wipe SQLite database + config)" -ForegroundColor Yellow
} else {
    Write-Host "Mode: standard (keeps your config + database; set `$env:GITDASH_PURGE='1' to wipe)"
}

# -----------------------------------------------------------------------------
# Step 1: Remove the Windows shim and clean up PATH
# -----------------------------------------------------------------------------
Write-Step "Removing Windows launcher shim"

$shimDir  = Join-Path $env:LOCALAPPDATA 'gitdash'
$shimPath = Join-Path $shimDir 'gitdash.cmd'

if (Test-Path $shimPath) {
    Remove-Item -Force $shimPath
    Write-Ok "Removed $shimPath"
}
if (Test-Path $shimDir) {
    # Only remove the dir if empty (paranoia: don't blow away anything the
    # user might have dropped in there).
    if (-not (Get-ChildItem -Force $shimDir)) {
        Remove-Item -Force $shimDir
        Write-Ok "Removed empty $shimDir"
    } else {
        Write-Warn "$shimDir is not empty - left in place"
    }
}

# Strip from persistent user PATH
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath) {
    $entries = $userPath -split ';' | Where-Object { $_ -and $_ -ne $shimDir }
    $newUserPath = ($entries -join ';')
    if ($newUserPath -ne $userPath) {
        [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
        Write-Ok "Removed $shimDir from user PATH"
    }
}

# Strip from current session PATH too
$sessionEntries = $env:Path -split ';' | Where-Object { $_ -and $_ -ne $shimDir }
$env:Path = ($sessionEntries -join ';')

# -----------------------------------------------------------------------------
# Step 2: Run the bash uninstaller inside WSL
# -----------------------------------------------------------------------------
$wslAvailable = $null -ne (Get-Command wsl -ErrorAction SilentlyContinue)
if (-not $wslAvailable) {
    Write-Warn "WSL is not installed - nothing to clean up on the Linux side."
    Write-Host ""
    Write-Ok "Windows-side cleanup complete."
    exit 0
}

Write-Step "Running the gitdash uninstaller inside WSL"

# Build the bash command. quick-uninstall.sh handles install location lookup
# and forwards --purge to the in-tree uninstall.sh.
$bashCmd = 'curl -fsSL https://raw.githubusercontent.com/imwebdev/gitdash/main/scripts/quick-uninstall.sh | bash'
if ($Purge) {
    $bashCmd = 'curl -fsSL https://raw.githubusercontent.com/imwebdev/gitdash/main/scripts/quick-uninstall.sh | bash -s -- --purge'
}

wsl bash -c $bashCmd
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Warn "WSL-side uninstaller exited with code $exitCode (continuing - Windows-side cleanup already done)."
}

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "==================================" -ForegroundColor Green
Write-Host "  gitdash uninstall complete       " -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Green
Write-Host ""
Write-Host "What's gone:"
Write-Host "  - $shimPath (Windows launcher)"
Write-Host "  - User PATH entry for $shimDir"
Write-Host "  - gitdash systemd unit + launcher inside WSL"
if ($Purge) {
    Write-Host "  - WSL-side config + SQLite database (--purge)"
}
Write-Host ""
Write-Host "What's still here:"
Write-Host "  - Your WSL distro (Ubuntu) and everything else inside it"
Write-Host "  - The gitdash source clone inside WSL (~/gitdash by default)"
if (-not $Purge) {
    Write-Host "  - Your gitdash config + SQLite database (re-run with `$env:GITDASH_PURGE='1' to wipe)"
}
Write-Host ""
Write-Host "If you also want WSL gone entirely: wsl --unregister Ubuntu" -ForegroundColor DarkGray
Write-Host ""
