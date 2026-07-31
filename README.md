# Short Editor

A macOS-first, local desktop application for turning long-form episodes into
vertical YouTube Shorts.

Short Editor is open source under the [MIT License](LICENSE). Release builds
also contain separately licensed third-party components; see
[Third-party notices](THIRD_PARTY_NOTICES.md).

The authoritative v1 engineering requirements and current implementation matrix
are in [`SPEC.md`](SPEC.md). If this README, source comments, tests, or current
code conflict with the specification, `SPEC.md` wins.

Release consumers can use the generated
[`docs/release-interfaces-v1.md`](docs/release-interfaces-v1.md) guide and its
linked machine-readable HTTP, MCP schema, and compatibility artifacts.

The current vertical slice includes:

- source-in-place media inventory with path/fingerprint deduplication;
- persistent, restart-safe jobs and an explicit local/cloud authorization boundary;
- deterministic transcript-window candidate generation and review;
- revision-safe Short projects and invalidation of stale renders/schedules;
- a versioned, supervised Python worker host with strict framing, capability
  reporting, bounded cancellation/restart, and typed provider-operation results;
- installed-model-only faster-whisper English transcription with normalized
  segment/word timing, explicit absent diarization, and local provenance;
- immutable accepted transcript revisions with safe text/timing/speaker edits,
  optimistic conflicts, exact history reads, and downstream invalidation;
- configurable Ollama analysis plus explicitly authorized OpenAI transcription,
  diarization, and strict structured analysis with no silent model fallback;
- versioned starter composition templates;
- immutable revision-bound render preflight with typed, actionable findings and
  no output creation, plus final-output validation through `ffprobe`;
- a timezone-aware, rules-based launch scheduler;
- a versioned HTTP API, React dashboard, Electron shell, and typed MCP adapter.

The v1 public beta targets Apple Silicon Macs running macOS 14 or newer. FFmpeg,
ffprobe, the worker runtime, native SQLite binding, and fonts are packaged
application resources; the English transcription model is an explicit optional
first-run installation. Ollama and OpenAI remain optional.

## Development

Requires Node 22+. Install dependencies, then:

```bash
npm install
npm test
npm run dev
```

The core listens on `127.0.0.1:43120` by default. Packaged builds use
application-managed paths and do not require PATH or environment setup.
Environment overrides remain available for development and automated tests.

### Development transcription setup

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

On Apple Silicon, `npm run release:prepare` downloads checksum-pinned sources,
builds the static GPL FFmpeg and frozen Python worker, creates deterministic
model and corresponding-source archives, writes the concrete runtime manifest,
and validates every staged resource. `npm run release:publish-model` publishes
both model assets only when the target GitHub repository is public and the
versioned tag does not already exist. Run `npm run package:mac` afterward;
without a Developer ID it emits unsigned test artifacts, while signing and
notarization credentials are supplied only by the release environment.

### macOS data

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
do not copy `node_modules` between operating systems. Release acceptance is run
against the exact signed and notarized Apple Silicon artifact on clean macOS
14 and newer accounts.

## Safety and privacy

Sources are referenced in place and never modified. Local mode makes no cloud
requests. Cloud work requires a current persisted project or batch grant created
through the desktop disclosure UI; caller-supplied authorization flags are
ignored or rejected. Credential values are encrypted with Electron
`safeStorage` (DPAPI on Windows), while SQLite and public APIs retain only opaque
handles and non-secret grant metadata.

## Community

See [Contributing](CONTRIBUTING.md), the
[Code of Conduct](CODE_OF_CONDUCT.md), [Support](SUPPORT.md), and the
[Security policy](SECURITY.md). Please report vulnerabilities privately through
GitHub Security Advisories rather than public issues.
