# Ship manifest

## SCH-01 shipping boundary — 2026-07-28

### User goal

Persist canonical revisioned schedule rules and implement deterministic,
machine-timezone-independent DST resolution with a documented warning policy
through the core, HTTP, and typed MCP boundaries.

### Changed files

`IMPLEMENTATION_PLAN.md`, `SPEC.md`, `src/core/api.ts`,
`src/core/database.ts`, `src/core/repository.ts`, `src/core/scheduler.ts`,
`src/core/service.ts`, `src/mcp/server.ts`, `src/shared/contracts.ts`,
`tasks/history.md`, `tasks/ship-manifest.md`, `tasks/todo.md`,
`tests/domain-contracts.test.ts`, `tests/migrations.test.ts`,
`tests/persistence.test.ts`, `tests/schedule-rules.test.ts`, and
`tests/scheduler.test.ts`.

Generated `.agents/skillpacks/`, `.claude/`, and `.codex/` local artifacts are
unrelated and excluded. No path under `.claude/skills/` or
`.codex/skills/` is tracked. `.agents/project.json` remains tracked and
unchanged. There are no earlier unpushed commits or unrelated tracked changes
in the boundary.

### Per-file purpose

- `src/shared/contracts.ts` defines strict schedule-rule updates, schedulable
  Shorts, draft results, the v1 DST policy, warnings, canonical-value
  constraints, and timezone-database diagnostics.
- `src/core/database.ts` adds migration 16 and preserves legacy rule snapshots
  with explicit `unknown` timezone-database provenance.
- `src/core/repository.ts` reads, creates, and exactly replaces complete
  revisioned snapshots including timezone-database provenance.
- `src/core/scheduler.ts` resolves explicit-zone wall times, implements exact
  gap shifting and earlier-overlap selection, emits selected-slot warnings,
  and returns rule/resolver provenance with deterministic drafts.
- `src/core/service.ts` canonicalizes full snapshots, coordinates first-create
  and CAS updates, requires the persisted rule revision for drafting, validates
  current approved deterministic Renders, binds each Short to its persisted
  owning Episode, and inserts the draft atomically.
- `src/core/api.ts` and `src/mcp/server.ts` expose strict matching rule read,
  update, and persisted-revision draft operations.
- `tests/scheduler.test.ts` covers gaps, overlaps, non-hour transitions,
  historical/future offsets, host-zone independence, warning selection,
  cadence, blackouts, occupation, and Episode spacing.
- `tests/schedule-rules.test.ts` covers creation, canonicalization, CAS,
  invalid snapshots, persisted-revision drafting, Short/Episode ownership, and
  HTTP/MCP parity. The migration, persistence, and domain-contract suites cover
  migration 16 and the expanded strict entity surface.
- `SPEC.md` and `IMPLEMENTATION_PLAN.md` document the implemented DST and
  revision policy and distinguish SCH-02/UI work. `tasks/todo.md` closes
  SCH-01 and promotes SCH-02; `tasks/history.md` records the completed behavior
  and evidence; this manifest records the exact shipping boundary.

### User-goal mapping

The shared schemas, migration, repository, and service form one durable
full-snapshot rule lifecycle with canonical storage and exact revisions. The
resolver and scheduler preserve configured wall-clock intent using an explicit
versioned anomaly policy and expose enough provenance to diagnose runtime
timezone-data differences. HTTP and MCP use the same strict contracts and core
logic. The executable suites exercise every promised persistence, resolution,
transport, and rollback boundary.

### Tests run

- Executable verification: `npm test` passed all 37 test files and 269 tests,
  including real FFmpeg coverage and the new DST/rule/ownership regressions.
- Executable verification: `npm run build` passed application typecheck, Vite
  production build, and Node TypeScript compilation without warnings.
- Repository verification: `git diff --check` passed.
- Security verification: a focused changed-file scan found no private-key,
  credential, token, password, secret, or API-key material.

### Skipped tests

- Native Windows NSIS packaging and Windows timezone-database behavior were
  skipped because the current host is macOS; WIN-03.7 owns the packaged
  calendar acceptance gate.
- Interactive stale-save, spring/fall warning, calendar, and recovery checks
  were skipped because this boundary adds core/HTTP/MCP behavior rather than
  the calendar UI; UI-01.5 owns that acceptance.
- No lint script exists in `package.json`; the full suite, typecheck,
  production build, diff hygiene, and focused security scan are the available
  automated gates.

### Adversarial review

A failure-oriented changed-file review served as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It traced invalid/canonical snapshots, missing and stale revisions,
concurrent first writes, migration preservation, host timezone leakage,
ordinary/gap/overlap resolution, non-one-hour transitions, warning selection,
occupied slots, transaction rollback, approved/current/deterministic Render
eligibility, caller-controlled identity fields, and HTTP/MCP parity.

The review found that an otherwise valid Short/Render could be paired with a
caller-supplied unrelated Episode ID, bypassing same-Episode spacing and
persisting inconsistent ownership. The service now requires the requested
Episode to match the persisted Short, and a regression test proves rejection
leaves the schedule unchanged. No blocking finding remains.

### Residual risk

