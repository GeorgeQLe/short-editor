# macOS public beta acceptance

This checklist is completed against the exact arm64 DMG proposed for release.
Automated development-host tests are supporting evidence, not substitutes.

## Artifact gates

- `npm run validate:runtime` passes with concrete versions, licenses, and
  SHA-256 values in `resources/runtime-manifest.json`.
- The application and DMG are Developer ID signed and Apple-notarized.
- `spctl`, `codesign`, and notarization validation pass after downloading the
  artifact through a browser.
- Installation and first launch pass on clean Apple Silicon accounts running
  macOS 14 and the newest supported macOS release, without development tools or
  PATH dependencies.

## Product journey

- Setup Center reports FFmpeg, ffprobe, worker runtime, worker, model, optional
  Ollama, and writable storage accurately.
- Model disclosure shows exact transfer size, source, network use, license, and
  local privacy behavior before an explicit install; cancellation/resume and a
  deliberately corrupt checksum are exercised.
- Import → local transcription → Candidate review → edit → preflight → render →
  schedule completes offline after model installation.
- Optional loopback Ollama and explicitly authorized OpenAI flows are exercised
  independently without fallback.
- Restart persistence, source relink, DST scheduling, cancellation, bounded
  retry, dependency loss, and forced Electron/core/worker/FFmpeg termination
  preserve accepted edits and prior successful renders.

## Safety and support

- Source hashes remain unchanged throughout installation, use, upgrade, and
  uninstall.
- Upgrade over the prior beta retains application data. Uninstall does not
  remove sources; application-data removal is a separate explicit choice.
- Diagnostic preview and exported ZIP contain no credentials, transcripts, or
  absolute paths by default. Path and transcript consents are tested separately.
- No telemetry or automatic upload occurs. About shows the exact version,
  platform, support baseline, and manual-update policy.
- Secret scanning and rendered-output validation pass against the release
  candidate.

## Accessibility

- Every primary journey completes with the keyboard alone with visible focus.
- Dialog initial focus, focus containment, Escape behavior, and restoration are
  verified with VoiceOver.
- Labels, live announcements, non-color indicators, WCAG AA contrast, reduced
  motion, and 200% text scaling pass.
- Numeric timeline and crop alternatives remain available.

Release requires an owner-approved specification, evidence index, known
limitations, runtime/release manifest, and completed acceptance record.
