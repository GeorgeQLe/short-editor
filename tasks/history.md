# Session history

## 2026-07-28

- Completed RND-02 with strict snapshot-bound `renders.start` contracts requiring
  an explicit passing preflight, migration 13 Render bindings, and atomic
  queued Render/job creation. Render state now advances through guarded
  `queued → running → succeeded|failed|cancelled|stale` transitions.
- Added deterministic `ffmpeg-composition-v1` filter scripts for ordered source
  trims/concatenation, stored-order layers, fit/fill, independent interpolated
  crops, reusable still/video assets, packaged-Inter caption burn-in with timed
  word highlighting, source gain/fades, continuous bed playback, 48 kHz stereo
  mixing, and silence fallback. FFmpeg is spawned without a shell using an
  argument array, `-nostdin`, a filter-script file, capped/redacted stderr, and
  parsed progress timestamps.
- Extended artifact staging for external producers with exclusive temporary
  paths, validation, streaming SHA-256, fsync, atomic rename, collision
  rejection, and cleanup. Render completion now rechecks dependencies and every
  captured input before and after encoding, enforces current-revision approval,
  ffprobes H.264/AAC 1080×1920 positive-duration output, persists graph/encoder
  provenance and hashes, and optionally finalizes regenerated SRT/WebVTT beside
  the MP4. Added deterministic graph/contract and compact real-media coverage,
  including spaced paths and unchanged-source proof. Promoted RND-03.
- Full verification passes 36 test files and 251 tests, including a real
  FFmpeg-rendered MP4/sidecar fixture, plus the production build and diff/secret
  hygiene. Failure-oriented review traced graph determinism, input/dependency
  identity, cancellation, stale revisions, validation, artifact rollback, and
  transport binding with no blocking finding. Native Windows packaging, UI
  visual/audio acceptance, and advanced queued-cancel, retry, and crash
  recovery remain assigned to WIN-03.6, UI-01.4, and RND-04.

- Completed RND-01 with strict `{ shortId, expectedRevision }` preflight,
  canonical `render-snapshot-v1` SHA-256 identity, migration 12 immutable audit
  records, a centralized typed finding registry, and independent
  FFmpeg/FFprobe version checks.
- Snapshot capture now binds the exact Short revision, materialized
  composition/lineage, ordered ranges, recomputed caption layouts, crop and
  audio decisions, fixed v1 output requirements, and stable Episode/asset file
  identity, metadata, and hashes. A transactional final revision check prevents
  concurrent edits from being recorded under the requested revision.
- Added matching strict HTTP `POST /v1/renders/preflight` and MCP
  `renders.preflight` values with no public paths, stderr, or internal snapshot.
  Focused tests cover canonical hashing and ordering, duration boundaries,
  Content ID help, stale/concurrent revisions, repeatability, database
  immutability, redaction, shared-asset binding validation, and no
  Render/job/artifact creation. Adversarial review found and fixed an
  overwritten-binding gap when one asset is reused by multiple layers. Full
  verification passes 35 test files and 245 tests plus production build and
  diff hygiene. Promoted RND-02 as current work.

- Completed EDT-05 with migration 11 strict source/bed audio state, bounded gain
  and cut fades, nullable-pair asset binding, deterministic derived warnings,
  and removal of legacy loudness normalization.
- Added the pure revisioned audio decision engine: every ordered Episode range
  retains its synchronized source route at contiguous output timestamps, all
  entrances/exits receive half-range-capped fades, and optional beds start at
  zero, remain continuous across cuts, loop when short, and trim exactly.
- Added exact-CAS audio updates over service, HTTP, and typed MCP with one Short
  revision increment, approval clearing, successful-Render staleness,
  non-published-only rerender flags, and byte-preserved published schedules.
  Engine, threshold, strict-schema, migration, lifecycle, asset, and parity
  tests pass. Full verification passes 34 test files and 234 tests plus the
  production build/typecheck and diff hygiene. FFmpeg composition/preflight
  remain RND-01/RND-02, and UI controls remain UI-01.3. Promoted RND-01 as
  current work.

### EDT-05 ship manifest

- **User goal:** Implement the strict revisioned audio model and deterministic
  source/bed decision engine with migration, lifecycle invalidation, HTTP, and
  MCP parity while leaving FFmpeg mixing to RND-02.