Runtime `Intl` behavior is covered for ordinary, gap, overlap, non-hour,
historical, future, and host-zone-independent cases on the current Node/macOS
stack, but packaged Windows may ship different timezone data. The stored
write-time and resolver versions make such differences diagnosable; WIN-03.7
must repeat the fixtures on the release build. Move, lock, publication URL,
rerender, and interactive calendar semantics remain explicitly assigned to
SCH-02 and UI-01.5.

### Rollback note

Revert the SCH-01 feature commit before deploying migration 16. After a
database has migrated, restore a pre-migration backup before running older
application code because older code does not write or understand the
timezone-database diagnostic column.

### Next command

Run `npx skillpacks install exec-loop` from the project shell before invoking
`$exec` for SCH-02 draft, move, lock, and publication semantics.

## RND-04 shipping boundary — 2026-07-28

### User goal

Add safe Render cancellation, immutable bounded retry attempts, and
pair-consistent crash recovery without adopting newer Short edits or leaking
unsafe filesystem diagnostics.

### Changed files

`IMPLEMENTATION_PLAN.md`, `SPEC.md`, `src/core/api.ts`,
`src/core/artifact-store.ts`, `src/core/bootstrap.ts`,
`src/core/database.ts`, `src/core/jobs.ts`, `src/core/render.ts`,
`src/core/repository.ts`, `src/core/service.ts`, `src/mcp/server.ts`,
`src/shared/contracts.ts`, `tasks/history.md`, `tasks/ship-manifest.md`,
`tasks/todo.md`, `tests/artifact-store.test.ts`,
`tests/domain-contracts.test.ts`, `tests/migrations.test.ts`,
`tests/render.test.ts`, `tests/repository.test.ts`, and
`tests/transcript-editing.test.ts`.

Generated `.agents/skillpacks/`, `.claude/`, and `.codex/` local artifacts are
unrelated and excluded. No path under `.claude/skills/` or `.codex/skills/` is
tracked. `.agents/project.json` remains tracked and unchanged. There are no
earlier unpushed commits or unrelated tracked changes in the boundary.

### Per-file purpose

- `src/shared/contracts.ts` exposes immutable Render lineage, predecessor, and
  attempt values through the strict public entity contract.
- `src/core/database.ts` adds migration 15 lineage storage, indexes, and
  insert/update integrity triggers while upgrading every legacy Render to a
  one-attempt self-rooted lineage.
- `src/core/repository.ts` creates snapshot-bound retries in immediate
  transactions, caps each lineage at three attempts, guards completion against
  late cancellation, reconciles Render/Job pairs, and identifies invalid
  completed-artifact state.
- `src/core/jobs.ts` atomically cancels queued Render/Job pairs, retains a
  durable cancellation request for running work, bounds automatic reclaim, and
  preserves a committed Render success across a late cancellation race.
- `src/core/render.ts` observes cancellation through dependency checks, input
  hashing, encoding, probing, normalization, artifact finalization, and
  completion; it escalates subprocess termination after two seconds and
  removes interrupted attempt output.
- `src/core/artifact-store.ts` makes streaming hashes cancellation-aware,
  redacts disk/finalization failures, and removes artifact records/files left
  by an interrupted Render.
- `src/core/bootstrap.ts` orders artifact reconciliation, Render validation,
  pair recovery, and interrupted-output cleanup at startup.
- `src/core/service.ts`, `src/core/api.ts`, and `src/mcp/server.ts` expose the
  same manual retry behavior through core, HTTP, and typed MCP boundaries.
- `tests/artifact-store.test.ts`, `tests/migrations.test.ts`,
  `tests/repository.test.ts`, and `tests/render.test.ts` cover redaction,
  upgrades, lineage/retry constraints, pair recovery, cooperative
  cancellation, cleanup, and the real-media path. The remaining test files
  update strict Render fixtures and contract assertions.
- `SPEC.md` and `IMPLEMENTATION_PLAN.md` record the implemented recovery
  boundary and deferred native gates. `tasks/todo.md` closes RND-04 and promotes
  SCH-01; `tasks/history.md` records behavior and evidence; this manifest
  records the exact ship and rollback boundary.

### User-goal mapping

Migration and public contracts make every attempt durably distinguishable.
Repository transactions retain the exact failed/cancelled attempt snapshot and
serialize bounded retries. Job, renderer, and artifact-store changes carry one
durable cancellation signal through all long-running stages and prevent a
cancelled attempt from retaining output. Startup reconciliation restores a
consistent Render/Job pair, preserves committed success, makes interrupted
unsafe work manually recoverable, and removes its artifacts. Focused and
real-media tests exercise each layer through the public and persistence
boundaries.

### Tests run

- Executable verification: `npm test` passed all 36 files and 258 tests,
  including the real FFmpeg render/retry/cancellation path.
- Executable verification: `npm run build` passed application typecheck, Vite
  production build, and Node TypeScript compilation without warnings.
- Repository verification: `git diff --check` passed.
- Security verification: a focused added-line scan found no private-key,
  credential, token, password, secret, or API-key signatures.

### Skipped tests

