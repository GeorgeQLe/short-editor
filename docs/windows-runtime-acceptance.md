# WIN-01 Windows runtime acceptance

WIN-01 remains a development milestone until both architecture jobs and both
clean-machine runs below attach passing evidence. CI artifacts alone do not
make Windows a supported beta platform.

## Automated architecture artifacts

The `Windows runtime installers` workflow must publish:

- `SiftCut-0.1.0-windows-x64.exe` from `windows-2025`;
- `SiftCut-0.1.0-windows-arm64.exe` from `windows-11-arm`;
- the matching schema-v3 runtime manifest, SPDX SBOM, build provenance,
  corresponding-source written offer, and SHA-256 evidence.

Each job must pass PE inspection, runtime hashes and licenses, the packaged
FFmpeg probe/captioned H.264/AAC render, frozen-worker protocol, verified real
`small.en` offline transcription, cancellation, process restart, offline retry,
the packaged native `better-sqlite3` transaction, and packaged loopback-core
startup. The ARM64 job must report x64 FFmpeg and worker resources as
`emulated`; Electron and `better-sqlite3` must be ARM64.

## Clean Windows 11 VM matrix

Run once on clean Windows 11 x64 and once on clean Windows 11 ARM64. The VM
must not have Node, Python, FFmpeg, Visual Studio, or developer tools installed.
Record Windows edition/build, CPU/VM architecture, installer hash, runtime
manifest hash, and whether networking is connected for each step.

1. Install the unsigned development artifact and launch SiftCut.
2. Capture Setup Center showing every version, actual resource architecture,
   and execution mode. Confirm the application says `Development platform`.
3. Start the disclosed model installation, interrupt it, restart SiftCut, and
   resume. Record partial and final archive hashes and Setup Center screenshots.
4. Keep RDP on a private management path and block internet egress at the
   VM/hypervisor boundary after the model verifies. Do not disable the adapter
   or firewall rule that carries the private RDP session.
5. Import a credential-free fixture, probe it, transcribe it, render captions
   to H.264/AAC, and validate the output streams.
6. Cancel one active operation, restart the app/core, and retry it offline.
7. Hash source media before and after the workflow and prove it is unchanged.
8. Capture application/core/worker logs, output hashes, screenshots, and any
   initial failure plus the passing rerun.

Store evidence outside the repository under an immutable run identifier, then
link its hashes in the release record. Do not attach private media, paths,
transcripts, credentials, or machine identifiers.

## Evidence collector

`scripts/release/collect-windows-evidence.ps1` uses only Windows PowerShell/.NET
and the packaged FFprobe. Create a new evidence directory outside the checkout
for each VM and never reuse it for another run.

Before installation, copy the installer and credential-free media fixture to
the VM and collect the clean baseline:

```powershell
.\scripts\release\collect-windows-evidence.ps1 `
  -Phase baseline `
  -EvidenceDirectory D:\SiftCutEvidence\win11-x64-20260801T120000Z `
  -InstallerPath D:\Inputs\SiftCut-0.1.0-windows-x64.exe `
  -FixturePath D:\Inputs\acceptance.mp4
```

After installation, point `RuntimeRoot` at the installed Electron `resources`
directory. This phase verifies every schema-v3 manifest member, size, checksum,
PE architecture, execution declaration, license, SBOM, and provenance:

```powershell
.\scripts\release\collect-windows-evidence.ps1 `
  -Phase post-install `
  -EvidenceDirectory D:\SiftCutEvidence\win11-x64-20260801T120000Z `
  -RuntimeRoot 'C:\Program Files\SiftCut\resources' `
  -RuntimeManifestPath 'C:\Program Files\SiftCut\resources\runtime-manifest.json'
```

After the interrupted/resumed model install and offline probe, transcription,
render, cancellation, restart, and retry flow, collect the final evidence.
Supply sanitized application logs, restart/retry logs, and screenshots; ARM64
screenshots must visibly identify the x64 FFmpeg and worker as `emulated`.

```powershell
.\scripts\release\collect-windows-evidence.ps1 `
  -Phase post-workflow `
  -EvidenceDirectory D:\SiftCutEvidence\win11-x64-20260801T120000Z `
  -FixturePath D:\Inputs\acceptance.mp4 `
  -ModelArchivePath D:\SiftCutData\models\small.en.tar.gz `
  -ModelDirectory D:\SiftCutData\models\small.en `
  -RenderedMediaPath D:\SiftCutData\artifacts\final.mp4 `
  -PackagedFfprobePath 'C:\Program Files\SiftCut\resources\bin\ffprobe.exe' `
  -ApplicationLogPaths D:\Sanitized\app.log,D:\Sanitized\core.log,D:\Sanitized\worker.log `
  -RestartRetryEvidencePaths D:\Sanitized\restart-retry.log `
  -ScreenshotPaths D:\Sanitized\setup-center.png,D:\Sanitized\offline-result.png
```

Review `baseline.json`, `post-install.json`, `post-workflow.json`, and
`SHA256SUMS.json`, then hash and archive the entire directory before copying it
off the VM. Repeat with a distinct immutable directory and ARM64 installer on
the clean Windows 11 ARM64 VM.

## Closure rule

WIN-01 closes only after both CI artifacts and both clean-VM evidence sets pass.
Signing, upgrade, repair, shortcuts, permissions, and uninstall lifecycle stay
open under WIN-02. Full Windows product gates stay open under WIN-03.
