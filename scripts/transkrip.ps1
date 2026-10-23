# Transkrip: audio/video -> <name>.txt + <name>.srt beside the file, with whisper.cpp on this PC (offline).
# Used by Explorer "Send to -> Transkrip". Settings proven on quiet meeting recordings (2026-10-23):
#   clean the sound (boost quiet voices, cut hum), VAD (only speech goes to whisper), no carried context (-mc 0)
#   so one mistake cannot loop, then drop leftover hallucinations ("Terima kasih kerana menonton") and repeats.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Files)

# Not "Stop": Windows PowerShell 5.1 turns a native program's stderr into errors. Exit codes are checked instead.
$ErrorActionPreference = "Continue"
$bin   = "C:\whisper\bin\Release\whisper-cli.exe"
$model = "C:\whisper\models\ggml-large-v3-turbo-q5_0.bin"
$vad   = "C:\whisper\models\ggml-silero-v5.1.2.bin"
$lang  = if ($env:TRANSKRIP_LANG) { $env:TRANSKRIP_LANG } else { "ms" }
$junk  = 'terima kasih kerana menonton|sila langgan|subscribe|like dan share|thanks for watching'
$utf8  = New-Object System.Text.UTF8Encoding($false)

foreach ($f in @($bin, $model, $vad)) { if (-not (Test-Path $f)) { Write-Host "Tidak jumpa: $f" -ForegroundColor Red; Read-Host "Tekan Enter"; exit 1 } }
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { Write-Host "ffmpeg tiada dalam PATH" -ForegroundColor Red; Read-Host "Tekan Enter"; exit 1 }
if (-not $Files) { Write-Host "Guna: klik kanan fail audio/video -> Send to -> Transkrip"; Read-Host "Tekan Enter"; exit 0 }

foreach ($file in $Files) {
  $item = Get-Item -LiteralPath $file -ErrorAction SilentlyContinue
  if (-not $item) { Write-Host "Tidak jumpa: $file" -ForegroundColor Red; continue }
  $base = Join-Path $item.DirectoryName $item.BaseName
  $wav  = Join-Path $env:TEMP ("transkrip-" + [guid]::NewGuid().ToString("N") + ".wav")
  Write-Host "`n== $($item.Name)" -ForegroundColor Cyan
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    Write-Host "1/3 Bersihkan bunyi..."
    & ffmpeg -y -loglevel error -i $item.FullName -vn -af "highpass=f=80,lowpass=f=7500,afftdn=nf=-25,dynaudnorm=f=250:g=15:p=0.9:m=20" -ar 16000 -ac 1 -c:a pcm_s16le $wav
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg gagal (fail ini ada bunyi?)" }

    Write-Host "2/3 Whisper (GPU)..."
    & $bin -m $model --vad -vm $vad -vt 0.4 -vsd 400 -vp 200 -l $lang -mc 0 -sns -et 2.2 -np -f $wav -otxt -osrt -of $base 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$base.txt")) { throw "whisper gagal (kod $LASTEXITCODE)" }

    Write-Host "3/3 Buang halusinasi..."
    $prev = ""; $kept = New-Object System.Collections.Generic.List[string]; $dropped = 0
    foreach ($line in [IO.File]::ReadAllLines("$base.txt", $utf8)) {
      $t = $line.Trim()
      if (-not $t) { continue }
      if ($t -match $junk -or $t -eq $prev) { $dropped++; continue }
      $kept.Add($t); $prev = $t
    }
    [IO.File]::WriteAllLines("$base.txt", $kept, $utf8)
    Write-Host ("Siap dalam {0:n0} s: {1} baris ({2} dibuang)" -f $sw.Elapsed.TotalSeconds, $kept.Count, $dropped) -ForegroundColor Green
    Write-Host "   $base.txt"
    Write-Host "   $base.srt  (dengan masa)"
  } catch {
    Write-Host "Gagal: $_" -ForegroundColor Red
  } finally {
    if (Test-Path $wav) { Remove-Item $wav -Force }
  }
}
Read-Host "`nTekan Enter untuk tutup"
