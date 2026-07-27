# Ship manifest — 2026-07-27

## User goal

Ship the current Short Editor session cleanly: complete FND-02 transactional
persistence and migrations, validate the exact boundary, update project
tracking, commit it, and push it to the primary branch.

## Changed files and per-file purpose

- `SPEC.md`: reconciles implementation evidence for migrations, complete entity
  persistence, revision guards, invalidation, and authorization metadata.
- `src/core/database.ts`: defines ordered transactional schema migrations,
  legacy-data upgrades, complete persistence tables, starter-template seeding,
  and migration failure reporting.
- `src/core/repository.ts`: persists and maps the complete domain fields,
  provides transaction and compare-and-swap operations, and enforces
  invalidation and forbidden-state rules.
- `src/core/service.ts`: writes the expanded Asset and Short fields through the
  complete repository contracts.
- `tests/migrations.test.ts`: verifies fresh and every-version upgrades,
  migration rollback, foreign keys, settings, and accepted-record retention.
- `tests/persistence.test.ts`: verifies large and complete round trips,
  provenance, revision conflicts, forbidden states, transaction rollback,
  artifact metadata, and scoped authorization records.
- `tasks/todo.md`: records FND-02 completion and promotes FND-03 as the sole
  executable current task.
- `tasks/history.md`: records the completed persistence, migration, and test
  work.
- `tasks/ship-manifest.md`: records this exact shipping proof.

## User-goal mapping

The database, repository, service, and test changes implement and prove FND-02.
The SPEC and task documents reconcile the completed boundary and route the next
artifact-store task. This manifest limits the commit to those goal-owned files;
untracked generated skill-pack roots remain local and uncommitted.

## Tests run

- `npm test`: all 11 test files and 46 tests passed, including the new migration
  and persistence suites.
- `npm run build`: TypeScript typechecking, the Vite production build, and the
  Node TypeScript build passed without warnings.
- `git diff --check`: passed.
- Targeted secret-pattern scan over the shipping boundary: no matches.

## Skipped tests

- No separate lint command exists in `package.json` or another project command
  surface; TypeScript checking and the full test/build commands provide the
  available executable verification.
- `npm run package:win` was not run because this macOS host cannot prove the
  Windows-native SQLite and installer acceptance gate.
- UI/visual validation is not relevant because this boundary changes
  persistence and service wiring without changing rendered UI.
- Production/provider integration is outside FND-02; the boundary persists only
  scoped authorization metadata and does not add a provider request workflow.

## Adversarial review

A failure-oriented changed-file review traced the exact diff through migration
atomicity, legacy upgrades, foreign keys, large transcript fixtures,
compare-and-swap conflicts, multi-row rollback, Short/render/schedule
invalidation, built-in template immutability, and authorization-secret
boundaries. The executable suites cover each of those risks and produced no
blocking findings. The review confirmed that generated `.claude/` and
`.codex/` skill roots are untracked and excluded from the commit.

## Residual risk

Native SQLite and packaging behavior remain unverified on Windows and are still
release-gate work. Artifact metadata rejects absolute paths, but root
containment, filesystem writes, startup reconciliation, and cleanup are
deliberately deferred to the active FND-03 task; until then, callers must not
treat a stored metadata row as proof that an artifact is present or contained.

## Rollback note

Revert the FND-02 session commit on `master`. For databases already upgraded to
schema version 3, restore a pre-upgrade database backup before running the
reverted application; source reversion alone does not downgrade SQLite data.

## Next command

`$exec FND-03`
