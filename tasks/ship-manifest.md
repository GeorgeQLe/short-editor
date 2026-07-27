# Ship manifest — 2026-07-27

## User goal

Complete PRO-01 by defining and supervising the versioned Python worker
protocol, then wrap up the session and ship the result.

## Changed files and per-file purpose

- `src/shared/python-worker-protocol.ts` defines strict v1 NDJSON commands,
  events, operation inputs, typed results, provenance, runtime status,
  capabilities, dependency state, progress, cancellation, and framing limits.
- `src/shared/domain.ts` exports the worker protocol through the shared domain
  surface.
- `src/core/python-worker-supervisor.ts` launches development or packaged worker
  targets, validates every frame, bounds startup/heartbeat/job/cancellation/
  shutdown behavior, maps failures to typed errors, redacts stderr, and limits
  crash restarts.
- `resources/worker/worker.py` provides the SQLite-free development host and
  reports intentionally unavailable provider capabilities until PRO-02/03/05.
- `tests/fixtures/python-worker-fixture.mjs` supplies deterministic normal,
  malformed, partial, mismatched, oversized, hung, crashing, restart, and stderr
  behaviors.
- `tests/python-worker-protocol.test.ts` proves strict versioning, required
  fields, operation coverage, and rejection of credential-shaped inputs.
- `tests/python-worker-supervisor.test.ts` proves lifecycle, status, capability,
  progress, typed results, framing limits, timeouts, cancellation, restart
  bounds, missing-runtime mapping, SQLite isolation, and diagnostic redaction.
- `tests/python-worker-host.test.ts` starts the real development host, checks its
  degraded dependency state, exercises a typed unavailable result, and shuts it
  down.
- `package.json` includes worker resources in the Electron packaging boundary.
- `README.md` describes the supervised worker slice and clarifies that concrete
  providers remain future work.
- `IMPLEMENTATION_PLAN.md` records PRO-01 implementation evidence and preserves
  frozen-runtime and Windows acceptance work in WIN-02/WIN-03.
- `tasks/todo.md` marks PRO-01 complete and promotes PRO-02 as the sole current
  executable task.
- `tasks/history.md` records the completed protocol, supervisor, host, and fault
  fixtures.
- `tasks/ship-manifest.md` records this exact shipping proof.

Generated `.agents/skillpacks/`, `.claude/skills/`, and `.codex/skills/` local
artifacts are excluded from the commit. `.agents/project.json` is unchanged.

## User-goal mapping

The shared schemas define the compatibility and data-safety boundary. The
supervisor enforces that boundary across process lifecycle and failures. The
development host establishes the provider-independent runtime contract, while
the fixtures and three focused suites prove protocol, supervisor, and real-host
behavior. Packaging configuration, project documentation, and task records
reconcile the completed PRO-01 scope and route the first concrete provider.

## Tests run

- `npm test`: 17 test files and 91 tests passed, including 15 worker-specific
  protocol, supervisor, and development-host tests.
- `npm run build`: TypeScript application checking, Vite production build, and
  Node-target TypeScript build passed.
- `git diff --check`: passed.
- A targeted secret-signature scan over the shipping paths found no credential
  material. Credential-looking fixture text is deliberately synthetic and
  covered by redaction assertions.

## Skipped tests

- No lint script or lint/check target exists in `package.json`, and there is no
  Makefile, Justfile, Python, or Cargo validation surface. The full Vitest suite,
  TypeScript checks, production web build, and Node build are the available
  executable gates.
- `npm run package:win` is deferred because frozen/embedded worker assembly is
  explicitly owned by WIN-02 and this macOS host cannot provide Windows-native
  packaged startup/shutdown evidence.
- Interactive Electron validation is deferred to UI-03/WIN-03 because PRO-01
  does not yet connect provider controls to the UI; the real development-host
  lifecycle is exercised directly by `tests/python-worker-host.test.ts`.

## Adversarial review

An explicitly justified failure-oriented review was used as the quality-sweep
equivalent because no standalone `quality-sweep` or `expert-review` command is
installed. The review traced mismatched and partial startup frames; unexpected
response types and IDs; frame overflow before parse/storage; invalid result
kinds; missing runtime; job, heartbeat, cancellation, and shutdown deadlines;
crash-loop bounds; duplicate jobs; restart/stop races; credential-shaped
arguments/options; stderr disclosure; direct SQLite access; development versus
packaged launch paths; and task/document scope.

The focused worker suites and full regression suite exercise the applicable
failure paths. No blocking finding or warning remains.

## Residual risk

- The packaged launcher expects a frozen `short-editor-worker` executable while
  this slice ships the development Python host source. WIN-02 owns frozen
  runtime assembly and WIN-03 owns clean Windows startup/shutdown evidence, so
  packaged execution is not claimed by PRO-01.
- The placeholder host reports all provider operations unavailable by design.
  PRO-02/03/05 must add concrete adapters without weakening strict framing,
  typed provenance, credential isolation, or cancellation behavior.
- The stdio lifecycle is covered under Node and the local Python runtime on
  macOS. Windows process signaling, path handling, antivirus interaction, and
  installer resource placement remain acceptance risks until WIN-02/WIN-03.

## Rollback note

Revert the PRO-01 commit. This change adds no database migration and the
placeholder worker writes no application data, so rollback requires no data
restoration. Remove any separately assembled worker executable when reverting a
future packaged build.

## Next command

`$exec PRO-02`
