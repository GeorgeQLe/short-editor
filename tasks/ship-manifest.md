# Ship manifest

## User goal

Complete EDT-01 across the repository, service, HTTP, and MCP layers with
revisioned Short creation, timeline editing, approval, and selective
invalidation, then wrap up and ship the session.

## Changed files

- `IMPLEMENTATION_PLAN.md`
- `SPEC.md`
- `src/core/api.ts`
- `src/core/repository.ts`
- `src/core/service.ts`
- `src/mcp/server.ts`
- `src/shared/contracts.ts`
- `tasks/history.md`
- `tasks/ship-manifest.md`
- `tasks/todo.md`
- `tests/candidate-integration.test.ts`
- `tests/repository.test.ts`
- `tests/short-lifecycle.test.ts`

Generated `.agents/skillpacks/`, `.claude/skills/`, and `.codex/skills/` local
artifacts are excluded from the commit. No path under `.claude/skills/` or
`.codex/skills/` is tracked. `.agents/project.json` remains tracked and
unchanged. There are no earlier unpushed commits or unrelated tracked changes
in the shipping boundary.

## Per-file purpose

- `src/shared/contracts.ts` defines strict timeline and approval mutation
  contracts.
- `src/core/repository.ts` implements atomic timeline and approval CAS,
  same-Episode range validation, approval clearing, and selective Render and
  schedule invalidation.
- `src/core/service.ts` enforces Short-creation prerequisites, seeds an
  independent accepted-transcript caption snapshot, and exposes timeline and
  approval operations.
- `src/core/api.ts` adds the strict timeline endpoint and applies the strict
  approval body contract.
- `src/mcp/server.ts` adds typed `shorts.update_timeline` and `shorts.approve`
  tools matching the HTTP surface.
- `tests/short-lifecycle.test.ts` covers creation prerequisites, range classes,
  lifecycle CAS, invalidation, HTTP error envelopes, and MCP parity.
- `tests/repository.test.ts` records that copy/title-only changes preserve
  successful Renders and schedule flags.
- `tests/candidate-integration.test.ts` gives the existing full lifecycle
  integration fixture an explicit timeout appropriate for the complete suite.
- `IMPLEMENTATION_PLAN.md` records EDT-01 implementation and deferred UI/native
  evidence.
- `SPEC.md` moves the revisioned Short lifecycle from partial to implemented
  with exact code and test evidence.
- `tasks/todo.md` completes EDT-01 and promotes EDT-02 as the sole executable
  current task.
- `tasks/history.md` records the EDT-01 behavior and final verification.
- `tasks/ship-manifest.md` records this exact commit boundary, quality evidence,
  residual risk, rollback, and continuation route.

## User-goal mapping

The contract, repository, service, HTTP, and MCP changes form the complete
EDT-01 executable path: revision-1 creation requires an active approved
Candidate, an available known-duration Episode, and an accepted transcript;
timeline and approval writes are atomic and revisioned exactly once; and
render-affecting changes clear approval, stale successful Renders, and flag
only non-published schedules. The test changes prove those behaviors and the
copy-only preservation rule. The implementation plan, specification, and task
records make the completed scope and deferred editor/native evidence explicit.

## Tests run

Executable verification against the final source boundary:

- `npm test`: all 28 test files and 188 tests passed.
- `npm run build`: TypeScript application checking, Vite production UI build,
  and Node-target TypeScript compilation passed with no warnings.
- `git diff --check`: passed.
- Focused tracked and untracked added-line credential-signature scans found no
  matches.

Documentation/task verification:

- `scripts/audit-task-docs.mjs` is absent, so the repository defines no
  task-document audit command.
- `tasks/todo.md` contains exactly one current executable item, EDT-02, and
  EDT-01 appears under completed work.

## Skipped tests

- No lint script or standalone check target exists in `package.json`, and
  there is no Makefile, Justfile, Python-project, Cargo, or repository-local
  task-doc audit surface. The full Vitest suite and production build cover the
  available executable gates.
- `npm run package:win` is deferred because native packaged behavior is owned
  by WIN-03. This macOS host cannot prove Windows SQLite loading, process/IPC
  behavior, long paths, or frozen worker resources.
- Interactive timeline editing and approval are deferred to UI-01.3 because the
  current change exposes core HTTP/MCP behavior but does not add that UI.
- No visual inspection is relevant because no UI component or rendered visual
  asset changed.

## Adversarial review

A failure-oriented changed-file review was used as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed and delegated review was not requested. It traced pending, rejected,
and superseded Candidates; missing sources; unknown durations; absent accepted
transcripts; proposed versus accepted copy; integer, empty, reversed,
unordered, overlapping, adjacent, gapped, and out-of-bounds ranges; stale
revision writes; duplicate approval; transaction rollback; exact revision
increments; approval clearing; successful Render staleness; published schedule
byte preservation; copy/title-only preservation; strict unknown-field
rejection; HTTP error envelopes; MCP parity; generated local artifacts; and
credential patterns.

No correctness finding remained after review. All executable checks passed
without warnings.

## Residual risk

- Interactive editor behavior is not yet implemented, so a user cannot prove
  EDT-01 through the desktop timeline UI until UI-01.3.
- Native Windows packaging was not exercised on this macOS host; WIN-03 owns
  packaged runtime proof.
- Caption snapshots include transcript segments fully contained by the initial
  Candidate range. The lifecycle test proves the intended bounded snapshot,
  but later timeline edits do not automatically regenerate captions; the
  editor must make that relationship visible.

## Rollback note

Revert the EDT-01 feature commit to restore the previous generic Short update
behavior and remove the new timeline/approval surfaces. No database migration
was introduced, so rollback requires no schema or data conversion.

## Next command

`$exec` for EDT-02, template clones, materialized lineage, and complete assets.
