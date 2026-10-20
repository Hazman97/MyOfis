# Run the hub + runner in the background, with no terminal windows (owner request, 2026-10-20).
#
#   powershell -ExecutionPolicy Bypass -File scripts\background.ps1 start     # start (stops `bun run dev` first yourself)
#   powershell -ExecutionPolicy Bypass -File scripts\background.ps1 stop
#   powershell -ExecutionPolicy Bypass -File scripts\background.ps1 restart   # after pulling code / UI build
#   powershell -ExecutionPolicy Bypass -File scripts\background.ps1 status
#   powershell -ExecutionPolicy Bypass -File scripts\background.ps1 logs      # last lines of both logs
#   powershell -ExecutionPolicy Bypass -File scripts\background.ps1 autostart # start at login (Startup folder, no admin)
#   powershell -ExecutionPolicy Bypass -File scripts\background.ps1 no-autostart
#
# The hub serves the built UI: run `bun run --cwd apps/web build` after UI changes, then restart.
# Logs: data/logs/hub.log, data/logs/runner.log (+ .err.log). PIDs: data/logs/background.json.
param([string]$Action = "status")

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Logs = Join-Path $Root "data\logs"
$PidFile = Join-Path $Logs "background.json"
$Bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $Bun) { $Bun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe" }
$Apps = [ordered]@{ hub = "apps/hub/src/index.ts"; runner = "apps/runner/src/index.ts" }
$Startup = Join-Path ([Environment]::GetFolderPath("Startup")) "MyOfis background.vbs"

function Read-Pids {
  if (Test-Path $PidFile) { try { return Get-Content $PidFile -Raw | ConvertFrom-Json } catch {} }
  return $null
}

# An entry is { pid, start }: a pid alone could be reused by another bun after a reboot.
function Get-Entry($pids, $name) {
  if (-not $pids) { return $null }
  $e = $pids.$name
  if ($e -is [int] -or $e -is [long]) { return @{ pid = $e; start = $null } }
  return $e
}

function Test-Running($entry) {
  if (-not $entry -or -not $entry.pid) { return $false }
  $p = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
  if (-not ($p -and $p.ProcessName -eq "bun")) { return $false }
  if ($entry.start) { return $p.StartTime.ToString("o") -eq $entry.start }
  return $true
}

function Show-Status {
  $pids = Read-Pids
  foreach ($name in $Apps.Keys) {
    $entry = Get-Entry $pids $name
    $state = if (Test-Running $entry) { "running (pid $($entry.pid))" } else { "stopped" }
    "{0,-7} {1}" -f $name, $state
  }
}

function Start-All {
  New-Item -ItemType Directory -Force $Logs | Out-Null
  $pids = Read-Pids
  $out = @{}
  foreach ($name in $Apps.Keys) {
    $old = Get-Entry $pids $name
    if (Test-Running $old) { "$name already running (pid $($old.pid))"; $out[$name] = $old; continue }
    # keep the previous log (a crash before a restart would be lost otherwise)
    foreach ($f in "$name.log", "$name.err.log") {
      $path = Join-Path $Logs $f
      if (Test-Path $path) { Move-Item -Force $path ($path -replace '\.log$', '.prev.log') }
    }
    # bun loads .env from the repo folder (cwd), the same as `bun run dev`
    $p = Start-Process -FilePath $Bun -ArgumentList $Apps[$name] -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $Logs "$name.log") -RedirectStandardError (Join-Path $Logs "$name.err.log")
    $out[$name] = @{ pid = $p.Id; start = (Get-Process -Id $p.Id).StartTime.ToString("o") }
    "$name started (pid $($p.Id))"
    if ($name -eq "hub") { Start-Sleep -Seconds 4 } # the runner connects to the hub
  }
  $out | ConvertTo-Json | Set-Content -Encoding utf8 $PidFile
}

function Stop-All {
  $pids = Read-Pids
  if (-not $pids) { "nothing to stop"; return }
  foreach ($name in @("runner", "hub")) {
    $entry = Get-Entry $pids $name
    if (Test-Running $entry) { taskkill /PID $entry.pid /T /F | Out-Null; "$name stopped" } else { "$name was not running" }
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}

switch ($Action) {
  "start" { Start-All }
  "stop" { Stop-All }
  "restart" { Stop-All; Start-Sleep -Seconds 2; Start-All }
  "status" { Show-Status }
  "logs" {
    foreach ($f in "hub.log", "hub.err.log", "runner.log", "runner.err.log", "hub.prev.log", "hub.err.prev.log", "runner.prev.log", "runner.err.prev.log") {
      $path = Join-Path $Logs $f
      if (Test-Path $path) { "===== $f"; Get-Content $path -Tail 15 }
    }
  }
  "autostart" {
    $cmd = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$PSCommandPath"" start"
    "CreateObject(""WScript.Shell"").Run ""$($cmd.Replace('"', '""'))"", 0, False" | Set-Content -Encoding ascii $Startup
    "MyOfis will start hidden at login ($Startup)"
  }
  "no-autostart" { Remove-Item $Startup -ErrorAction SilentlyContinue; "autostart removed" }
  default { "unknown action: $Action (start | stop | restart | status | logs | autostart | no-autostart)" }
}
