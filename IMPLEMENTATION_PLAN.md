# Short Editor v1 Implementation Plan

This is the issue-ready execution roadmap for the outstanding requirements in
[`SPEC.md`](SPEC.md). The specification remains authoritative. This plan does
not relax a requirement, declare a queued job complete, or turn development
evidence from macOS or Linux into release acceptance.

## Current state and completion definition

The repository has a useful TypeScript/Electron foundation: ordered SQLite
migrations, source-in-place MP4 inventory, probe/hash jobs, current-transcript
storage, heuristic Candidate generation, revisioned Short rows, starter
composition data, output probing, deterministic slot drafting, a loopback HTTP
service, an MCP adapter, and a library-focused React shell. The implementation
matrix in SPEC section 8 records the exact evidence and gaps.

Baseline on 2026-07-27 from a macOS development host after FND-01:

- `npm test`: passed, 9 files and 35 tests;
- `npm run typecheck`: passed;
- `npm run build`: passed; and
- Windows packaging and every Windows-only release scenario: not run.

FND-01 is complete in the development baseline. FND-02 is the next executable
task on the dependency spine.

The platform-aware application-data work already present in
[`src/core/bootstrap.ts`](src/core/bootstrap.ts),
[`tests/bootstrap.test.ts`](tests/bootstrap.test.ts), and
[`README.md`](README.md) is part of this baseline. It must remain intact and be
carried through packaged-process and Windows validation work.

v1 is complete only when all of the following are true:

1. every applicable `MUST`, `MUST NOT`, and `REQUIRED` in SPEC 1–7 is
   implemented and tested;
2. every G1–G10 gate passes on a clean, supported Windows 11 environment against
   the representative beta corpus;
3. all `SHOULD` items are implemented or have an owner-reviewed, documented
   disposition that does not weaken a `MUST`;
4. the HTTP and MCP contract inventories are complete and parity-tested;
5. local-mode network isolation, credential redaction, source immutability,
   artifact ownership, optimistic revisions, and crash recovery have negative
   tests; and
6. external provider and YouTube facts have been reverified for the release
   candidate.

## Dependency graph and dependency spine

```text
FND-01 ─> FND-02 ─> FND-03 ───────────────────────────────────────┐
  ├─> INV-01 ─> INV-02 ─> INV-03 ────────────────────────────────┤
  ├─> PRO-01 ─> PRO-02 ─> PRO-03 ────────────────────────────────┤
  │              PRO-04 ─> PRO-05 ───────────────────────────────┤
  ├─> TRC-01 ─> TRC-02 ─> TRC-03 ────────────────────────────────┤
  └─> EDT-01 ─┬─> EDT-02 ─> EDT-03 ──────────────────────────────┤
              ├─> EDT-04 ────────────────────────────────────────┤
              └─> EDT-05 ────────────────────────────────────────┤
                                                                 v
                         EDT-01–05 + FND-03 ────────> RND-01
                                                        │
                         RND-01 ─> RND-02 ─> RND-03 ─> RND-04
                                             │
                                   SCH-01 ─> SCH-02

all completed domain services ─────────────────────────> API-01
                                                          │
                                              API-01 ─> API-02 ─> API-03
                                                          │         │
API-01/API-02 ─> UI-01.3, UI-01.4                         │         │
API-03 + matching domain services ─> UI-01.1/.2/.5 <──────┘         │
all UI-01 subtasks ───────────────────────────────> UI-01 <──────────┘
                                                       │
                                              UI-02 + UI-03
                                                       │
WIN-01 ─> WIN-02 ──────────────────────────────────────┤
                                                       v
                                                    WIN-03 ─> REL-01
```

This is an acyclic dependency spine, not a claim about the mathematically
longest path in the fully expanded prerequisite graph. Parallel branches
converge explicitly at RND-01, API-01, UI-01, WIN-03, and REL-01. Every task is
independently mergeable after its declared prerequisites and MUST NOT silently
absorb a downstream task.

## Milestone 1 — Domain contracts and persistence foundations

### FND-01 — Complete domain schemas and the error registry

- **SPEC / gates:** 4.1, 5.1–5.4, 7.1; G8.
- **Prerequisites / unblocks:** none; unblocks every persistence, API, worker, and
  UI task.
- **Behavior:** Add concrete schemas for every required entity, lifecycle,
  revision, provider classification, artifact owner, validation result, and all
  15 error codes. FND-01 owns the explicit Episode transition matrix. Validate
  UUIDs, UTC instants, IANA zones, positive revisions, bounded normalized
  rectangles, ordered ranges, state enums, and every allowed or forbidden
  Episode transition without a separate centralized state-machine service.
- **Non-goals:** No database migration or workflow endpoint.
- **Changes:** Split shared contracts by domain if useful; add versioned job
  payload/result discriminated unions and the full structured error envelope
  including `retryable`.
- **Errors / privacy / compatibility:** Unknown exceptions map to redacted
  `INTERNAL_ERROR`; public schemas contain no credential fields. Preserve
  existing v1 field names or add explicit adapters.
- **Tests / fixtures / Windows:** Schema table tests for valid and invalid entity,
  lifecycle, range, revision, error, and redaction fixtures, including every
  forbidden Episode edge returning `INVALID_STATE`. No Windows-only behavior,
  but run tests on Windows in G8.
- **Milestone / exit criteria:** Complete schemas and the Episode transition
  matrix generate clean inventories; schema/error/forbidden-edge suites pass and
  enable FND-02 plus the G8 contract subset.
- **Computer Use validation:** Launch fresh, migrated, interrupted, and both-path
  fixtures and inspect normal startup or the actionable recovery screen,
  including one invalid-state message. Capture a macOS screenshot; this
  development checkpoint is deferred to UI-03 and release-blocking WIN-03.9.
- **Evidence / acceptance:** A generated inventory shows every SPEC 5.1 entity,
  5.2 state, and 5.4 code represented; no `z.record(...unknown())` is needed for
  a known domain payload.

### FND-02 — Add complete transactional persistence and migrations

- **SPEC / gates:** 4.1–4.2, 5.1–5.3; G2–G8.
- **Prerequisites / unblocks:** FND-01; unblocks FND-03, INV-02, PRO-04, TRC-01,
  EDT-02, SCH-01, and all complete interfaces.
- **Behavior:** Persist `WatchedFolder`, `TranscriptRevision`,
  `AnalysisArtifact`, artifact metadata, template clones, complete assets,
  render attempts, versioned schedule rules, cloud authorizations, and missing
  fields on existing entities. Enforce foreign keys and uniqueness without
  destructive cascade behavior exposed to users.
- **Non-goals:** No provider, render, calendar, or editor workflow.
- **Changes:** Add ordered idempotent migrations, row mappers, repository
  transactions, migration compatibility fixtures from the current schema, and
  repository-level revision compare-and-swap guards. INV/PRO and other domain
  services consume these guards; no centralized state-machine service is
  required.
- **Errors / privacy / compatibility:** Migration failure is atomic and
  actionable; credential secrets never enter SQLite. Existing IDs and accepted
  records survive upgrades.
- **Tests / fixtures / Windows:** Fresh database, every-version upgrade,
  interrupted migration rollback, foreign-key, revision-conflict, forbidden-edge
  `INVALID_STATE`, UTC timestamp, and >1,000-row fixtures. Re-run upgrade
  fixtures with packaged Windows native SQLite.
- **Milestone / exit criteria:** All required records persist transactionally,
  CAS guards reject stale and forbidden writes, migration/compatibility suites
  pass, and FND-03 plus persistence-dependent G2–G8 work are enabled.
- **Computer Use validation:** Launch fresh, migrated, interrupted, and both-path
  database fixtures; verify normal state or a recovery screen and capture a
  visible revision conflict on macOS. Deferred to UI-03 and WIN-03.9.
- **Evidence / acceptance:** Schema inspection accounts for every required field;
  migrations are ordered, recorded, transactional, and preserve current fixture
  data byte-for-byte at the semantic level.

### FND-03 — Enforce the artifact store and startup reconciliation

- **SPEC / gates:** 3.3, 4.1–4.3, 5.1, 6.9, 6.11; G2, G4, G6, G9, G10.
- **Prerequisites / unblocks:** FND-02; unblocks provider outputs, proxies,
  caption sidecars, render finalization, and recovery.
- **Behavior:** Create the required database/artifacts/logs layout at the
  platform-aware data directory; write application-owned artifacts to relative
  paths using temp-file, validate, fsync where appropriate, atomic-rename, and
  completed-state transitions. Reconcile temp files and interrupted jobs at
  startup, requeue only idempotent work, and terminally fail unsafe work.
  A path is populated only when it contains a database or application-owned
  artifacts; empty directories do not count. If neither legacy nor native path
  is populated, initialize the platform-native path; if only native is
  populated, open it normally. If only legacy is populated, checkpoint/read its
  database through SQLite APIs, copy it into staging, copy owned artifacts/logs
  by relative path, verify database integrity and artifact hashes, then
  atomically promote staging. Preserve legacy as a timestamped migration backup
  until owner-defined retention cleanup; v1 exposes no automatic deletion. If
  both paths are populated, write nothing, open neither database, and return an
  actionable recovery state—never merge or silently prefer one. Failed
  verification leaves legacy authoritative and moves incomplete staging to
  quarantine.
- **Non-goals:** No FFmpeg composition or provider logic.
- **Changes:** Add an artifact-store service owned by the core, typed ownership
  and producer metadata, content hashing and byte counts, cleanup quarantine,
  and recovery policies per job type.
- **Errors / privacy / compatibility:** Emit `ARTIFACT_CORRUPT`,
  `DEPENDENCY_UNAVAILABLE`, or redacted `INTERNAL_ERROR`; never place generated
  files beside sources or present partial files as complete.
- **Tests / fixtures / Windows:** Atomic-finalization, collision, corrupt hash,
  missing file, disk-full injection, crash-between-steps, and old-path migration
  tests. Upgrade/rollback covers SQLite WAL/SHM, interrupted copy/promotion,
  both-path conflict, stable IDs, artifact hashes, and an incompatible old binary
  attempting migrated data. Manually verify Windows Local AppData permissions,
  long paths, restart, and no source writes.
- **Milestone / exit criteria:** Artifact startup and all four data-path cases
  are deterministic; migration, interruption, rollback, hash/integrity, and
  old-binary suites pass and enable provider/render recovery and G2/G4/G6/G9/G10.
- **Computer Use validation:** Launch fresh, legacy-only migrated, interrupted,
  and both-populated fixtures; verify normal startup or actionable no-write
  recovery and capture the quarantine outcome on macOS. Deferred to UI-03 and
  release-blocking WIN-03.9.
- **Evidence / acceptance:** Every owned fixture has kind, owner, revision, path,
  hash, bytes, timestamp, producer, and lifecycle; restart produces safe retry or
  an actionable terminal error with no false success.

## Milestone 2 — Inventory hardening

### INV-01 — Make batch import identity-safe and format-aware

- **SPEC / gates:** 2.3, 3.2–3.3, 5.1, 6.1; G1.
- **Prerequisites / unblocks:** FND-01; unblocks INV-02 and INV-03.
- **Behavior:** Preserve per-input imported/duplicate/rejected results, canonical
  path dedupe, quick-fingerprint hints, and full SHA-256 resolution before
  merging ambiguous files. Accept guaranteed H.264/AAC MP4 and best-effort
  FFmpeg-readable media; fail malformed/unsupported entries independently.
- **Non-goals:** No watched-folder UI or relinking.
- **Changes:** Replace size+mtime conclusive dedupe with a quick fingerprint that
  samples content plus metadata; add batch identity resolution, probe validation,
  and file-level diagnostics.
