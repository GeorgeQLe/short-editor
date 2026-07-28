# Session history

## 2026-07-27

- Completed TRC-01 with immutable accepted transcript snapshots, exact/current
  revision reads, full-snapshot optimistic edits, manual-edit provenance, and
  validation for nonempty text plus ordered/bounded segment and word timing.
- Added atomic transcript-dependent invalidation: accepted/proposed Episode
  analysis is superseded, Short approval is cleared with a revision increment,
  successful Renders become stale, and non-published schedule entries require
  rerendering while published entries and raw transcript artifacts are
  preserved.
- Added typed HTTP and MCP transcript read/update operations with structured
  conflict, validation, missing-source, and not-found errors that do not echo
  transcript text.
- Added repository, HTTP, and MCP fixtures covering manual corrections,
  nullable no-diarization data, 1,001 segments, stale clients, invalid timing,
  dependent invalidation, exact history, and privacy. Full `npm test` (25 files,
  160 tests), `npm run build`, credential-signature scan, and `git diff --check`
  pass.
- Completed PRO-05 with an Electron-owned OpenAI HTTP adapter and a typed
  child-process bridge; plaintext credentials remain confined to Electron and
  inherited OpenAI credential environment variables are stripped from the core.
- Added explicit `transcription` and `diarization` speech modes, 20-minute mono
  MP3 chunk preparation below the 25 MB upload limit, timeline offsets,
  chunk-scoped speaker identities, raw/accepted transcript artifacts, progress,
  cleanup, cancellation, and no model fallback.
- Added strict Responses API episode analysis with an explicit configured model,
  refusal/incomplete/schema/model validation, request provenance, independent
  `analysis` authorization, and proposed raw typed artifacts.
- Centralized canonical analysis cache identity for Ollama and OpenAI, added a
  migration-safe unique successful-cache constraint and transactional winner
  selection, required authorization before reuse, and rejected corrupt cache
  rows.
- Added non-secret provider capability/status HTTP operations and read-only MCP
  tools, bounded timeout/network/429/retryable-5xx retries with revocation
  checks, and deterministic OpenAI/security/cache fixtures. Full `npm test`
  (148 tests), `npm run build`, and `git diff --check` pass; native packaged
  Windows execution remains the WIN-03 gate.
- Hardened the typed Electron bridge after adversarial review by rejecting
  responses whose job ID does not match the pending request; the targeted
  OpenAI core suite (8 tests) and production build pass after the fix.
- Completed PRO-04 with an OS-protected desktop credential vault backed by
  Electron safeStorage (Windows DPAPI), opaque handles, atomic ciphertext-only
  persistence, create/edit/remove UI, and locked-vault failure behavior.
- Added a desktop-only authenticated core channel for credential-handle
  synchronization and scoped cloud grant/list/revoke operations; credential
  removal transactionally revokes every linked authorization.
- Removed caller-controlled cloud authorization booleans from HTTP and MCP.
  OpenAI queueing and claiming now verify a matching persisted project grant,
  named operation class, and currently available protected credential handle.
- Added explicit provider/data/network/cost disclosure controls and tests for
  protected persistence, locked storage, mismatched scopes, forged booleans,
  missing confirmation, revocation, and queued-job authorization races.
- Hardened the final security boundary after adversarial review by revoking
  grants before deleting protected credential bytes, clearing stale UI
  selections, and surfacing credential-removal and grant-revocation failures.
- Completed PRO-03 with configurable Ollama base URL/model selection,
  schema-constrained structured analysis, model capability discovery, typed
  provider provenance, and no silent provider fallback.
- Classified loopback, private-LAN, and public endpoints before execution;
  required disclosure for private-LAN use, persisted scoped authorization for
  public endpoints, and reclassified redirects before sending analysis data
  while preserving the stricter original/target policy.
- Added local FFmpeg frame sampling with bounded interval/count options and
  visual-activity scores; speaker framing, face detection, and screen-share
  detection are explicitly unsupported when the installed stack lacks them.
- Added prompt/schema/visual option versions and cache identity over source
  hash, accepted transcript revision, provider/model/endpoint class, normalized
  options, and sampling configuration.
- Added deterministic Ollama and visual fixtures for success, unavailable,
  timeout, malformed output, schema drift, endpoint policy/redirects, no-face,
  multi-face, screen-share, and option-driven cache misses.