- Native Windows NSIS packaging and packaged FFmpeg/FFprobe forced-termination
  behavior were skipped because the current host is macOS; WIN-03.6/.9 own
  those release gates.
- A real operating-system crash at every filesystem/database boundary was not
  injected. Repository/startup tests simulate the durable states, and
  real-media tests prove cleanup during controlled cancellation, but native
  packaged fault injection remains a release-gate risk.
- Human UI retry/cancellation history and audiovisual inspection were skipped
  because this boundary adds core/HTTP/MCP behavior rather than the editor
  workflow; UI-01.4 owns that acceptance.
- No lint script exists in `package.json`; the full suite, typecheck,
  production build, diff hygiene, and focused security scan are the available
  automated gates.

### Adversarial review

A failure-oriented changed-file review served as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It traced malformed/legacy lineage, concurrent retries, stale or
unapproved revisions, superseded and exhausted attempts, invalid persisted job
snapshots, queued and running cancellation races, cancellation after artifact
finalization, committed-success recovery, orphan/mismatched Render/Job pairs,
bounded non-Render reclaim, disk exhaustion, path/error redaction, subprocess
termination, and HTTP/MCP parity. Strict schemas, SQLite immediate
transactions/triggers, guarded state transitions, cleanup paths, migration
coverage, and real-media assertions cover the reviewed boundary. No blocking
finding remains.

### Residual risk

The executable evidence covers the macOS process and SQLite behavior, but not
the packaged Windows signal semantics or abrupt native process death between
every individual fsync/rename/transaction step. Those failures should first be
visible as a terminal recovery-required attempt with its own output removed;
WIN-03.6/.9 must close the native packaged gates. The three-attempt retry
surface is available through HTTP/MCP, but the human attempt-history and
recovery experience remains UI-01.4.

### Rollback note

Revert the RND-04 feature commit before deploying migration 15. After migration
15 has run, restore a pre-migration backup instead of down-migrating because
older code does not understand the required lineage columns. Each interrupted
or cancelled attempt owns only its own artifact records and files.

### Next command

Run `npx skillpacks install exec-loop` from the project shell before invoking
`$exec` for SCH-01 revisioned schedule rules and documented DST policy.

## RND-03 shipping boundary — 2026-07-28

### User goal

Gate Render success on persisted normalized frame/audio determinism evidence,
using the first equivalent successful attempt as an immutable baseline.

### Changed files

`IMPLEMENTATION_PLAN.md`, `SPEC.md`, `src/core/database.ts`,
`src/core/render.ts`, `src/core/repository.ts`, `src/core/service.ts`,
`src/shared/contracts.ts`, `src/shared/job-messages.ts`, `tasks/history.md`,
`tasks/ship-manifest.md`, `tasks/todo.md`, `tests/domain-contracts.test.ts`,
`tests/job-messages.test.ts`, `tests/migrations.test.ts`,
`tests/render.test.ts`, and `tests/transcript-editing.test.ts`.

Generated `.agents/skillpacks/`, `.claude/`, and `.codex/` local artifacts are
unrelated and excluded.

### Per-file purpose

- `src/shared/contracts.ts` defines strict versioned normalized evidence and
  adds it to the Render entity; `src/shared/job-messages.ts` adds the same typed
  boundary to Render job results.
- `src/core/database.ts` adds migration 14 evidence storage, lookup indexing,
  and safe demotion of legacy successes that lack evidence.
- `src/core/render.ts` stream-hashes canonical decoded video/audio, binds the
  completed FFmpeg/graph provenance into identity, and removes mismatch output.
- `src/core/repository.ts` persists and validates evidence and serializes
  baseline/match/mismatch completion in an immediate transaction.
- `src/core/service.ts` permits scheduling only from a current approved Render
  with `baseline` or `matched` evidence.
- `tests/domain-contracts.test.ts` and `tests/job-messages.test.ts` prove strict
  public evidence schemas; `tests/migrations.test.ts` proves migration 14 and
  every prior upgrade path.
- `tests/render.test.ts` proves identity changes, normalization redaction, real
  repeated rendering, metadata independence, separate pixel/audio mismatch
  detection, cleanup, and prior-output immutability.
- `tests/transcript-editing.test.ts` updates the existing strict Render fixture
  for the new nullable evidence field.
- `SPEC.md` and `IMPLEMENTATION_PLAN.md` record the completed RND-03 contract
  and retain RND-04/WIN-03.6/UI-01.4 as explicit later work.
- `tasks/todo.md` promotes RND-04; `tasks/history.md` records implementation and
  executable evidence; this manifest records the exact shipping boundary.

### User-goal mapping

The shared contracts and migration make evidence durable and inspectable. The
renderer produces canonical stream evidence with the captured executable, while
the repository transaction establishes one immutable equivalent-attempt
baseline and rejects divergent output. Scheduling enforcement prevents a
validation-only or mismatched Render from becoming downstream publish input.
Contract, migration, and real-media tests exercise each layer of that path.

### Tests run

- Executable verification: `npm test` passed all 36 files and 256 tests,
  including the real FFmpeg baseline, repeat-match, and mismatch-cleanup path.
