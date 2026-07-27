# Ship manifest — 2026-07-27

## User goal

Ship the current Short Editor session cleanly: complete the active FND-01
contract work, preserve the platform-path work, validate the exact boundary,
update project tracking, commit it, and push it to the primary branch.

## Changed files and per-file purpose

- `README.md`: documents supported macOS development paths and the Windows
  release-acceptance boundary.
- `SPEC.md`: records the reviewed normative additions and reconciles current
  implementation evidence.
- `IMPLEMENTATION_PLAN.md`: defines the issue-ready v1 dependency spine, records
  the validated FND-01 baseline, and routes FND-02 next.
- `.agents/project.json`: commits the project designation required by the
  installed shipping workflow.
- `src/core/api.ts`: emits the structured v1 error envelope.
- `src/core/bootstrap.ts`: resolves platform-appropriate application data paths.
- `src/core/candidates.ts`, `src/core/jobs.ts`, `src/core/repository.ts`,
  `src/core/service.ts`, and `src/shared/templates.ts`: adapt existing runtime
  objects to the expanded canonical contracts without adding downstream
  persistence workflows.
- `src/shared/domain.ts`: retains the compatibility import surface while
  re-exporting the split contracts.
- `src/shared/contracts.ts`, `src/shared/validators.ts`,
  `src/shared/error-contracts.ts`, `src/shared/job-messages.ts`, and
  `src/shared/episode-transitions.ts`: implement the complete strict FND-01
  entity, validation, lifecycle, provider-classification, job-message, and
  error inventories.
- `src/shared/errors.ts`: normalizes known failures and redacts unknown failures.
- `tests/bootstrap.test.ts`, `tests/domain-contracts.test.ts`,
  `tests/episode-transitions.test.ts`, `tests/errors.test.ts`, and
  `tests/job-messages.test.ts`: cover the new behavior and contract inventories.
- `tests/factories.ts` and `tests/repository.test.ts`: keep existing fixtures on
  the canonical contracts.
- `tasks/todo.md` and `tasks/history.md`: record completion and the next
  executable task.
- `tasks/ship-manifest.md`: records this shipping proof.

## User-goal mapping

The shared schema and runtime changes satisfy FND-01; the bootstrap and README
changes preserve the platform-path work already in the session; SPEC, plan, and
task documents make the completed boundary and next task explicit.

## Tests run

- `npm test`: 9 files and 34 tests passed before the adversarial-review fix.
- `git diff --check`: passed before task-document updates.
- `npm test`: final post-fix run passed all 9 files and 35 tests.
- `npm run build`: passed TypeScript typechecking, the Vite production build,
  and the Node TypeScript build without warnings.
- `git diff --check`: final post-fix run passed.

## Skipped tests

- Windows packaging and Windows release scenarios are unavailable on this macOS
  host and remain release-gate work, not substitutes for local executable
  checks.
- UI/visual validation is deferred by the FND-01 plan to UI-03 and WIN-03.9;
  this boundary changes contracts and bootstrap behavior but no rendered UI.
- Production/provider integration is outside FND-01 and no provider request path
  was implemented here.

## Adversarial review

A changed-file, acceptance-criteria, and privacy review compared the exact diff
against SPEC sections 5 and 7 and the FND-01 exit criteria. It found that
provider provenance omitted the required private-network classification and
that SPEC evidence still described the completed contract inventory as partial.
Both findings were fixed and covered by a contract test.

## Residual risk

The expanded contract fields are currently adapted over the legacy database
schema with compatibility defaults. FND-02 must persist those fields and prove
fresh/upgrade/interrupted migration behavior. Windows-native SQLite and
packaging behavior also remain unverified until the Windows gates.

## Rollback note

Revert the session commit on `master`. No database migration or destructive
data operation is included in this boundary.

## Next command

`$exec FND-02`