- **Errors / privacy / compatibility:** Never modify or copy sources; use
  `VALIDATION_ERROR`, `DEPENDENCY_UNAVAILABLE`, and per-file reasons without
  leaking paths when diagnostic detail is off. Do not merge distinct files on
  metadata alone.
- **Tests / fixtures / Windows:** Mixed formats, same path, hard link/symlink,
  same metadata/different bytes, true content duplicate, malformed, zero-byte,
  no-audio, no-video, read-only, Unicode, and concurrent import. Manually cover
  long Windows paths.
- **Milestone / exit criteria:** Mixed batches produce durable per-file results
  with content-safe identity and unchanged source hashes; automated import suites
  pass and enable INV-02/03 plus G1.
- **Computer Use validation:** In UI-01.1 import the mixed batch, inspect
  imported/duplicate/rejected rows and durable Job progress, then retry a bad
  file and confirm no duplicate Episode or source change. Capture macOS evidence;
  closure is deferred to UI-01.1 and WIN-03.1.
- **Evidence / acceptance:** G1 identity and immutability fixtures pass; source
  stat/hash snapshots are unchanged and ambiguous identity always uses content
  verification.

### INV-02 — Persist and reconcile watched folders

- **Status:** Implemented 2026-07-27 together with INV-03. Filesystem events are
  debounced hints; durable startup, manual, and five-minute scans remain
  authoritative.
- **SPEC / gates:** 5.1, 6.1, 7.2; G1, G8.
- **Prerequisites / unblocks:** FND-02 and INV-01; unblocks UI-01 and API-02.
- **Behavior:** Configure multiple enabled/disabled watched folders, recursive
  choice, include patterns, manual rescan, startup scan, and periodic/event
  reconciliation that repairs missed events. The typed
  `library.configure_watched_folder` operation accepts a rescan action and
  immediately returns a durable scan Job.
- **Non-goals:** No automatic web discovery and no deletion when files disappear.
- **Changes:** Add repository/service/API operations, scan jobs with progress and
  last-scan state, filesystem-event adapter plus reconciliation, and typed MCP
  operations `library.list_watched_folders` and
  `library.configure_watched_folder`.
- **Errors / privacy / compatibility:** Inaccessible folders fail individually;
  scanning is local-only and does not traverse outside configured roots via
  links unless explicitly allowed and tested.
- **Tests / fixtures / Windows:** Enable/disable, recursive/nonrecursive,
  patterns, duplicate discovery, missed-event repair, permissions, rename, and
  concurrent scan fixtures. Verify Windows watcher behavior and network-drive
  failure recovery without making network drives a guaranteed input.
- **Milestone / exit criteria:** Configuration and typed manual rescan produce
  durable restart-safe Jobs without duplicate Episodes; scan/reconciliation
  suites pass and enable INV-03, UI-01.1, API-02, and G1/G8.
- **Computer Use validation:** In UI-01.1 configure and disable a watched folder,
  trigger manual rescan, simulate a missed event, and inspect durable Job
  progress; confirm dedupe and actionable permission recovery. Capture macOS
  evidence; deferred to UI-01.1 and WIN-03.1.
- **Evidence / acceptance:** Scan results are deterministic and durable; manual
  rescan repairs a missed event without duplicating Episodes.

### INV-03 — Reconcile missing sources and relink safely

- **Status:** Implemented 2026-07-27 as the combined INV-02 inventory milestone.
  Packaged Windows watcher/network-drive/long-path validation remains in the
  existing Windows release gate.
- **SPEC / gates:** 5.2–5.3, 6.1, 7.2; G1, G8, G9.
- **Prerequisites / unblocks:** INV-01 and INV-02; unblocks complete library UX.
- **Behavior:** Detect missing sources without removing Episodes, transition to
  `source_missing`, expose recovery, and relink atomically after full-hash
  identity checks. When no old full hash exists, require a desktop confirmation
  after quick fingerprint and probe comparison, then resume only valid work.
- **Non-goals:** No destructive cleanup or MCP bypass of user confirmation.
- **Changes:** Add reconciliation jobs, prior-safe-state persistence, relink
  comparison records, desktop security confirmation, HTTP operation, and typed
  `library.relink_source`.
- **Errors / privacy / compatibility:** Return `SOURCE_MISSING` or
  `SOURCE_IDENTITY_MISMATCH`; MCP may complete only non-confirmation relinks and
  cannot forge the UI confirmation. Never rewrite source bytes.
- **Tests / fixtures / Windows:** Move, offline drive, same bytes/new path,
  changed bytes, no-old-hash confirmation, stale derived inputs, and atomic
  rollback. Verify file picker and long/Unicode paths on Windows.
- **Milestone / exit criteria:** Missing-source detection and safe relinking
  preserve lifecycle and accepted work; identity/rollback suites pass and enable
  the complete library workflow and G1/G8/G9.
- **Computer Use validation:** In UI-01.1 remove a source, perform valid and
  invalid relinks, and verify recovery messaging, unchanged bytes, and no
  duplicate Episode. Capture macOS evidence; deferred to UI-01.1 and WIN-03.1.
- **Evidence / acceptance:** Valid relink restores the correct lifecycle and
  invalid relink leaves every stored path and accepted artifact unchanged.

## Milestone 3 — Providers, privacy, and the Python worker

### PRO-01 — Define and supervise the versioned Python worker protocol

- **Status:** Implemented 2026-07-27. The development host, strict NDJSON
  protocol, bounded supervisor, dependency/capability reporting, and automated
  compatibility/fault fixtures are complete. Frozen/embedded runtime assembly
  and clean Windows startup/shutdown evidence remain in WIN-02/WIN-03.
- **SPEC / gates:** 4.1, 4.3, 5.1–5.2, 6.2; G2, G9, G10.
- **Prerequisites / unblocks:** FND-01 and FND-03; unblocks PRO-02, PRO-03, and
  PRO-05.
- **Behavior:** Launch a packaged/development Python worker with versioned,
  discriminated job messages for transcription, diarization, visual sampling,
  and provider calls; validate typed results before core storage; report
  progress, cancellation, dependency state, and capabilities.
- **Non-goals:** No provider implementation in this task.
- **Changes:** Add protocol schemas, supervisor/heartbeat, stdio or loopback
  transport with framing limits, capability/status endpoints, and fixtures.
- **Errors / privacy / compatibility:** Map malformed/partial output to
  `PROVIDER_OUTPUT_INVALID`, missing runtime/model to
  `DEPENDENCY_UNAVAILABLE`; redact stderr and never pass credentials in command
  arguments.
- **Tests / fixtures / Windows:** Version mismatch, malformed frame, timeout,
  crash, cancellation, oversized result, restart, and no-direct-SQLite tests.
  Verify worker startup/shutdown in packaged Windows.
- **Milestone / exit criteria:** The supervised protocol validates all messages,
  bounds cancellation/restart, and passes compatibility/fault suites, enabling
  PRO-02/03/05 and G2/G9/G10.
- **Computer Use validation:** Through UI-01.1/UI-03 select provider capability
  status, start work, kill the worker, and verify visible bounded recovery with
  no silent fallback. Record macOS evidence; deferred to UI-03 and WIN-03.2/.9.
- **Evidence / acceptance:** The worker cannot write SQLite, every message
  validates, and a killed worker yields a recoverable or actionable job state.

### PRO-02 — Implement local faster-whisper transcription

- **Status:** Implemented 2026-07-27. The local-only faster-whisper adapter,
  normalized segment/word timing, explicit no-diarization result, installed
  model status, durable job progress/cancellation, accepted transcript
  persistence, and deterministic provider fixtures are complete. Frozen worker
  assembly and representative Windows CPU/GPU validation remain WIN-02/WIN-03.
- **SPEC / gates:** 3.2–3.3, 6.2; G2, G3, G9, G10.
- **Prerequisites / unblocks:** PRO-01 and FND-03; unblocks TRC-01 and local
  end-to-end release flow.
- **Behavior:** Transcribe English locally with configurable faster-whisper model,
  timed segments, word timing when supported, and explicit absence of
  diarization. Read sources in place and store typed results through the core.
- **Non-goals:** No OpenAI fallback, model auto-switch, or generated voice.
- **Changes:** Add local provider adapter, model inventory/download handoff,
  normalized transcript result, provenance, progress stages, and deterministic
  test-mode fixture.
- **Errors / privacy / compatibility:** No network after an installed model is
  selected; missing model is actionable, not infinitely queued. Never include
  transcript text or absolute paths in default logs.
- **Tests / fixtures / Windows:** Deterministic audio fixtures, segment/word
  bounds, silence, unsupported audio, cancellation, missing model, and network
  deny tests. Run representative CPU/GPU-compatible local flow on Windows.
- **Milestone / exit criteria:** Installed-model faster-whisper produces typed
  local transcripts with clean network capture; provider/cancellation/missing-
  model suites pass and enable TRC-01 and the local G2/G3 path.
- **Computer Use validation:** In UI-01.1 select local faster-whisper, inspect
  local label/capabilities, cancel once, then remove the model and verify
  actionable recovery without fallback. Capture macOS evidence; deferred to
  UI-01.1/UI-03 and WIN-03.2.
- **Evidence / acceptance:** G2 local-network capture is clean and accepted
  transcript artifacts carry provider/model/version/local provenance.

### PRO-03 — Implement Ollama analysis and local visual sampling

- **Status:** Implemented 2026-07-27. Configurable schema-constrained Ollama
  analysis, endpoint/redirect classification, persisted public-endpoint
  authorization enforcement, FFmpeg visual-activity sampling, explicit
  unsupported detections, typed provenance, normalized cache identity, and
  deterministic provider/visual fixtures are complete. Configured Windows
  validation remains in WIN-03.
- **SPEC / gates:** 3.3, 6.2–6.3, 6.6; G2–G4.
- **Prerequisites / unblocks:** PRO-01 and PRO-02; unblocks quality Candidate and
  crop automation work.
- **Behavior:** Support configurable Ollama base URL/model ID and schema-validated
  local analysis; sample visual activity and speaker/screen framing where
  available; represent unsupported detections explicitly.
- **Non-goals:** No cloud fallback and no promise of diarization/detection when a
  selected local stack lacks it.
- **Changes:** Add capability discovery, prompt/schema versions, visual sampling
  artifacts, normalized provider options, and deterministic fixture adapters.
- **Errors / privacy / compatibility:** Localhost Ollama is classified local;
  private-LAN endpoints are disclosed network operations without cloud
  authorization; public/non-private endpoints require persisted cloud
  authorization. Redirect targets are reclassified before transmission and
  cannot weaken the original requirement. Use `PROVIDER_UNAVAILABLE` and
  `PROVIDER_OUTPUT_INVALID`.
- **Tests / fixtures / Windows:** Success, unavailable, timeout, malformed JSON,
  schema drift, loopback/private/public endpoints, local-to-public and
  public-to-local redirects, disclosure/authorization enforcement, no-face,
  multi-face, screen-share, and changed-option cache-miss fixtures. Validate
  configured Ollama on Windows without claiming it bundled.
- **Milestone / exit criteria:** Ollama and visual analysis retain typed
  provenance, enforce endpoint/redirect policy, and pass capability/cache/
  network suites, enabling Candidate and crop work plus G2–G4.
- **Computer Use validation:** In UI-01.1/UI-03 select loopback, private-LAN,
  public Ollama, and redirect fixtures; verify local/network/cloud labels before
  execution, authorization, cancellation, and no fallback. Capture macOS plus
  authorized-cloud evidence; defer closure to WIN-03.2.
- **Evidence / acceptance:** No silent fallback occurs; scores/detections retain
  provider/model/schema/input provenance and capability absence is explicit.