- Executable verification: `npm run build` passed TypeScript typecheck, Vite
  production build, and Node TypeScript compilation without warnings.
- Repository verification: `git diff --check` passed.
- Security verification: a focused added-line scan found no private-key,
  credential, token, password, or API-key signatures.

### Skipped tests

- Native Windows NSIS packaging and packaged release-FFmpeg/font behavior were
  skipped because the current host is macOS; WIN-03.6 owns that release gate.
- Human visual/audio inspection and interactive attempt history were skipped
  because this change is the core determinism gate; UI-01.4 owns the workflow
  and visible/audible acceptance.
- Crash recovery and retry-lineage fault injection were skipped because RND-04
  is the promoted task that owns those state transitions.
- No lint script exists in `package.json`; typecheck, the full Vitest suite,
  production build, diff hygiene, and focused security scan are the available
  executable gates.

### Adversarial review

A failure-oriented changed-file review served as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It traced malformed evidence, migration compatibility, concurrent
baseline selection, stale revisions, mismatching video or audio, cancellation
between finalization and completion, sidecar/output/artifact rollback,
normalization byte bounds and error redaction, scheduling eligibility, and
unchanged prior successes. The implementation already covers these paths with
strict parsing, an immediate completion transaction, bounded no-shell FFmpeg
decoding, guarded state transitions, and real-media cleanup assertions. No
blocking finding remains.

### Residual risk

The real-media fixture proves the macOS FFmpeg path and exact-build identity,
but does not prove the packaged Windows binary or human audiovisual quality;
WIN-03.6 and UI-01.4 own those checks. A process crash after media finalization
but before database completion may require startup reconciliation, and attempt
retry lineage is not yet user-facing; RND-04 is the concrete next task.

### Rollback note

Revert the RND-03 commit before deploying migration 14. After migration 14 has
run, restore a pre-migration backup rather than attempting a down migration.
Legacy output paths are retained by the migration, and failed new attempts
remove only their own artifact files and records.

### Next command

Run `npx skillpacks install exec-loop` from the project shell before invoking
`$exec` for RND-04 cancellation, retries, and crash recovery.

## RND-02 shipping boundary — 2026-07-28

### User goal

Compose one immutable approved Short revision from original sources with an
explicit FFmpeg graph, validate and atomically finalize its MP4 and optional
caption sidecar, and expose a strict snapshot-bound render-start contract.

### Changed files

`IMPLEMENTATION_PLAN.md`, `SPEC.md`, `src/core/api.ts`,
`src/core/artifact-store.ts`, `src/core/bootstrap.ts`, `src/core/database.ts`,
`src/core/render-composition.ts`, `src/core/render-preflight.ts`,
`src/core/render.ts`, `src/core/repository.ts`, `src/core/service.ts`,
`src/mcp/server.ts`, `src/shared/contracts.ts`,
`src/shared/job-messages.ts`, `tasks/history.md`,
`tasks/ship-manifest.md`, `tasks/todo.md`,
`tests/domain-contracts.test.ts`, `tests/job-messages.test.ts`,
`tests/render.test.ts`, and `tests/transcript-editing.test.ts`.

Generated `.agents/skillpacks/`, `.claude/`, and `.codex/` local artifacts are
unrelated and excluded from the commit. No path under `.claude/skills/` or
`.codex/skills/` is tracked. `.agents/project.json` remains tracked and
unchanged. There are no earlier unpushed commits or unrelated tracked changes
in the shipping boundary.

### Per-file purpose

- `src/core/render-composition.ts` builds the deterministic explicit filter
  script and direct FFmpeg argument vector for ordered source ranges, template
  layers, fit/fill, independent crops, captions, source audio, bed audio, and
  fixed H.264/AAC output settings.
- `src/core/render.ts` executes FFmpeg without a shell, reports progress,
  validates captured inputs and dependency versions before and after encoding,
  ffprobes output, redacts process errors, and coordinates cancellation, stale
  revisions, artifact cleanup, and successful completion.
- `src/core/artifact-store.ts` adds exclusive external-producer reservations,
  streaming hashes, validation, fsync/rename finalization, and rollback of
  finalized artifacts.
- `src/core/database.ts` adds migration 13 bindings from Render attempts to
  immutable preflights plus optional sidecar paths.
- `src/core/repository.ts` atomically creates matching Render/job rows and
  guards Render state transitions and final current-revision approval.
- `src/core/render-preflight.ts` persists and validates the complete typed
  render snapshot needed by the renderer.
- `src/core/bootstrap.ts` installs the render job handler.
- `src/shared/contracts.ts` and `src/shared/job-messages.ts` define strict
  Render, start request/result, sidecar, and job payload shapes.
- `src/core/service.ts`, `src/core/api.ts`, and `src/mcp/server.ts` expose the
  same preflight-bound start operation through core, HTTP, and MCP.
- `tests/render.test.ts` covers strict starts, all starter-template graphs,
  deterministic special/spaced-path arguments, a real composed MP4 and WebVTT
  sidecar, output validation/provenance, and unchanged source bytes. The three
  other test files update existing strict Render/job fixtures.
