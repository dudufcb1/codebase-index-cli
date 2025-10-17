# PowerShell installation script for Windows
# Run with: powershell -ExecutionPolicy Bypass -File scripts\install.ps1

$ErrorActionPreference = "Stop"

$REPO_DIR = Split-Path -Parent $PSScriptRoot
$BIN_DIR = if ($env:CODEBASE_INDEX_BIN_DIR) { $env:CODEBASE_INDEX_BIN_DIR } else { "$env:USERPROFILE\.local\bin" }
$CONFIG_DIR = if ($env:CODEBASE_INDEX_CONFIG_DIR) { $env:CODEBASE_INDEX_CONFIG_DIR } else { "$env:APPDATA\codebase-index-cli" }

# Check if pnpm is installed
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Error "pnpm is not installed. Install it from https://pnpm.io/installation and try again."
    exit 1
}

# Create directories
New-Item -ItemType Directory -Force -Path $BIN_DIR | Out-Null
New-Item -ItemType Directory -Force -Path $CONFIG_DIR | Out-Null

Write-Host "Installing CLI dependencies..." -ForegroundColor Cyan
Set-Location $REPO_DIR
pnpm install

Write-Host "Building CLI..." -ForegroundColor Cyan
pnpm run build

# Function to create batch wrapper
function New-BatchWrapper {
    param(
        [string]$Name,
        [string]$EnvVar = "",
        [string]$EnvValue = ""
    )

    $Target = Join-Path $BIN_DIR "$Name.bat"

    if ($EnvVar -and $EnvValue) {
        $Content = @"
@echo off
set $EnvVar=$EnvValue
node "$REPO_DIR\dist\index.js" %*
"@
    } else {
        $Content = @"
@echo off
node "$REPO_DIR\dist\index.js" %*
"@
    }

    Set-Content -Path $Target -Value $Content -Encoding ASCII
    Write-Host "Created: $Target" -ForegroundColor Green
}

# Create wrappers
New-BatchWrapper -Name "codebase-index"
New-BatchWrapper -Name "codebase" -EnvVar "VECTOR_STORE" -EnvValue "qdrant"
New-BatchWrapper -Name "codesql" -EnvVar "VECTOR_STORE" -EnvValue "sqlite"

# Check if BIN_DIR is in PATH
$PathParts = $env:Path -split ';'
if ($PathParts -notcontains $BIN_DIR) {
    Write-Host ""
    Write-Host "IMPORTANT: Add $BIN_DIR to your PATH environment variable." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "You can do this by:" -ForegroundColor Yellow
    Write-Host "1. Open System Properties > Advanced > Environment Variables" -ForegroundColor Yellow
    Write-Host "2. Edit the 'Path' variable under User variables" -ForegroundColor Yellow
    Write-Host "3. Add: $BIN_DIR" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Or run this command (requires admin/restart):" -ForegroundColor Yellow
    Write-Host "  [Environment]::SetEnvironmentVariable('Path', `$env:Path + ';$BIN_DIR', 'User')" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Installation completed! You can now run:" -ForegroundColor Green
Write-Host "  codebase -start .    # Uses Qdrant vector store" -ForegroundColor White
Write-Host "  codesql -start .     # Uses SQLite-vec (local database)" -ForegroundColor White
Write-Host "(The 'codebase-index' command is also available for compatibility)." -ForegroundColor Gray
Write-Host ""
Write-Host "Note: You may need to restart your terminal or add $BIN_DIR to PATH." -ForegroundColor Yellow