- **Changed files:** `IMPLEMENTATION_PLAN.md`, `SPEC.md`, `tasks/todo.md`,
  `tasks/history.md`, `src/shared/contracts.ts`, `src/core/audio.ts`,
  `src/core/database.ts`, `src/core/repository.ts`, `src/core/service.ts`,
  `src/core/api.ts`, `src/mcp/server.ts`, `tests/audio.test.ts`,
  `tests/migrations.test.ts`, `tests/short-lifecycle.test.ts`,
  `tests/caption-service.test.ts`, `tests/crop-service.test.ts`,
  `tests/domain-contracts.test.ts`, `tests/persistence.test.ts`,
  `tests/repository.test.ts`, and `tests/transcript-editing.test.ts`.
- **Per-file purpose:** `src/shared/contracts.ts` defines strict audio settings,
  warnings, decisions, and transport results; `src/core/audio.ts` implements
  warning derivation and deterministic source/bed decisions;
  `src/core/database.ts` upgrades legacy audio state in migration 11;
  `src/core/repository.ts` provides transactional CAS persistence and
  invalidation; `src/core/service.ts` validates asset bindings and coordinates
  updates; `src/core/api.ts` and `src/mcp/server.ts` expose matching mutation
  surfaces. `tests/audio.test.ts`, `tests/migrations.test.ts`, and
  `tests/short-lifecycle.test.ts` cover the new engine, migration, lifecycle,
  HTTP, and MCP behavior; the remaining test files update existing typed
  fixtures to the new schema. `SPEC.md` and `IMPLEMENTATION_PLAN.md` record the
  implemented boundary, while `tasks/todo.md` and `tasks/history.md` close
  EDT-05 and route RND-01.
- **User-goal mapping:** The contracts, engine, migration, repository, service,
  and transport files implement the accepted EDT-05 behavior end to end. The
  focused tests prove each promised boundary, fixture changes preserve
  regression coverage under the new state shape, and the planning/task docs
  distinguish completed deterministic decisions from deferred preflight,
  FFmpeg mixing, and interactive controls.
- **Tests run:** `npm test` passed 34 files and 234 tests; `npm run build` and
  `git diff --check` passed.
- **Skipped tests:** Windows NSIS packaging was skipped because this core,
  schema, and transport change does not alter packaging and the current host is
  macOS. Manual UI/visual testing was skipped because EDT-05 adds no UI or
  rendered artifact; FFmpeg output verification belongs to the explicitly
  deferred RND-02 renderer.
- **Adversarial review:** A failure-oriented changed-file review scanned for
  stale legacy audio fields, invalid nullable bed pairs, non-finite/out-of-range
  gains and fades, discontinuous range/bed boundaries, threshold errors, stale
  CAS writes, incorrect asset kinds, and accidental published-row mutation.
  The targeted tests exercise those cases, a repository-wide scan found legacy
  fields only in migration fixtures/defaults, and no unresolved finding
  remained.
- **Residual risk:** The decision model is executable and fully covered, but no
  rendered media consumes it yet. RND-01 must snapshot and validate the typed
  decision, and RND-02 must prove FFmpeg gain/fade/loop behavior against media
  fixtures before users can rely on audible output.
- **Rollback note:** Revert the EDT-05 feature commit before deploying migration
  11. After migration, restore a pre-migration backup instead of down-migrating.
- **Next command:** Run `npx skillpacks install exec-loop` from the project
  shell before invoking `$exec` for RND-01 immutable-revision typed preflight.

- Completed EDT-04 with migration 10 independent caption cues/words, complete
  approved Inter Regular/Bold styles, persisted typed warnings and sidecar
  references, and official OFL-licensed Inter 4.1 resources included in
  Electron packaging.
- Added deterministic OpenType advance/line/glyph analysis for explicit line
  breaks, whitespace wrapping, safe areas, canvas overflow, missing glyphs,
  sub-500 ms cues, overlaps, and source-range containment.
- Added exact-CAS caption updates over service, HTTP, and MCP with one revision
  increment, approval clearing, successful-render staleness, non-published-only
  schedule flags, published-entry preservation, and transcript independence.
  Revision-owned LF-normalized UTF-8-without-BOM SRT/WebVTT sidecars remap
  disjoint Episode ranges to contiguous output time and are finalized in the
  same rollback boundary as the Short and artifact records.
- Added migration, schema, layout, timing, encoding, lifecycle, transport,
  missing-dependency, and artifact rollback coverage. Full verification passes
  33 test files and 222 tests plus production build/typecheck and diff hygiene.
  UI controls remain UI-01.3; burned-in composition/preflight remain
  RND-01/RND-02. Promoted EDT-05 as the sole current executable task.

### EDT-04 ship manifest

