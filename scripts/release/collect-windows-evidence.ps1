param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("baseline", "post-install", "post-workflow")]
  [string]$Phase,

  [Parameter(Mandatory = $true)]
  [string]$EvidenceDirectory,

  [string]$InstallerPath,
  [string]$FixturePath,
  [string]$RuntimeRoot,
  [string]$RuntimeManifestPath,
  [string]$ModelArchivePath,
  [string]$ModelDirectory,
  [string]$RenderedMediaPath,
  [string]$PackagedFfprobePath,
  [string[]]$ApplicationLogPaths = @(),
  [string[]]$RestartRetryEvidencePaths = @(),
  [string[]]$ScreenshotPaths = @()
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Require-File([string]$Path, [string]$Label) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label is required and must be an existing file."
  }
  return (Resolve-Path -LiteralPath $Path).Path
}

function Require-Directory([string]$Path, [string]$Label) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "$Label is required and must be an existing directory."
  }
  return (Resolve-Path -LiteralPath $Path).Path
}

function File-Evidence([string]$Path) {
  $Resolved = Require-File $Path "Evidence input"
  $Item = Get-Item -LiteralPath $Resolved
  return [ordered]@{
    name = $Item.Name
    size = $Item.Length
    sha256 = (Get-FileHash -LiteralPath $Resolved -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

function Get-PeArchitecture([string]$Path) {
  $Bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($Bytes.Length -lt 64 -or [BitConverter]::ToUInt16($Bytes, 0) -ne 0x5a4d) {
    throw "$([IO.Path]::GetFileName($Path)) is not a PE executable."
  }
  $PeOffset = [BitConverter]::ToUInt32($Bytes, 0x3c)
  if ($PeOffset + 6 -gt $Bytes.Length -or
      [BitConverter]::ToUInt32($Bytes, $PeOffset) -ne 0x00004550) {
    throw "$([IO.Path]::GetFileName($Path)) has an invalid PE signature."
  }
  $Machine = [BitConverter]::ToUInt16($Bytes, $PeOffset + 4)
  if ($Machine -eq 0x8664) { return "x64" }
  if ($Machine -eq 0xaa64) { return "arm64" }
  throw ("Unsupported PE machine type 0x{0:x4}." -f $Machine)
}

function Assert-ContainedPath([string]$Root, [string]$RelativePath) {
  if ([IO.Path]::IsPathRooted($RelativePath) -or $RelativePath -match '(^|[\\/])\.\.([\\/]|$)') {
    throw "Unsafe runtime manifest path: $RelativePath"
  }
  $Full = [IO.Path]::GetFullPath((Join-Path $Root $RelativePath))
  $Prefix = [IO.Path]::GetFullPath($Root).TrimEnd("\", "/") + [IO.Path]::DirectorySeparatorChar
  if (-not $Full.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Runtime manifest member escapes the runtime root: $RelativePath"
  }
  return $Full
}

function Copy-SanitizedEvidence([string[]]$Paths, [string]$Category) {
  $Destination = Join-Path $EvidenceDirectory $Category
  New-Item -Path $Destination -ItemType Directory -Force | Out-Null
  $Records = @()
  foreach ($Path in $Paths) {
    $Source = Require-File $Path $Category
    $Name = [IO.Path]::GetFileName($Source)
    $Target = Join-Path $Destination $Name
    Copy-Item -LiteralPath $Source -Destination $Target -Force
    $Records += File-Evidence $Target
  }
  return $Records
}

function Write-Json([string]$Name, [object]$Value) {
  $Path = Join-Path $EvidenceDirectory $Name
  $Value | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding UTF8
}

New-Item -Path $EvidenceDirectory -ItemType Directory -Force | Out-Null
$EvidenceDirectory = (Resolve-Path -LiteralPath $EvidenceDirectory).Path
$RecordedAt = (Get-Date).ToUniversalTime().ToString("o")

if ($Phase -eq "baseline") {
  $Installer = Require-File $InstallerPath "InstallerPath"
  $Fixture = Require-File $FixturePath "FixturePath"
  $Build = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
  $ToolNames = @(
    "node", "python", "python3", "ffmpeg", "ffprobe", "git", "cl", "cl.exe",
    "cmake", "msbuild"
  )
  $Tools = [ordered]@{}
  foreach ($Name in $ToolNames) {
    $Tools[$Name] = $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
  }
  $Present = @($Tools.GetEnumerator() | Where-Object Value | ForEach-Object Key)
  if ($Present.Count -ne 0) {
    throw "Clean-VM baseline failed; developer tools were found: $($Present -join ', ')"
  }
  Write-Json "baseline.json" ([ordered]@{
    schemaVersion = 1
    phase = "baseline"
    recordedAt = $RecordedAt
    windows = [ordered]@{
      productName = $Build.ProductName
      displayVersion = $Build.DisplayVersion
      currentBuild = $Build.CurrentBuild
      updateBuildRevision = $Build.UBR
      processArchitecture = $env:PROCESSOR_ARCHITECTURE
    }
    installer = File-Evidence $Installer
    fixtureBefore = File-Evidence $Fixture
    toolsPresent = $Tools
  })
  Write-Output "Clean Windows baseline evidence recorded."
  exit 0
}

if ($Phase -eq "post-install") {
  $Root = Require-Directory $RuntimeRoot "RuntimeRoot"
  $ManifestFile = Require-File $RuntimeManifestPath "RuntimeManifestPath"
  $Manifest = Get-Content -LiteralPath $ManifestFile -Raw | ConvertFrom-Json
  if ($Manifest.schemaVersion -ne 3) { throw "The installed runtime manifest is not schema v3." }
  if ($Manifest.releasePlatform.os -ne "windows") { throw "The runtime manifest is not for Windows." }
  $TargetArchitecture = [string]$Manifest.releasePlatform.applicationArchitecture
  if ($TargetArchitecture -notin @("x64", "arm64")) {
    throw "The runtime manifest application architecture is invalid."
  }
  $Members = @()
  foreach ($Resource in $Manifest.resources) {
    $MemberPath = Assert-ContainedPath $Root ([string]$Resource.path)
    $Actual = File-Evidence $MemberPath
    if ($Actual.size -ne [long]$Resource.size -or $Actual.sha256 -ne [string]$Resource.sha256) {
      throw "$($Resource.id) does not match its manifest size/hash."
    }
    $LicensePath = Assert-ContainedPath $Root ([string]$Resource.licenseEvidence)
    $License = File-Evidence $LicensePath
    $PeArchitecture = $null
    if ($MemberPath -match '\.(exe|dll|pyd|node)$') {
      $PeArchitecture = Get-PeArchitecture $MemberPath
      if ($PeArchitecture -ne [string]$Resource.architecture) {
        throw "$($Resource.id) PE architecture is $PeArchitecture, expected $($Resource.architecture)."
      }
    }
    if ($Resource.executionMode -eq "native" -and
        $Resource.architecture -notin @("neutral", $TargetArchitecture)) {
      throw "$($Resource.id) has an invalid native execution declaration."
    }
    if ($Resource.executionMode -eq "emulated" -and
        -not ($TargetArchitecture -eq "arm64" -and $Resource.architecture -eq "x64")) {
      throw "$($Resource.id) has an invalid emulated execution declaration."
    }
    $Members += [ordered]@{
      id = $Resource.id
      path = $Resource.path
      size = $Actual.size
      sha256 = $Actual.sha256
      peArchitecture = $PeArchitecture
      executionMode = $Resource.executionMode
      licenseEvidence = $License
    }
  }
  $Sbom = File-Evidence (Join-Path $Root "release/SBOM.spdx.json")
  $Provenance = File-Evidence (Join-Path $Root "release/build-provenance.json")
  Write-Json "post-install.json" ([ordered]@{
    schemaVersion = 1
    phase = "post-install"
    recordedAt = $RecordedAt
    packagedResourceLocation = [IO.Path]::GetFileName($Root)
    targetArchitecture = $TargetArchitecture
    runtimeManifest = File-Evidence $ManifestFile
    resources = $Members
    sbom = $Sbom
    provenance = $Provenance
  })
  Write-Output "Installed runtime manifest, PE, license, SBOM, and provenance evidence passed."
  exit 0
}

$BaselinePath = Join-Path $EvidenceDirectory "baseline.json"
if (-not (Test-Path -LiteralPath $BaselinePath -PathType Leaf)) {
  throw "baseline.json must exist in the evidence directory before post-workflow collection."
}
$Baseline = Get-Content -LiteralPath $BaselinePath -Raw | ConvertFrom-Json
$Source = Require-File $FixturePath "FixturePath"
$SourceAfter = File-Evidence $Source
if ($SourceAfter.sha256 -ne $Baseline.fixtureBefore.sha256 -or
    $SourceAfter.size -ne $Baseline.fixtureBefore.size) {
  throw "The source fixture changed during the clean-VM workflow."
}
$Rendered = Require-File $RenderedMediaPath "RenderedMediaPath"
$Ffprobe = Require-File $PackagedFfprobePath "PackagedFfprobePath"
$ProbeJson = & $Ffprobe -v error -show_entries "stream=codec_type,codec_name,width,height" `
  -of json $Rendered
if ($LASTEXITCODE -ne 0) { throw "Packaged FFprobe could not inspect the rendered media." }
$Probe = $ProbeJson | ConvertFrom-Json
$Video = @($Probe.streams | Where-Object codec_type -eq "video")
$Audio = @($Probe.streams | Where-Object codec_type -eq "audio")
if ($Video.Count -eq 0 -or $Video[0].codec_name -ne "h264" -or
    $Audio.Count -eq 0 -or $Audio[0].codec_name -ne "aac") {
  throw "Rendered media does not contain the required H.264/AAC streams."
}
$ModelArchive = File-Evidence (Require-File $ModelArchivePath "ModelArchivePath")
$ModelRoot = Require-Directory $ModelDirectory "ModelDirectory"
$ModelFiles = @(
  Get-ChildItem -LiteralPath $ModelRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
    $Relative = $_.FullName.Substring($ModelRoot.Length).TrimStart("\", "/")
    $Evidence = File-Evidence $_.FullName
    [ordered]@{ path = $Relative; size = $Evidence.size; sha256 = $Evidence.sha256 }
  }
)
$Logs = Copy-SanitizedEvidence $ApplicationLogPaths "application-logs"
$RestartRetry = Copy-SanitizedEvidence $RestartRetryEvidencePaths "restart-retry"
$Screenshots = Copy-SanitizedEvidence $ScreenshotPaths "screenshots"
Write-Json "post-workflow.json" ([ordered]@{
  schemaVersion = 1
  phase = "post-workflow"
  recordedAt = $RecordedAt
  modelArchive = $ModelArchive
  modelFiles = $ModelFiles
  renderedMedia = File-Evidence $Rendered
  renderedStreams = $Probe.streams
  sourceBefore = $Baseline.fixtureBefore
  sourceAfter = $SourceAfter
  sourceUnchanged = $true
  applicationLogs = $Logs
  restartRetryEvidence = $RestartRetry
  screenshots = $Screenshots
})

$ChecksumPath = Join-Path $EvidenceDirectory "SHA256SUMS.json"
$Checksums = @(
  Get-ChildItem -LiteralPath $EvidenceDirectory -File -Recurse |
    Where-Object FullName -ne $ChecksumPath |
    Sort-Object FullName |
    ForEach-Object {
      [ordered]@{
        path = $_.FullName.Substring($EvidenceDirectory.Length).TrimStart("\", "/")
        size = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    }
)
Write-Json "SHA256SUMS.json" ([ordered]@{
  schemaVersion = 1
  generatedAt = $RecordedAt
  files = $Checksums
})
Write-Output "Offline workflow and checksummed evidence bundle passed."