### PRO-04 — Add Windows-protected credentials and persisted cloud authorization

- **SPEC / gates:** 2.2–2.3, 3.3, 5.4, 7.3; G2, G8, G10.
- **Prerequisites / unblocks:** FND-02 and FND-01; unblocks PRO-05 and cloud MCP.
- **Behavior:** Create/edit/select credentials only in desktop UI through a
  reviewed Windows-protected adapter. Grant revocable authorization scoped to a
  project or explicit batch and named operation classes after showing provider,
  data, network, and cost implications.
- **Non-goals:** MCP cannot create credentials, grant/expand authorization, or
  treat a boolean as authorization.
- **Changes:** Add credential-handle adapter, authorization records without
  secrets, desktop IPC/UI gates, revocation, and core-side authorization checks.
- **Errors / privacy / compatibility:** Fail before network use with
  `CLOUD_NOT_AUTHORIZED` or `CLOUD_CONFIRMATION_REQUIRED`; secrets never enter
  logs, SQLite, exports, MCP, errors, or process arguments.
- **Tests / fixtures / Windows:** Mock vault, locked vault, revoked/mismatched
  scope, forged MCP boolean, redaction scans, and authorization race tests.
  Manually validate Windows Credential Manager/DPAPI behavior.
- **Milestone / exit criteria:** Protected credential handles and persisted,
  revocable grants gate every cloud request; authorization/redaction/race suites
  pass and enable PRO-05, cloud MCP, and G2/G8/G10.
- **Computer Use validation:** In UI-01.1 create/revoke a fixture authorization,
  attempt public provider work before and after the grant, and verify disclosure
  and typed denial with no secret visible. macOS is development evidence; repeat
  with Windows protection in WIN-03.2.
- **Evidence / acceptance:** A security test proves every cloud adapter receives
  a core-verified credential handle and matching persisted grant, never caller
  assertion or plaintext.
- **Implementation evidence (2026-07-27):** Electron `safeStorage` protects
  credential ciphertext (DPAPI on Windows); the desktop-main process exposes
  only opaque metadata and authenticates its private core channel with a
  per-launch secret. Public HTTP/MCP schemas reject authorization booleans.
  Queue and claim-time checks require a matching live grant and synchronized
  protected handle. Vault, disclosure, scope, revocation, forgery, and race
  tests pass; native packaged Windows validation remains assigned to WIN-03.

### PRO-05 — Implement OpenAI adapters, provenance, and cache identity

- **Status:** Implemented 2026-07-27. Deterministic provider, authorization,
  artifact, retry, cancellation, provenance, capability/status, and exact-cache
  suites pass. Native packaged Windows authorized-cloud execution and UI
  evidence remain assigned to WIN-03.2/UI-01.1.
- **SPEC / gates:** 1, 3.3, 5.3–5.4, 6.2, 7.3; G2, G3, G8.
- **Prerequisites / unblocks:** PRO-01 and PRO-04; unblocks authorized cloud
  workflow and TRC-03.
- **Behavior:** Add configurable-model transcription/diarization and structured
  analysis adapters, strict output validation, no silent model fallback,
  provider/raw-versus-accepted provenance, and cache identity over source hash,
  transcript revision, provider, model, prompt/schema version, and normalized
  options.
- **Non-goals:** No pinned “latest” marketing alias and no cloud request merely
  from opening/importing/editing/rendering/scheduling/launching.
- **Changes:** Add provider adapters, cache lookup/write service, request
  metadata, rate-limit/timeout policy, authorization enforcement, and provider
  capability/status operations.
- **Errors / privacy / compatibility:** Typed unavailable, invalid-output,
  confirmation, and authorization failures; redact request content by default.
  Cache hits require exact identity; changed inputs miss.
- **Tests / fixtures / Windows:** Mock success, timeout, rate limit, malformed,
  partial output, model mismatch, cache hit/miss, revoked grant, and log/SQLite/
  MCP/process-argument secret scans. Run only an explicitly authorized Windows
  cloud fixture.
- **Milestone / exit criteria:** Authorized OpenAI fixtures validate typed
  outputs/provenance/cache identity with zero secret leakage or silent fallback;
  provider suites pass and enable TRC-03 plus G2/G3/G8.
- **Computer Use validation:** In UI-01.1 select public OpenAI fixtures, inspect
  cloud disclosure, deny once, authorize explicitly, cancel/retry, and verify
  malformed/missing-model recovery without fallback. Capture authorized macOS
  evidence; final closure is WIN-03.2.
- **Evidence / acceptance:** G2 passes; raw results remain distinguishable from
  accepted projections and every artifact exposes local/cloud creation
  provenance without credentials.
- **Implementation evidence (2026-07-27):** [`src/electron/openai-adapter.ts`](src/electron/openai-adapter.ts),
  [`src/core/openai-provider.ts`](src/core/openai-provider.ts),
  [`src/shared/openai-contracts.ts`](src/shared/openai-contracts.ts), and
  [`src/core/analysis-cache.ts`](src/core/analysis-cache.ts) implement the
  Electron-only credential boundary, chunked speech modes, strict Responses
  analysis, typed IPC, request metadata, and canonical cache identity.
  [`tests/openai-adapter.test.ts`](tests/openai-adapter.test.ts) and
  [`tests/openai-core.test.ts`](tests/openai-core.test.ts) cover multi-chunk
  offsets/speakers, raw/accepted separation, refusal/partial/malformed/model
  failures, bounded retries, revocation, cancellation, status redaction, cache
  misses, and concurrent winner selection. Migration 6 prevents duplicate
  successful cache rows. Full tests/build/diff checks pass; WIN-03 remains open.

## Milestone 4 — Transcript revisions and Candidate quality

### TRC-01 — Add accepted transcript revisions and safe editing

- **SPEC / gates:** 5.1–5.3, 6.2, 6.7, 7.2; G3, G5, G8.
- **Prerequisites / unblocks:** FND-02 and PRO-02; unblocks TRC-02, EDT-01,
  EDT-04, and API-02.
- **Behavior:** Persist immutable transcript revisions with language, segments,
  optional words/speakers, provider provenance, accepted state, and positive
  revision. Edit text, word timing, speaker labels, and accepted caption timing
  with `expectedRevision`.
- **Non-goals:** Provider raw results are never overwritten; editing does not
  mutate source audio.
- **Changes:** Add repository/service/API operations, acceptance projection,
  validation of timing/order, invalidation of dependent analysis/renders, and
  typed MCP `analysis.get_transcript` / `analysis.update_transcript`.
- **Errors / privacy / compatibility:** `REVISION_CONFLICT`,
  `VALIDATION_ERROR`, `SOURCE_MISSING`; default errors/logs omit transcript text.
  Migrate the current transcript rows as revision 1 without data loss.
- **Tests / fixtures / Windows:** Segment/word bounds, no diarization, manual
  corrections, stale edit, accepted switch, analysis cache invalidation, render
  staleness, and concurrent clients.
- **Milestone / exit criteria:** Immutable accepted transcript revisions support
  safe text/timing/speaker edits and downstream invalidation; revision/migration
  suites pass and enable TRC-02, EDT-01/04, API-02, and G3/G5/G8.
- **Computer Use validation:** In UI-01.2 edit text, timing, and speaker data,
  provoke a stale revision, and verify exact conflict plus approval/render/
  schedule effects. Capture macOS evidence; deferred to UI-01.2 and WIN-03.3.
- **Evidence / acceptance:** History remains queryable, one accepted projection
  is unambiguous, and downstream work binds to an explicit transcript revision.
- **Implementation evidence (2026-07-27):** [`src/core/repository.ts`](src/core/repository.ts),
  [`src/core/service.ts`](src/core/service.ts), [`src/core/api.ts`](src/core/api.ts),
  [`src/mcp/server.ts`](src/mcp/server.ts), and
  [`src/shared/contracts.ts`](src/shared/contracts.ts) implement immutable
  accepted snapshots, exact/current reads, full-snapshot optimistic edits,
  timing/order validation, manual provenance, privacy-safe errors, and atomic
  analysis/Short/Render/schedule invalidation. [`tests/transcript-editing.test.ts`](tests/transcript-editing.test.ts)
  covers repository, HTTP, and MCP behavior including nullable no-diarization
  data, 1,001 segments, stale clients, history, and published-entry/raw-artifact
  preservation. Full tests/build/diff checks pass; interactive macOS and native
  Windows proof remains assigned to UI-01.2/WIN-03.3.

### TRC-02 — Make Candidate generation deterministic, diagnostic, and corpus-tested

- **SPEC / gates:** 3.2, 5.1, 6.3; G3.
- **Prerequisites / unblocks:** TRC-01 and PRO-03; unblocks TRC-03 and complete
  Candidate UI.
- **Behavior:** Generate 5–10 distinct, independently understandable,
  sentence/segment-aligned 20–90 second Candidates when sufficient material
  exists; otherwise return all valid choices plus an explicit diagnostic.
  Retain explainable hook/coherence/payoff/independence/delivery/visual scores
  and deterministic ordering for identical accepted inputs/version.
- **Non-goals:** Never pad with low-quality duplicates and never claim an
  owner-approved quality threshold without corpus evidence.
- **Changes:** Add generation version/provenance, stable tie rules,
  overlap/semantic grouping across retained decisions, diagnostics, and
  text+visual scoring integration.
- **Errors / privacy / compatibility:** Invalid provider output is rejected;
  local heuristic fallback, if retained, must be explicit and never a silent
  cloud/local model switch.
- **Tests / fixtures / Windows:** Exact-repeat ordering, ties, 20/90 boundaries,
  insufficient material, overlap, semantic duplicate, sentence alignment, and
  representative labeled corpus metrics.
- **Milestone / exit criteria:** Deterministic generation yields 5–10 valid
  Candidates or an explicit insufficiency diagnostic; corpus/determinism suites
  pass and enable TRC-03, Candidate UI, and G3.
- **Computer Use validation:** In UI-01.2 regenerate Candidates from a fixed
  transcript, inspect scores/order and the insufficient-material recovery case,
  and capture macOS evidence. Deferred to UI-01.2 and WIN-03.3.
- **Evidence / acceptance:** G3 automated assertions pass and owners record the
  beta corpus quality threshold and result before release.

### TRC-03 — Preserve decisions and accepted copy across regeneration

- **SPEC / gates:** 2.2, 5.3, 6.3–6.4; G3, G5.
- **Prerequisites / unblocks:** TRC-02 and PRO-05 for cloud paths; unblocks robust
  content-package workflows.
- **Behavior:** Regeneration uses an explicit replace-pending or append-pending
  strategy, preserves approved/rejected Candidates, suppresses conflicts with
  retained decisions, and keeps provider proposals separate from user-accepted
  copy. User edits survive regeneration.
- **Non-goals:** Rewrites are planning/copy aids only and never become voiceover.
- **Changes:** Add Candidate generation runs, decision lineage, proposed and
  accepted content-package projections, acceptance/edit operations, and
  provenance/cache binding.
- **Errors / privacy / compatibility:** Stale generation/acceptance uses
  `REVISION_CONFLICT`; no accepted data is overwritten by a new provider result.
- **Tests / fixtures / Windows:** Approved/rejected preservation, both strategies,
  duplicate retained decision, edited-copy survival, concurrent regenerate/edit,
  and provider switch.
- **Milestone / exit criteria:** Regeneration preserves every reviewed decision
  and accepted edit while keeping new provider output pending; preservation/
  concurrency suites pass and enable content-package workflows and G3/G5.
- **Computer Use validation:** In UI-01.2 approve/reject Candidates, accept/edit
  copy, regenerate, and verify all decisions and accepted copy survive; provoke
  a stale edit and inspect recovery. Capture macOS evidence; defer to WIN-03.3.
