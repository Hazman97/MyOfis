# Agent Office runner installer (Windows PowerShell). Served by the hub with the URL and
# pairing code filled in. Re-running it updates the runner and keeps the existing pairing.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Hub = '__HUB__'
$Code = '__CODE__'
$Dir = if ($env:AGENT_OFFICE_DIR) { $env:AGENT_OFFICE_DIR } else { Join-Path $HOME ".agent-office-runner" }
$Name = if ($env:RUNNER_NAME) { $env:RUNNER_NAME } else { $env:COMPUTERNAME }
function Say($msg) { Write-Host "[agent-office] $msg" }

$Headers = @{}
if ($env:CF_ACCESS_CLIENT_ID) {
  $Headers["CF-Access-Client-Id"] = $env:CF_ACCESS_CLIENT_ID
  $Headers["CF-Access-Client-Secret"] = $env:CF_ACCESS_CLIENT_SECRET
}

# 1. Bun
$Bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $Bun) {
  $Bun = Join-Path $HOME ".bun\bin\bun.exe"
  if (-not (Test-Path $Bun)) {
    Say "installing Bun (https://bun.sh)..."
    Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression
  }
}

# 2. Stop a runner from an earlier install, then fetch the files
$AppJs = Join-Path $Dir "app\runner.js"
Get-CimInstance Win32_Process -Filter "Name = 'bun.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($AppJs) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Say "downloading the runner from $Hub"
foreach ($d in "app", "browser", "data", "workspaces") { New-Item -ItemType Directory -Force -Path (Join-Path $Dir $d) | Out-Null }
Invoke-WebRequest -UseBasicParsing -Headers $Headers -Uri "$Hub/install/runner.js?code=$Code" -OutFile $AppJs
Invoke-WebRequest -UseBasicParsing -Headers $Headers -Uri "$Hub/install/worker.mjs?code=$Code" -OutFile (Join-Path $Dir "browser\worker.mjs")

# 3. Settings (Bun loads .env from the working directory)
$lines = @("HUB_URL=$Hub", "RUNNER_NAME=$Name", "RUNNER_STATE_PATH=./data/runner-state.json", "WORKSPACES_DIR=./workspaces")
if ($env:CF_ACCESS_CLIENT_ID) { $lines += @("CF_ACCESS_CLIENT_ID=$($env:CF_ACCESS_CLIENT_ID)", "CF_ACCESS_CLIENT_SECRET=$($env:CF_ACCESS_CLIENT_SECRET)") }
Set-Content -Path (Join-Path $Dir ".env") -Value $lines -Encoding ascii

# 4. Pair (skipped when this PC is already paired with this hub)
Say "pairing as `"$Name`""
Push-Location $Dir
try {
  $env:PAIRING_CODE = $Code
  & $Bun $AppJs --pair-only
  if ($LASTEXITCODE -ne 0) { throw "pairing failed (see the message above)" }
} finally {
  Remove-Item Env:PAIRING_CODE -ErrorAction SilentlyContinue
  Pop-Location
}

# 5. Start now and at every login: a hidden launcher in the Startup folder (no admin needed)
if ($env:AGENT_OFFICE_NO_SERVICE) {
  Say "done. Start it with: cd `"$Dir`"; & `"$Bun`" `"$AppJs`""
  return
}
$Cmd = Join-Path $Dir "start-runner.cmd"
Set-Content -Path $Cmd -Encoding ascii -Value @(
  "@echo off",
  ('cd /d "{0}"' -f $Dir),
  ('"{0}" "{1}" >> data\runner.log 2>&1' -f $Bun, $AppJs)
)
$Vbs = Join-Path ([Environment]::GetFolderPath("Startup")) "agent-office-runner.vbs"
Set-Content -Path $Vbs -Encoding ascii -Value ('CreateObject("WScript.Shell").Run "cmd /c ""{0}""", 0, False' -f $Cmd)
Start-Process wscript.exe -ArgumentList ('"{0}"' -f $Vbs)
Say "done. The runner is running in the background and starts at every login."
Say "log: $Dir\data\runner.log  |  to remove: delete $Vbs and $Dir"
