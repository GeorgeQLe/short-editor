# Redistributable release sources

SiftCut's macOS FFmpeg binaries are GPL builds because they statically
link x264. Release archives must include the notices in `resources/licenses`.

Windows 11 releases use the immutable Gyan FFmpeg 8.1.2 essentials archive:
`https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip`,
SHA-256 `db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec`.
Gyan's x64 FFmpeg and ffprobe run natively in the x64 package and under Windows
11 x64 emulation in the ARM64 package. Their GPLv3 evidence, third-party
notices, SPDX SBOM, and pinned provenance are staged with each package; the
written corresponding-source offer is also emitted adjacent to each installer.

The Windows worker is built only on Windows x64 from
`resources/worker/requirements.windows-x64.lock`, using CPython 3.12.10,
PyInstaller 6.21.0, faster-whisper 1.2.1, and CTranslate2 4.8.1. It is a
one-directory frozen bundle so every non-system DLL remains inspectable beside
the executable. The x64 bundle is reused under Windows 11 emulation on ARM64.
Electron 43.2.0 and better-sqlite3 12.11.1 are exact application pins; Electron
Builder rebuilds and the release gate executes the matching SQLite binding for
each application architecture.

## Exact inputs

- FFmpeg 8.1.2: `https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz`,
  SHA-256 `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`.
- x264 r3222 commit `b35605ace3ddf7c1a5d67a2eb553f034aef41d55`:
  the official VideoLAN archive URL and SHA-256
  `cd71a7515b0e9a012e1ac9b1f8415bebcaf6fc97d4db32286642ac4c0fbe24f9`
  are pinned in `scripts/release/release-config.sh`.
- FreeType 2.14.1, used statically for caption rendering: official SourceForge
  archive SHA-256
  `32427e8c471ac095853212a37aef816c60b42052d4d9e48230bab3bdf2936ccc`.
- HarfBuzz 14.2.1, used statically for FFmpeg text shaping: official GitHub
  release SHA-256
  `a54a5d8e9380a41fbb762ce367bcbf7704792dfca0d93f1bbca86c5a57902e0e`.

Run `scripts/release/build-ffmpeg-macos-arm64.sh` on native Apple Silicon.
The script verifies downloads before extraction, records all configure flags in
source control, builds only static third-party libraries, and rejects Homebrew
or developer-workspace paths in the final Mach-O files.
Run `npm run release:package-source` after the build to create a deterministic
corresponding-source archive containing all four verified upstream archives,
the exact build recipe, notices, and a per-member SHA-256 manifest.

## Corresponding source

For every binary release, retain the four exact upstream archives above and
this repository revision for at least the GPL-required period. Offer them next
to the DMG as a `corresponding-source` release archive, or provide them on
request using the written offer shipped with the release. The source archive
must include this build recipe, patches (if any), notices, and the unmodified
upstream archives so recipients can rebuild the distributed FFmpeg binaries.

## Model

`Systran/faster-whisper-small.en` is pinned to revision
`e0e3c0a16c844a994ca4d6d1318ce35f68236052`. Every member hash and size is in
`resources/models/model-upstream.json`. The deterministic archive and versioned
manifest are produced by `scripts/release/fetch-and-package-model.sh`. The model
is MIT licensed and is downloaded only after the Setup Center disclosure is
explicitly accepted.