- **Evidence / acceptance:** Before/after fixture proves all reviewed decisions
  and user edits persist while new proposals remain visibly pending.

## Milestone 5 — Editing, templates, assets, crops, captions, and audio

### EDT-01 — Complete the Short timeline and approval lifecycle

- **SPEC / gates:** 5.1–5.3, 6.4, 6.6, 7.2; G5, G8.
- **Prerequisites / unblocks:** TRC-01 and FND-02; unblocks all remaining editor
  and render tasks.
- **Behavior:** Create revision-1 Shorts only from approved Candidates; copy the
  selected range and accepted transcript; validate ordered, positive,
  non-overlapping same-Episode ranges within duration; edit boundaries/gaps at
  millisecond or frame precision; approve explicitly and require reapproval
  after every render-affecting edit.
- **Non-goals:** No cross-Episode or general multitrack editing.
- **Changes:** Add timeline/audio/caption state to Short snapshots, compare-and-
  swap update and approve services, invalidation field classification, and typed
  `shorts.update_timeline` / `shorts.approve`.
- **Errors / privacy / compatibility:** `INVALID_STATE`, `VALIDATION_ERROR`,
  `REVISION_CONFLICT`, `SOURCE_MISSING`; published schedule records remain locked
  and are not mutated by Short invalidation.
- **Tests / fixtures / Windows:** Range order/overlap/bounds, gap tightening,
  stale writes, exact revision increment, render staleness, schedule
  `needsRerender`, copy-only exception, and reapproval.
- **Milestone / exit criteria:** Revisioned timeline edits and approval lifecycle
  enforce bounds, CAS, invalidation, and published locks; editor suites pass and
  enable EDT-02–05, RND-01, and G5/G8.
- **Computer Use validation:** In UI-01.3 edit ranges, undo/redo, save stale and
  current revisions, and verify exact feedback, approval clearing, stale renders,
  non-published rerender flags, and published immutability. Capture macOS
  evidence; defer release closure to WIN-03.4.
- **Evidence / acceptance:** Every render-affecting mutation clears approval or
  makes render impossible until a new explicit approval at the current revision.

### EDT-02 — Persist template clones, materialized lineage, and complete assets

- **SPEC / gates:** 5.1–5.3, 6.5; G4, G8.
- **Prerequisites / unblocks:** FND-02 and EDT-01; unblocks EDT-03 and RND-01.
- **Behavior:** Keep three built-ins immutable; clone and revision user templates
  with parent/version lineage; materialize composition into Shorts so later
  template edits do not change them. Import image/video/audio assets only with a
  rights/provenance note and reusable choice; retain metadata and ownership.
- **Non-goals:** No web discovery/download and no licensing inference.
- **Changes:** Add template/asset repositories and services, metadata probing,
  owned-versus-source asset paths, composition source references, and typed
  `templates.clone`, `templates.update`, and existing asset operations.
- **Errors / privacy / compatibility:** Reject built-in mutation, missing/
  unsupported assets, stale clone revision, and invalid provenance with typed
  errors. Sources remain in place.
- **Tests / fixtures / Windows:** Built-in immutability, clone lineage, old Short
  stability, image/video/audio metadata, missing asset, unsupported codec,
  reusable false, and rights-note validation.
- **Milestone / exit criteria:** Template clones and complete assets persist with
  immutable lineage and unchanged prior Shorts; compatibility/asset suites pass
  and enable EDT-03, RND-01, and G4/G8.
- **Computer Use validation:** In UI-01.3 clone/edit a template, compose with
  image/video/audio assets, provoke missing/unsupported asset recovery, and
  verify the old Short is unchanged. Capture macOS evidence; defer to WIN-03.4.
- **Evidence / acceptance:** G4 lineage fixtures show a template update changes
  only the clone and future explicit uses, never an existing Short snapshot.

### EDT-03 — Add independent automatic and manual crop tracks

- **SPEC / gates:** 5.3, 6.5–6.6; G4, G5.
- **Prerequisites / unblocks:** PRO-03 and EDT-02; unblocks complete composition
  rendering.
- **Behavior:** Produce smooth bounded face/person/screen crop keyframes per video
  layer; add/move/remove manual keyframes; manual intervals override automatic
  tracks and survive re-analysis.
- **Non-goals:** No source-pixel mutation and no unbounded/negative crop.
- **Changes:** Add track interpolation/precedence service, detection-to-crop
  conversion, composition mutation schemas, numeric editing operations, and
  invalidation.
- **Errors / privacy / compatibility:** Invalid dimensions/coordinates fail
  validation; missing detections use an explicit fit/fill fallback without
  inventing a face.
- **Tests / fixtures / Windows:** Landscape/portrait/square, no/multiple/
  intermittent faces, screen share, interpolation bounds, manual precedence,
  per-layer independence, re-analysis survival, and revision conflict.
- **Milestone / exit criteria:** Independent crop tracks remain bounded and
  manual overrides survive re-analysis; interpolation/revision suites pass and
  enable composition rendering plus G4/G5.
- **Computer Use validation:** In UI-01.3 edit automatic and manual crop tracks,
  use numeric controls, re-analyze, undo/redo, and verify manual precedence plus
  stale-save recovery. Capture macOS evidence; defer to WIN-03.4.
- **Evidence / acceptance:** Every sampled interpolated rectangle remains within
  source bounds and manual fixtures are bit-for-bit stable after auto reanalysis.

### EDT-04 — Implement caption data, editing, layout checks, and sidecars

- **SPEC / gates:** 3.2, 5.3, 6.7; G5, G6.
- **Prerequisites / unblocks:** TRC-01, EDT-01, and EDT-02; unblocks RND-01 and
  RND-02.
- **Behavior:** Initialize captions from the accepted transcript, then edit them
  independently with cue text/timing, line breaks, approved packaged fonts,
  position, size, color, outline/background, and per-word highlights. Validate
  safe areas, overflow, missing glyphs, short cues, overlap, and range bounds.
- **Non-goals:** Sidecars do not replace required burned-in captions.
- **Changes:** Add caption schemas/state/mutations, layout and font metrics,
  packaged font inventory, typed `shorts.update_captions`, warning codes, and
  UTF-8 SRT/WebVTT generation.
- **Errors / privacy / compatibility:** Stale edits conflict; missing font/glyph
  and invalid timing are actionable. Caption text stays local unless included in
  an authorized provider operation.
- **Tests / fixtures / Windows:** Long words, punctuation, rapid/overlapping cues,
  line wrapping, Unicode missing glyph, safe area, highlighting, style
  persistence, SRT encoding, and transcript-versus-caption independence.
- **Milestone / exit criteria:** Independent caption state, styles, warnings,
  and UTF-8 sidecars round-trip through persistence; layout/revision suites pass
  and enable RND-01/02 plus G5/G6.
- **Computer Use validation:** In UI-01.3 edit caption text/timing/style, trigger
  overflow/glyph/safe-area warnings, undo/redo, and provoke a stale save; verify
  actionable recovery. Capture macOS evidence; defer to WIN-03.5.
- **Evidence / acceptance:** G5 caption fixtures round-trip through persistence,
  preflight, burned-in render, and a UTF-8 sidecar with identical timing.

### EDT-05 — Implement deterministic source and bed audio decisions

- **SPEC / gates:** 2.3, 3.2, 5.3, 6.8; G5, G6.
- **Prerequisites / unblocks:** EDT-01 and EDT-02; unblocks RND-01 and RND-02.
- **Behavior:** Always retain synchronized source speaker audio across ranges;
  support source gain/mute, deterministic short cut fades, and optional imported
  music/bed gain. Warn when speech-to-background settings exceed the reviewed
  threshold.
- **Non-goals:** No voice synthesis or automatic cloud TTS. Loudness
  normalization is excluded unless added later as an explicit deterministic
  setting.
- **Changes:** EDT-05 owns the audio state schema, revisioned mutation service,
  Render/schedule invalidation, and HTTP operation. Add asset binding,
  mixing/fade decisions, threshold analysis, and preflight warning data.
- **Errors / privacy / compatibility:** Reject missing/non-audio assets and
  out-of-range levels; rewrite text never maps to an audio source.
- **Tests / fixtures / Windows:** Multi-range sync, mute/gain, fade boundaries,
  bed loop/trim policy, warning threshold, deterministic settings, and explicit
  proof that source audio remains present. Cover revision conflicts, strict
  schema rejection, stale Renders, `needsRerender` only for non-published
  schedule entries, and published-entry immutability.
- **Milestone / exit criteria:** The revisioned HTTP audio mutation supports
  concrete gain/mute/fade/bed fields with deterministic invalidation; audio,
  schema, CAS, and publication-lock suites pass and enable RND-01/02 plus G5/G8.
- **Computer Use validation:** In UI-01.3 adjust gain, mute, fades, bed asset and
  bed gain; undo/redo and stale-save; verify parity, warning, stale Render,
  non-published rerender flag, and published immutability. Capture macOS evidence;
  defer release closure to WIN-03.4/.5.
- **Evidence / acceptance:** G5 normalized audio comparison confirms sync,
  configured fades/mix, intelligible speaker track, and no generated voice.

## Milestone 6 — Rendering, validation, retry, and recovery

### RND-01 — Build typed preflight from an immutable revision snapshot

- **SPEC / gates:** 3.2–3.3, 4.2, 5.3, 6.5–6.9, 7.2; G4–G8.
- **Prerequisites / unblocks:** FND-03 and EDT-01–EDT-05; unblocks RND-02.
- **Behavior:** Preflight without final output creation; bind an immutable Short
  revision snapshot and return typed errors/warnings for sources, revision,
  approval, ranges, assets, captions, crops, audio, duration, dependencies,
  output settings, safe areas, and the current >60-second Content ID warning.
- **Non-goals:** Preflight never marks a Render successful.
- **Changes:** Add preflight result schema/service/persistence, dependency probes,
  warning registry, HTTP operation, and typed `renders.preflight`.
- **Errors / privacy / compatibility:** Use registry codes and redact paths by
  default; warning includes the SPEC YouTube Help link but does not claim remote
  publication status.
- **Tests / fixtures / Windows:** One fixture per error/warning, exact 180 seconds,
  >180 seconds, >60 seconds, stale approval, corrupt asset, caption/crop bounds,
  missing FFmpeg, and no-output assertion.
- **Milestone / exit criteria:** Typed preflight binds an immutable snapshot and
  creates no output while covering every warning/error; matrix suites pass and
  enable RND-02 plus G4–G8.
- **Computer Use validation:** In UI-01.4 run preflight, force stale revision and
  missing dependency, and verify typed warnings, no output, and actionable
  recovery. Capture macOS evidence; deferred to UI-01.4/UI-03 and WIN-03.6/.9.
- **Evidence / acceptance:** G6 preflight matrix is complete and a filesystem
  snapshot proves no final render is created.

### RND-02 — Compose originals with an explicit FFmpeg graph

- **SPEC / gates:** 2.3, 4.1, 5.3, 6.5–6.9; G4–G6.
- **Prerequisites / unblocks:** RND-01; unblocks RND-03 and RND-04.
- **Behavior:** Generate an explicit filter graph from the immutable snapshot;
  use original sources, ordered ranges, fit/fill without stretch, independent
  crop tracks, layers/assets, burned-in captions, source audio, fades, and bed
  mixing; produce 1080×1920 H.264/AAC MP4 and optional sidecar.
- **Non-goals:** FFmpeg does not own lifecycle rules and never overwrites source
  or prior successful Render output.
- **Changes:** Add graph builder, safe argument spawning, artifact temp outputs,
  progress parser, encoder provenance, deterministic settings, and per-template
  golden fixtures.
