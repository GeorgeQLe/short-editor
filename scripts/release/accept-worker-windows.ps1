param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("x64", "arm64")]
  [string]$Architecture
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$Runtime = Join-Path $RepositoryRoot "build/runtime/windows-$Architecture"
$Worker = Join-Path $Runtime "worker/short-editor-worker.exe"
$Acceptance = Join-Path $RepositoryRoot "build/windows-worker-acceptance"
$Models = Join-Path $Acceptance "models"
$Archive = Join-Path $Acceptance "faster-whisper-small.en-e0e3c0a.tar.gz"
$Audio = Join-Path $Acceptance "release-smoke.wav"
$Expected = "65dcc9aabf93c44a2d23931df9aaabeb2a45278df7fded9a428501ec45fe3455"
$Url = "https://github.com/GeorgeQLe/short-editor/releases/download/model-small.en-e0e3c0a/faster-whisper-small.en-e0e3c0a.tar.gz"

New-Item $Acceptance -ItemType Directory -Force | Out-Null
if (-not (Test-Path $Archive) -or
    (Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
  Remove-Item $Archive -Force -ErrorAction SilentlyContinue
  curl.exe --fail --location --retry 3 --output $Archive $Url
}
if ((Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
  throw "The small.en acceptance archive checksum does not match its release manifest."
}
Remove-Item $Models -Recurse -Force -ErrorAction SilentlyContinue
New-Item $Models -ItemType Directory | Out-Null
tar.exe -xf $Archive -C $Models

$SpeechScript = @'
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.SetOutputToWaveFile($args[0])
$speaker.Speak("This release validates offline transcription and restart.")
$speaker.Dispose()
'@
powershell.exe -NoProfile -NonInteractive -Command $SpeechScript $Audio
if (-not (Test-Path $Audio)) {
  throw "Windows speech synthesis did not create the acceptance fixture."
}

$env:SHORT_EDITOR_WHISPER_MODEL_DIR = $Models
$env:SHORT_EDITOR_WHISPER_MODEL_IDS = "small.en"
$env:SHORT_EDITOR_WHISPER_MODEL = "small.en"
$env:HF_HUB_OFFLINE = "1"
$env:TRANSFORMERS_OFFLINE = "1"
$env:HF_HUB_DISABLE_TELEMETRY = "1"
$env:SHORT_EDITOR_FFMPEG_PATH = Join-Path $Runtime "bin/ffmpeg.exe"

node (Join-Path $PSScriptRoot "smoke-worker-cancellation.mjs") $Worker
node (Join-Path $PSScriptRoot "smoke-worker-transcription.mjs") $Worker $Audio
# A new frozen process and a second real job prove restart and offline retry.
node (Join-Path $PSScriptRoot "smoke-worker-transcription.mjs") $Worker $Audio
Write-Output "Frozen worker real-model acceptance passed on Windows $Architecture."
