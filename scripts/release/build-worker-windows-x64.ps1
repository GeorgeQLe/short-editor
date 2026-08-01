$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$BuildRoot = Join-Path $RepositoryRoot "build/worker-windows-x64"
$VirtualEnvironment = Join-Path $BuildRoot "venv"
$Distribution = Join-Path $BuildRoot "dist"
$Output = Join-Path $RepositoryRoot "build/windows-compute-x64/worker"
$Lock = Join-Path $RepositoryRoot "resources/worker/requirements.windows-x64.lock"

if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
  throw "The frozen worker must be built on Windows x64."
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw "uv is required on the build runner."
}

Remove-Item $BuildRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $Output -Recurse -Force -ErrorAction SilentlyContinue
New-Item $BuildRoot -ItemType Directory | Out-Null
New-Item $Output -ItemType Directory | Out-Null

$env:UV_CACHE_DIR = Join-Path $RepositoryRoot "build/uv-cache-windows"
$SystemPython = Get-Command python -CommandType Application -ErrorAction Stop |
  Where-Object Source -NotMatch "\\WindowsApps\\" |
  Select-Object -First 1 -ExpandProperty Source
if (-not $SystemPython) {
  throw "The worker build could not locate the provisioned CPython interpreter."
}
$SystemPythonVersion = & $SystemPython -c "import platform; print(platform.python_version())"
if ($SystemPythonVersion.Trim() -ne "3.12.10") {
  throw "The worker build requires CPython 3.12.10, found $SystemPythonVersion."
}
uv venv --python $SystemPython --seed $VirtualEnvironment
$Python = Join-Path $VirtualEnvironment "Scripts/python.exe"
uv pip sync --python $Python $Lock

$env:SOURCE_DATE_EPOCH = "1781653653"
$env:PYTHONHASHSEED = "0"
& (Join-Path $VirtualEnvironment "Scripts/pyinstaller.exe") `
  --clean `
  --noconfirm `
  --onedir `
  --name short-editor-worker `
  --distpath $Distribution `
  --workpath (Join-Path $BuildRoot "work") `
  --specpath $BuildRoot `
  --collect-all faster_whisper `
  --collect-all ctranslate2 `
  (Join-Path $RepositoryRoot "resources/worker/worker.py")

Copy-Item (Join-Path $Distribution "short-editor-worker/*") $Output -Recurse -Force
$BasePrefix = & $Python -c "import sys; print(sys.base_prefix)"
foreach ($Runtime in @("vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll")) {
  $Candidate = Join-Path $BasePrefix $Runtime
  if (Test-Path $Candidate) {
    Copy-Item $Candidate (Join-Path $Output $Runtime) -Force
  }
}

$Worker = Join-Path $Output "short-editor-worker.exe"
node (Join-Path $PSScriptRoot "inspect-windows-dependencies.mjs") $Output
$env:SHORT_EDITOR_WHISPER_MODEL_DIR = Join-Path $BuildRoot "missing-models"
node (Join-Path $PSScriptRoot "smoke-worker.mjs") $Worker
node (Join-Path $PSScriptRoot "windows-compute-manifest.mjs") `
  (Join-Path $RepositoryRoot "build/windows-compute-x64") --write
Write-Output "Built frozen Python 3.12.10 x64 worker bundle at $Output"