- `SPEC.md` and `IMPLEMENTATION_PLAN.md` record the implemented RND-02 boundary
  and defer determinism comparison, retry/recovery, UI acceptance, and native
  evidence to their owning tasks.
- `tasks/todo.md`, `tasks/history.md`, and `tasks/ship-manifest.md` close RND-02,
  preserve its evidence, and promote RND-03.

### User-goal mapping

The graph builder converts the immutable RND-01 snapshot into the required
original-source video/audio composition. The executor, external artifact
boundary, migration, and guarded repository lifecycle ensure only a current,
approved, ffprobe-valid result becomes successful. Shared contracts and
HTTP/MCP adapters require the exact passing preflight. The focused graph and
real-media tests prove the executable path, while project/task documentation
routes the intentionally deferred determinism and recovery scope.

### Tests run

- Executable verification: `npm test` passed all 36 test files and 251 tests,
  including `tests/render.test.ts` and its real FFmpeg composition.
- Executable verification: `npm run build` passed application typecheck, Vite
  production build, and Node TypeScript compilation.
- Repository verification: `git diff --check` passed without warnings.
- Security verification: the focused changed-path private-key/token signature
  scan found no secret-like content.

### Skipped tests

- Native Windows NSIS packaging and packaged FFmpeg/font behavior were skipped
  because the current host is macOS; WIN-03.6 owns that release evidence.
- UI progress, visible/audible composition review, and interactive cancellation
  were skipped because UI-01.4 owns the render workflow and Computer Use
  acceptance. The core boundary is instead covered by deterministic graph
  assertions and a real locally rendered H.264/AAC fixture.
- Disk-full fault injection, queued-cancel reconciliation, retry lineage, and
  crash recovery were not used as RND-02 success proof because RND-04 owns those
  advanced interruption/recovery guarantees. RND-02 verifies exclusive output,
  validation cleanup, stale-revision cleanup, and running-process cancellation
  boundaries in its implementation review.
- No lint command exists in `package.json`; TypeScript compilation, the full
  Vitest suite, production build, and diff hygiene are the available executable
  gates.

### Adversarial review

A failure-oriented changed-file review served as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It traced snapshot/job/Render binding, passing-preflight enforcement,
revision races before and after artifact finalization, input byte and dependency
changes, no-shell path handling, filter ordering, crop time bases, audio
concatenation and bed looping, stderr bounds/redaction, cancellation, ffprobe
validation, sidecar rollback, artifact-record/file consistency, migration
compatibility, and HTTP/MCP strictness.

Migration upgrades are covered from every prior schema version by
`tests/migrations.test.ts`, and the real-media test exercises migration 13
through a current database. No blocking finding remains.

### Residual risk

The macOS fixture proves a real one-second speaker render, captions when the
installed FFmpeg supports `drawtext`, source audio, sidecar finalization, and
unchanged original bytes. It does not replace native Windows packaging or
human visual/audio judgment across every media shape. Advanced queued
cancellation, retry attempts, crash recovery, and normalized repeated-render
comparison remain explicit RND-04, WIN-03.6, UI-01.4, and RND-03 work rather
than hidden assumptions in this boundary.

### Rollback note

Revert the RND-02 feature commit before deploying migration 13. After a database
has migrated, restore a pre-migration backup rather than attempting a down
migration. Generated Render artifacts can be discarded with their artifact
records; original source files are never modified.

### Next command

Run `npx skillpacks install exec-loop` from the project shell before invoking
`$exec` for RND-03 normalized determinism evidence.

## RND-01 shipping boundary — 2026-07-28

### User goal

Add an insert-only render preflight that validates one exact approved Short
revision, persists its complete render-decision snapshot, returns typed
actionable findings, and creates no Render, job, or output artifact.

### Changed files

`IMPLEMENTATION_PLAN.md`, `README.md`, `SPEC.md`, `src/core/api.ts`,
`src/core/database.ts`, `src/core/render-preflight.ts`,
`src/core/repository.ts`, `src/core/service.ts`, `src/mcp/server.ts`,
`src/shared/contracts.ts`, `tasks/history.md`, `tasks/ship-manifest.md`,
`tasks/todo.md`, `tests/migrations.test.ts`, and
`tests/render-preflight.test.ts`.

### Per-file purpose

- `src/shared/contracts.ts` defines strict request, result, dependency, category,
  code, severity, remediation, identifier-detail, and help-link contracts.
- `src/core/render-preflight.ts` implements the canonical snapshot, registry,
  stable dependency/resource probing, decision recomputation, safe findings,
  hashing, ordering, revision-bound workflow, and complete validation when one
  asset is reused across multiple bindings.
- `src/core/database.ts` adds migration 12 and database-enforced immutable
  `render_preflights`; `src/core/repository.ts` exposes insert/read-only access
  with an atomic final revision comparison.
- `src/core/service.ts`, `src/core/api.ts`, and `src/mcp/server.ts` expose
  identical strict HTTP/MCP values without internal paths, stderr, or snapshots.
- `tests/render-preflight.test.ts` and `tests/migrations.test.ts` cover contracts,
  hashes, ordering, dependency parsing, duration edges, Content ID help,
  repeatability, stale/concurrent revisions, immutability, redaction, shared
  asset bindings, prior-version upgrades, and no Render/job/artifact side
  effects.
