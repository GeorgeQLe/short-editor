# Ship manifest — 2026-07-27

## User goal

Complete PRO-04 by adding Windows-protected credentials and a non-bypassable,
persisted cloud-authorization boundary, then wrap up and ship the session.

## Changed files and per-file purpose

- `src/security/credential-vault.ts` adds the OS-protected, atomic,
  ciphertext-only credential store and opaque credential summaries.
- `src/electron/main.ts` owns Electron `safeStorage`, desktop-only credential
  IPC, authenticated core synchronization, authorization operations, and
  revoke-before-delete credential removal.
- `src/electron/preload.ts` exposes the narrow credential and cloud-grant IPC
  surface to the isolated renderer.
- `src/core/api.ts` removes caller authorization booleans and adds
  constant-time-token-protected desktop security routes.
- `src/core/cli.ts` receives the per-launch desktop-channel token only through
  the spawned core process environment.
- `src/core/bootstrap.ts` creates the in-memory protected-handle inventory and
  connects it to queue-time and claim-time authorization checks.
- `src/core/jobs.ts` resolves current persisted grants, stores only opaque
  handles, and fails queued OpenAI work when a grant or handle is revoked.
- `src/core/repository.ts` finds active grants, lists them, and transactionally
  revokes all grants linked to a removed credential.
- `src/core/service.ts` synchronizes handles, validates disclosure and
  confirmation, creates/lists/revokes scoped grants, and binds OpenAI work to a
  project or explicitly selected authorized batch.
- `src/mcp/server.ts` removes the caller-controlled cloud authorization field
  and accepts only an optional selected authorization batch.
- `src/ui/App.tsx` adds protected credential and project authorization controls,
  clears stale credential selections, and reports security-operation failures.
- `src/ui/api.ts` removes the obsolete authorization boolean from local
  analysis requests.
- `src/ui/styles.css` styles the security controls and responsive cloud-access
  layout.
- `tests/credential-vault.test.ts` proves protected persistence, metadata-only
  disclosure, locked-storage failure, update, resolve, and removal behavior.
- `tests/cloud-security.test.ts` proves grant/handle matching, batch selection,
  confirmations, credential-linked revocation, claim-time races, forged boolean
  rejection, and desktop-route isolation.
- `package.json` makes Electron the sole owner of its core child during the
  combined development command, avoiding a competing unauthenticated core.
- `tsconfig.node.json` includes the new security module in the Node build.
- `README.md` documents the implemented safety and privacy boundary.
- `SPEC.md` reconciles the local/cloud request boundary as implemented while
  retaining native Windows validation as a release gate.
- `IMPLEMENTATION_PLAN.md` records PRO-04 implementation evidence and routes
  native packaged proof to WIN-03.
- `tasks/todo.md` marks PRO-04 complete and promotes PRO-05 as the sole current
  executable task.
- `tasks/history.md` records the implementation and the final adversarial
  hardening.
- `tasks/ship-manifest.md` records this exact shipping boundary and evidence.

Generated `.agents/skillpacks/`, `.claude/skills/`, and `.codex/skills/` local
artifacts are excluded from the commit. No generated skill-root path is
tracked. `.agents/project.json` remains tracked and unchanged, and there are no
unrelated tracked changes or unpushed commits in the boundary.

## User-goal mapping

The Electron vault and IPC surface keep plaintext credentials inside the
desktop main process. The authenticated core channel, active-handle inventory,
repository grants, service validation, and queue checks make authorization
persisted, scoped, revocable, and non-bypassable at both enqueue and claim
time. The UI supplies the required disclosure and confirmation flow. HTTP/MCP
schema changes remove caller assertions. Tests cover the vault, public
boundaries, grant matching, revocation, and race behavior; project and task
documents reconcile completion and route the next implementation slice.

## Tests run

Executable verification against the final code diff:

- `npm test`: 22 test files and 128 tests passed, including cloud-security,
  credential-vault, persistence, worker-host, authorization-policy, and
  regression suites.
- `npm run build`: TypeScript application checking, Vite production UI build,
  and Node-target TypeScript compilation passed.
- `git diff --check`: passed before the review fixes and is repeated in the
  final pre-commit scope check.
- A targeted credential-signature scan over the exact shipping paths found no
  secret material. Its only lexical match was the deterministic
  `sk-plaintext-must-not-persist` non-persistence test fixture.

Documentation/task verification:

- `scripts/audit-task-docs.mjs` is absent, so the repository defines no
  task-document audit command.
- `tasks/todo.md` has one current executable item, PRO-05, and PRO-04 appears
  once under completed work.

## Skipped tests

- No lint script or lint/check target exists in `package.json`, and there is no
  Makefile, Justfile, Python-project, Cargo validation surface, or standalone
  task-doc audit. The full Vitest suite and production build are the available
  executable gates.
- `npm run package:win` is deferred because frozen/embedded worker assembly and
  native packaged validation are explicitly owned by WIN-02/WIN-03. This macOS
  host cannot prove Windows DPAPI or packaged startup behavior.
- Interactive credential entry/removal was not exercised against a packaged
  Windows UI because DPAPI and the Windows release environment are unavailable
  on this host. Compile-time UI coverage plus vault and HTTP security tests
  cover the portable boundary; selector state, failure reporting, native DPAPI,
  and the packaged disclosure flow remain WIN-03 smoke-test obligations.
- A real OpenAI request was not run because PRO-05 owns the provider adapter,
  provenance, and cache implementation. PRO-04 intentionally establishes the
  protected credential and authorization gate without transmitting user data.

## Adversarial review

An explicitly justified failure-oriented self-review was used as the
quality-sweep equivalent because no standalone `quality-sweep` or
`expert-review` command is installed. It traced plaintext lifetime and
persistence, vault lock/corruption behavior, renderer exposure, desktop token
comparison, public HTTP/MCP forgery, operation/provider/scope matching,
credential synchronization, credential removal, grant revocation, queued-job
races, batch selection, error disclosure, generated artifacts, and the
development process topology.

The review found that credential bytes were deleted before linked grants were
durably revoked, which could leave stale active grant metadata during a core
outage. `src/electron/main.ts` now revokes first and deletes protected bytes
only after the core confirms success. It also found that the Cloud Access UI
could retain a removed handle and silently reject remove/revoke promises;
`src/ui/App.tsx` now selects only an existing handle and reports failures.
The full test and build gates passed after both fixes. No warning remains.

## Residual risk

- Native `safeStorage`/DPAPI availability, Windows ACL behavior, packaged child
  startup, IPC disclosure controls, and the complete credential UI flow remain
  unproven until WIN-03 runs on configured Windows 11 hardware.
- Credential and grant persistence are separate stores. Revoke-before-delete
  fails safely: if vault deletion fails after grant revocation, protected bytes
  can remain but cannot authorize cloud work. A later successful handle
  synchronization does not reactivate the revoked grant.
- Batch authorization uses an explicit persisted batch scope identifier because
  the current domain has no durable Batch entity or membership table. The
  selected UUID is not sufficient without a current matching grant and live
  credential handle, but PRO-05 must preserve that binding when the adapter is
  connected.
- The desktop token protects the private loopback routes for one application
  launch; it is not a general multi-user authentication system. The core
  remains bound to loopback, and public request schemas cannot create grants.

## Rollback note

Revert the PRO-04 commit. The change adds no database migration: it uses the
existing cloud-authorization table and adds a separate protected credential
file under Electron user data. After rollback, remove that file only through a
future compatible desktop cleanup path if the user explicitly requests
credential deletion; do not manually expose or copy its ciphertext.

## Next command

`$exec PRO-05`
