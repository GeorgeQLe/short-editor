# Ship manifest — 2026-07-27

## User goal

Complete TRC-01 by adding immutable accepted transcript revisions and safe
editing, then wrap up and ship the session.

## Changed files and per-file purpose

- `src/shared/contracts.ts` defines normalized transcript-update snapshots,
  nullable unavailable word/speaker data, nonempty text, timing/order
  validation, and the optimistic update input.
- `src/core/repository.ts` accepts a new transcript revision transactionally,
  keeps exact history, updates the accepted projection, and invalidates every
  dependent result without changing published schedules or raw transcript
  artifacts.
- `src/core/service.ts` exposes exact/current transcript reads and accepted
  updates, and returns persisted revisions from generated transcription.
- `src/core/api.ts` adds typed GET/PUT transcript operations with optional exact
  revision selection.
- `src/mcp/server.ts` adds typed transcript read/update tools and retains
  structured error details for optimistic conflicts.
- `tests/transcript-editing.test.ts` covers repository invariants, HTTP
  contracts, MCP parity, large snapshots, privacy, and dependent invalidation.
- `README.md` records accepted transcript editing in the current vertical slice.
- `SPEC.md` reconciles transcript and Short-invalidation implementation status.
- `IMPLEMENTATION_PLAN.md` records TRC-01 implementation evidence and preserves
  its interactive/native validation gates.
- `tasks/todo.md` completes TRC-01 and promotes TRC-02 as the sole current
  executable task.
- `tasks/history.md` records the implementation, review, and verification.
- `tasks/ship-manifest.md` records this exact shipping boundary and evidence.

Generated `.agents/skillpacks/`, `.claude/skills/`, and `.codex/skills/` local
artifacts are excluded from the commit. No path under `.claude/skills/` or
`.codex/skills/` is tracked. `.agents/project.json` remains tracked and
unchanged. There are no unrelated tracked changes or earlier unpushed commits
in the boundary.

## User-goal mapping

The shared snapshot schema and repository transaction make accepted transcripts
editable without mutating history or provider raw results. Repository
invalidation prevents analysis, approved Shorts, successful Renders, or
non-published schedules from silently continuing against stale transcript
content. Service, HTTP, and MCP layers expose the same current/exact read and
optimistic full-snapshot update behavior. The new tests prove validation,
privacy, history, conflict, invalidation, large-input, and adapter parity
requirements. Project and task documents close TRC-01 and route the next
milestone item.

## Tests run

Executable verification against the shipping source:

- `npm test`: all 25 test files and 160 tests passed. This includes 11 new
  transcript-editing tests plus all persistence, migration, provider, security,
  worker, media, reconciliation, scheduling, and regression suites.
- `npm run build`: TypeScript application checking, Vite production UI build,
  and Node-target TypeScript compilation passed.
- `git diff --check`: passed against the final pre-commit boundary after
  documentation reconciliation.
- A targeted credential-signature scan found no credential material in the
  shipping paths. The sole match is an intentional fake credential string in
  `tests/credential-vault.test.ts`.

Documentation/task verification:

- `scripts/audit-task-docs.mjs` is absent, so the repository defines no
  task-document audit command.
- `tasks/todo.md` has one current executable item, TRC-02, and TRC-01 appears
  once under completed work.

## Skipped tests

- No lint script or standalone check target exists in `package.json`, and there
  is no Makefile, Justfile, Python-project, Cargo validation surface, installed
  `quality-sweep`/`expert-review` command, or task-doc audit. The full Vitest
  suite, production build, failure-oriented review, credential scan, and diff
  checks are the available gates.
- `npm run package:win` is deferred because packaged Windows behavior is
  explicitly owned by WIN-02/WIN-03. This macOS host cannot prove native
  SQLite, process/IPC behavior, long-path handling, or frozen worker resources.
- Interactive text/timing/speaker edits and an actual two-client UI conflict
  were not exercised because the UI does not expose this workflow yet;
  deterministic repository/HTTP/MCP fixtures cover the executable core, while
  UI-01.2 and WIN-03.3 own interactive macOS/native Windows evidence.
- No visual check is relevant because this boundary changes no UI component or
  rendered visual asset.

## Adversarial review

An explicitly justified failure-oriented self-review was used as the quality
sweep equivalent because no standalone review command is installed and
multi-agent delegation was not authorized for this invocation. The review
traced stale and concurrent clients, exact-history mutability, first/generated
revision behavior, missing-source edits, empty and overlapping content, words
outside segments, duplicate segment IDs, timing beyond Episode duration,
nullable no-diarization data, provider raw-output preservation, accepted and
proposed analysis invalidation, Short approval/revision changes, succeeded
versus failed Render behavior, non-published versus published schedules, HTTP
error redaction, MCP error detail, 1,001-segment persistence, and generated
local artifact boundaries.

No correctness finding remained after review. The full executable suite and
build passed without warnings.

## Residual risk

- Accepted transcript replacement increments every dependent Short and
  non-published schedule revision, even when an edit is semantically
  equivalent. This deliberately favors safe invalidation; UI-01.2 should make
  that consequence visible before accepting an edit.
- Repository transactions serialize optimistic updates within the supported
  single Electron-owned SQLite topology. Unsupported multi-process direct
  database writers are outside the acceptance boundary.
- The HTTP/MCP snapshot path handles the required 1,001-segment fixture, but
  native packaged performance on unusually large transcripts remains part of
  WIN-03.3.
- Interactive editing, conflict presentation, and macOS/Windows evidence remain
  unproven until the UI task exposes the operation.

## Rollback note

Revert the TRC-01 commit. No schema migration is added by this boundary; existing
transcript revision rows remain compatible. Reverting removes accepted-edit
operations and their invalidation behavior but does not delete stored revision
history, raw provider artifacts, media, or user projects.

## Next command

`$exec TRC-02`