- Completed PRO-02 with installed-model-only faster-whisper English
  transcription, normalized timed segments and optional words, explicit absent
  diarization, typed local provenance, progress, and bounded cancellation.
- Added local model inventory/status and an explicit external download handoff;
  the worker resolves an existing model directory and uses local-only loading
  without model switching, OpenAI fallback, or network clients.
- Installed local `analyze` job handling through the supervised worker and core
  transaction so successful results become accepted transcript revisions with
  provider/model/version provenance.
- Added deterministic provider and core fixtures for timing normalization,
  optional words, silence, unsupported audio, missing models, cancellation,
  local-only loading, inventory, and persistence.
- Preserved worker-provided retryability through the supervisor so missing
  installed models remain explicit, non-retryable setup failures.
- Completed PRO-01 with a strict versioned Python worker protocol covering
  transcription, diarization, visual sampling, and provider calls, plus typed
  capability, dependency, progress, result, cancellation, and status messages.
- Added a bounded stdio supervisor with NDJSON frame limits, heartbeat/job
  timeouts, cancellation grace, crash restart limits, credential-free launch
  arguments, fully redacted stderr, and typed error mapping before storage.
- Added a SQLite-free development worker host and compatibility/fault fixtures
  for malformed/partial/version-mismatched frames, missing runtime, oversized
  output, timeout, crash, restart, cancellation, and startup/shutdown.
- Completed the combined INV-02/INV-03 inventory milestone with persisted
  watched-folder configuration, debounced chokidar events, durable startup,
  manual, and five-minute scans, scan deduplication/progress/cancellation, and
  safe recovery of interrupted reconciliation jobs.
- Added canonical root validation, recursive/nonrecursive root-relative glob
  discovery, no directory-symlink traversal, contained file-link support, and
  identity-safe import/relink behavior for duplicate discoveries.
- Added migration 5 Episode restore state and expiring one-use relink comparison
  records; missing sources remain visible and restore to a safe lifecycle state.
- Added automatic SHA-256 move repair and explicit no-hash comparison/
  confirmation with candidate revalidation, transactional path/metadata/hash
  updates, and render/schedule invalidation while preserving accepted work.
- Added typed HTTP and MCP watched-folder/relink operations, lifecycle shutdown,
  versioned scan/reconciliation job messages, and reconciliation/relink fixtures.
- Completed INV-01 with FFprobe-gated, format-aware batch import that preserves
  independent imported, duplicate, and typed rejected results.
- Added content-sampled quick fingerprints, SHA-256 resolution for ambiguous
  identity, serialized concurrent finalization, persisted probe metadata, and
  safe handling for dependency failures and sources changed during inspection.
- Updated the Electron picker, UI copy, HTTP/MCP boundary, and shared contracts
  for readable video formats while retaining MP4 H.264/AAC as the guaranteed
  input.
- Completed FND-03 with contained application-owned paths, atomic validated
  finalization, hashes and byte counts, collision handling, and startup
  quarantine for temporary, corrupt, missing, and orphaned artifact state.
- Added deterministic native/legacy startup selection, verified staged database
  and artifact migration, timestamped legacy backup, failed-copy quarantine,
  and no-write recovery when both locations are populated.
- Added per-job restart policy: idempotent local work is requeued, recovered
  cancellation is terminally cancelled, and unsafe interrupted cloud-analysis
  or render work fails with an actionable recovery stage.
- Completed FND-02 with ordered transactional schema upgrades, legacy v1/v2
  compatibility, complete entity storage, artifact metadata, and scoped
  authorization records that contain no credential secrets.
- Added repository transactions and compare-and-swap guards for transcripts,
  Shorts, template clones, schedule rule sets, and schedule entries, including
  forbidden-state enforcement and render/schedule invalidation.
- Added fresh/every-version/interrupted migration, foreign-key, large-fixture,
  round-trip, rollback, UTC, revision-conflict, and forbidden-edge tests.
- Completed FND-01 shared domain contracts and split the public schema surface
  into validators, entities, error contracts, job messages, and Episode
  transitions.
- Added strict entity, lifecycle, range, timing, error-redaction, HTTP-envelope,
  and job-message contract tests.
- Added platform-aware application data paths and documented macOS development
  constraints while retaining Windows 11 as the release-acceptance platform.
- Reconciled SPEC implementation evidence and routed the next executable work to
  FND-02 transactional persistence and migrations.
