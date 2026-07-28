# Ship manifest — 2026-07-27

## User goal

Complete PRO-05 by implementing authorized OpenAI transcription, diarization,
structured analysis, provenance, provider status, and canonical analysis cache
identity, then wrap up and ship the session.

## Changed files and per-file purpose

- `src/shared/openai-contracts.ts` defines exact OpenAI models/options, typed
  Electron bridge requests/events, provider request metadata, capabilities,
  status, and canonical cache input contracts.
- `src/shared/domain.ts` exports the OpenAI contract surface.
- `src/shared/contracts.ts` extends persisted provenance with optional cloud
  request, model, adapter, prompt, and schema identity.
- `src/core/analysis-cache.ts` provides recursively canonical JSON and one
  SHA-256 cache identity over every output-affecting field.
- `src/core/openai-provider.ts` implements the typed child-process provider
  bridge, result/model/schema validation, progress, cancellation, and strict
  request/job correlation.
- `src/electron/openai-adapter.ts` implements FFmpeg audio chunk preparation,
  transcription and diarization normalization, strict Responses API analysis,
  bounded retries/timeouts, authorization rechecks, cancellation, cleanup, and
  request provenance.
- `src/electron/main.ts` keeps credential resolution and OpenAI HTTP execution
  in Electron, validates authorization before each attempt, handles typed IPC,
  and strips inherited OpenAI credential environment variables from the core.
- `src/core/api.ts` adds speech-mode/timeout inputs, OpenAI structured-analysis
  start, non-secret provider capability/status routes, and the authenticated
  authorization revalidation route.
- `src/core/cli.ts` installs the Electron child-process provider only when the
  core has an IPC channel.
- `src/core/bootstrap.ts` executes authorized OpenAI speech/analysis jobs,
  samples local visual inputs, persists raw and projected artifacts, rechecks
  authorization, handles cancellation, and reuses exact analysis results.
- `src/core/database.ts` adds migration 6, reconciles duplicate successful
  analysis rows, and enforces one proposed/accepted cache winner.
- `src/core/local-analysis.ts` moves Ollama onto the shared canonical cache
  identity without changing its provider-specific output inputs.
- `src/core/repository.ts` validates cache rows, marks corrupt rows, and selects
  a transactionally safe winner for equivalent successful analysis writes.
- `src/core/service.ts` queues explicit OpenAI speech/analysis modes, exposes
  non-secret provider readiness, validates grants, stores raw speech separately
  from accepted transcript revisions, and hashes speech inputs.
- `src/mcp/server.ts` exposes authorized OpenAI analysis and read-only provider
  capability/status tools.
- `tests/openai-adapter.test.ts` covers speech formatting, multi-chunk timing
  and speaker namespaces, strict analysis output, retries, authorization, and
  cancellation.
- `tests/openai-core.test.ts` covers separate operation grants, explicit model
  configuration, raw/accepted separation, non-secret status, returned-model and
  IPC job correlation, canonical identity, and cache winner selection.
- `README.md` describes the now-implemented Ollama and authorized OpenAI slice.
- `SPEC.md` reconciles implementation evidence and preserves native Windows,
  interactive workflow, and frozen-runtime gates.
- `IMPLEMENTATION_PLAN.md` marks PRO-05 implemented with file/test evidence and
  routes remaining native/UI proof to WIN-03.2/UI-01.1.
- `tasks/todo.md` marks PRO-05 complete and promotes TRC-01 as the sole current
  executable task.
- `tasks/history.md` records PRO-05 implementation, validation, residual native
  gate, and final bridge-correlation hardening.
- `tasks/ship-manifest.md` records this exact shipping boundary and evidence.

Generated `.agents/skillpacks/`, `.claude/skills/`, and `.codex/skills/` local
artifacts are excluded from the commit. No generated skill-root path is
tracked. `.agents/project.json` remains tracked and unchanged, and there are no
unrelated tracked changes or earlier unpushed commits in the boundary.

## User-goal mapping

The Electron adapter and process bridge implement the protected OpenAI execution
path without exposing plaintext credentials to the core. Queue, claim, handler,
cache-reuse, and retry-time authorization checks preserve the persisted cloud
grant boundary. Typed contracts and strict output validation keep provider
results explicit and attributable. Speech artifacts retain raw output while
accepted transcript revisions remain independently addressable. Canonical cache
identity plus migration/repository uniqueness provides exact reuse for both
Ollama and OpenAI. HTTP/MCP status surfaces reveal capability and readiness
without credential handles or network calls. Tests exercise the portable
security, provider, artifact, and cache boundaries; task and project documents
route the next implementation slice.