- **User goal:** Complete EDT-04 with deterministic editable caption data,
  layout and timing checks, revision-owned SRT/WebVTT sidecars, and public
  service/HTTP/MCP mutation parity.
- **Changed files:** `IMPLEMENTATION_PLAN.md`, `SPEC.md`, `package.json`,
  `package-lock.json`, `resources/fonts/Inter-Regular.otf`,
  `resources/fonts/Inter-Bold.otf`, `resources/fonts/OFL.txt`,
  `src/core/api.ts`, `src/core/artifact-store.ts`, `src/core/captions.ts`,
  `src/core/database.ts`, `src/core/repository.ts`, `src/core/service.ts`,
  `src/mcp/server.ts`, `src/shared/contracts.ts`,
  `tests/artifact-store.test.ts`, `tests/caption-service.test.ts`,
  `tests/captions.test.ts`, `tests/crop-service.test.ts`,
  `tests/domain-contracts.test.ts`, `tests/factories.ts`,
  `tests/migrations.test.ts`, `tests/persistence.test.ts`,
  `tests/repository.test.ts`, `tests/short-lifecycle.test.ts`,
  `tests/transcript-editing.test.ts`, `tasks/todo.md`, and
  `tasks/history.md`.
- **Per-file purpose:** `IMPLEMENTATION_PLAN.md` and `SPEC.md` record EDT-04
  completion and separate remaining audio/render/UI scope; `package.json` and
  `package-lock.json` add deterministic OpenType metrics and package the fonts;
  the three `resources/fonts/*` files provide approved Inter Regular/Bold
  runtime resources and their license; `src/core/captions.ts` implements
  layout, glyph, timing, overlap, source-range, and sidecar logic;
  `src/shared/contracts.ts` defines strict caption inputs, state, warnings, and
  results; `src/core/database.ts` migrates legacy caption state;
  `src/core/artifact-store.ts` atomically finalizes multi-file artifact batches;
  `src/core/repository.ts` persists exact-CAS caption changes and dependent
  invalidation; `src/core/service.ts` coordinates analysis, sidecars, and the
  Short mutation; `src/core/api.ts` and `src/mcp/server.ts` expose transport
  parity; `tests/captions.test.ts`, `tests/caption-service.test.ts`,
  `tests/artifact-store.test.ts`, and `tests/migrations.test.ts` cover the new
  behavior and rollback boundaries; `tests/factories.ts` centralizes valid
  caption fixtures; the six remaining changed test files migrate existing
  fixtures and assertions to the new contract; `tasks/todo.md` closes EDT-04
  and promotes EDT-05; and `tasks/history.md` records the work and evidence.
- **User-goal mapping:** The schema, engine, fonts, migration, artifact batch,
  repository/service mutation, and HTTP/MCP surfaces form the complete EDT-04
  path. Dedicated tests prove each contract and existing-suite fixture updates
  preserve compatibility with the new persisted shape.
- **Tests run:** Executable verification: `npm test` passed all 33 files and
  222 tests after the final review fix; `npm run build` passed application
  typecheck, Vite production build, and Node TypeScript compilation. Targeted
  executable verification: `npm test -- --run tests/captions.test.ts` passed
  all 8 caption-engine tests. Repository verification: `git diff --check`
  passed without warnings.
- **Skipped tests:** Interactive caption editing remains UI-01.3 because this
  change exposes core/HTTP/MCP behavior but does not add the editor controls.
  Burned-in caption composition and render preflight remain RND-01/RND-02.
  Packaged native Windows font loading remains part of the later WIN gate; the
  current environment verifies the same packaged font files through the
  platform-neutral engine and build configuration.
- **Adversarial review:** A failure-oriented review traced caption schema,
  migration, layout, source-time remapping, sidecar encoding, artifact/Short
  rollback, stale-write handling, and public interface parity. It found that an
  adjacent-pair overlap scan missed a later cue nested beneath one long-running
  cue, and that disabled captions unnecessarily loaded a font. The engine now
  tracks the latest-ending active cue, bypasses font loading when disabled, and
  has regression coverage for both cases. No blocking findings remain.
- **Residual risk:** Windows packaged-resource resolution and real rendered
  visual placement are not exercised on this macOS core-test boundary. A user
  would first notice either issue during packaged Windows caption editing or
  RND composition; UI-01.3, RND-01/RND-02, and the later WIN gate own those
  checks.
- **Rollback note:** Revert the EDT-04 feature commit before deploying
  migration 10. After a database has migrated, restore a pre-migration backup
  rather than attempting a down migration.
