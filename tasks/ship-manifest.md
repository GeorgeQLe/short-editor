# Ship manifest — 2026-07-27

## User goal

Complete FND-03: enforce the application artifact store and reconcile data,
artifacts, and interrupted jobs at startup.

## Changed files and per-file purpose

- `src/core/artifact-path.ts` and `src/core/artifact-store.ts` enforce normalized
  contained paths and atomic temp/validate/fsync/rename finalization with SHA-256,
  byte counts, producer metadata, collision rejection, and quarantine.
- `src/core/startup.ts` implements the four native/legacy population cases,
  SQLite checkpoint and integrity checks, staged copy and hash verification,
  atomic promotion, timestamped legacy backup, and failed-staging quarantine.
- `src/core/bootstrap.ts`, `src/core/service.ts`, and `src/core/repository.ts`
  wire reconciliation before job execution, expose the store to core producers,
  constrain all owned paths, and apply safe per-job restart policies.
- `src/core/database.ts` adds schema migration 4 to normalize existing
  application-owned metadata below the `artifacts/` root.
- `tests/artifact-store.test.ts`, `tests/startup.test.ts`, and updated
  `tests/persistence.test.ts`, `tests/repository.test.ts`, and
  `tests/migrations.test.ts` exercise the boundary, schema upgrade, and crash
  cases.
- `README.md` documents runtime layout and legacy migration behavior.
- `SPEC.md` reconciles implementation evidence and deferred Windows gates.
- `tasks/todo.md` records FND-03 completion and promotes INV-01 as the sole
  executable current task.
- `tasks/history.md` records the completed artifact, startup, and job recovery
  work.
- `tasks/ship-manifest.md` records this exact shipping proof.

## User-goal mapping

The artifact-path, artifact-store, startup, database, repository, service, and
bootstrap changes implement the FND-03 runtime boundary. The tests prove the
supported executable behavior, while the README, SPEC, and task documents
reconcile the completed scope and route the next task. Generated local skill
roots are deliberately excluded from the commit.

## Tests run

- `npm test`: 13 test files and 64 tests passed.
- `npm run build`: TypeScript checks, Vite production build, and Node build
  passed.
- `git diff --check`: passed.

## Skipped tests

- No lint script or lint/check target exists in the repository command surfaces;
  TypeScript checking, the production build, and the full Vitest suite are the
  available executable gates.
- `npm run package:win` is deferred because this macOS host cannot establish the
  Windows-native SQLite, Local AppData, long-path, or installer acceptance
  evidence required by WIN-02/WIN-03.
- UI/visual validation is not relevant because this boundary changes core
  persistence and startup behavior without changing rendered UI.

## Adversarial review

The suites cover atomic visibility, collisions, validation failure cleanup,
path traversal, corrupt hash, missing file, temporary/orphan quarantine,
fresh/native/legacy/both-populated startup, verified legacy promotion, legacy
schema path upgrade, failed verification, stable artifact IDs, safe retry,
unsafe cloud/render terminal failure, and recovered cancellation.

The changed-file review additionally traced symbolic-link handling, database
checkpoint order, staging rollback, metadata/file commit ordering, collision
cleanup, and the exclusion of generated skill roots. No blocking finding
remains.

## Residual risk

- Windows Local AppData permissions, long-path behavior, packaged native SQLite,
  and restart behavior still require WIN-02/WIN-03 execution on Windows 11.
- FFmpeg/provider producers adopt the artifact-store service in their later
  workflow tasks; FND-03 deliberately adds no composition or provider logic.
- UI recovery presentation remains UI-03.
- Filesystem containment is checked immediately before writes, but—as with
  path-based synchronous filesystem APIs—a hostile process with direct write
  access to the same data directory could race path-component replacement.

## Rollback note

Revert the FND-03 commit. Databases opened by this boundary are schema version
4; an older binary requires the preserved pre-upgrade data backup rather than a
source-only rollback.

## Next command

`$exec INV-01`
