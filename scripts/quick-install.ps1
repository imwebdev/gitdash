# gitdash quick-install for Windows (PowerShell)
#
# Usage (paste into any normal PowerShell window):
#   iwr -useb https://raw.githubusercontent.com/imwebdev/gitdash/main/scripts/quick-install.ps1 | iex
#
# What it does (idempotent):
#   1. Checks whether WSL 2 is installed
#   2. If not, installs WSL 2 (relaunches as admin if needed) and asks you to reboot
#   3. If WSL is installed but no Linux distro: installs Ubuntu, waits for the user
#      to finish setting their Linux username/password, then auto-continues
#   4. Runs the Linux quick-install.sh inside WSL
#   5. Leaves you with a `gitdash` command inside WSL

$ErrorActionPreference = 'Stop'

function Write-Step([string]$msg) { Write-Host "`n-> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "   [ok] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "   [!] $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "   [x] $msg" -ForegroundColor Red }
function Die([string]$msg)        { Write-Fail $msg; exit 1 }

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = [Security.Principal.WindowsPrincipal]$id
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "  gitdash installer for Windows " -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "gitdash runs inside WSL (Windows Subsystem for Linux)."
Write-Host "This script will set everything up for you."

# -----------------------------------------------------------------------------
# Step 1: Is WSL even available?
# -----------------------------------------------------------------------------
Write-Step "Checking for WSL"

$wslAvailable = $null -ne (Get-Command wsl -ErrorAction SilentlyContinue)

if (-not $wslAvailable) {
    Write-Warn "WSL is not installed"
    Write-Host ""
    Write-Host "I need to install WSL 2 now. This requires:"
    Write-Host "  - Administrator privileges (I'll ask Windows to elevate)"
    Write-Host "  - A reboot when it finishes"
    Write-Host "  - About 3 minutes of your time"
    Write-Host ""
    $ans = Read-Host "Install WSL 2 now? [Y/n]"
    if ($ans -and $ans.Trim().ToLower() -notin @('', 'y', 'yes')) {
        Write-Host "Aborted. Run this command again whenever you are ready."
        exit 0
    }

    if (Test-IsAdmin) {
        Write-Step "Running: wsl --install"
        wsl --install
        Write-Host ""
        Write-Ok "WSL install started."
        Write-Host ""
        Write-Host "IMPORTANT: Reboot Windows now." -ForegroundColor Yellow
        Write-Host "After reboot, Ubuntu will launch automatically and ask for a Linux"
        Write-Host "username + password. Set them. Then re-run this same command to finish"
        Write-Host "installing gitdash."
        exit 0
    }

    Write-Host ""
    Write-Host "Opening a new admin PowerShell window to run 'wsl --install'..."
    Write-Host "(Windows will show a UAC prompt - click Yes.)"
    Write-Host ""

    $adminCmd = @'
Write-Host "Installing WSL 2..." -ForegroundColor Cyan
wsl --install
Write-Host ""
Write-Host "WSL install finished. REBOOT Windows now, then re-run the gitdash" -ForegroundColor Yellow
Write-Host "install command in your regular PowerShell window to finish." -ForegroundColor Yellow
Write-Host ""
Write-Host "Press any key to close this window..."
[void][System.Console]::ReadKey($true)
'@

    try {
        Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList @(
            '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-Command', $adminCmd
        ) | Out-Null
    } catch {
        Die "Could not launch admin PowerShell. Right-click the Start button, pick 'Terminal (Admin)' or 'Windows PowerShell (Admin)', then run:  wsl --install"
    }

    Write-Host ""
    Write-Ok "Admin window opened. Follow its instructions (install + reboot)."
    Write-Host "Once Windows has rebooted and Ubuntu is set up, run this gitdash"
    Write-Host "install command again."
    exit 0
}

Write-Ok "WSL command is available"

# -----------------------------------------------------------------------------
# Step 2: Is there a Linux distro installed inside WSL?
# -----------------------------------------------------------------------------
Write-Step "Checking for a WSL Linux distro"

# `wsl --list --quiet` can emit UTF-16 output on some systems; decode safely.
$prevEncoding = [Console]::OutputEncoding
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::Unicode
    $rawList = wsl --list --quiet 2>$null
} finally {
    [Console]::OutputEncoding = $prevEncoding
}

$distros = @()
if ($rawList) {
    $distros = $rawList |
        ForEach-Object { ($_ -replace "`0", '').Trim() } |
        Where-Object { $_ -ne '' }
}

if (-not $distros -or $distros.Count -eq 0) {
    Write-Warn "WSL is installed but no Linux distro is set up yet"
    Write-Host ""
    Write-Host "An Ubuntu window will open. It will ask you to set a Linux username + password."
    Write-Host "Once you see the Ubuntu prompt (e.g. 'you@host:~`$'), come back to THIS window."
    Write-Host "gitdash will continue installing here automatically - you do NOT need to re-run anything."
    Write-Host ""

    wsl --install -d Ubuntu

    Write-Step "Waiting for Ubuntu to finish provisioning"
    Write-Host "   (Polling every few seconds. Just finish setting your Ubuntu username + password.)"

    $deadline = (Get-Date).AddMinutes(15)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        wsl -d Ubuntu -- true 2>$null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 3
    }

    if (-not $ready) {
        Write-Host ""
        Write-Warn "Ubuntu did not become reachable within 15 minutes."
        Write-Host ""
        Write-Host "Once you have set your Ubuntu username + password and you see its prompt,"
        Write-Host "come back to PowerShell and paste this exact command:"
        Write-Host ""
        Write-Host "  iwr -useb https://raw.githubusercontent.com/imwebdev/gitdash/main/scripts/quick-install.ps1 | iex" -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }

    $distros = @('Ubuntu')
}

Write-Ok ("Found: {0}" -f ($distros -join ', '))

# -----------------------------------------------------------------------------
# Step 3: Run the bash installer inside WSL
# -----------------------------------------------------------------------------
Write-Step "Running the gitdash installer inside WSL"
Write-Host "   (This takes a few minutes - installing Node deps and building.)"
Write-Host ""

$bashCmd = 'curl -fsSL https://raw.githubusercontent.com/imwebdev/gitdash/main/scripts/quick-install.sh | bash'
wsl bash -c $bashCmd
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Die "The Linux installer exited with code $exitCode. See the output above for what went wrong."
}

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "================================" -ForegroundColor Green
Write-Host "  gitdash is installed in WSL   " -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""
Write-Host "To start gitdash:"
Write-Host "  1. Open a new PowerShell window"
Write-Host "  2. Type:  wsl"
Write-Host "  3. Inside Linux, type:  gitdash start"
Write-Host "  4. Open http://127.0.0.1:7420 in any Windows browser"
Write-Host ""