- **Errors / privacy / compatibility:** No shell interpolation; paths/credentials
  are not logged. Dependency/process failures are typed and partial files remain
  incomplete artifacts.
- **Tests / fixtures / Windows:** Every starter template with landscape,
  portrait, square, screen share, multi/single speaker; crop/aspect/caption/audio
  assertions; path quoting; disk full; and original-source verification.
- **Milestone / exit criteria:** Explicit FFmpeg graphs compose originals,
  captions, crops, and audio without source mutation; graph/media/fault suites
  pass and enable RND-03/04 plus G4–G6.
- **Computer Use validation:** In UI-01.4 render a composed fixture, inspect
  progress/stages, cancel once, and force disk/dependency failure; verify visible
  recovery and unchanged sources. Capture macOS evidence; defer to WIN-03.6.
- **Evidence / acceptance:** Filter graphs are snapshot-testable, sources are
  unchanged, and rendered fixtures visibly/audibly match persisted decisions.

### RND-03 — Gate Render success on validation and determinism

- **SPEC / gates:** 3.2, 5.1–5.3, 6.9; G6.
- **Prerequisites / unblocks:** RND-02; unblocks scheduling and final packaging
  validation.
- **Behavior:** Persist a Render attempt bound to one Short revision and mark it
  `succeeded` only after ffprobe confirms playable video/audio, 1080×1920,
  H.264/AAC, positive duration, and ≤180 seconds. Store validation, output/hash,
  encoder/FFmpeg provenance, and normalized determinism hashes.
- **Non-goals:** A standalone path validator cannot transition an unrelated
  Render or rebind revisions.
- **Changes:** Complete Render repository/lifecycle, validation typed details,
  normalized frame/audio hashing, metadata normalization/exclusion rules, and
  immutable output paths.
- **Errors / privacy / compatibility:** `ARTIFACT_CORRUPT`, `INVALID_STATE`, and
  typed validation errors; a failed validation never presents the file as
  complete.
- **Tests / fixtures / Windows:** Zero duration, no stream, wrong codec/size,
  exactly/over 180 seconds, corrupt/truncated file, stale revision, repeated
  normalized hashes, and non-overwrite.
- **Milestone / exit criteria:** Only validated immutable attempts reach success
  and repeated normalized output matches; validation/determinism suites pass and
  enable scheduling, packaging validation, and G6.
- **Computer Use validation:** In UI-01.4 render valid and corrupt fixtures,
  inspect validation details and attempt history, and verify prior success stays
  immutable after failure. Capture macOS evidence; defer to WIN-03.6.
- **Evidence / acceptance:** G6 validation and repeated-render comparisons pass
  using the exact release FFmpeg build.

### RND-04 — Add safe cancellation, retry attempts, and crash recovery

- **SPEC / gates:** 4.2, 5.2, 6.9, 6.11, 7.2; G6, G8, G9.
- **Prerequisites / unblocks:** RND-03 and FND-03; unblocks final UI recovery and
  Windows gates.
- **Behavior:** Cancel at safe subprocess boundaries, retry the same persisted
  revision as a new job attempt/new Render attempt where appropriate, preserve
  prior successes, and reconcile core/worker/FFmpeg crashes without false
  success.
- **Non-goals:** Retry never adopts the latest mutable Short implicitly.
- **Changes:** Add attempt lineage, cancellation signal escalation, retry policy,
  `renders.retry`, recovery actions, bounded attempts, and UI/API-visible stage,
  path, validation, provenance, and failures.
- **Errors / privacy / compatibility:** `JOB_CANCELLED`, actionable dependency/
  artifact errors, redacted process output, and no infinite queued states.
- **Tests / fixtures / Windows:** Cancel queued/running stages, retry failed/
  cancelled/stale, kill each process stage, disk full, missing output, restart,
  attempt limits, and prior-success preservation.
- **Milestone / exit criteria:** Cancellation, retry lineage, and crash recovery
  terminate in bounded safe states with immutable prior success; fault suites
  pass and enable UI recovery plus G6/G8/G9.
- **Computer Use validation:** In UI-01.4/UI-03 cancel/retry, kill core/worker/
  renderer at supported stages, restart, and inspect progress, history, redacted
  errors, and bounded recovery. Capture macOS evidence; defer to WIN-03.6/.9.
- **Evidence / acceptance:** G6/G9 fault injection yields only safe retry or a
  terminal actionable error, with each attempt durably distinguishable.

## Milestone 7 — Scheduling and publication records

### SCH-01 — Persist revisioned schedule rules with a documented DST policy

- **SPEC / gates:** 5.1–5.3, 6.10, 7.2; G7, G8.
- **Prerequisites / unblocks:** FND-02; unblocks SCH-02 and complete calendar UI.
- **Behavior:** Persist revisioned start date, IANA timezone, weekdays, multiple
  wall times, daily cap, blackouts, and same-Episode spacing. Preserve local
  wall-clock intent across zone changes; define, test, and warn on nonexistent
  and ambiguous local times.
- **Non-goals:** No uploader and no reliance on the host timezone.
- **Changes:** Add rule repository/service, compare-and-swap updates, timezone
  resolver with explicit spring/fall policy, warnings, HTTP, and typed
  `schedule.get_rules` / `schedule.update_rules`.
- **Errors / privacy / compatibility:** Invalid IANA zone/date/time and stale
  revision are typed; timezone database version is captured for diagnostics.
- **Tests / fixtures / Windows:** Spring-forward gap, fall-back duplicate,
  historical/future offset, timezone rule fixture, daily cap, weekdays,
  blackouts, and revision conflict.
- **Milestone / exit criteria:** Revisioned rules produce deterministic,
  machine-timezone-independent slots and explicit DST warnings; timezone/CAS
  suites pass and enable SCH-02, calendar UI, and G7/G8.
- **Computer Use validation:** In UI-01.5 edit rules, exercise warned spring/fall
  fixtures and a stale revision, and verify deterministic visible results and
  recovery. Capture macOS evidence; deferred to UI-01.5 and WIN-03.7.
- **Evidence / acceptance:** G7 wall-clock fixtures pass with documented warning
  behavior independent of machine timezone.

### SCH-02 — Complete draft, move, lock, and publication semantics

- **SPEC / gates:** 2.1–2.3, 5.2–5.3, 6.10; G7.
- **Prerequisites / unblocks:** SCH-01 and RND-03; unblocks UI-01 and WIN-03.
- **Behavior:** Schedule only approved Shorts with current successful validated
  Renders; sort priority with stable ID tie; use earliest legal unoccupied slot;
  validate moves against all rules/collisions/revisions; manually mark published
  with optional valid YouTube URL and lock permanently.
- **Non-goals:** No YouTube OAuth/upload or claim of remote verification.
- **Changes:** Complete entry state transitions (`draft`, `planned`,
  `published`), move validation, published-lock protections, rerender handling,
  rationale/warnings, and service tests.
- **Errors / privacy / compatibility:** `SCHEDULE_COLLISION`,
  `REVISION_CONFLICT`, `INVALID_STATE`; Short edits affect only non-published
  dependent entries.
- **Tests / fixtures / Windows:** Stable tie, caps, occupied slots, spacing,
  illegal move, lock, stale revision, rerender invalidation, valid/invalid URL,
  >60-second warning, and published immutability.
- **Milestone / exit criteria:** Draft/move/publish semantics are deterministic,
  collision-safe, revisioned, and permanently lock published entries; suites
  pass and enable UI-01.5, WIN-03, and G7.
- **Computer Use validation:** In UI-01.5 draft, move, collide, stale-save, mark
  published with/without valid URL, then edit the Short; verify locks,
  deterministic order, and rerender flags only on non-published entries. Capture
  macOS evidence; defer to WIN-03.7.
- **Evidence / acceptance:** G7 passes and database assertions prove a published
  record cannot be changed by later Short edits.

## Milestone 8 — HTTP contracts, typed MCP parity, and security

### API-01 — Complete and contract-test the versioned HTTP API

- **SPEC / gates:** 4.1, 5.4, 6.1–6.10, 7.1, 7.3; G8.
- **Prerequisites / unblocks:** Completed domain services FND through SCH;
  unblocks API-02 and UI-01.
- **Behavior:** Expose every workflow under loopback `/v1`; successes use
  `{apiVersion,data}`, failures use `{apiVersion,error:{code,message,details,
  retryable}}`; long operations return durable handles; every revisioned
  mutation requires `expectedRevision`.
- **Non-goals:** No destructive deletion route and no credential/grant route
  callable outside desktop user-only IPC.
- **Changes:** Add missing inventory, transcript, provider, timeline, caption,
  audio, approval, rules, template, preflight, and retry contract coverage;
  strict request schemas; shared redacted error middleware; route inventory.
  EDT-05 owns the audio schema/service/invalidation/HTTP implementation; API-01
  owns its endpoint contract tests.
- **Errors / privacy / compatibility:** Unknown mutation/security fields are
  rejected; internal errors reveal no stack, secret, transcript, or detailed path
  by default. Preserve existing operation semantics or version deliberate
  incompatibilities through the SPEC process.
- **Tests / fixtures / Windows:** Contract-test every operation for success,
  invalid schema, not found, invalid state, conflict, cancellation, provider
  failure, envelope shape, loopback host, credential absence, and no deletion.
- **Milestone / exit criteria:** A machine-generated route inventory includes
  every domain operation, including audio, with stable envelopes, pagination
  compatibility, redaction, and zero unexplained UI-only transitions; all
  contract suites pass and enable API-02 plus G8.
- **Computer Use validation:** Exercise matching UI workflows and compare visible
  values/errors with recorded HTTP fixtures, including audio conflicts and
  invalidation. Capture macOS evidence; direct closure is deferred to matching
  UI-01 subtasks and WIN-03.8.
- **Evidence / acceptance:** Machine-generated route inventory maps every public
  state transition and all G8 HTTP cases pass.

### API-02 — Deliver concrete MCP schemas and complete parity

- **SPEC / gates:** 2.3, 4.1, 5.4, 7.2–7.3; G2, G8.
- **Prerequisites / unblocks:** API-01 and PRO-04; unblocks complete agent
  workflow and UI parity audit.
- **Behavior:** Keep all original v1 tools and add every parity tool below. Use
  the HTTP API, preserve `apiVersion`, stable IDs, domain values, job handles,
  and structured error fields as machine-readable JSON.
- **Non-goals:** No alternate business logic, credentials, authorization grants,
  confirmation bypass, arbitrary-record schemas, or destructive deletion tools.
- **Changes:** Register concrete schemas and shared HTTP result/error translation
  for:
  `library.list_episodes`, `library.get_episode`, `library.import_paths`,
  `analysis.start`, `jobs.list`, `jobs.cancel`, `candidates.list`,
  `candidates.generate`, `candidates.review`, `shorts.create`, `shorts.get`,
  `shorts.update_composition`, `shorts.update_copy`, `renders.start`,
  `renders.validate`, `renders.list`, `schedule.get`, `schedule.draft`,
  `schedule.move`, `schedule.mark_published`, `templates.list`, `assets.list`,
  `assets.import`, plus `library.list_watched_folders`,
  `library.configure_watched_folder`, `library.relink_source`,
  `analysis.get_transcript`, `analysis.update_transcript`,
  `providers.list_capabilities`, `providers.get_status`,
  `shorts.update_timeline`, `shorts.update_captions`, `shorts.update_audio`,
  `shorts.approve`,
  `schedule.get_rules`, `schedule.update_rules`, `templates.clone`,
  `templates.update`, `renders.preflight`, and `renders.retry`.
- **Errors / privacy / compatibility:** Preserve structured fields and
  `retryable`; core verifies authorization. Human text may wrap but never replace
  JSON.
