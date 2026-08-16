#!/usr/bin/env pwsh
# install-hooks.ps1 - Install Git hooks (PowerShell)
# Usage: ./scripts/install-hooks.ps1

$ErrorActionPreference = "Stop"

$Root = git rev-parse --show-toplevel
$HooksDir = Join-Path $Root ".git\hooks"

Write-Host "Installing Git hooks..."

# Ensure hooks directory exists
if (-not (Test-Path $HooksDir)) {
    New-Item -ItemType Directory -Path $HooksDir -Force | Out-Null
}

# Copy pre-commit hook from scripts
$HookPath = Join-Path $HooksDir "pre-commit"

# Write minimal hook that calls the check script
$HookContent = @"
#!/bin/sh
ROOT="`$(git rev-parse --show-toplevel)"
if [ -f "`$ROOT/scripts/check-encoding.cjs" ]; then
  node "`$ROOT/scripts/check-encoding.cjs" --staged
  exit `$?
fi
exit 0
"@

[System.IO.File]::WriteAllText($HookPath, $HookContent, [System.Text.Encoding]::UTF8)

Write-Host "Done. pre-commit hook installed."
Write-Host ""
Write-Host "Test with: npm run check-encoding"