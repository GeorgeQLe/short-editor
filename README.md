# Short Editor

A Windows-first, local desktop foundation for turning long-form episodes into
vertical YouTube Shorts.

The authoritative v1 engineering requirements and current implementation matrix
are in [`SPEC.md`](SPEC.md). If this README, source comments, tests, or current
code conflict with the specification, `SPEC.md` wins.

The current vertical slice includes:

- source-in-place media inventory with path/fingerprint deduplication;
- persistent, restart-safe jobs and an explicit local/cloud authorization boundary;
- deterministic transcript-window candidate generation and review;
- revision-safe Short projects and invalidation of stale renders/schedules;
- a versioned, supervised Python worker host with strict framing, capability
  reporting, bounded cancellation/restart, and typed provider-operation results;
- installed-model-only faster-whisper English transcription with normalized
  segment/word timing, explicit absent diarization, and local provenance;
- versioned starter composition templates;
- render preflight/output validation through `ffprobe`;
- a timezone-aware, rules-based launch scheduler;
- a versioned HTTP API, React dashboard, Electron shell, and typed MCP adapter.

Ollama/OpenAI analysis providers, production crop tracking, and the complete
FFmpeg filter graph are intentionally behind interfaces for later phases.

## Development

Requires Node 22+. Install dependencies, then:

```bash
npm install
npm test
npm run dev
```

The core listens on `127.0.0.1:43120` by default. Set `SHORT_EDITOR_DATA_DIR`,
`SHORT_EDITOR_FFMPEG`, or `SHORT_EDITOR_FFPROBE` to override local paths.

### Local transcription setup

Install the worker dependency independently from the Node dependencies:

```bash
python3 -m pip install -r resources/worker/requirements.txt
```

Short Editor deliberately does not download models while transcribing. Put a
faster-whisper/CTranslate2 model containing `model.bin` below a dedicated model
directory, then identify the selectable local models:

```bash
export SHORT_EDITOR_WHISPER_MODEL_DIR=/path/to/short-editor-models
hf download Systran/faster-whisper-small.en \
  --local-dir "$SHORT_EDITOR_WHISPER_MODEL_DIR/small.en"
export SHORT_EDITOR_WHISPER_MODEL_IDS=small.en
export SHORT_EDITOR_WHISPER_MODEL=small.en
```

`SHORT_EDITOR_WHISPER_MODEL_IDS` is a comma-separated inventory; missing entries
remain visible as not installed. The selected `SHORT_EDITOR_WHISPER_MODEL` must
be installed before a job starts. Optional
`SHORT_EDITOR_WHISPER_DEVICE`/`SHORT_EDITOR_WHISPER_COMPUTE_TYPE` values are
passed to faster-whisper for host-specific CPU/GPU configuration. The worker
resolves the selected ID to an existing local directory and uses
`local_files_only=True`; it never silently downloads, switches models, invokes
OpenAI, or falls back to another provider.

For packaged Windows builds, place licensed FFmpeg binaries under `resources/bin`
and run `npm run package:win`.

### macOS development

macOS is supported as a development host only. Windows 11 remains the sole
release-acceptance platform, so every release must still be validated on Windows.

During macOS development, Short Editor stores its database at
`~/Library/Application Support/ShortEditor/short-editor.db`. Set
`SHORT_EDITOR_DATA_DIR` to override the containing data directory,
`SHORT_EDITOR_FFMPEG` to override the FFmpeg executable, or
`SHORT_EDITOR_FFPROBE` to override the ffprobe executable.

On startup the core also creates `artifacts/` and `logs/` below that data
directory. Application-generated media is finalized through the artifact store;
source media remains in place. Development data found at the earlier
`~/AppData/Local/ShortEditor` default is verified and migrated to the native
location with a timestamped backup. If both locations contain data, startup
stops without opening or changing either database so the conflict can be
resolved explicitly.

Install Node dependencies independently on each operating system so native
packages such as `better-sqlite3` are built or downloaded for the current host;
do not copy `node_modules` between macOS and Windows. macOS development checks
do not replace the required Windows release build and validation.

## Safety and privacy

Sources are referenced in place and never modified. Local mode makes no cloud
requests. Cloud work requires a current persisted project or batch grant created
through the desktop disclosure UI; caller-supplied authorization flags are
ignored or rejected. Credential values are encrypted with Electron
`safeStorage` (DPAPI on Windows), while SQLite and public APIs retain only opaque
handles and non-secret grant metadata.
