# Ship manifest

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
