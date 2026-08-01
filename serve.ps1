# Fallback launcher — prefers Node (reliable on Windows)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "ERROR: Node.js not found. Install from https://nodejs.org"
  exit 1
}

if (-not (Test-Path (Join-Path $PSScriptRoot 'index.html'))) {
  Write-Host "ERROR: index.html missing"
  exit 1
}

Write-Host "Starting Voodoo Lottery (node server.js)..."
& node (Join-Path $PSScriptRoot 'server.js')
