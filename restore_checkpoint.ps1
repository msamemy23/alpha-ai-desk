# ============================================================
# AgentX / Alpha AI Desk — Checkpoint Restore
# Restores a saved checkpoint back to its original file paths.
# Usage:  .\restore_checkpoint.ps1 -Name "checkpoint-2026-04-13-0900"
#         .\restore_checkpoint.ps1              (lists available checkpoints)
# ============================================================

param(
  [string]$Name = ""
)

$Root          = $PSScriptRoot
$CheckpointDir = Join-Path $Root "checkpoints"

# List available checkpoints if no name given
if ($Name -eq "") {
  Write-Host ""
  Write-Host "Available checkpoints:" -ForegroundColor Cyan
  if (Test-Path $CheckpointDir) {
    $list = Get-ChildItem -Path $CheckpointDir -Directory | Sort-Object Name -Descending
    if ($list.Count -eq 0) {
      Write-Host "  (none found)" -ForegroundColor Yellow
    } else {
      foreach ($cp in $list) {
        $meta = Join-Path $cp.FullName "CHECKPOINT_INFO.json"
        $info = if (Test-Path $meta) { Get-Content $meta | ConvertFrom-Json } else { $null }
        $date = if ($info) { $info.created } else { $cp.LastWriteTime }
        Write-Host "  $($cp.Name)  ($date)" -ForegroundColor White
      }
    }
  } else {
    Write-Host "  No checkpoints directory found." -ForegroundColor Yellow
  }
  Write-Host ""
  Write-Host "Usage: .\restore_checkpoint.ps1 -Name `"<checkpoint-name>`"" -ForegroundColor Cyan
  return
}

$BackupDir = Join-Path $CheckpointDir $Name

if (-not (Test-Path $BackupDir)) {
  Write-Host "ERROR: Checkpoint not found: $BackupDir" -ForegroundColor Red
  return
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  Restoring checkpoint: $Name" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

# Restore web files
$webFiles = @(
  @{ backup = "web_web_src_app_(app)_ai_page.tsx";           dest = "web\src\app\(app)\ai\page.tsx" },
  @{ backup = "web_web_src_lib_supabase.ts";                 dest = "web\src\lib\supabase.ts" },
  @{ backup = "web_web_src_middleware.ts";                    dest = "web\src\middleware.ts" },
  @{ backup = "web_web_next.config.mjs";                     dest = "web\next.config.mjs" },
  @{ backup = "web_web_next.config.js";                      dest = "web\next.config.js" },
  @{ backup = "web_web_package.json";                        dest = "web\package.json" },
  @{ backup = "web_SESSION_LOG.md";                          dest = "SESSION_LOG.md" },
  @{ backup = "web_DEVNOTES.md";                             dest = "DEVNOTES.md" }
)

foreach ($f in $webFiles) {
  $src = Join-Path $BackupDir $f.backup
  $dst = Join-Path $Root $f.dest
  if (Test-Path $src) {
    $dstDir = Split-Path $dst -Parent
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    Copy-Item -Path $src -Destination $dst -Force
    Write-Host "  Restored: $($f.dest)" -ForegroundColor Green
  }
}

# Restore electron files
$electronFiles = @(
  @{ backup = "electron_main.js";    dest = "..\alpha-desk-desktop\main.js" },
  @{ backup = "electron_preload.js"; dest = "..\alpha-desk-desktop\preload.js" },
  @{ backup = "electron_package.json"; dest = "..\alpha-desk-desktop\package.json" }
)

foreach ($f in $electronFiles) {
  $src = Join-Path $BackupDir $f.backup
  $dst = Join-Path $Root $f.dest
  if (Test-Path $src) {
    Copy-Item -Path $src -Destination $dst -Force
    Write-Host "  Restored: (electron) $(Split-Path $f.dest -Leaf)" -ForegroundColor Green
  }
}

Write-Host ""
Write-Host "Checkpoint '$Name' restored." -ForegroundColor Cyan
Write-Host "Restart the Electron app and redeploy Vercel to see changes." -ForegroundColor White
Write-Host ""
