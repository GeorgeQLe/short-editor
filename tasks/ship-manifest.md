# Ship manifest — 2026-07-27

## User goal

Complete PRO-03 by implementing configurable Ollama analysis and local visual
sampling, then wrap up and ship the session.

## Changed files and per-file purpose

- `resources/worker/worker.py` adds Ollama capability discovery and
  schema-constrained analysis, redirect-aware endpoint authorization, bounded
  provider responses, FFmpeg frame sampling, visual activity scoring, explicit
  unsupported detections, typed provenance, and deterministic visual fixtures.
- `src/core/local-analysis.ts` defines provider configuration and output
  schemas, endpoint classification, normalized cache identity, worker adapters,
  and persisted analysis-artifact construction.
- `src/core/bootstrap.ts` installs local visual sampling and Ollama analysis in
  the durable `analyze` job handler, reuses matching cache entries, persists
  typed input artifacts and analysis output, reports progress, and propagates
  cancellation.
- `src/core/service.ts` validates Episode prerequisites and analysis options,
  enforces private-LAN disclosure, derives public-endpoint permission from
  persisted authorization rather than a caller flag, and exposes status and
  artifact retrieval.
- `src/core/repository.ts` retrieves the accepted transcript revision and finds
  reusable proposed or accepted analysis artifacts by normalized input hash.
- `src/core/api.ts` adds typed Ollama start/status and Episode analysis-artifact
  endpoints.
- `src/shared/python-worker-protocol.ts` adds capability discovery, visual
  fixture selection, explicit visual capability states, and typed face and
  screen-share fields.
- `tests/local-analysis.test.ts` covers endpoint classes and consent gates,
  output schema drift, visual capability representation, cache identity, and
  persisted cloud-authorization enforcement.
- `tests/ollama-worker-host.test.ts` exercises the real worker process against
  deterministic HTTP and visual fixtures for discovery, structured analysis,
  unavailable and malformed providers, timeout, redirect policy, stricter
  policy preservation, and visual detections.
- `tests/python-worker-host.test.ts` updates the worker version assertion and
  retains the SQLite-free and local-only transcription safety checks while
  acknowledging the intentionally installed Ollama HTTP adapter.
- `SPEC.md` reconciles the implemented Ollama and visual-sampling slice while
  retaining OpenAI, diarization, frozen-runtime, and Windows evidence as
  pending work.
- `IMPLEMENTATION_PLAN.md` records PRO-03 implementation evidence and leaves
  configured Windows validation in WIN-03.
- `tasks/todo.md` marks PRO-03 complete and promotes PRO-04 as the sole current
  executable task.
- `tasks/history.md` records the provider, policy, cache, sampling, and fixture
  work.
- `tasks/ship-manifest.md` records this exact shipping proof.

Generated `.agents/skillpacks/`, `.claude/skills/`, and `.codex/skills/` local
artifacts are excluded from the commit. No generated skill-root path is
tracked, `.agents/project.json` is absent, and there are no unrelated tracked
changes or unpushed commits in the boundary.

## User-goal mapping

The Python worker and typed adapters implement the configurable local provider
and visual-sampling runtime. Bootstrap, service, repository, protocol, and HTTP
changes connect that runtime to durable jobs, persisted authorization, stable
cache identity, typed artifacts, cancellation, and retrieval. The real worker
host tests and core policy tests prove the required success and failure
boundaries, while project and task documents reconcile PRO-03 completion and
route PRO-04.

## Tests run

Executable verification against the final code diff:

- `npm test`: 20 test files and 120 tests passed, including the real Python
  Ollama worker-host, local-analysis, transcription, persistence, artifact,
  worker-supervision, and protocol suites.
- `npm run build`: TypeScript application checking, Vite production build, and
  Node-target TypeScript compilation passed.
- `git diff --check`: passed before the manifest update and is repeated in the
  final pre-commit scope check.
- A targeted secret-signature scan over all shipping paths found no credential
  material. Its only lexical match was the worker's defensive
  `parsed.password` URL-credential rejection.

Documentation/task verification:

- `scripts/audit-task-docs.mjs` is absent, so no repository task-doc audit
  command exists.
- `tasks/todo.md` has one current executable item, PRO-04, and PRO-03 appears
  once under completed work.

## Skipped tests

- No lint script or lint/check target exists in `package.json`, and there is no
  Makefile, Justfile, Python-project, Cargo validation surface, or standalone
  task-doc audit. The full Vitest suite and production build are the available
  executable gates.
- `npm run package:win` is deferred because frozen/embedded worker assembly and
  configured Windows validation are explicitly owned by WIN-02/WIN-03; this
  macOS host cannot provide Windows-native packaged startup/shutdown evidence.
- Live Ollama model inference and FFmpeg sampling of representative production
  media were not run because model and media assets are not committed test
  data. The real worker process instead uses deterministic local HTTP and
  visual fixtures. Native codec/model compatibility and representative
  CPU/GPU performance remain WIN-03 risks.
- Interactive Electron validation is not applicable to this slice because it
  adds no UI control; the HTTP boundary, core policy, persistence, and worker
  behavior have executable coverage.

## Adversarial review

An explicitly justified failure-oriented review was used as the quality-sweep
equivalent because no standalone `quality-sweep` or `expert-review` command is
installed. The review traced invalid schemes and URL credentials, loopback,
private-LAN, public, IPv4-mapped IPv6, and redirect classifications; caller
flags versus persisted authorization; stricter original/redirect policy;
transmission timing; input and response size limits; provider unavailability,
timeout, malformed output, schema drift, and missing capabilities; FFmpeg
absence, decode failure, frame parsing, progress, and cancellation; normalized
cache identity; accepted-transcript and source-hash prerequisites; artifact
persistence; and generated pack scope.

No blocking policy bypass or correctness defect was found. Public authorization
is derived from active persisted project scope, analysis data is not posted
until endpoint discovery and redirect reclassification pass, and the stricter
original/target endpoint class is retained in provenance and consent checks.
The full test and build gates passed after the review. No warning remains.

## Residual risk

- If visual input artifacts are finalized and the subsequent Ollama request
  fails, the bounded local inputs remain recorded for startup reconciliation
  rather than being removed immediately. They contain only the accepted
  transcript and derived visual samples, remain inside the owned artifact
  store, and can be rolled back with the feature; explicit failed-run retention
  policy is future cleanup work.
- Endpoint policy classifies arbitrary DNS names as public before execution,
  which requires persisted cloud authorization. It does not pin resolved
  addresses against DNS rebinding; a loopback literal or `localhost` remains
  the intended no-authorization local route.
- Native FFmpeg codec coverage, real Ollama schema adherence across supported
  models, performance, packaged worker placement, and Windows cancellation
  behavior remain unproven until WIN-02/WIN-03.
- Speaker framing, face detection, and screen-share detection are deliberately
  reported as unsupported by the installed production sampler instead of being
  inferred or silently fabricated.

## Rollback note

Revert the PRO-03 commit. The feature adds no database migration and uses the
existing analysis-artifact and authorization tables. After rollback, remove
PRO-03 analysis-input artifact files only through the artifact-store cleanup
path if they are no longer needed; do not delete unrelated Episode artifacts.

## Next command

`$exec PRO-04`