- `README.md`, `SPEC.md`, `IMPLEMENTATION_PLAN.md`, `tasks/todo.md`,
  `tasks/history.md`, and `tasks/ship-manifest.md` record the implemented
  boundary, evidence, and promotion of RND-02.

### User-goal mapping

The contracts establish the public typed boundary; the preflight engine captures
and validates the exact immutable render decision; migration and repository
changes preserve an insert-only audit record with a final atomic revision check;
HTTP/MCP surfaces expose only the safe result; and focused tests prove
repeatability, redaction, immutability, concurrent-edit rejection, and the
no-output invariant.

### Tests run

- Executable verification: `npm test -- --run
  tests/render-preflight.test.ts` passed 10 tests after the adversarial-review
  regression was added.
- Executable verification: `npm test` passed 35 files and 245 tests.
- Executable verification: `npm run build` passed typecheck, Vite production
  build, and Node compilation.
- Repository verification: `git diff --check` and the added-line credential
  scan passed.

### Skipped tests

Native Windows NSIS packaging was skipped because RND-01 changes the
platform-neutral core/schema/transports and creates no packaged or final media.
Visual output inspection was skipped because RND-01 intentionally creates no
output; RND-02 owns the first FFmpeg output artifact and its media fixtures.

### Adversarial review

A failure-oriented changed-file review traced stale and concurrent revisions,
snapshot hash recomputation, database immutability, dependency independence,
resource changes during inspection, public redaction, finding determinism, and
multi-layer asset reuse. It found that the asset inspection map overwrote an
earlier binding when one asset ID appeared on multiple layers. The implementation
now validates every binding while probing each file once, with a focused
regression test. No unresolved finding remains.

### Residual risk

The immutable preflight is executable and tested, but it does not yet feed a
real FFmpeg graph. Cross-platform binary behavior and final audiovisual output
remain unproven until RND-02 and the later Windows gate.

### Rollback note

Revert the RND-01 feature commit before deploying migration 12. After a database
has migrated, restore a pre-migration backup rather than attempting a down
migration.

### Next command

Run `npx skillpacks install exec-loop` from the project shell before invoking
`$exec` for RND-02.

## EDT-03 shipping boundary — 2026-07-28

### User goal

Replace mixed crop keyframes with independent automatic and manual tracks,
deterministic bounded automatic framing, explicit resume markers, and exact-CAS
re-analysis/manual mutations across core, HTTP, and MCP.

### Changed files

- `IMPLEMENTATION_PLAN.md`
- `SPEC.md`
- `src/core/api.ts`
- `src/core/crops.ts`
- `src/core/database.ts`
- `src/core/repository.ts`
- `src/core/service.ts`
- `src/mcp/server.ts`
- `src/shared/contracts.ts`
- `src/shared/python-worker-protocol.ts`
- `src/shared/templates.ts`
- `tasks/history.md`
- `tasks/ship-manifest.md`
- `tasks/todo.md`
- `tests/crop-service.test.ts`
- `tests/crops.test.ts`
- `tests/domain-contracts.test.ts`
- `tests/migrations.test.ts`

Generated `.agents/skillpacks/`, `.claude/`, and `.codex/` local artifacts are
unrelated and excluded from the commit. No path under `.claude/skills/` or
`.codex/skills/` is tracked. `.agents/project.json` remains tracked and
unchanged. There are no earlier unpushed commits or unrelated tracked changes
in the shipping boundary.

### Per-file purpose

- `IMPLEMENTATION_PLAN.md` records EDT-03 implementation evidence and defers
  interactive/native acceptance to their owning milestones.
- `SPEC.md` updates the crop implementation matrix, v1 MCP inventory, and
  changelog.
- `src/core/api.ts` exposes revisioned crop re-analysis and manual control
  routes.
- `src/core/crops.ts` implements source-time remapping, detection selection,
  union/padding/aspect correction, smoothing, interpolation, fallback
  provenance, and manual precedence.
- `src/core/database.ts` adds migration 9 for independent automatic/manual
  tracks and deterministic legacy manual IDs.
- `src/core/repository.ts` validates crop timestamps and applies existing
  render/schedule invalidation transactionally.
- `src/core/service.ts` selects verified visual artifacts and implements exact
  CAS re-analysis plus add/move/remove mutations.
- `src/mcp/server.ts` adds four typed crop tools and safely URL-encodes
  arbitrary layer IDs.
- `src/shared/contracts.ts` defines detection, automatic track, provenance,
  fallback, manual control, layer, and mutation schemas.
- `src/shared/python-worker-protocol.ts` carries optional typed detection
  observations in visual-sampling results.
- `src/shared/templates.ts` gives each starter video layer an independent
  target and crop state.
- `tasks/history.md` records completed behavior, review, validation, and
  remaining acceptance work.
- `tasks/ship-manifest.md` records this exact shipping and rollback boundary.
- `tasks/todo.md` closes EDT-03 and promotes EDT-04 as the sole current task.
- `tests/crop-service.test.ts` covers stale writes, preservation, invalidation,
  invalid inputs, HTTP/MCP parity, and reserved-character layer IDs.