- **Tests / fixtures / Windows:** Schema discovery snapshots and success/error
  parity for every tool; forged authorization, secrets, stable IDs, job fields,
  no deletion, and API/MCP value equality.
- **Milestone / exit criteria:** Machine-generated discovery exposes exactly 40
  unique typed tools with API-equivalent values/errors, durable Jobs, redaction,
  pagination compatibility, and zero unexplained UI-only transitions; suites
  pass and enable API-03 plus G8.
- **Computer Use validation:** Exercise matching UI workflows and compare visible
  results/errors with MCP fixtures, including watched-folder rescan Jobs and
  audio schema/conflict/invalidation parity. Capture macOS evidence; closure is
  deferred to matching UI-01 subtasks and WIN-03.8.
- **Merge boundaries:** Land as four numbered pull requests:
  `API-02.1` adds the shared result/error translator and concrete schemas for the
  original tools; `API-02.2` adds inventory, transcript, and provider parity;
  `API-02.3` adds Short, template, asset, preflight, and retry parity, including
  `shorts.update_audio` with concrete `sourceGain`, `sourceMuted`,
  `cutFadeMilliseconds`, optional `bedAssetId`, `bedGain`, and
  `expectedRevision` fields; and
  `API-02.4` adds schedule parity plus the final authorization/no-deletion
  security inventory. Each subtask must leave discovery and existing tools
  passing.
- **Evidence / acceptance:** G8 tool inventory has no gap and no known-domain
  input uses an arbitrary record.

### API-03 — Enforce collection bounds, diagnostics redaction, and compatibility

- **SPEC / gates:** 1, 3.3, 5.4, 7.1–7.3; G2, G8, G9.
- **Prerequisites / unblocks:** API-01 and API-02; freezes the release contract
  and unblocks UI-01.1, UI-01.2, UI-01.5, and UI-03.
- **Behavior:** Add cursor pagination before any collection can exceed 1,000;
  centralize diagnostic-detail opt-in and redaction; publish compatibility
  fixtures for routes/tools and prove primary transition parity.
- **Non-goals:** No transcript/path logging by default and no undocumented
  breaking contract changes.
- **Changes:** Add cursor schemas/order guarantees, redaction policy, diagnostic
  export filters, contract snapshots, and UI-to-MCP transition inventory.
- **Errors / privacy / compatibility:** Invalid/expired cursors are typed;
  exported diagnostics never contain credentials and include sensitive
  transcript/path data only after explicit opt-in.
- **Tests / fixtures / Windows:** >1,000 rows, stable page traversal under inserts,
  redaction corpus, unknown fields, compatibility snapshots, and parity diff.
- **Milestone / exit criteria:** Frozen route/tool snapshots prove bounded
  pagination, compatibility, redaction, 40-tool discovery, and zero unexplained
  UI-only transitions; suites pass and enable collection-consuming UI plus
  G2/G8/G9.
- **Computer Use validation:** Exercise collection-consuming UI workflows and
  compare paging, diagnostics, and errors with frozen HTTP/MCP fixtures; inspect
  redacted recovery once. Capture macOS evidence; closure is deferred to
  UI-01.1/.2/.5 and WIN-03.8.
- **Evidence / acceptance:** G2/G8 secret scans and bidirectional transition
  inventory pass with zero unexplained UI-only mutations.

## Milestone 9 — End-to-end desktop workflow, accessibility, and recovery

### UI-01 — Replace placeholders with complete React/Electron workflows

- **SPEC / gates:** 2.1–2.3, 3.3, 4.1, 6.1–6.10, 7.3; G1–G8.
- **Prerequisites / unblocks:** API-01, API-02, API-03, INV-03, PRO-05, TRC-03,
  EDT-01–EDT-05, RND-04, and SCH-02; unblocks UI-02, UI-03, and WIN-03. API-03
  contract freeze is required before UI-01.1, UI-01.2, or UI-01.5; UI-01.3 and
  UI-01.4 may start earlier after their existing API-01/API-02 and domain
  dependencies.
- **Behavior:** Implement library/watched-folder/relink, provider choice and
  user-only cloud gates, transcript/Candidate review, content-package acceptance,
  synchronized editor/timeline/crop/caption/audio with session undo/redo and
  save feedback, render/preflight/progress/retry, and list/calendar scheduling.
- **Non-goals:** No deletion, YouTube upload/OAuth, multitrack NLE, web download,
  multi-user, or generated voice.
- **Changes:** Add routed views, typed API client, native dialogs/security IPC,
  preview/proxy coordination, state/revision conflict UX, safe-area display,
  publication recording, and local/cloud labels before operations.
- **Errors / privacy / compatibility:** Every failure offers recovery where
  possible; cloud disclosure precedes authorization; no UI assertion bypasses
  core rules.
- **Tests / fixtures / Windows:** Component/integration tests for every primary
  transition, revision races, no-network launch/local workflow, undo/redo,
  preview-original binding, and placeholder absence. Manual full workflow on
  Windows.
- **Milestone / exit criteria:** Each numbered subtask is independently
  observable and closes only with no placeholders, visible expected conflicts/
  recovery, its typed client, and a passing transition-parity test:
  `UI-01.1` complete inventory/provider workflow; `UI-01.2` complete transcript/
  Candidate/copy workflow; `UI-01.3` complete timeline/composition/crop/caption/
  audio workflow; `UI-01.4` complete approval/render/retry workflow; and
  `UI-01.5` complete rules/calendar/publication workflow. All five enable
  UI-02/UI-03, WIN-03, and G1–G8.
- **Computer Use validation:** Start each subtask from its named fixture:
  `UI-01.1` imports, watches/rescans, relinks, and exercises provider disclosure/
  recovery; `UI-01.2` edits transcript, regenerates/reviews Candidates, and
  preserves accepted copy; `UI-01.3` edits timeline/crops/captions/audio with
  undo/redo, stale saves, and published locks; `UI-01.4` approves, preflights,
  renders, cancels/retries, and recovers; `UI-01.5` edits rules, drafts/moves,
  collides, and publishes. Each must show expected visible state and one
  failure/recovery result, with a macOS screenshot/recording; each blocks its own
  subtask, and all repeat on WIN-03.1–.8 as mapped.
- **Merge boundaries:** Land as five independently usable pull requests:
  `UI-01.1` library, watched folders, relink, provider status, and cloud gates;
  `UI-01.2` transcript, Candidate review, and accepted copy;
  `UI-01.3` timeline/composition/crop/caption/audio editing, the typed audio
  client, and undo/redo;
  `UI-01.4` approval, preflight, render, progress, cancellation, and retry; and
  `UI-01.5` rules, list/calendar scheduling, moves, and publication recording.
  Each subtask includes its matching API client and transition-parity tests.
- **Evidence / acceptance:** G1–G8 UI scenarios pass and the transition inventory
  maps each persisted action to typed HTTP/MCP or the documented UI-only gate.

### UI-02 — Meet keyboard, screen-reader, scaling, contrast, and motion requirements

- **SPEC / gates:** 4.1, 6.6, 6.11; G9.
- **Prerequisites / unblocks:** UI-01; unblocks Windows release acceptance.
- **Behavior:** Make all workflows keyboard operable with visible focus and
  accessible names; announce status without focus theft; provide numeric
  timeline/crop alternatives; use non-color status indicators; support Windows
  200% text scaling, WCAG 2.2 AA contrast, and reduced motion.
- **Non-goals:** Pointer gestures are not removed; they gain equivalent controls.
- **Changes:** Add focus management, semantic/live regions, scalable responsive
  layout, motion tokens, numeric dialogs, accessibility test IDs, and contrast
  tokens.
- **Errors / privacy / compatibility:** Error announcements are concise and do
  not expose sensitive detail; focus returns to the invoking control/dialog
  context.
- **Tests / fixtures / Windows:** Automated axe/keyboard/contrast checks where
  reliable; manual Windows screen reader, keyboard-only, 200% scaling, reduced
  motion, visible focus, and numeric crop/timeline scenarios.
- **Milestone / exit criteria:** The entire placeholder-free workflow passes
  automated accessibility suites and is operable by keyboard with numeric
  spatial alternatives, announcements, focus, reduced motion, and 200% scaling;
  it enables G9 and Windows acceptance.
- **Computer Use validation:** From the complete UI, record a macOS keyboard-only
  run with visible focus, screen-reader announcements, reduced motion, numeric
  timeline/crop input, and 200% text scaling; verify focus-safe error recovery.
  This blocks UI-02 as development evidence and must repeat in WIN-03.9.
- **Evidence / acceptance:** G9 accessibility checklist is signed with screenshots
  or recordings and no primary action requires a pointer.

### UI-03 — Expose diagnostics and actionable crash recovery

- **SPEC / gates:** 3.3, 4.2–4.3, 6.9, 6.11; G6, G9, G10.
- **Prerequisites / unblocks:** UI-01, API-03, FND-03, and RND-04; unblocks
  Windows fault-injection gate.
- **Behavior:** Show interrupted jobs, missing sources/models/dependencies/
  artifacts, recovery choices, safe retry, and redacted diagnostics. Preserve
  accepted state across UI/core/worker/FFmpeg termination and power-loss
  simulation.
- **Non-goals:** Never auto-delete accepted state or loop retries forever.
- **Changes:** Add recovery center, dependency/provider status, diagnostic detail
  consent/export, attempt history, startup reconciliation display, and focus-safe
  notifications.
- **Errors / privacy / compatibility:** Default diagnostics omit credentials,
  transcripts, and absolute paths; corrupt artifacts never appear successful.
- **Tests / fixtures / Windows:** Force-close every process at each stage,
  missing dependency/model/source/artifact, corrupt database/artifact handling,
  bounded retry, and secret scan.
- **Milestone / exit criteria:** Every supported UI/core/worker/renderer
  interruption preserves accepted state and ends in bounded retry or redacted,
  actionable failure; full fault suites pass and enable G6/G9/G10.
- **Computer Use validation:** Force-close UI, core, worker, and renderer at each
  supported stage; restart and verify accepted state, bounded retry, redacted
  diagnostics, attempt history, and focus-safe recovery. Record the full macOS
  matrix and repeat it on Windows; Windows evidence blocks WIN-03.9.
- **Evidence / acceptance:** G9 fault matrix passes with database integrity and
  every interrupted case ends in safe retry or actionable terminal state.

## Milestone 10 — Windows resources, installer, and release gates

### WIN-01 — Package compatible native, FFmpeg, Python, model, and font resources

- **SPEC / gates:** 3.1, 4.3, 6.7, 6.9; G6, G10.
- **Prerequisites / unblocks:** PRO-01, PRO-02, EDT-04, and RND-03; unblocks
  WIN-02.
- **Behavior:** Produce the Windows architecture matrix with compatible
  `better-sqlite3`, licensed FFmpeg/ffprobe, Python worker/runtime, approved
  fonts, and model setup. If models download first-run, make it resumable and
  disclose disk, network, license, and privacy before transfer.
- **Non-goals:** Empty `resources/bin` or package declarations alone are not
  evidence; no unlicensed binary distribution.
- **Changes:** Add pinned resource manifests/checksums/licenses, build scripts,
  packaged path resolution, model manager, architecture checks, and SBOM/license
  notices.
- **Errors / privacy / compatibility:** Missing/corrupt/incompatible resources
  fail actionably; no credential in build logs; offline installed-model workflow
  remains network-free.
- **Tests / fixtures / Windows:** Packaged binary smoke tests, checksum/license
  verification, worker/SQLite load, fonts, offline probe/transcribe/render, and
  interrupted model download resume.