- **Next command:** `$exec` for EDT-05, deterministic source and bed audio
  decisions.

- Completed EDT-03 with migration 9 independent automatic/manual crop tracks,
  typed face/person/screen observations, explicit starter person/screen targets,
  deterministic legacy manual UUIDs, and Short-output-time timestamp bounds.
- Added deterministic source-range remapping, target selection, person/face
  unions, padding, aspect correction, clamping, temporal smoothing, linear
  interpolation, explicit fit/fill fallbacks, and exact manual-to-automatic
  precedence.
- Added strict CAS re-analysis and manual add/move/remove operations over HTTP
  and MCP. Each successful mutation increments once, clears approval, stales
  successful renders, flags only unpublished schedules, and preserves manual
  tracks bit-for-bit across repeated automatic analysis.
- Added crop engine, service, interface-parity, migration, and contract fixtures.
  Adversarial review found and fixed unencoded arbitrary layer IDs in MCP crop
  mutation paths; the transport regression now exercises a slash-containing ID.
- Full `npm test` passes all 31 files and 208 tests; `npm run build`,
  `git diff --check`, and the focused added-line credential scan pass without
  warnings. Interactive editing remains UI-01.3 and native packaged evidence
  remains WIN-03.4. Promoted EDT-04 as the sole current executable task.

- Completed EDT-02 with nullable composition asset bindings, migration-backed
  legacy normalization, immutable built-ins, immediate-parent template clones,
  exact CAS version/revision increments, and persisted-template Short creation
  with immutable lineage/composition snapshots.
- Added canonical source-in-place asset import with explicit reusable and
  trimmed provenance inputs, stable FFprobe inspection, complete still/video/
  audio metadata, requested codec support, and typed rejection of missing,
  empty, changing, malformed, streamless, unsupported, or dependency-blocked
  sources.
- Added strict HTTP/MCP template clone/update and asset list/import parity plus
  contract, migration, lineage, snapshot, asset-binding, codec, source-byte,
  validation, immutable-state, dependency, and conflict coverage.
- Adversarial review found and fixed a deferred-validation gap so invalid
  template asset bindings are rejected before persistence; the template
  revision remains unchanged after failure.
- Full `npm test` passes all 29 files and 197 tests; `npm run build`,
  `git diff --check`, and the focused added-line credential scan pass without
  warnings.
- Interactive template/asset workflow evidence remains assigned to UI-01.3 and
  packaged Windows evidence to WIN-03.4. Promoted EDT-03 as the sole current
  executable task.

## 2026-07-27

- Completed EDT-01 with guarded revision-1 Short creation, independent accepted
  transcript caption snapshots, strict integer-millisecond timeline contracts,
  bounded same-Episode ranges, atomic timeline and approval compare-and-swap
  operations, and typed HTTP/MCP parity.
- Classified composition, ranges, captions, audio, and accepted-transcript
  changes as render-affecting while title/content-package changes preserve
  approval, successful Render state, and schedule flags. Render-affecting
  changes stale successful Renders and mark only non-published schedule entries;
  published rows remain byte-for-byte unchanged.
- Added creation, range, lifecycle, invalidation, HTTP, and MCP fixtures in
  `tests/short-lifecycle.test.ts`; interactive editor and packaged Windows
  evidence remain assigned to UI-01.3 and WIN-03.
- Full `npm test` passes all 28 files and 188 tests; `npm run build`,
  `git diff --check`, and the focused added-line credential scan also pass.
- Promoted EDT-02 as the sole current executable task.

- Completed TRC-03 with durable Candidate generation runs, explicit
  replace-pending and append-pending strategies, retained reviewed decisions,
  accepted-copy preservation, conflict suppression, and superseded history for
  stale-write detection.
- Added immutable proposed and nullable accepted Candidate content packages,
  optimistic Candidate review/copy revisions, compatible legacy migration,
  explicit proposed/accepted Short copy lineage, and HTTP/MCP parity. Full
  `npm test` (27 files, 178 tests), `npm run build`, and `git diff --check`
  pass without warnings.

### TRC-03 ship manifest

- **User goal:** Preserve reviewed Candidate decisions and accepted user copy
  across explicit append/replace regeneration while keeping provider proposals
  separate and concurrency-safe.
