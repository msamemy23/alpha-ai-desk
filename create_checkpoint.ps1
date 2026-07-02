# ============================================================
# AgentX / Alpha AI Desk — Checkpoint Creator
# Run this any time you want to save a restore point.
# Usage:  .\create_checkpoint.ps1 [-Name "my-label"]
# ============================================================

param(
  [string]$Name = "checkpoint-$(Get-Date -Format 'yyyy-MM-dd-HHmm')"
)

$Root      = $PSScriptRoot
$BackupDir = Join-Path $Root "checkpoints\$Name"

# Files and folders to snapshot
$Targets = @(
  "web\src\app\(app)\ai\page.tsx",
  "web\src\lib\supabase.ts",
  "web\src\middleware.ts",
  "web\next.config.mjs",
  "web\next.config.js",
  "web\package.json",
  "SESSION_LOG.md",
  "DEVNOTES.md"
)

$ElectronTargets = @(
  "..\alpha-desk-desktop\main.js",
  "..\alpha-desk-desktop\preload.js",
  "..\alpha-desk-desktop\package.json"
)

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Creating checkpoint: $Name" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Create checkpoint directory
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

# Copy web targets
foreach ($t in $Targets) {
  $src = Join-Path $Root $t
  if (Test-Path $src) {
    $rel = $t.Replace("\", "_").Replace("/", "_")
    $dst = Join-Path $BackupDir "web_$rel"
    Copy-Item -Path $src -Destination $dst -Force
    Write-Host "  + $t" -ForegroundColor Green
  } else {
    Write-Host "  - $t (not found, skipped)" -ForegroundColor Yellow
  }
}

# Copy electron targets
foreach ($t in $ElectronTargets) {
  $src = Join-Path $Root $t
  if (Test-Path $src) {
    $rel = (Split-Path $t -Leaf)
    $dst = Join-Path $BackupDir "electron_$rel"
    Copy-Item -Path $src -Destination $dst -Force
    Write-Host "  + (electron) $rel" -ForegroundColor Green
  } else {
    Write-Host "  - $t (not found, skipped)" -ForegroundColor Yellow
  }
}

# Write checkpoint metadata
$meta = @{
  name      = $Name
  created   = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  files     = ($Targets + $ElectronTargets)
} | ConvertTo-Json

$meta | Set-Content -Path (Join-Path $BackupDir "CHECKPOINT_INFO.json")

Write-Host ""
Write-Host "Checkpoint saved to:" -ForegroundColor Cyan
Write-Host "  $BackupDir" -ForegroundColor White
Write-Host ""
Write-Host "To restore this checkpoint, run:" -ForegroundColor Cyan
Write-Host "  .\restore_checkpoint.ps1 -Name `"$Name`"" -ForegroundColor White
Write-Host ""