- **Milestone / exit criteria:** A clean Windows VM loads every pinned packaged
  dependency without PATH substitutes and passes checksum/license/offline smoke
  suites, enabling WIN-02 plus G6/G10.
- **Computer Use validation:** On a clean Windows VM install packaged resources,
  inspect first-run disk/network/license/privacy disclosure, interrupt/resume
  model setup, and run offline probe/transcribe/render; record screenshots,
  build/resource IDs, and recovery. Windows evidence blocks WIN-01.
- **Evidence / acceptance:** A clean Windows VM runs every packaged dependency
  without development tools or PATH-provided substitutes.

### WIN-02 — Complete installer identity, lifecycle, upgrade, and uninstall safety

- **SPEC / gates:** 3.1, 4.3; G10.
- **Prerequisites / unblocks:** WIN-01 and FND-03; unblocks WIN-03.
- **Behavior:** Build a signed or explicitly developer-identified NSIS installer
  that installs without admin where policy allows, starts/stops the core with the
  app, binds loopback, creates correct shortcuts/data permissions, upgrades from
  prior beta, and uninstalls without deleting source media. Data removal is a
  separate explicit choice.
  Apply FND-03's populated-path and four-case decision exactly during upgrade:
  native initialization/open, verified legacy SQLite checkpoint/staged copy/
  artifact-hash promotion with timestamped backup, or no-write both-path
  recovery. Failed verification quarantines staging and leaves legacy
  authoritative; v1 never auto-merges or auto-deletes a migration backup.
- **Non-goals:** No implicit application-data or source cleanup.
- **Changes:** Add installer identity/signing configuration, per-user install
  behavior, upgrade migration, core shutdown supervision, uninstall choices, and
  crash-log location.
- **Errors / privacy / compatibility:** Failed install/upgrade rolls back safely;
  retain accepted data and stable IDs; never display signing secrets.
- **Tests / fixtures / Windows:** Clean install, no-admin user, launch/quit,
  loopback check, upgrade current DB/artifacts, repair, uninstall keep/remove
  data choices, shortcut, permissions, and source hash snapshots. Upgrade/
  rollback covers empty directories, SQLite WAL/SHM, interrupted copy/promotion,
  both-path conflicts, stable IDs, artifact hashes, and an incompatible old
  binary attempting migrated data.
- **Milestone / exit criteria:** Installer lifecycle and all migration branches
  preserve IDs, hashes, sources, and recovery authority; Windows upgrade/
  rollback/uninstall suites pass and enable WIN-03 plus G10.
- **Computer Use validation:** On clean/no-admin Windows install, launch, upgrade
  legacy/WAL fixtures, interrupt promotion, provoke both-path recovery, test old-
  binary rollback, and uninstall with keep/remove choices; verify no PATH
  substitutes and unchanged source hashes. Record screenshots/build/fixture IDs;
  Windows evidence blocks WIN-02.
- **Evidence / acceptance:** G10 installer lifecycle passes on clean supported
  Windows 11 and source/data retention behavior is documented and observed.

### WIN-03 — Execute G1–G10 on the representative Windows beta corpus

- **SPEC / gates:** 3.1, 4.3, 9; G1–G10.
- **Prerequisites / unblocks:** All implementation tasks and WIN-02; unblocks
  REL-01.
- **Behavior:** Run the complete release-gate matrix on clean Windows 11 using the
  release installer, binaries, models, FFmpeg build, and representative corpus.
  Before creating the release-candidate manifest, reverify every dated OpenAI
  and YouTube fact in SPEC against its official source and record the result. A
  changed fact blocks manifest creation until SPEC, behavior, warnings, and tests
  are reconciled. Then record exact build IDs, fixtures, machine policy,
  evidence, and defects.
- **Non-goals:** macOS/Linux results, isolated unit tests, or packaging
  declarations cannot substitute for a gate.
- **Changes:** Add reproducible gate harnesses, corpus manifest/license handling,
  manual checklists, normalized render comparisons, network capture, fault
  injection, accessibility protocol, and release evidence index.
- **Errors / privacy / compatibility:** Corpus and logs use approved handling;
  secret scans and source immutability are mandatory; a failed `MUST` blocks v1.
- **Tests / fixtures / Windows:** Execute every scenario listed in G1–G10,
  including clean install, local offline workflow, explicit cloud fixture,
  process kills, DST, 200% scaling, upgrade, and uninstall.
- **Milestone / exit criteria:** Pre-manifest external-fact verification is
  complete, one immutable RC manifest identifies all inputs, and each G1–G10
  checklist passes on Windows with linked failure/rerun evidence; this enables
  REL-01. macOS evidence cannot close any WIN-03 milestone.
- **Computer Use validation:** First open and record all dated official facts;
  only if unchanged/reconciled create the RC manifest. Run WIN-03.1–.10 against
  that same manifest, recording exact desktop actions, expected/failure states,
  screenshots/recordings, build IDs, fixture IDs, defects, and reruns. Windows
  11 evidence blocks every subtask and the parent.
- **Execution boundaries:** Track `WIN-03.1` through `WIN-03.10`, one result set
  for each corresponding release gate. A gate subtask may be rerun independently
  after a fix, but all ten must reference the same release-candidate manifest
  before the parent closes.
- **Evidence / acceptance:** Every gate is pass with linked evidence and no open
  applicable `MUST`; failures create scoped follow-up issues and keep release
  status incomplete.

### REL-01 — Close the final trace, evidence freshness, and owner approval

- **SPEC / gates:** 1, 6.2, 6.10, 9–10; G2, G3, G7, G10.
- **Prerequisites / unblocks:** WIN-03; final v1 decision.
- **Behavior:** Inspect the already completed WIN-03 pre-manifest external-fact
  record, confirm it matches the exact tested manifest, verify evidence freshness,
  run the bidirectional requirement/task/test/gate audit, and obtain owner review
  of SPEC 1.1.0 and the final release trace.
- **Non-goals:** External marketing names never become durable model selection,
  and factual changes are not silently patched around.
- **Changes:** Archive the final rendered trace, evidence-freshness report,
  pre-RC fact record, tested manifest, owner approval, and owner-approved
  Candidate quality threshold. External-fact changes return to WIN-03 before any
  new manifest; REL-01 is not the first external-fact check.
- **Errors / privacy / compatibility:** If an external fact changes, fail the
  release decision until behavior, warning, tests, and SPEC are reconciled.
- **Tests / fixtures / Windows:** Inspect evidence that any affected provider/
  platform fixtures were rerun before the tested manifest, and confirm all links
  and artifacts are accessible to maintainers; REL-01 itself mutates no product
  state.
- **Milestone / exit criteria:** Every requirement/task/test/gate row resolves,
  evidence is fresh and tied to the tested manifest, and an owner records approval
  of SPEC 1.1.0 and release closure; no product-state mutation occurs.
- **Computer Use validation:** Open the rendered SPEC/plan trace, every dated
  external link, the pre-RC verification record, tested manifest, and evidence
  index; confirm they agree and record the owner approval artifact. This is
  documentation/release evidence, performs no product-state mutation, and blocks
  REL-01.
- **Evidence / acceptance:** Owners approve the final trace; every requirement
  row below maps to completed tasks/tests and every task cites a SPEC clause or
  gate.

## Requirement-to-task traceability

Requirement IDs below are audit handles, not additions to the specification.
Each row covers the named normative statements in the cited SPEC location. A
row may map to several tasks because implementation and Windows acceptance are
separate obligations.