- **Changed files:**
  `IMPLEMENTATION_PLAN.md`, `SPEC.md`, `src/core/api.ts`,
  `src/core/candidates.ts`, `src/core/database.ts`,
  `src/core/repository.ts`, `src/core/service.ts`, `src/mcp/server.ts`,
  `src/shared/contracts.ts`, `tests/candidate-integration.test.ts`,
  `tests/candidates.test.ts`, `tests/domain-contracts.test.ts`,
  `tests/factories.ts`, `tests/migrations.test.ts`,
  `tests/persistence.test.ts`, `tests/repository.test.ts`,
  `tests/transcript-editing.test.ts`, `tasks/todo.md`, and
  `tasks/history.md`.
- **Per-file purpose:**
  `IMPLEMENTATION_PLAN.md` records TRC-03 completion evidence;
  `SPEC.md` reconciles the implementation matrix and changelog;
  `src/core/api.ts` adds revisioned Candidate review/copy endpoints;
  `src/core/candidates.ts` exposes shared conflict detection and revisioned
  proposal defaults; `src/core/database.ts` adds migration 7 and legacy
  backfill; `src/core/repository.ts` implements atomic generation strategies,
  lineage, copy acceptance, and Short copy metadata;
  `src/core/service.ts` binds generation, review, copy, and Short creation;
  `src/mcp/server.ts` adds typed MCP parity; `src/shared/contracts.ts` defines
  strategies, runs, revisions, content packages, and copy lineage;
  `tests/candidate-integration.test.ts` covers end-to-end preservation,
  conflicts, rollback, and public interfaces; `tests/candidates.test.ts`
  updates deterministic comparison for revision timestamps;
  `tests/domain-contracts.test.ts` verifies the new public schemas;
  `tests/factories.ts` supplies revisioned Candidate fixtures;
  `tests/migrations.test.ts` proves legacy upgrade behavior;
  `tests/persistence.test.ts`, `tests/repository.test.ts`, and
  `tests/transcript-editing.test.ts` update persisted Short fixtures;
  `tasks/todo.md` closes TRC-03 and promotes EDT-01; and
  `tasks/history.md` records the session and this manifest.
- **User-goal mapping:** Atomic append/replace persistence and conflict
  suppression preserve reviewed rows; accepted projections preserve user copy;
  Candidate revisions reject stale operations; generation-run and copy-source
  metadata keep provider output auditable and distinct from accepted edits.
- **Tests run:** Executable verification: `npm test` passed all 27 files and
  178 tests; `npm run build` passed application typecheck, Vite production
  build, and Node TypeScript compilation. Repository verification:
  `git diff --check` passed. A targeted added-line credential/signature scan
  found no secret-like additions.
- **Skipped tests:** Interactive macOS Candidate UI validation and packaged
  native Windows validation remain assigned to UI-01.2 and WIN-03.3 because
  this repository boundary has no completed Candidate UI workflow or packaged
  Windows runtime in the current environment.
- **Adversarial review:** Reviewed the exact source/migration/API/MCP diff for
  transaction rollback, legacy acceptance preservation, append/replace
  conflicts, accepted-copy retention, superseded/stale writes, provider
  switching, proposal immutability, and public schema parity. No blocking
  findings remained; dedicated fixtures exercise each high-risk boundary.
- **Residual risk:** Native SQLite migration and interactive conflict recovery
  still need packaged Windows/UI evidence at their assigned gates. The
  deterministic automated suite covers the platform-neutral persistence and
  interface behavior.
- **Rollback note:** Revert the TRC-03 feature commit before deploying migration
  7. After a database has migrated, restore a pre-migration backup rather than
  attempting a down migration.
- **Next command:** `$exec` for EDT-01, the Short timeline and approval
  lifecycle.

- Completed TRC-02 with versioned deterministic Candidate generation, explicit
  heuristic or selected-analysis modes, accepted-transcript revision binding,
  provider/artifact provenance, complete aligned 20–90 second enumeration,
  quality floors, stable ranking and duplicate groups, and explicit
  insufficient-material diagnostics through service, HTTP, and MCP.
- Added a separate-label anonymized `candidate-corpus-v1` and enforced the
  approved `balanced-beta-v1` gate. Recorded 100% validity, highlight recall,
  generated precision, and pairwise ranking accuracy against thresholds of
  100%, 80%, 60%, and 75%, respectively.
- Added deterministic repeat/tie/boundary/alignment tests, analysis visual-score
  ranking, stale/mismatched/malformed artifact rejection without fallback,
  actual revision/provenance binding, persistence ordering, and HTTP/MCP
  diagnostics. Full `npm test` (27 files, 171 tests), `npm run build`, and
  `git diff --check` pass.
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
