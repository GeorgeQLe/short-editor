# Ship manifest — 2026-07-27

## User goal

Complete PRO-02 by implementing installed-model-only faster-whisper
transcription through the supervised local worker, then wrap up and ship the
session.

## Changed files and per-file purpose

- `resources/worker/requirements.txt` declares the independently installed
  faster-whisper worker dependency.
- `resources/worker/worker.py` discovers configured local models, reports
  dependency and capability status, performs English transcription without
  downloads or network clients, normalizes segments and optional words, emits
  progress and provenance, and honors cancellation.
- `src/core/local-transcription.ts` validates provider model identifiers, maps
  typed worker output into transcript segments, exposes model inventory, and
  rejects silence rather than inventing transcript content.
- `src/core/bootstrap.ts` installs the local transcription provider as the
  durable `analyze` job handler, polls durable cancellation, persists successful
  transcripts, and shuts the worker down with the job runner.
- `src/core/service.ts` validates transcription options, rejects missing source
  media, exposes local status, and stores accepted generated revisions with
  provider provenance in the Episode lifecycle transaction.
- `src/core/repository.ts` adds transactional transcript replacement with
  caller-supplied language and provenance while preserving manual replacement.
- `src/core/api.ts` adds model and word-timestamp inputs plus the local
  transcription status endpoint.
- `src/mcp/server.ts` exposes the same inputs and status operation over MCP.
- `src/core/python-worker-supervisor.ts` disables Python bytecode artifacts in
  development and preserves the worker event's retryability decision.
- `src/shared/errors.ts` permits a validated worker error to override the
  registry retryability default without changing existing callers.
- `tests/fixtures/python/faster_whisper.py` provides deterministic normal,
  silent, unsupported, slow, timed-word, and no-word provider behavior.
- `tests/fixtures/python/sitecustomize.py` denies socket connections during the
  real worker-host tests.
- `tests/python-worker-host.test.ts` exercises the real host's local-only model
  loading, capabilities, timing normalization, provenance, silence, unsupported
  input, cancellation, dependency failures, retryability, and SQLite/network
  isolation.
- `tests/local-transcription.test.ts` covers model-ID validation, result mapping,
  inventory, silence handling, and accepted provenance persistence.
- `README.md` documents dependency installation, explicit model download
  handoff, model inventory, and local-only runtime configuration.
- `SPEC.md` reconciles durable cancellation and the implemented transcription
  slice while retaining pending provider and Windows work.
- `IMPLEMENTATION_PLAN.md` records PRO-02 implementation evidence and leaves
  frozen worker and representative Windows validation to WIN-02/WIN-03.
- `tasks/todo.md` marks PRO-02 complete and promotes PRO-03 as the sole current
  executable task.
- `tasks/history.md` records the provider, core integration, fixtures, and the
  retryability review fix.
- `tasks/ship-manifest.md` records this exact shipping proof.

Generated `.agents/skillpacks/`, `.claude/skills/`, and `.codex/skills/` local
artifacts are excluded from the commit. `.agents/project.json` is unchanged.
There are no unrelated tracked changes or unpushed commits in the boundary.

## User-goal mapping

The Python host and dependency file implement the local faster-whisper runtime.
The provider, bootstrap, service, repository, HTTP, and MCP changes connect that
runtime to durable jobs and accepted transcript revisions without weakening the
worker protocol or local/cloud boundary. The deterministic fixtures and focused
tests prove the provider behavior, while the project and task documents
reconcile PRO-02 completion and route PRO-03.

## Tests run

Executable verification against the final code diff:

- `npm test`: 18 test files and 99 tests passed, including the real Python
  worker-host and local-transcription suites.
- `npm run build`: TypeScript application checking, Vite production build, and
  Node-target TypeScript build passed.
- `git diff --check`: passed.
- A targeted secret-signature scan over all shipping paths found no credential
  material.

Documentation/task verification:

- `scripts/audit-task-docs.mjs` is absent, so no repository task-doc audit
  command exists.
- `tasks/todo.md` has one current executable item, PRO-03, and PRO-02 appears
  once under completed work.

## Skipped tests

- No lint script or lint/check target exists in `package.json`, and there is no
  Makefile, Justfile, Python-project, or Cargo validation surface. The full
  Vitest suite and production build are the available executable gates.
- `npm run package:win` is deferred because frozen/embedded worker assembly is
  explicitly owned by WIN-02 and this macOS host cannot provide Windows-native
  packaged startup/shutdown evidence.
- A live transcription against the real faster-whisper package and a production
  model was not run because neither is committed test data; the real worker
  process instead runs against an API-compatible deterministic provider under a
  socket deny. Representative CPU/GPU and packaged-host proof remains WIN-03.
- Interactive Electron validation is not applicable to this slice because it
  adds no UI control; HTTP/MCP contracts and worker behavior are covered by
  executable tests.

## Adversarial review

An explicitly justified failure-oriented review was used as the
quality-sweep equivalent because no standalone `quality-sweep` or
`expert-review` command is installed. The review traced model-ID traversal and
local-directory resolution, absent dependencies and models, socket denial,
provider import/load/decode failures, silence, overlapping or invalid timing,
optional words, missing sources, cloud-provider isolation, durable job
cancellation, worker shutdown, transcript revision transactions, status
inventory, HTTP/MCP validation, SQLite isolation, and generated artifact scope.

The review found that `PythonWorkerSupervisor` discarded the protocol event's
explicit `retryable` value. That made a missing installed model inherit the
registry's retryable dependency default. The supervisor now preserves the
worker decision through `AppError`, and the real-host test asserts
`retryable: false`. The full test and build gates passed after the fix. No
blocking finding or warning remains.

## Residual risk

- The tests run the real Python worker process but substitute the
  faster-whisper package and model. Native CTranslate2 loading, representative
  CPU/GPU performance, codec behavior, and Windows process/resource placement
  remain unproven until WIN-02/WIN-03.
- Model selection is configuration-driven and deliberately refuses downloads
  or fallback. A user with a missing or incompatible model receives an
  actionable terminal setup failure and must install or select a valid model.
- Cancellation is cooperative between generated segments; a native provider
  call that blocks before yielding may require the supervisor's bounded
  cancellation timeout and worker termination.

## Rollback note

Revert the PRO-02 commit. The feature adds no database migration; generated
transcripts use the existing revision schema. After rollback, remove the
separately installed Python dependency or model directories only if they are no
longer needed.

## Next command

`$exec PRO-03`