| Requirement ID | SPEC requirement scope | Implementation / validation tasks |
| --- | --- | --- |
| S1-CHANGE | 1: versioning, external verification dates/recheck, owner review | REL-01 |
| S2-FLOW | 2.1: complete eight-step workflow | INV-01–03, PRO-02–05, TRC-01–03, EDT-01–05, RND-01–04, SCH-01–02, UI-01, WIN-03 |
| S2-DATA | 2.2: provider output remains distinct from accepted data and authorization meaning | PRO-04–05, TRC-01, TRC-03 |
| S2-NONGOAL | 2.3: no upload/OAuth, general NLE, collaboration/accounts/sync, voice synthesis, web sourcing, silent cloud, source mutation, or destructive deletion | INV-01, PRO-04–05, EDT-01–02, EDT-05, API-01–03, UI-01, WIN-03 |
| S3-PLATFORM | 3.1: Windows-only acceptance, installer identity/resources, no-admin default | WIN-01–03 |
| S3-INPUT | 3.2: guaranteed MP4, best-effort readable media, per-file failure | INV-01, WIN-03 |
| S3-DURATION | 3.2: Candidate 20–90 seconds and render ≤180 seconds | TRC-02, RND-01, RND-03, WIN-03 |
| S3-OUTPUT | 3.2: 1080×1920 H.264/AAC playable MP4 with original speaker audio | EDT-05, RND-02–03, WIN-03 |
| S3-LOCAL | 3.3: local data/work stays on workstation and passive actions make no cloud request | FND-03, PRO-02–05, UI-01, WIN-03 |
| S3-SOURCE | 3.3: source-in-place immutability and generated artifact store | FND-03, INV-01–03, RND-02, WIN-03 |
| S3-DISCLOSE | 3.3: local/cloud disclosure before operation | PRO-04, UI-01 |
| S3-PROVIDERS | 3.3: faster-whisper, Ollama, explicit OpenAI, no fallback, configurable model IDs | PRO-02–05 |
| S3-CREDS | 3.3: protected credentials, forbidden storage/exposure, redacted logs/errors | PRO-04–05, API-03, UI-03, WIN-03 |
| S4-PROCESS | 4.1: Electron/core/SQLite/Python/FFmpeg/MCP ownership boundaries and loopback | FND-02, PRO-01, RND-02, API-01–02, UI-01, WIN-02–03 |
| S4-DIR | 4.2: required application-data directory layout | FND-03, WIN-02 |
| S4-SQLITE | 4.2: transactional recorded migrations, foreign keys, WAL/busy timeout | FND-02, WIN-03 |
| S4-ARTPATH | 4.2: relative owned paths and absolute source paths | FND-03 |
| S4-ATOMIC | 4.2: atomic validated artifact creation and complete metadata | FND-03, RND-02–03 |
| S4-RECOVER | 4.2: startup job/temp reconciliation and safe retry/terminal failure | FND-03, RND-04, UI-03 |
| S4-PACKCORE | 4.3: packaged core start/stop | WIN-02 |
| S4-PACKRES | 4.3: native SQLite plus FFmpeg/ffprobe and disclosed worker/model setup | WIN-01–02 |
| S4-PACKGATE | 4.3: clean Windows workflow packaging gate | WIN-03 |
| S4-UNINSTALL | 4.3: source-safe uninstall and separate data-removal choice | WIN-02–03 |
| S5-IDENTITY | 5: stable UUIDs, UTC instants, retained IANA zone | FND-01–02, SCH-01 |
| S5-EPISODE | 5.1: complete Episode entity | FND-01–02, INV-01–03 |
| S5-WATCH | 5.1: complete WatchedFolder entity | FND-01–02, INV-02 |
| S5-TRANSCRIPT | 5.1: complete TranscriptRevision entity | FND-01–02, TRC-01 |
| S5-ANALYSIS | 5.1: complete AnalysisArtifact entity | FND-01–02, PRO-03, PRO-05 |
| S5-CANDIDATE | 5.1: complete Candidate entity | FND-01–02, TRC-02–03 |
| S5-SHORT | 5.1: complete ShortProject entity | FND-01–02, EDT-01, EDT-04–05 |
| S5-TEMPLATE | 5.1: complete Template entity | FND-01–02, EDT-02 |
| S5-ASSET | 5.1: complete Asset entity | FND-01–02, EDT-02 |
| S5-RENDER | 5.1: complete Render entity | FND-01–02, RND-03–04 |
| S5-SCHEDULE | 5.1: complete ScheduleRuleSet and ScheduleEntry entities | FND-01–02, SCH-01–02 |
| S5-JOB | 5.1: complete Job entity | FND-01–02, PRO-01, RND-04 |
| S5-EPSTATE | 5.2: Episode lifecycle and relink restoration | FND-01, INV-01–03 |
| S5-JOBSTATE | 5.2: Job lifecycle | FND-01, PRO-01, RND-04 |
| S5-CANDSTATE | 5.2: review states and approved-only Short creation | TRC-03, EDT-01 |
| S5-RENDERSTATE | 5.2: render states and validated-only success | FND-01, RND-03–04 |
| S5-SCHEDSTATE | 5.2: draft/planned/published, published lock/no upload implication | FND-01, SCH-02 |
| S5-REVISION | 5.3: positive revisions, expectedRevision, one increment, conflict detail | FND-01–02, TRC-01, EDT-01–04, SCH-01–02, API-01 |
| S5-INVALIDATE | 5.3: render binding/staleness and non-published rerender invalidation | EDT-01, RND-03, SCH-02 |
| S5-RELINK | 5.3: identity mismatch and no-hash confirmation | INV-03 |
| S5-REANALYZE | 5.3: preserve decisions/accepted edits | TRC-03, EDT-03 |
| S5-ERROR | 5.4: complete structured error envelope/registry and redacted internal errors | FND-01, API-01–03 |
| S6-IMPORT | 6.1: multifile/watched folders, batch results, immutability, safe identity | INV-01–02 |
| S6-MISSING | 6.1: visible missing state and identity-safe atomic relink | INV-03 |
| S6-PROBE | 6.1: duration/dimensions/video/audio codec | INV-01 |
| S6-TRANSCRIBE | 6.2: faster-whisper English, timed segments, word/speaker availability | PRO-02, TRC-01 |
| S6-TRANSCRIPTEDIT | 6.2: editable segment/word/speaker/caption timing with revisions | TRC-01, EDT-04 |
| S6-LOCALAI | 6.2: visual analysis, configurable Ollama | PRO-03 |
| S6-OPENAI | 6.2: configurable typed OpenAI and validated output | PRO-05 |
| S6-CACHE | 6.2: complete cache identity/reuse/miss and provenance | PRO-05 |
| S6-CANDCOUNT | 6.3: 5–10 or explicit insufficient-material result | TRC-02 |
| S6-CANDQUALITY | 6.3: bounds/alignment/independence/scores/determinism/deduplication | TRC-02 |
| S6-CANDREGEN | 6.3: non-destructive review and explicit regeneration | TRC-03 |
| S6-SHORTCREATE | 6.4: copy approved range/transcript without source/Candidate mutation | EDT-01 |
| S6-TIMELINE | 6.4: range invariants, precise supported edits, no general NLE | EDT-01, UI-01 |
| S6-COPY | 6.4: complete package, proposed/accepted split, edit survival, planning labels | TRC-03, UI-01 |
| S6-APPROVE | 6.4: revisioned approval and reapproval after output edits | EDT-01 |
| S6-COMPOSITION | 6.5: normalized coordinates and 1080×1920 canvas | FND-01, EDT-02, RND-02 |
| S6-STARTERS | 6.5: three versioned starter templates | EDT-02, WIN-03 |
| S6-TEMPLATEEDIT | 6.5: immutable built-ins, revisioned clones, materialized lineage | EDT-02 |
| S6-LAYERS | 6.5: episode/assets/captions/shapes/logos and rights-note imports | EDT-02 |
| S6-SAFEAREA | 6.5: visible and enforced/warned safe areas | EDT-04, RND-01, UI-01 |
| S6-AUTOFRAME | 6.6: smooth bounded automatic reframing | PRO-03, EDT-03 |
| S6-CROP | 6.6: independent valid tracks and durable manual precedence | EDT-03 |
| S6-EDITOR | 6.6: synchronized interactive editor, undo/redo, save feedback | UI-01–02 |
| S6-ORIGINAL | 6.6: proxy preview allowed, original-source final render | RND-02, UI-01 |
| S6-CAPTIONDATA | 6.7: accepted-transcript initialization, independent text/timing/words | EDT-04 |
| S6-CAPTIONSTYLE | 6.7: styling and safe-area/layout warnings | EDT-04, RND-01 |
| S6-CAPTIONOUT | 6.7: burned-in captions and optional UTF-8 sidecar | EDT-04, RND-02 |
| S6-AUDIO | 6.8: synchronized speaker audio, gain/mute/fades/bed | EDT-05, RND-02 |
| S6-AUDIOWARN | 6.8: speech/background protection and deterministic visible normalization | EDT-05, RND-01 |
| S6-NOVOICE | 6.8: no generated voice/TTS | EDT-05, API-02, UI-01 |
| S6-PREFLIGHT | 6.9: no-output typed preflight across required checks | RND-01 |
| S6-GRAPH | 6.9: immutable-snapshot explicit FFmpeg graph | RND-02 |
| S6-RENDERJOB | 6.9: cancellation/retry/new attempt/non-overwrite | RND-04 |
| S6-DETERMINISM | 6.9: deterministic decisions/frame/audio and normalized metadata | RND-02–03 |
| S6-VALIDATE | 6.9: validated-only success and output invariants | RND-03 |
| S6-ASPECT | 6.9: fit/fill aspect preservation | RND-02 |
| S6-RENDERSTATUS | 6.9: progress/stage/path/validation/provenance/actionable failure | RND-04, API-01, UI-01 |
| S6-RULES | 6.10: complete schedule rules | SCH-01 |
| S6-DRAFT | 6.10: stable priority and earliest legal slot | SCH-02 |
| S6-DST | 6.10: wall-clock intent and warned gap/ambiguity policy | SCH-01 |
| S6-ELIGIBLE | 6.10: approved/current/validated-only scheduling | SCH-02 |
| S6-MOVE | 6.10: collision and stale-revision rejection | SCH-02 |
| S6-CALENDARUI | 6.10: list/calendar, draft, move, rules, publish | UI-01 |
| S6-PUBLISH | 6.10: manual optional URL, lock, no upload/auth/claim | SCH-02, UI-01 |
| S6-YTWARN | 6.10: >60-second Content ID warning/link and pre-release recheck | RND-01, REL-01 |
| S6-A11YKEY | 6.11: keyboard, focus, names, live status, non-color | UI-02 |
| S6-A11YVIS | 6.11: WCAG contrast, scaling, reduced motion, numeric alternatives | UI-02 |
| S6-CRASH | 6.11: accepted-state integrity, reconciliation, safe retry | FND-03, RND-04, UI-03 |
| S6-RECOVERY | 6.11: actionable missing dependency/model/source/artifact | UI-03 |
| S7-HTTPBASE | 7.1: loopback `/v1`, success/error envelopes, UUIDs | API-01 |
| S7-JOBS | 7.1: immediate durable long-job handles | API-01 |
| S7-HTTPREV | 7.1: expectedRevision on mutations | API-01 |
| S7-HTTPSEC | 7.1: no credentials, reject unknown sensitive fields | API-01–03 |
| S7-PAGE | 7.1: pagination before unbounded collection exceeds 1,000 | API-03 |
| S7-MCPBASE | 7.2: same API/IDs/values/version/jobs/errors and no credentials | API-02 |
| S7-MCPPARITY | 7.2: every primary transition typed or documented UI-only gate | API-02–03 |
| S7-MCPTOOLS | 7.2: all original and parity-addition tool behaviors remain available | API-02 |
| S7-NODELETE | 7.2: no destructive deletion tools | API-01–02 |
| S7-CLOUDUI | 7.3: credential/grant UI-only gates and disclosure | PRO-04, UI-01 |
| S7-CLOUDSCOPE | 7.3: scoped/revocable persisted authorization | PRO-04 |
| S7-CLOUDMCP | 7.3: MCP request only with matching authorization and no bypass | PRO-04–05, API-02 |
| S7-CLOUDERR | 7.3: fail before network with required authorization codes | PRO-04–05 |

## Section 8 gap traceability

| Capability-matrix gap | Closing tasks |
| --- | --- |
| Missing entities, migrations, and persistence fields | FND-01–02 |
| Incomplete platform data layout and packaged-path validation | FND-03, WIN-02–03 |
| Incomplete schemas and error codes | FND-01, API-01 |
| Unsafe fingerprint dedupe, format limits, watched folders, and relinking | INV-01–03 |
| Hash identity resolution and probe fixtures | INV-01, WIN-03.1 |
| Job retry, cancellation, cleanup, and bounded recovery | FND-03, PRO-01, RND-04 |
| Caller-controlled cloud authorization | PRO-04–05, API-02 |
| Missing transcription/vision/provider workers | PRO-01–03, PRO-05 |
| Non-revisioned current transcript replacement | TRC-01 |
| Candidate provenance, diagnostics, quality, and regeneration behavior | TRC-02–03 |
| Short reapproval and correct render/schedule invalidation | EDT-01, SCH-02 |
| Template clone/update and materialized lineage | EDT-02 |
| Asset metadata, ownership, rights UX, and editor use | EDT-02, UI-01.3 |
| Crop detection/tracking/manual override workflow | PRO-03, EDT-03, UI-01.3 |
| Caption and audio persistence/editing/composition | EDT-04–05, RND-02, UI-01.3 |
| Render preflight, validation persistence, and determinism | RND-01, RND-03 |
| Missing FFmpeg composition handler | RND-02 |
| Schedule rules, DST policy, moves, warnings, and calendar UI | SCH-01–02, UI-01.5 |
| Incomplete HTTP envelopes and workflow endpoints | API-01, API-03 |
| Untyped/incomplete MCP and discarded structured response data | API-02–03 |
| Placeholder desktop workflows and incomplete accessibility | UI-01–03 |
| Unproven Windows resources, installer, and clean-machine flow | WIN-01–03 |

## Release-gate traceability

| Gate | Implementation tasks | Gate execution |
| --- | --- | --- |
| G1 Import and inventory | INV-01–03, API-01–02, UI-01 | WIN-03 |
| G2 Provider and privacy fixtures | FND-03, PRO-01–05, API-02–03 | WIN-03, REL-01 |
| G3 Transcripts and Candidates | TRC-01–03, PRO-02–05 | WIN-03, REL-01 |
| G4 Templates, assets, reframing | EDT-02–03, RND-01–02 | WIN-03 |
| G5 Timeline, captions, audio | EDT-01, EDT-04–05, RND-01–03, UI-01 | WIN-03 |
| G6 Rendering | FND-03, RND-01–04, WIN-01 | WIN-03 |
| G7 Scheduling and platform rules | SCH-01–02, RND-01, UI-01 | WIN-03, REL-01 |
| G8 HTTP and MCP contracts | FND-01, API-01–03 | WIN-03 |
| G9 Accessibility and recovery | FND-03, RND-04, UI-02–03 | WIN-03 |
| G10 Windows packaging | WIN-01–02 and all end-to-end dependencies | WIN-03, REL-01 |

## Execution controls

- Each pull request must name its task ID, SPEC clauses, affected gate fixtures,
  migration/contract compatibility impact, privacy impact, and completion
  evidence.
- A task is not complete when only a schema, queue entry, placeholder view, or
  packaging declaration exists; its acceptance criteria and tests must pass.
- New user-visible mutations require simultaneous HTTP/MCP parity unless they are
  the explicit credential/cloud-authorization UI-only gates.
- Any external-rule or public-contract change must follow SPEC section 1 before
  code merge.
- CI on non-Windows hosts is development evidence. Only WIN-03 can close a
  Windows release gate.