- `tests/crops.test.ts` covers bounds, aspect, fallback, smoothing,
  interpolation, range remapping, and manual precedence.
- `tests/domain-contracts.test.ts` updates strict public composition fixtures.
- `tests/migrations.test.ts` proves deterministic legacy track splitting.

### User-goal mapping

- Independent layer schemas, starter state, and migration 9 replace mixed
  source-tagged keyframes without discarding legacy automatic/manual data.
- The crop engine remaps Episode observations into contiguous Short time,
  selects person/screen/auto observations, and produces bounded aspect-correct
  frames with deterministic smoothing and interpolation.
- Explicit fit/fill fallback reasons and immutable artifact/version provenance
  make unavailable detection behavior auditable.
- UUID-addressed crop and automatic-resume controls remain separate per layer,
  resolve at exact timestamps, and survive automatic re-analysis byte-for-byte.
- Repository-backed exact CAS mutations increment the Short once, clear
  approval, stale succeeded renders, and flag only unpublished schedules.
- Strict HTTP and MCP operations expose equivalent success and typed failure
  behavior, including layer IDs that require URL encoding.

### Tests run

Executable verification against the final source boundary:

- `npm test`: all 31 test files and 208 tests passed.
- `npm run build`: application typecheck, Vite production build, and Node
  TypeScript compilation passed.
- `npx vitest run --config vitest.config.ts tests/crop-service.test.ts`: all 4
  focused service/HTTP/MCP tests passed after the path-encoding review fix.
- `git diff --check`: passed.
- A focused added-line credential/signature scan found no secret-like additions.

Documentation/task verification:

- `scripts/audit-task-docs.mjs` is absent, so the repository defines no
  task-document audit command.
- `tasks/todo.md` contains exactly one current executable item, EDT-04, and
  EDT-03 appears under completed work.

### Skipped tests

- No lint script or standalone check target exists in `package.json`; the full
  Vitest suite and production build cover the available executable gates.
- Interactive crop manipulation, undo, and visual inspection are deferred to
  UI-01.3 because EDT-03 adds the core/public mutation surface, not editor
  controls.
- Native packaged Windows crop and migration validation is deferred to
  WIN-03.4. This macOS host cannot close the Windows release gate.
- No visual inspection was relevant because this boundary changes no UI
  component or rendered visual asset.

### Adversarial review

A failure-oriented changed-file review was used as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It traced migration compatibility and deterministic IDs; malformed,
missing, stale, and reordered visual artifacts; output/source timestamp
boundaries; rectangle bounds and aspect math; missing dimensions/detections;
manual interpolation and exact resume; per-layer independence; duplicate IDs
and timestamps; CAS races and rollback; render/publishing invalidation; strict
schemas; and HTTP/MCP value/error parity.

The review found that MCP crop mutations embedded contract-valid arbitrary
layer IDs directly in URL paths. Reserved characters such as `/` could select
the wrong route. The paths now encode layer IDs, and the transport regression
uses `speaker/primary`. The first production typecheck exposed the generic MCP
callback value as `unknown`; the encoder boundary now converts the
schema-validated value explicitly. The final targeted test, full suite, and
production build pass without warnings. No blocking finding remains.

### Residual risk

- Automatic crop quality still depends on future visual providers populating
  the optional face/person/screen observations; explicit fallbacks cover absent
  capabilities but do not replace native quality evaluation.
- The editor must expose manipulation, undo, and visual recovery at UI-01.3.
- Native SQLite migration behavior, video sampling, and packaged crop workflows
  still require WIN-03.4 evidence on Windows.

### Rollback note

Revert the EDT-03 feature commit before deploying migration 9. After migration
9 has run, restore a pre-migration backup before using older application code.

### Next command

`$exec` for EDT-04, caption data, editing, layout checks, and sidecars.

## EDT-02 archive

## User goal

Complete EDT-02 across contracts, persistence, services, HTTP, and MCP:
revisioned template clones with materialized Short lineage plus complete,
source-preserving image/video/audio asset import.

## Changed files

- `IMPLEMENTATION_PLAN.md`
- `SPEC.md`
- `src/core/api.ts`
- `src/core/database.ts`
- `src/core/media.ts`
- `src/core/repository.ts`
- `src/core/service.ts`
- `src/mcp/server.ts`
- `src/shared/contracts.ts`
- `src/shared/templates.ts`
- `tasks/history.md`
- `tasks/ship-manifest.md`
- `tasks/todo.md`
- `tests/domain-contracts.test.ts`
- `tests/media.test.ts`
- `tests/migrations.test.ts`
- `tests/template-assets.test.ts`

Generated `.agents/skillpacks/`, `.claude/`, and `.codex/` local artifacts are
unrelated and excluded from the commit. No path under `.claude/skills/` or
`.codex/skills/` is tracked. `.agents/project.json` remains tracked and
unchanged. There are no earlier unpushed commits or unrelated tracked changes
in the shipping boundary.

## Per-file purpose

