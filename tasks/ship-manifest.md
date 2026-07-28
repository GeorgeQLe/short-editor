# Ship manifest — 2026-07-27

## User goal

Complete TRC-02 by making Candidate generation deterministic, diagnostic, and
corpus-tested, then wrap up and ship the session.

## Changed files and per-file purpose

- `src/core/candidates.ts` implements versioned heuristic and analysis-backed
  Candidate generation, exhaustive aligned 20–90 second window enumeration,
  explicit quality floors, stable ranking, semantic/temporal grouping,
  provenance, and insufficiency diagnostics.
- `src/shared/contracts.ts` defines strict generation inputs, sufficient and
  insufficient diagnostics, and result consistency validation.
- `src/core/service.ts` binds generation to the accepted transcript revision,
  requires explicit analysis-artifact selection, validates active typed
  analysis output, and persists the generated result without silent fallback.
- `src/core/repository.ts` validates selected analysis artifacts and applies the
  canonical Candidate ranking when reading persisted rows.
- `src/core/api.ts` and `src/mcp/server.ts` expose the typed generation modes,
  analysis-artifact selection, and structured diagnostics.
- `tests/candidates.test.ts` covers repeatability, ordering, boundaries,
  exhaustive enumeration, quality floors, alignment, provenance, and
  insufficiency.
- `tests/candidate-integration.test.ts` covers accepted-revision binding,
  selected-artifact validation, direct and enveloped typed analysis output,
  provider provenance, and HTTP/MCP parity.
- `tests/candidate-corpus.test.ts` enforces the approved corpus quality gate.
- `tests/fixtures/candidate-corpus/manifest.json`,
  `tests/fixtures/candidate-corpus/transcripts.json`, and
  `tests/fixtures/candidate-corpus/labels.json` provide a versioned anonymized
  corpus with labels stored separately from generation input.
- `tests/domain-contracts.test.ts` covers generation-schema defaults and
  diagnostic discrimination.
- `tests/persistence.test.ts` proves persisted Candidate ordering uses all
  documented tie breakers.
- `IMPLEMENTATION_PLAN.md` and `SPEC.md` record TRC-02 implementation evidence,
  metrics, and the remaining TRC-03/UI/native validation boundary.
- `tasks/todo.md` completes TRC-02 and promotes TRC-03 as the sole executable
  current task.
- `tasks/history.md` records the implementation and verification.
- `tasks/ship-manifest.md` records this exact shipping boundary and evidence.

Generated `.agents/skillpacks/`, `.claude/skills/`, and `.codex/skills/` local
artifacts are excluded from the commit. No path under `.claude/skills/` or
`.codex/skills/` is tracked. `.agents/project.json` remains tracked and
unchanged. There are no earlier unpushed commits in the boundary.

## User-goal mapping

The generator now produces ranked, sentence/segment-aligned Candidates from the
actual accepted transcript revision and records an immutable generation
version. Analysis mode requires an explicitly selected active artifact and
retains its provider provenance; malformed, mismatched, stale, or missing
artifacts fail instead of falling back. Quality floors and duplicate grouping
prevent low-quality padding, while structured diagnostics return every valid
choice when fewer than five survive. Shared schemas and HTTP/MCP integration
make those rules consistent at each public boundary. The separate-label corpus
and deterministic fixtures prove the documented quality and stability claims.

## Tests run

Executable verification against the final source boundary:

- `npm test`: all 27 test files and 171 tests passed, including the new
  deterministic generator, corpus, service, HTTP/MCP, schema, and persistence
  coverage plus the complete regression suite.
- `npm run build`: TypeScript application checking, Vite production UI build,
  and Node-target TypeScript compilation passed.
- `git diff --check`: passed.
- A targeted credential-signature scan found no credential material. Matches
  were policy prose, the Candidate hook heuristic word `secret`, and an
  intentional schema-rejection fixture.

Documentation/task verification:

- `scripts/audit-task-docs.mjs` is absent, so the repository defines no
  task-document audit command.
- `tasks/todo.md` has one current executable item, TRC-03, and TRC-02 appears
  once under completed work.

## Skipped tests

- No lint script or standalone check target exists in `package.json`, and there
  is no Makefile, Justfile, Python-project, Cargo validation surface, installed
  `quality-sweep`/`expert-review` command, or task-doc audit. The full Vitest
  suite, production build, failure-oriented review, credential scan, and diff
  check are the available gates.
- `npm run package:win` is deferred because packaged Windows behavior is owned
  by WIN-02/WIN-03. This macOS host cannot prove native SQLite, process/IPC,
  long-path, or frozen-worker-resource behavior.
- Interactive regeneration, score inspection, and recovery from insufficient
  material are deferred to UI-01.2 and WIN-03.3 because the current UI does not
  expose this workflow; repository, service, HTTP, and MCP tests cover the
  executable core.
- No visual check is relevant because this boundary changes no UI component or
  rendered visual asset.

## Adversarial review

An explicitly justified failure-oriented self-review was used as the review
lane because no standalone review command is installed and multi-agent review
was not requested. The review traced empty/short/long transcripts, exact 20 and
90 second boundaries, transcripts with more than the former segment cap,
quality-floor rejection, overlap and semantic grouping, tied scores and ranges,
whitespace/token normalization, short-highlight expansion, outside and
overlong highlights, selected artifacts that are missing, stale, mismatched,
or malformed, direct and typed-envelope provider output, accepted transcript
revision changes, persistence ordering, insufficient-result consistency,
HTTP/MCP schema behavior, generated local artifacts, and credential patterns.

No correctness finding remained after review. All executable checks passed
without warnings.

## Residual risk

- The anonymized corpus is deliberately small and synthetic. Its 100% result
  proves the versioned gate but does not establish production quality on a
  broad real-world creator corpus.
- Candidate IDs and timestamps are newly generated on each run; deterministic
  ordering/content/provenance are stable for identical accepted inputs, while
  identity preservation and user-decision conflict handling are intentionally
  deferred to TRC-03.
- Pending Candidate replacement is transactional and reviewed rows survive, but
  regeneration does not yet suppress conflicts against retained decisions.
  TRC-03 owns append/replace strategies, accepted-copy preservation, and
  conflict resolution.
- Interactive macOS and packaged native Windows validation remain open under
  UI-01.2 and WIN-03.3.

## Rollback note

Revert the TRC-02 feature commit to restore the prior single-mode Candidate
generator and API. This boundary adds no database migration; persisted
generation provenance uses existing columns.

## Next command

`$exec`
