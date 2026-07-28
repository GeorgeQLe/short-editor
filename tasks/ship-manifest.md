# Ship manifest

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