## Tests run

Executable verification against the shipping code:

- `npm test`: all 24 test files and 148 tests passed before the final
  correlation hardening, including OpenAI adapter/core, cloud security,
  credential vault, migrations, persistence, local provider, worker, and
  regression suites.
- `npx vitest run --config vitest.config.ts tests/openai-core.test.ts`: all 8
  targeted tests passed after the IPC job-correlation fix.
- `npm run build`: TypeScript application checking, Vite production UI build,
  and Node-target TypeScript compilation passed both before and after the final
  review fix.
- `git diff --check`: passed for the final pre-commit boundary.
- A targeted credential-signature scan found no credential material. Matches
  were limited to deterministic `test-secret` fixtures and identifiers/source
  code that intentionally implement credential handling.

Documentation/task verification:

- `scripts/audit-task-docs.mjs` is absent, so the repository defines no
  task-document audit command.
- `tasks/todo.md` has one current executable item, TRC-01, and PRO-05 appears
  once under completed work.

## Skipped tests

- No lint script or lint/check target exists in `package.json`, and there is no
  Makefile, Justfile, Python-project, Cargo validation surface, standalone
  quality-sweep/expert-review command, or task-doc audit. The full Vitest suite,
  targeted post-review regression test, production build, and diff checks are
  the available executable gates.
- `npm run package:win` is deferred because frozen/embedded worker assembly and
  native packaged validation are explicitly owned by WIN-02/WIN-03. This macOS
  host cannot prove DPAPI, Windows process/IPC behavior, long-path handling, or
  packaged FFmpeg/OpenAI execution.
- No live OpenAI request was sent because shipping must not consume user data,
  credentials, or paid API quota without an explicit smoke-test request.
  Deterministic mocked HTTP fixtures cover request formatting, response
  validation, timeouts, retries, revocation, and cancellation; real service
  compatibility remains a controlled WIN-03.2 smoke-test obligation.
- Interactive UI selection and complete authorized-cloud execution were not
  exercised because PRO-05 adds the provider/core/MCP surface but the
  interactive workflow is assigned to UI-01.1 and native Windows proof to
  WIN-03.2.

## Adversarial review

An explicitly justified failure-oriented self-review was used as the configured
quality-sweep equivalent because no standalone `quality-sweep` or
`expert-review` command is installed. It traced plaintext credential lifetime,
child environment inheritance, public versus desktop-only API reachability,
scope/operation/handle matching at queue/claim/handler/cache/retry boundaries,
typed IPC correlation and malformed events, cancellation during FFmpeg/upload/
retry, temporary-file cleanup, provider timeout and 4xx/429/5xx behavior,
returned-model/refusal/incomplete/schema validation, raw-versus-accepted
artifact persistence, corrupt cache rows, migration deduplication, concurrent
winner selection, provider-status disclosure, generated artifacts, and the
exact commit boundary.

The review found that a structurally valid Electron event was correlated only
by request ID and did not prove the event job ID matched the pending operation.
`src/core/openai-provider.ts` now rejects mismatched job output, and
`tests/openai-core.test.ts` locks the boundary with a regression test. The
targeted suite and production build passed after the fix. No warning remains.

## Residual risk

- Real OpenAI endpoint/schema behavior, model availability, billing, network
  policy, and provider-side limits remain unproven without an explicitly
  authorized live request.
- Native Electron safeStorage/DPAPI, Windows child-process IPC, FFmpeg chunking,
  packaged resource discovery, cancellation, and UI disclosure remain WIN-03
  acceptance work.
- The 20-minute 128 kbps mono MP3 strategy is designed to remain below the
  provider upload limit, and every produced chunk is size-checked, but unusual
  FFmpeg/provider behavior remains a native smoke-test risk.
- Analysis input artifacts are intentionally retained as local provenance.
  Failed/cancelled jobs can leave approved local transcript/visual input
  artifacts for startup reconciliation or later cleanup; they contain no
  credentials but can contain user media-derived data.
- Cache uniqueness is database-local. Concurrent writes through the single
  SQLite repository converge on one winner, but multi-process access outside
  the supported Electron-owned core topology is not an acceptance target.

## Rollback note

Revert the PRO-05 commit. Migration 6 is additive and older binaries ignore the
new unique index and schema version only if their migration compatibility
permits opening the database; take a database backup before deliberately
rolling back a migrated runtime. Reverting removes the OpenAI adapter, bridge,
routes, contracts, tests, and shared cache identity. Do not delete protected
credentials or user analysis artifacts as part of code rollback without a
separate explicit data-removal request.

## Next command

`$exec TRC-01`
