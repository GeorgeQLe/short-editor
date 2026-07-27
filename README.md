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
- versioned starter composition templates;
- render preflight/output validation through `ffprobe`;
- a timezone-aware, rules-based launch scheduler;
- a versioned HTTP API, React dashboard, Electron shell, and typed MCP adapter.

The Python analysis worker, production crop tracking, complete FFmpeg filter graph,
and provider-specific AI calls are intentionally behind interfaces for later phases.

## Development

Requires Node 22+. Install dependencies, then:

```bash
npm install
npm test
npm run dev
```

The core listens on `127.0.0.1:43120` by default. Set `SHORT_EDITOR_DATA_DIR`,
`SHORT_EDITOR_FFMPEG`, or `SHORT_EDITOR_FFPROBE` to override local paths.

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
requests. Cloud work requires an explicit authorization token on each job request;
credential storage is represented by an adapter boundary and is not emulated with
plaintext files.
