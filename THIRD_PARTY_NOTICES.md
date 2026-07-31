# Third-party notices

The MIT license in `LICENSE` applies to Short Editor's original source code.
Third-party components retain their own licenses:

- Release builds of FFmpeg 8.1.2 statically link x264 r3222 and are distributed
  under GPL-2.0-or-later. Exact sources, hashes, build flags, and corresponding
  source instructions are in `docs/release-sources.md`,
  `resources/licenses/FFmpeg-GPLv2.txt`, and
  `resources/licenses/x264-GPLv2.txt`.
- The frozen transcription worker includes Python, faster-whisper,
  CTranslate2, PyInstaller, and hash-pinned transitive dependencies under their
  respective upstream licenses. See `resources/licenses/worker-notices.txt`
  and `resources/worker/requirements.lock`.
- Inter font files are distributed under the SIL Open Font License 1.1 in
  `resources/fonts/OFL.txt`.
- The optional `Systran/faster-whisper-small.en` model is MIT licensed. It is
  not stored in Git and is downloaded only with explicit user consent. Its
  immutable revision, contents, and hashes are recorded in
  `resources/models/faster-whisper-small.en-e0e3c0a.manifest.json`.

Package-specific copyright and license information remains available from each
upstream project and package distribution.
