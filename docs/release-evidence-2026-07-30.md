# macOS release-input evidence — 2026-07-30

This record covers the locally staged Apple Silicon release inputs and unsigned
test package. It is not final publication approval.

## Reproducible inputs

- FFmpeg 8.1.2 + x264 r3222:
  `847026157a13b451b83fb1d8838dc87cdb47800f71bd88516627d1bde2a0853a`
  (8,082,200 bytes). Two clean builds matched.
- ffprobe 8.1.2:
  `e1b7b664daa16d66c3bb4eea9bce964d635cc9f8646bd2e6cef0e49f8b542356`
  (7,922,520 bytes). Two clean builds matched.
- Frozen worker:
  `7722b60469a5f48087c6c9638848f9340b30c62a17c4ef0192a871117fb3a033`
  (61,054,592 bytes). Two clean builds matched.
- Model archive:
  `65dcc9aabf93c44a2d23931df9aaabeb2a45278df7fded9a428501ec45fe3455`
  (445,185,198 bytes). Two deterministic packages matched.
- Model manifest:
  `7b7c1d4b1bcef38f99a0920748914538d0e82791e60b3c65025547e75cfdd1db`.
- Corresponding-source archive:
  `24b308ee09cb736a1990a69af5a357c43e97e7ebfb707cc55850be24100ca74a`
  (34,991,993 bytes). Two deterministic packages matched.

The concrete versions, sizes, licenses, and resource hashes are also recorded
in `resources/runtime-manifest.json`. FFmpeg, ffprobe, the worker, and the
packaged `better-sqlite3` binding are arm64 Mach-O files with only approved
system dependencies. Byte scans found no repository, Homebrew, credential, or
developer-machine paths in the three executable runtime inputs.

## Automated gates

- `npm run typecheck`: passed.
- `npm test -- --maxWorkers=4`: 50 files and 363 tests passed.
- `npm run build`: passed.
- `npm run smoke:preload`: passed with all 11 preload functions.
- `npm run validate:runtime`: passed.
- FFmpeg probe, libx264, captions, audio mixing, and composition smoke: passed.
- Frozen-worker protocol startup with a system-only `PATH`: passed.
- Real offline transcription with the frozen worker and pinned complete model:
  passed without system Python or network access.
- Model transfer resume, cancellation, checksum failure, member corruption,
  traversal rejection, insufficient disk, restart recovery, and atomic previous
  model preservation: passed.

## Unsigned test package

- DMG: `dist/Short Editor-0.1.0-arm64.dmg`
- DMG SHA-256:
  `a12c3500dfeefe28df90697e996dc45b0b857bbf961eaf7d17e66cf4cbdef407`
  (322,638,699 bytes).
- Application tree hash:
  `64ba486091ec1e0cf14425bb3e013f3b65712c1f0edd3f1faaa2f99382df96ef`
  using `sorted-path-and-file-sha256-v1` (727,292,132 bytes).
- Machine-readable Apple validation results:
  `build/release-evidence/macos-artifacts.json`.

As expected for an unsigned build, Developer ID verification, Gatekeeper,
notarization, and staple validation are not passed.

## Remaining owner gates

1. The GitHub repository is currently private. Setup Center uses anonymous
   download URLs, so the repository must be public before the guarded
   `npm run release:publish-model` command can create the versioned release.
2. Enable GitHub release immutability before creating that release.
3. Supply a Developer ID Application identity and notarization authorization,
   rebuild, then require all Apple validation fields to pass.
4. Complete the clean-macOS checklist in `docs/macos-public-beta-acceptance.md`
   and give final owner approval.

The model manifest shipped in the application is covered by the eventual
Developer ID application signature. The public copy is paired with the
immutable release asset, while Setup Center trusts only the archive size and
SHA-256 embedded in the signed application.