- `IMPLEMENTATION_PLAN.md` records EDT-02 implementation evidence and deferred
  interactive/native acceptance.
- `SPEC.md` marks the template and asset foundations implemented with their
  concrete source and test evidence.
- `src/core/api.ts` exposes strict template clone/update and asset import HTTP
  operations.
- `src/core/database.ts` adds migration 8 for nullable layer asset bindings and
  complete legacy Short template lineage.
- `src/core/media.ts` performs stable, canonical, codec-aware asset inspection.
- `src/core/repository.ts` adds typed asset lookup for composition validation.
- `src/core/service.ts` implements template cloning/updating, persisted-template
  Short snapshots, composition asset validation, and source-in-place import.
- `src/mcp/server.ts` adds MCP parity for template and asset mutations.
- `src/shared/contracts.ts` defines nullable layer asset bindings and strict
  template/asset mutation inputs.
- `src/shared/templates.ts` materializes nullable bindings in every starter
  layer.
- `tests/domain-contracts.test.ts` verifies strict public mutation contracts.
- `tests/media.test.ts` covers supported codecs, metadata, source preservation,
  unstable inputs, malformed media, and dependency failures.
- `tests/migrations.test.ts` proves legacy Template and Short normalization.
- `tests/template-assets.test.ts` covers clone lineage, CAS, immutable
  built-ins, snapshots, asset binding validation, and HTTP/MCP parity.
- `tasks/todo.md` closes EDT-02 and promotes EDT-03 as the sole current task.
- `tasks/history.md` records completed behavior, review, and validation.
- `tasks/ship-manifest.md` records this exact shipping and rollback boundary.

## User-goal mapping

- Nullable `assetId` layer bindings and migration 8 preserve and normalize
  existing Template and Short composition JSON. The migration also stores the
  selected template ID in legacy lineage JSON.
- Built-ins remain immutable. User clones start at version/revision 1, record
  their immediate parent, inherit or override descriptions, and deep-copy the
  source composition. User updates use CAS and increment version/revision once.
- Short creation loads any persisted template, validates bound assets, and
  stores exact selected-template lineage plus an independent composition
  snapshot.
- Asset import requires explicit reusable state and trimmed provenance,
  canonicalizes the source path, stably probes supported still/video/audio
  codecs, persists applicable dimensions/duration, and never copies or mutates
  source bytes.
- Strict HTTP and MCP clone/update/import operations share the public contracts
  and typed core error behavior.

## Tests run

Executable verification against the final source boundary:

- `npm test`: all 29 test files and 197 tests passed.
- `npm run build`: application typecheck, Vite production build, and Node
  TypeScript compilation passed.
- `git diff --check`: passed.
- A focused added-line credential/signature scan found no secret-like additions.

Documentation/task verification:

- `scripts/audit-task-docs.mjs` is absent, so the repository defines no
  task-document audit command.
- `tasks/todo.md` contains exactly one current executable item, EDT-03, and
  EDT-02 appears under completed work.

Focused EDT-02 coverage includes contract strictness, legacy JSON
normalization, path exclusivity, built-in immutability, clone-of-clone lineage,
deep-copy isolation, CAS conflicts, exact version/revision increments, prior
Short stability, bound asset existence/kind checks on both templates and
Shorts, PNG/JPEG/WebP, H.264, AAC/MP3/PCM, metadata persistence, reusable false,
whitespace provenance, missing/empty/changing/malformed/streamless/unsupported
media, dependency failure, source-byte preservation, and HTTP/MCP parity.

## Skipped tests

- No lint script or standalone check target exists in `package.json`; the full
  Vitest suite and production build cover the available executable gates.
- Interactive template cloning, asset selection, and recovery are deferred to
  UI-01.3 because this task adds no desktop editor workflow.
- Native packaged Windows validation is deferred to WIN-03.4. This macOS host
  cannot close the Windows release gate.
- No visual inspection was relevant because EDT-02 changes no UI component or
  rendered visual asset.

## Adversarial review

A failure-oriented changed-file review was used as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It traced migration compatibility and malformed JSON, built-in and
clone-of-clone lineage, stale revisions and exact increments, deep-copy
isolation, prior-Short stability, absent and mismatched assets, canonical-path
inspection, changing files, empty/malformed/streamless/unsupported media,
dependency failure, strict unknown-field rejection, HTTP error envelopes, MCP
parity, generated artifacts, and credential patterns.

The review found that template composition updates could persist missing or
mismatched asset bindings and fail only when a Short was later created.
`CoreService.updateTemplate` now validates composition assets before the
repository write, with regression coverage proving the invalid update leaves
the template revision unchanged. No blocking finding remains; all executable
checks pass without warnings.

## Residual risk

- The editor must expose missing/unsupported asset recovery and make immutable
  prior-Short snapshots visible during template updates.
- Native FFprobe/SQLite behavior, Windows path variants, and packaged runtime
  integration still require WIN-03.4 evidence.

## Rollback note

Revert the EDT-02 feature commit before deploying migration 8. Once a database
has migrated, restore a pre-migration backup before running older application
code.

## Next command

`$exec` for EDT-03, independent automatic and manual crop tracks.
