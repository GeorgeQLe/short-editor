# Ship manifest

## UI-01.3 editor implementation checkpoint — 2026-07-30

### User goal

Implement and ship the desktop Short editor slice covering durable project
creation/reopening, timeline, composition, crop, caption, and audio editing with
session undo/redo, while preserving the existing revision and render contracts.

### Changed files

`docs/api-v1-routes.json`, `docs/mcp-v1-tools.json`,
`docs/release-interface-v1.json`, `docs/release-interfaces-v1.md`,
`src/core/api.ts`, `src/core/database.ts`, `src/core/render-composition.ts`,
`src/core/render-preflight.ts`, `src/core/repository.ts`,
`src/core/service.ts`, `src/electron/main.ts`,
`src/electron/preload-smoke.ts`, `src/electron/preload.cts`,
`src/mcp/registry.ts`, `src/shared/contracts.ts`,
`src/shared/templates.ts`, `src/ui/App.tsx`, `src/ui/api.ts`,
`src/ui/desktop.ts`, `src/ui/EditorWorkspace.tsx`,
`src/ui/editor-state.ts`, `src/ui/styles.css`,
`tests/api-contract.test.ts`, `tests/api-release-contract.test.ts`,
`tests/editor-state.test.ts`, `tests/mcp-contract.test.ts`,
`tests/migrations.test.ts`, `tests/render.test.ts`, `tasks/todo.md`,
`tasks/history.md`, and `tasks/ship-manifest.md`.

Generated local pack material under `.agents/skillpacks/`, `.claude/`, and
`.codex/` is excluded from this boundary and remains untracked.

### Per-file purpose

- `src/ui/EditorWorkspace.tsx`, `src/ui/editor-state.ts`, `src/ui/App.tsx`,
  `src/ui/api.ts`, `src/ui/desktop.ts`, and `src/ui/styles.css` implement the
  Editor route, durable launcher, source-aware preview/transport, four editing
  surfaces, asset selection, revision-safe section saves, conflict recovery,
  and session history.
- `src/core/api.ts`, `src/core/repository.ts`, `src/core/service.ts`, and
  `src/mcp/registry.ts` expose paginated, optionally Episode-filtered Short
  listing through the frozen HTTP and MCP interfaces.
- `src/shared/contracts.ts`, `src/shared/templates.ts`, and
  `src/core/database.ts` add default-visible composition layers and migrate
  legacy Template and Short JSON in migration 18.
- `src/core/render-composition.ts` and `src/core/render-preflight.ts` consistently
  exclude hidden layers from render inputs, captions, crop analysis, asset
  binding, and preflight validation.
- `src/electron/main.ts`, `src/electron/preload.cts`, and
  `src/electron/preload-smoke.ts` add the native asset picker and validated
  inventory-media protocol with byte-range support, then freeze the expanded
  bridge in the Electron smoke.
- The four generated `docs/` artifacts publish the added HTTP operation and MCP
  tool with stable schemas, mappings, counts, and digests.
- The six changed/new test files freeze pagination and release compatibility,
  migration defaults, hidden-layer rendering, and editor history, dirty-section,
  source-time, crop, and canonical-save behavior.
- Task documents record this implementation checkpoint without closing the
  still-required interactive acceptance gate.

### User-goal mapping

Approved Candidates can create durable Shorts from an explicit Template, and
existing projects can be reopened after restart. The portrait preview maps the
Short playhead through ordered source ranges and displays visible composition
layers, captions, safe area, selected assets, and effective crops. Each editing
section maintains local drafts, saves with exact compare-and-swap revisions,
retains unrelated dirty work after canonical responses, and pauses on conflict
until the user explicitly discards or rebases drafts. Session undo/redo covers
all editor content. Layer visibility is persisted and honored by both preview
and executable render paths.

### Tests run

- Executable verification: `npm test` passed all 48 files and 340 tests,
  including the real FFmpeg render regression. The intentional
  `Unexpected internal error` stderr line is the existing redacted-500 fixture,
  not a warning or regression.
- Executable verification: `npm run build` passed TypeScript typecheck, Vite
  production compilation, and Node TypeScript compilation without warnings.
- Executable verification: `npm run smoke:preload` passed in Electron with all
  11 picker, media, credential, and authorization bridge functions present.
- Generated-contract verification: `npm run generate:release-interfaces`
  completed, and the subsequent working-tree comparison retained the exact
  checked-in generated boundary.
- Repository verification: `git diff --check` passed. Focused
  credential-signature scanning found only the deliberate redaction fixtures in
  `tests/api-release-contract.test.ts`, not new credential material.

### Skipped tests

- The isolated UI-01.3 macOS named-fixture walkthrough and screenshot were not
  completed in this session. The task therefore remains open; the residual
  interaction risk is not represented as automated closure.
- Native packaged Windows acceptance is unavailable on this macOS host and
  remains owned by the existing Windows release gate.
- No lint script or task-document audit script exists. TypeScript checking is
  included in the successful production build, and diff hygiene passed
  separately.

### Adversarial review

A failure-oriented changed-file review served as the explicit equivalent review
lane because no repository-local `quality-sweep` or `expert-review` command is
installed. It traced the revision boundary through every section save,
canonical merge, conflict discard/rebase, and reanalysis path; checked dirty
draft retention and invalidation messaging; checked source/output time mapping,
manual-crop duration guards, hidden-layer handling from migration through
preflight/render, pagination/filter binding, media UUID validation and range
handling, generated-interface stability, and exclusion of generated skill
roots.

No blocking defect remained after review and executable validation. The lack of
an end-to-end Editor component regression and named-fixture walkthrough is
explicitly retained as residual risk rather than being treated as proof of UI
completion.

### Residual risk

Complex pointer, media playback, asset-import, cross-section dirty-save, and
conflict interactions have state-helper and contract coverage but still need
the named macOS walkthrough. The custom media handler reads the requested file
before returning a byte range, so very large local media may have higher
transient memory use; the browser's normal range requests bound the response
body but not the initial file read. Packaged Windows protocol and native-dialog
behavior remain unproved until the Windows gate.

### Rollback note

Revert the Editor UI/client/bridge changes, Short-list HTTP/MCP contract and
generated artifacts, visibility migration/schema/template changes, hidden-layer
render behavior, tests, and task records together. Migration 18 is additive and
only writes `visible: true` where the field was absent.

### Next command

Run `$guide` for the isolated UI-01.3 macOS acceptance walkthrough and
credential-free evidence capture.

## UI-01.2 transcript/Candidate/copy boundary — 2026-07-29

### User goal

Replace the Candidates placeholder with the complete Episode-scoped transcript
editing, Candidate generation/review, and accepted-copy workflow while consuming
the frozen v1 HTTP contracts unchanged.

### Changed files

`src/ui/App.tsx`, `src/ui/api.ts`, `src/ui/CandidatesWorkspace.tsx`,
`src/ui/styles.css`, `tests/ui-api.test.ts`,
`tests/candidates-workspace.test.tsx`, `tasks/todo.md`, `tasks/history.md`, and
`tasks/ship-manifest.md`.

Generated local pack material under `.agents/skillpacks/`, `.claude/`, and
`.codex/` is excluded from this boundary and remains untracked. The isolated
fixture, SQLite database, media, and screenshot remain outside git under
`/tmp/short-editor-ui-01.2-macos-20260729/`.

### Per-file purpose

- `src/ui/App.tsx` routes Candidates to the implemented workspace and removes
  it from the placeholder path.
- `src/ui/api.ts` adds typed paginated artifact/Candidate reads and exact
  transcript, generation, review, and content-package mutations.
- `src/ui/CandidatesWorkspace.tsx` implements Episode selection, complete
  transcript snapshots, explicit conflict recovery, generation controls and
  diagnostics, deterministic Candidate review/detail, and immutable proposed
  versus editable accepted copy.
- `src/ui/styles.css` supplies the responsive transcript cards, generation
  controls, split Candidate/detail layout, review/provenance metadata, and
  validation/conflict/diagnostic states.
- `tests/ui-api.test.ts` freezes exact paths, pagination, request bodies,
  expected revisions, and structured conflict propagation.
- `tests/candidates-workspace.test.tsx` covers shell routing, selection and
  missing transcript guidance, word preservation, validation and conflict
  recovery, both modes/strategies, accepted-artifact filtering, deterministic
  scores/diagnostics, review, accepted copy, and stale-copy recovery.
- Task documents close UI-01.2 and route remaining desktop work to UI-01.3.

### User-goal mapping

Transcript saves send every segment, including untouched word arrays, against
the accepted revision and show manual provenance plus downstream invalidation
semantics. Transcript and copy conflicts retain local drafts and disable retry
until explicit reload. Candidate generation supports 5–10 heuristic or
explicit accepted-analysis proposals with append/replace pending strategies and
always refetches the complete active list. Candidate cards expose stable rank,
timing, transcript/provider provenance, three-decimal score breakdowns,
duplicate groups, revision, and review state. The detail editor keeps proposed
copy immutable, labels rewrites as planning aids, and edits every content-package
field with one-item-per-line arrays.

### Tests run

- `npm test`: all 47 files and 333 tests passed. The intentional
  `Unexpected internal error` line is the existing redacted-500 fixture.
- `npm run build`: TypeScript typecheck, Vite production compilation, and Node
  TypeScript compilation passed.
- `npm run smoke:preload`: the hidden sandboxed Electron window exposed all
  nine desktop bridge functions.
- `git diff --check`: passed.

### Skipped tests

- The executable checks above were already completed in this session against
  the exact working-tree boundary, so ship-end did not duplicate them.
- No lint script or task-document audit script exists. TypeScript checking is
  included in `npm run build`, and repository diff hygiene passed separately.
- Native packaged Windows acceptance is unavailable on this macOS host and
  remains assigned to WIN-03.3. The current UI logic is covered by component,
  API-contract, production-build, preload-smoke, and interactive macOS checks.

### Adversarial review

A failure-oriented changed-file review served as the explicit equivalent review
lane because no repository-local `quality-sweep` or `expert-review` command is
installed. It checked complete transcript snapshots and preserved word arrays,
revision-conflict draft retention, validation detail rendering, artifact-state
filtering, exact generation modes and pending strategies, post-mutation
refetches, stable Candidate ordering and score formatting, proposed-copy
immutability, accepted-copy revision synchronization, shell routing, responsive
layout, and exclusion of generated skill roots.

The review found no additional defect. Focused secret-signature scanning found
no credential material in the shipping boundary, and the generated
`.agents/skillpacks/`, `.claude/`, and `.codex/` trees remain untracked and
excluded.

### Interactive acceptance

- Computer Use's `sky.list_apps()` discovery gate passed. Fixture
  `UI-01.2-macos-2026-07-29` ran on macOS 26.5.2 (25F84) against the working
  tree based on commit `bf73dd3`.
- Transcript text, start timing, and speaker edits were visible with preserved
  word counts. A second local HTTP client advanced the revision; the UI showed
  exact `expected 1, actual 2`, preserved the draft, required reload, and then
  saved the reapplied revision successfully.
- Persisted checks confirmed the dependent Shorts became unapproved, the
  succeeded draft Render became stale, the draft schedule required rerender,
  and the published schedule stayed unchanged.
- Heuristic append and accepted-analysis replace generation both passed with
  deterministic ordering, scores, duplicate groups, transcript revision, and
  provider provenance. One Candidate was approved, another rejected, and the
  approved Candidate's complete copy package was accepted.
- A second local client advanced Candidate copy; the UI showed exact
  `expected 3, actual 4`, retained the unsaved draft, required reload, and
  accepted the reapplied copy at revision 5. Regeneration retained the approved
  and rejected decisions plus accepted copy while inserting six pending
  proposals.
- The short Episode visibly returned `INSUFFICIENT_MATERIAL`, exact rejection
  counts, and recovery guidance. The final credential-free full-window evidence
  shows the named primary Episode, approved/rejected decisions, provider scores,
  and accepted-copy state. It remains outside git as
  `UI-01.2-macos-2026-07-29.png` with SHA-256
  `85ba172352205f6a29826f20cfc772c509ccfe3025e44c2655fcbb1f68a13650`.

### Residual risk

Native packaged Windows validation remains deferred to WIN-03.3. UI-01.2 does
not create Shorts or expose Editor/Calendar controls; those remain UI-01.3
through UI-01.5.

### Rollback note

This slice adds no migration or core contract change. Revert the UI component,
client, route, styles, tests, and task-document entries together.

### Next command

Implement UI-01.3 timeline, composition, crop, caption, and audio editing with
session undo/redo.

## UI-01.1 acceptance-fix boundary — 2026-07-29

### User goal

Wrap up and ship the fixes discovered during UI-01.1 interactive acceptance,
close that gate after the clean named-fixture rerun, and preserve a concrete
route into UI-01.2.

### Changed files

`.agents/project.json`, `package.json`, `src/electron/desktop-list.ts`,
`src/electron/main.ts`, `src/electron/preload.cts`,
`src/electron/preload-smoke.ts`, `src/electron/window-options.ts`,
`tasks/history.md`, `tasks/ship-manifest.md`, `tasks/todo.md`,
`tests/electron-desktop-list.test.ts`,
`tests/electron-window-options.test.ts`, and `tsconfig.node.json`.

The obsolete `src/electron/preload.ts` is deleted in the same boundary.

Generated local pack material under `.agents/skillpacks/`, `.claude/`, and
`.codex/` is excluded from the shipping boundary and remains untracked.

### Per-file purpose

- `.agents/project.json` records the installed `guided-walkthrough` pack used
  for interactive acceptance and for the next manual UI route.
- `src/electron/preload.cts` replaces the obsolete TypeScript preload so Node
  compilation emits the CommonJS artifact required by Electron's sandboxed
  preload runtime.
- `src/electron/window-options.ts` centralizes the secure BrowserWindow settings
  and resolves `preload.cjs`; `src/electron/main.ts` consumes those options.
- `src/electron/preload-smoke.ts` opens a hidden sandboxed window and verifies
  that all nine desktop bridge functions are exposed.
- `src/electron/desktop-list.ts` validates and unwraps the core's paginated
  cloud-authorization response; `src/electron/main.ts` applies it before the
  response crosses the renderer bridge.
- `package.json` exposes the preload smoke command, while
  `tsconfig.node.json` compiles the `.cts` preload source.
- `tests/electron-window-options.test.ts` freezes the CommonJS preload path and
  renderer security settings. `tests/electron-desktop-list.test.ts` freezes
  the exact live response normalization and rejects malformed responses.
- `tasks/todo.md` closes the interactive acceptance step;
  `tasks/history.md` and this manifest record the implementation, evidence,
  recovered failures, and next route.

### User-goal mapping

The CommonJS preload fix restores the native picker and protected credential
bridge without weakening sandboxing. The list normalization aligns the live
paginated core response with the renderer's array contract. Together these
fixes allowed the named-fixture walkthrough and attach-only screenshot to close
UI-01.1, while the task documents route the next executable work to UI-01.2.

### Tests run

- Fresh executable verification: `npm test` passed all 46 files and 325 tests,
  including the two desktop-list and two BrowserWindow-options regressions.
  The intentional `Unexpected internal error` stderr line is the existing
  redacted-500 fixture, not a warning or regression.
- Fresh executable verification: `npm run build` passed TypeScript typecheck,
  Vite production compilation, and Node TypeScript compilation without
  warnings; it emitted `dist/electron/preload.cjs`.
- Fresh executable verification: `npm run smoke:preload` passed in a hidden,
  sandboxed Electron window with all nine picker, credential, and authorization
  bridge functions present.
- Interactive verification: the isolated `UI-01.1-macos-2026-07-29` fixture
  completed the full import, watched-folder, relink, provider disclosure, and
  credential authorization/revocation/removal walkthrough.
- Repository verification: `git diff --check` passed. A focused credential
  signature scan found one deliberate fake GitHub token in
  `tests/api-release-contract.test.ts` and no credential material in the
  shipping boundary.

### Interactive acceptance closure

- Computer Use's mandatory `sky.list_apps()` gate passed. The clean,
  isolated rerun used fixture `UI-01.1-macos-2026-07-29`, commit `af8ab23`,
  and macOS 26.5.2 (25F84), with both application and Electron credential data
  rooted under `/tmp/short-editor-ui-01.1-macos-20260729/`.
- Mixed import, watched-folder discovery/edit/disable/manual-rescan, wrong and
  confirmed relink candidates, passive provider readiness, private-network
  disclosure reset, and unauthorized OpenAI routing all passed visibly. The
  fake fixture credential was saved, authorized, revoked, and removed without
  queueing an external provider job.
- The rerun first reproduced the development ABI failure when Electron was
  launched without npm context, then recovered by supplying npm's host Node and
  completed every checkpoint. The full-window, attach-only Providers evidence
  is `UI-01.1-macos-2026-07-29.png`; it contains the named Episode, all three
  provider cards, and the private-network disclosure with no credential,
  token, private hostname, dialog, or unrelated desktop content.

### Skipped tests

- Native Windows packaged acceptance is unavailable on this macOS host and is
  outside UI-01.1's named macOS fixture. The CommonJS preload behavior is
  covered by build output, unit tests, the Electron smoke, and the interactive
  macOS walkthrough, but Windows packaging remains a release-gate risk.
- No lint script or task-document audit script exists. The full typecheck/build,
  full suite, preload smoke, diff hygiene, and focused credential scan are the
  available automated gates.

### Adversarial review

A failure-oriented changed-file review served as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It checked preload emission and runtime format, path resolution,
sandbox/isolation settings, smoke-list completeness, malformed response
handling, renderer contract shape, stale-source deletion, generated-pack
exclusion, and exact task/manifest scope.

Earlier interactive passes found the CommonJS preload mismatch and paginated
cloud-authorization bridge mismatch. Both are fixed with direct regressions.
The final review found no additional issue: the obsolete preload is deleted,
the build emits the referenced artifact, the smoke observes the bridge in an
actual Electron renderer, and the clean interactive rerun passed every UI-01.1
checkpoint.

### Residual risk

The desktop bridge, native picker round-trips, authorization lifecycle, and
required desktop framing work in the macOS development Electron shell. A
Windows user would be the first to notice a platform-specific packaged-preload
failure; that remains unproved until the Windows release-acceptance gate.

### Rollback note

Revert the acceptance-fix commit to restore the prior preload and raw paginated
bridge behavior. No database migration or durable-state rollback is required.

### Next command

Run `$guide` for the UI-01.2 named-fixture walkthrough covering transcript
editing, Candidate review, and accepted-copy recovery.

## News Brief + Speaker shipping boundary — 2026-07-29

### User goal

Ship the completed session boundary: add a production-renderable News Brief +
Speaker starter template and route the remaining project work into executable
UI workflow slices.

### Changed files

`docs/mcp-v1-tools.json`, `docs/release-interface-v1.json`,
`docs/release-interfaces-v1.md`, `src/core/captions.ts`,
`src/core/database.ts`, `src/core/render-composition.ts`,
`src/core/render-preflight.ts`, `src/core/service.ts`,
`src/shared/contracts.ts`, `src/shared/templates.ts`, `tasks/history.md`,
`tasks/ship-manifest.md`, `tasks/todo.md`, `tests/domain-contracts.test.ts`,
`tests/factories.ts`, `tests/migrations.test.ts`, `tests/render.test.ts`, and
`tests/template-assets.test.ts`.

### Per-file purpose

- `src/shared/contracts.ts` adds strict text-layer, media-layer, caption
  transform, and optional composition caption-preset schemas;
  `src/shared/templates.ts` defines the immutable News Brief + Speaker
  composition.
- `src/core/database.ts` installs the new built-in and upgrades existing
  caption styles in migration 17; `src/core/service.ts` materializes the
  template caption preset and enforces image-or-video media bindings.
- `src/core/captions.ts` shares deterministic Inter layout, measurement, and
  transformation helpers between analysis and rendering.
- `src/core/render-preflight.ts` validates media-layer assets;
  `src/core/render-composition.ts` advances the graph to v2 and renders bound
  topic text, related media, wrapped/ellipsized Inter text, transformed
  captions, and aligned word highlights.
- The three generated files under `docs/` publish the changed MCP composition
  schemas and their new release digest.
- `tests/domain-contracts.test.ts`, `tests/migrations.test.ts`,
  `tests/template-assets.test.ts`, and `tests/render.test.ts` cover strict
  schemas, migration preservation, materialization and binding rules,
  deterministic graphs, and a real FFmpeg output; `tests/factories.ts` updates
  the canonical caption fixture.
- `tasks/todo.md` records the completed boundary and promotes the five UI-01
  slices; `tasks/history.md` and this manifest record the session and evidence.

### User-goal mapping

The new immutable template expresses the complete requested split layout, and
Short creation binds its topic to the persisted title while inheriting its
caption preset. Strict schemas, service checks, migration 17, preflight, and
render graph v2 carry that layout safely from stored state through an actual
1080×1920 H.264/AAC output. Generated MCP schemas keep the public interface in
sync, while the task files route the remaining interactive work without
claiming that any UI slice is complete.

### Tests run

- Executable verification: `npm test` passed all 41 files and 311 tests,
  including the real FFmpeg News Brief render and existing determinism suite.
  The intentional `Unexpected internal error` stderr line is accepted output
  from the redacted-500 regression, not a product warning.
- Executable verification: `npm run build` passed TypeScript typecheck, the
  Vite production build, and Node TypeScript compilation without warnings.
- Artifact verification: two complete
  `npm run generate:release-interfaces` runs produced identical SHA-256
  digests for all three release-interface artifacts.
- Repository verification: `git diff --check` and a focused changed-file
  credential-signature scan passed.

### Skipped tests

- Native Windows NSIS packaging was skipped because the current host is macOS
  and this boundary does not alter packaging configuration. Packaged Windows
  acceptance remains a later release gate.
- Interactive UI acceptance was skipped because this session adds domain,
  migration, preflight, and rendering support but no UI controls. The promoted
  UI-01 slices own those workflows.
- No lint script or task-document audit script exists. Typecheck, production
  build, the full suite, deterministic generation, diff hygiene, and focused
  credential scanning are the available automated gates.

### Adversarial review

A failure-oriented review served as the equivalent review lane because no
repository-local `quality-sweep` or `expert-review` command is installed. It
checked legacy caption-style parsing and migration, built-in/user-template
preservation, strict text/media discriminants, image/video versus audio/logo
binding rejection, unbound optional slots, title binding, font fallback and
caching, FFmpeg filter escaping, wrapping and ellipsis bounds, word-highlight
placement, repeated media inputs, final-frame behavior, graph determinism, and
generated-schema drift. Focused and full regressions cover the material failure
classes; no unresolved finding remains.

### Residual risk

The real-media test proves a one-second image-backed composition on the current
FFmpeg build. Native Windows font/filter behavior, longer related videos, and
interactive authoring remain unproved until the Windows and UI acceptance
work. Text `clip` behavior intentionally draws within the configured
composition without a separate region mask; the built-in uses bounded wrapping
and ellipsis.

### Rollback note

Revert the feature commit before migration 17 is deployed. After migration,
reverting the code leaves the inserted built-in row and explicit
`textTransform: "none"` values in place; restore a pre-migration database
backup if an exact durable-state rollback is required.

### Next command

Run `$exec` for UI-01.1, starting with the library, watched-folder, relink,
provider-status, and cloud-authorization workflow.

## API-03 shipping boundary — 2026-07-29

### User goal

Freeze schemas and generate release-facing interface documentation.

### Changed files

`README.md`, `SPEC.md`, `IMPLEMENTATION_PLAN.md`, `package.json`,
`docs/release-interface-v1.json`, `docs/release-interfaces-v1.md`,
`scripts/generate-mcp-tool-inventory.ts`,
`scripts/generate-release-interface-docs.ts`, `src/mcp/registry.ts`,
`src/release/interface-docs.ts`, `src/shared/diagnostics.ts`,
`tests/api-contract.test.ts`, `tests/api-release-contract.test.ts`,
`tasks/history.md`, `tasks/ship-manifest.md`, and `tasks/todo.md`.

### Per-file purpose

- `src/release/interface-docs.ts` builds the compatibility manifest and
  release guide from the authoritative HTTP and MCP registries, validates every
  tool mapping, and hashes the exact serialized inventories.
- `src/shared/diagnostics.ts` defines the versioned export filter, including
  unconditional credential-field removal, recognizable token/private-key
  redaction, default path removal, circular-value handling, and sensitive-detail
  opt-in.
- `src/mcp/registry.ts` exposes the deterministic MCP inventory serializer;
  `scripts/generate-mcp-tool-inventory.ts` consumes it so runtime, tests, and
  generated artifacts share one implementation.
- `scripts/generate-release-interface-docs.ts`, `package.json`,
  `docs/release-interface-v1.json`, and `docs/release-interfaces-v1.md` provide
  the repeatable generation command and checked-in machine/human release
  contracts.
- `tests/api-release-contract.test.ts` freezes every generated artifact, exact
  MCP-to-HTTP mapping, and the diagnostic redaction corpus;
  `tests/api-contract.test.ts` proves stable-ID pagination during concurrent
  inserts.
- `README.md`, `SPEC.md`, and `IMPLEMENTATION_PLAN.md` publish and record the
  completed API-03 boundary; `tasks/todo.md`, `tasks/history.md`, and this
  manifest close and document the session.

### User-goal mapping

The v1 manifest records exact SHA-256 digests for the 60-operation HTTP
inventory and all 44 MCP input/output schema pairs, plus every exact
tool-to-route mapping. The generated Markdown guide explains the compatibility,
pagination, envelope, access, and diagnostic policies for release consumers.
Exact-artifact tests turn source or generated-document drift into a failing
gate. The versioned diagnostic filter always removes credential material and
requires explicit opt-in for transcript, source, and path detail.

### Tests run

- Executable verification: focused HTTP, MCP, and release-contract suites
  passed all 3 files and 27 tests.
- Executable verification: the full suite passed all 41 files and 302 tests,
  including real FFmpeg coverage. The intentional `Unexpected internal error`
  stderr line is accepted fixture output from the redacted-500 regression, not
  an unresolved product warning.
- Executable verification: production build/typecheck passed without warnings.
- Artifact verification: two complete release-interface generations produced
  identical artifacts.
- Repository verification: `git diff --check` and focused credential-pattern
  scans passed.

### Skipped tests

- Native Windows packaging and interactive UI diagnostics remain owned by
  WIN-03 and UI-03. API-03 changes platform-neutral contracts, generation, and
  filtering only.
- No lint script exists in `package.json`; typecheck, production build, full
  tests, deterministic generation, diff hygiene, and credential scanning are
  the available automated gates.

### Adversarial review

A failure-oriented review served as the equivalent review lane because no
repository-local `quality-sweep` or `expert-review` command is installed. It
checked artifact drift, duplicate or missing HTTP/MCP mappings, pagination
under concurrent inserts, strict compatibility claims, default-sensitive-field
removal, credential-bearing key variants, recognizable OpenAI/GitHub/AWS/JWT
values, bearer tokens, private-key blocks, absolute paths, nested values, and
circular payloads.

The review found that the initial filter omitted common `apiKey`-style field
names and credential formats beyond bearer and `sk-/pk-` tokens. The filter and
regression corpus now cover those cases. No blocking finding remains.

### Residual risk

The HTTP artifact freezes route identity and behavior metadata; the MCP artifact
contains the complete concrete Draft-07 request/response schemas. Interactive
diagnostic export UI wiring is intentionally deferred to UI-03.

### Rollback note

Revert the API-03 commit. No database migration or durable-state rollback is
required.

### Next command

No command is currently routed because `tasks/todo.md` has no promoted task.

## API-02 shipping boundary — 2026-07-29

### User goal

Freeze complete non-destructive MCP parity around the existing core HTTP API
with concrete schemas, versioned envelopes, cursor pagination, and no
credential or authorization bypass.

### Changed files

`.agents/project.json`, `SPEC.md`, `IMPLEMENTATION_PLAN.md`,
`docs/mcp-transition-audit.md`,
`docs/mcp-v1-tools.json`, `package.json`,
`scripts/generate-mcp-tool-inventory.ts`, `src/mcp/registry.ts`,
`src/mcp/server.ts`, `src/shared/contracts.ts`, `tasks/history.md`,
`tasks/ship-manifest.md`, `tasks/todo.md`, `tests/mcp-contract.test.ts`, and
the existing MCP workflow parity tests.

Generated local agent configuration directories remain unrelated and excluded.

### Per-file purpose

- `.agents/project.json` records the installed `investigate` project skill.
- `src/mcp/registry.ts` is the frozen 44-tool authority for discovery,
  registration, concrete input/output schemas, safe annotations, HTTP mappings,
  request construction, and redacted response translation.
- `src/mcp/server.ts` is the thin stdio entrypoint and re-exports the testable
  registry/factory surface.
- `src/shared/contracts.ts` adds shared versioned success, import,
  watched-folder configuration, local-status, and render-probe schemas.
- `scripts/generate-mcp-tool-inventory.ts`, `package.json`, and
  `docs/mcp-v1-tools.json` provide the deterministic checked-in discovery
  generator, command, and generated artifact.
- `tests/mcp-contract.test.ts` freezes the inventory, strict schemas,
  annotations, discovery, envelope/error translation, pagination/filter
  forwarding, URI construction, authorization rejection, and redaction.
- `tests/candidate-integration.test.ts`, `tests/render-preflight.test.ts`,
  `tests/short-lifecycle.test.ts`, and `tests/transcript-editing.test.ts` update
  real workflow parity assertions for complete versioned MCP envelopes.
- `docs/mcp-transition-audit.md` classifies typed MCP transitions, user-only
  security gates, and diagnostic helpers.
- `SPEC.md` and `IMPLEMENTATION_PLAN.md` record the implemented contract and
  evidence; `tasks/todo.md` closes API-02 and promotes API-03;
  `tasks/history.md` records the session; this file records the ship boundary.

### User-goal mapping

The authoritative registry makes runtime discovery, request routing, generated
documentation, and tests agree on exactly 44 non-destructive tools. Concrete
strict schemas and shared typed envelopes deliver parity without arbitrary
records or flattened errors. Cursor forwarding preserves the HTTP contract,
while the transition audit and authorization regressions prove that desktop
credentials and cloud authorization remain user-only gates.

### Tests run

- Executable verification: `npm test` passed all 40 test files and 296 tests,
  including real FFmpeg coverage. The redaction regression intentionally wrote
  `Unexpected internal error` to stderr while passing; this is accepted fixture
  output, not an unresolved product warning.
- Executable verification: `npm run build` passed TypeScript typecheck, the Vite
  production build, and Node TypeScript compilation without warnings.
- Artifact verification: two `npm run generate:mcp-inventory` runs produced the
  same SHA-256,
  `b2626ba7bfb858cdbe8205c14e9952d01ca5dc10b6fe67265a988fdd9690975e`.
- Repository checks: `git diff --check` passed, and focused changed-file
  credential/secret scans found no credential material.

### Skipped tests

- Native Windows NSIS packaging and packaged MCP startup were skipped on the
  current macOS host; WIN-03 owns that release gate.
- Interactive UI-to-MCP acceptance was skipped because this boundary changes no
  UI and the transition inventory is documentation-only; UI-01 owns interactive
  workflow proof.
- No lint script exists in `package.json`; typecheck, production build, the full
  suite, artifact generation, and diff hygiene are the available executable
  gates.

### Adversarial review

A failure-oriented review served as the equivalent configured review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It checked duplicate tool names and mappings, unknown and forged
authorization fields, loose composition inputs, unencoded path/query values,
cursor over-fetching, malformed/non-JSON cores, network error redaction,
registered error preservation, success output validation, and destructive
annotations. The focused contract suite exercises these failure classes; no
unresolved finding remains.

### Residual risk

MCP success values intentionally become v1 envelopes and list values
intentionally become single cursor pages. Four undocumented MCP helpers are
removed; their HTTP routes remain. Input-schema failures stay MCP
invalid-parameter errors, while requests reaching the core retain its
structured envelope. Native Windows and interactive UI acceptance remain owned
by WIN-03 and UI-01; no database or HTTP route changed.

### Rollback note

Revert the API-02 commit to restore the prior monolithic MCP entrypoint and
unversioned MCP results. The generated inventory and transition audit can be
removed with the same revert; no data migration or durable-state rollback is
required.

### Next command

Run `$exec` to begin API-03 schema freeze and release-facing interface
generation.

## API-01 shipping boundary — 2026-07-28

### User goal

Complete, harden, and freeze the versioned loopback HTTP API without removing
existing workflow operations or introducing durable-entity deletion.

### Changed files

`SPEC.md`, `docs/api-v1-routes.json`, `package.json`,
`scripts/generate-api-route-inventory.ts`, `src/core/api.ts`,
`src/core/candidates.ts`, `src/core/cli.ts`, `src/core/repository.ts`,
`src/core/service.ts`, `src/mcp/server.ts`, `src/shared/contracts.ts`,
`src/ui/api.ts`, `tasks/history.md`, `tasks/ship-manifest.md`, `tasks/todo.md`,
and `tests/api-contract.test.ts`.

Generated local agent configuration directories remain unrelated and excluded.

### Per-file purpose

- `src/core/api.ts` centralizes registration, classification, strict input
  parsing, pagination, envelopes, redaction, and loopback defaults for all 60
  operations.
- `src/shared/contracts.ts` defines reusable page contracts;
  `src/core/repository.ts` and `src/core/candidates.ts` add stable ID
  tie-breakers; `src/core/service.ts` closes the final non-strict import input.
- `src/core/cli.ts` consumes the exported loopback default; `src/ui/api.ts`
  unwraps HTTP pages; `src/mcp/server.ts` traverses pages to retain its current
  list behavior until API-02.
- `scripts/generate-api-route-inventory.ts`, `package.json`, and
  `docs/api-v1-routes.json` provide a deterministic offline inventory command
  and checked-in artifact.
- `tests/api-contract.test.ts` covers inventory uniqueness, classifications,
  paging, cursor isolation/staleness, strict query/body rejection, envelopes,
  redaction, loopback binding, desktop-token gates, and the absence of durable
  deletion.
- `SPEC.md` freezes the completed v1 behavior; `tasks/todo.md`,
  `tasks/history.md`, and this manifest close API-01, record evidence, and route
  API-02.

### User-goal mapping

The authoritative table prevents route-registration and documentation drift.
Strict inputs and universal envelopes harden every HTTP boundary. Stable
repository ordering plus operation/filter-bound cursors make every unbounded
collection finite and repeatably traversable. The UI/MCP adapters preserve
their existing caller behavior, while the inventory, focused regressions, and
specification freeze the exact API-01 compatibility boundary without adding
durable deletion.

### Tests run

- Executable verification: `npm test` passed all 39 test files and 288 tests,
  including real FFmpeg coverage.
- Post-review executable verification:
  `npx vitest run --config vitest.config.ts tests/api-contract.test.ts` passed
  all 14 focused tests after the unknown-query fix.
- Executable verification: `npm run build` passed TypeScript typecheck, Vite
  production build, and Node TypeScript compilation after the review fix.
- Generated-artifact verification: two inventory generations were
  byte-identical before review; the post-review generation changed no route
  metadata.
- Repository/security verification: `git diff --check` passed and the focused
  changed-boundary credential signature scan returned zero matches.

### Skipped tests

- Native Windows NSIS packaging and packaged loopback/firewall behavior were
  skipped because the current host is macOS; WIN-03 owns release-platform
  acceptance, and this boundary does not change packaging.
- Interactive UI workflow testing was skipped because the UI change only
  unwraps the same paginated Episode/job data into its existing arrays; UI-01
  owns end-to-end workflow acceptance.
- No lint script or repository task-doc audit script exists. Typecheck,
  production build, full/focused tests, generation stability, diff hygiene,
  and the focused credential scan are the available automated gates.

### Adversarial review

A failure-oriented review traced all 60 route classifications, the sole
non-destructive `DELETE`, every paginated collection, cursor decoding and
operation/filter binding, stable ordering, strict mutation bodies, fallback and
internal-error envelopes, desktop-token comparisons, UI/MCP traversal, and
generated-inventory drift.

The review found that four queryless GET routes accepted unknown parameters
despite the specification requiring validation on every query surface.
`system.health`, Episode detail, Candidate content-package detail, and Short
detail now parse a strict empty query, and one regression exercises all four.
The focused suite and production build pass after the fix. The intentional
`Unexpected internal error` stderr line is accepted because that test
deliberately exercises and verifies the redacted 500 path. No blocking finding
remains.

### Residual risk

Pagination operates over current in-memory query results rather than a database
snapshot, so concurrent insertions can move page boundaries; cursors reject a
missing last item and stable ID tie-breakers prevent ambiguous equal-sort
positions, but snapshot isolation is not promised in v1. API-02 still owns
exact MCP tool inventory, structured MCP envelopes, and concrete output
schemas. UI and packaged Windows loopback acceptance remain in their existing
tasks.

### Rollback note

This boundary adds no database migration. Reverting these source, generated,
test, and documentation changes restores array list responses and the prior
per-route Express registration without changing persisted data.

### Next command

Run `npx skillpacks install exec-loop` from the project shell before invoking
`$exec` for API-02 typed MCP parity.

## SCH-02 shipping boundary — 2026-07-28

### User goal

Complete deterministic schedule drafting, legal moves, permanent publication
locking, and manual publication recording semantics.

### Changed files

`SPEC.md`, `src/core/api.ts`, `src/core/repository.ts`,
`src/core/scheduler.ts`, `src/core/service.ts`, `src/mcp/server.ts`,
`src/shared/contracts.ts`, `tasks/history.md`, `tasks/ship-manifest.md`,
`tasks/todo.md`, and `tests/schedule-semantics.test.ts`.

Generated `.agents/skillpacks/`, `.claude/`, and `.codex/` local artifacts are
unrelated and excluded.

### Per-file purpose

- `src/shared/contracts.ts` defines strict move/publication requests and complete
  entry lock/URL invariants.
- `src/core/scheduler.ts` incorporates persisted same-Episode occupancy and
  validates exact instants against current legal wall-clock slots.
- `src/core/repository.ts` returns public schedule entities and applies guarded,
  exact-CAS entry transitions including permanent publication locks.
- `src/core/service.ts` makes drafting, moves, and publication transactional and
  enforces eligibility, uniqueness, current rules, collisions, spacing, and
  rerender state.
- `src/core/api.ts` and `src/mcp/server.ts` use the same strict shared inputs and
  typed schedule-entry outputs.
- `tests/schedule-semantics.test.ts` covers the completed state, scheduling,
  move, publication, lock, and transport behavior.
- `SPEC.md` records the completed implementation evidence.
- `tasks/todo.md` closes SCH-02 and promotes API-01.
- `tasks/history.md` records the behavior, verification, and deferred native/UI
  proof.
- `tasks/ship-manifest.md` documents this exact shipping and rollback boundary.

### User-goal mapping

The scheduler and service provide deterministic eligible drafting against both
new and persisted entries. The repository and service enforce legal
collision-free moves, exact revisions, one-way states, rerender protection, and
permanent publication locks. Shared contracts plus HTTP/MCP adapters expose the
same validated behavior, while the focused suite proves the required boundary
and the task/spec records make the completed scope and next task explicit.

### Behavior and evidence

- Drafting requires an approved current successful Render with passing
  validation and accepted determinism evidence, rejects duplicate/already
  scheduled Shorts, preserves priority plus stable-ID ordering, and applies
  same-Episode spacing against both new and persisted entries.
- Moves require exact entry CAS, a slot legal under the current persisted rules,
  no occupied instant, and valid same-Episode spacing. A successful move
  transitions `draft` or `planned` to `planned` and increments once.
- Publication is manual recordkeeping only. It accepts an optional HTTPS
  `youtube.com`/`youtu.be` URL, rejects rerender-needed or already published
  entries, transitions to `published`, and locks the row permanently.
- Shared strict request schemas drive HTTP and typed MCP. Schedule reads return
  the public camel-case domain contract rather than database rows.
- `tests/schedule-semantics.test.ts` covers stable ties, daily slots, persisted
  spacing, rollback, illegal/colliding moves, stale revisions, rerender blocks,
  optional valid/invalid URLs, permanent locks, and HTTP/MCP parity. Existing
  preflight coverage proves the over-60-second Content ID warning.

### Tests run

- `npx vitest run --config vitest.config.ts
  tests/schedule-semantics.test.ts`: all 6 focused tests passed after adding the
  adversarial same-Episode move assertion.
- `npm test`: 38 files and 275 tests passed, including real FFmpeg coverage.
- `npm run build`: typecheck, Vite production build, and Node TypeScript build
  passed without warnings.
- `git diff --check` passed.
- A filename-only changed-file credential scan found no private-key, token,
  password, secret, or API-key material.

### Skipped tests

- Native Windows NSIS packaging and packaged timezone/calendar behavior were
  skipped on the current macOS host; WIN-03.7 owns that release gate.
- Interactive list/calendar, stale-save, and post-publication Short-edit checks
  were skipped because this boundary adds no UI; UI-01.5 owns those checks, and
  existing repository suites provide executable published-entry immutability
  coverage.
- No lint command exists in `package.json`; the full suite, typecheck,
  production build, diff hygiene, and focused credential scan are the available
  automated gates.

### Adversarial review

A failure-oriented changed-file review served as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It traced duplicate inputs, already-scheduled Shorts, persisted
same-Episode spacing, invalid/stale Render evidence, exact rule and entry
revisions, illegal/colliding moves, timezone changes, one-way state transitions,
rerender blocks, YouTube URL validation, published-row immutability, transaction
rollback, and HTTP/MCP parity.

The review found an evidence gap: move-time same-Episode spacing was enforced
but not directly asserted by the focused suite. The move fixture now uses two
entries from one Episode and proves an otherwise legal unoccupied slot is
rejected when it violates spacing. The focused test and full suite pass after
the fix. No blocking finding remains.

### Residual risk

Interactive list/calendar behavior is assigned to UI-01.5. Packaged Windows
calendar and timezone behavior is assigned to WIN-03.7. No YouTube OAuth,
upload, authentication, or remote-publication verification was added.

### Rollback note

This boundary adds no migration. Reverting its source, test, and documentation
changes restores the SCH-01 behavior without changing persisted data. Entries
already marked published should remain treated as immutable during rollback.

### Next command

Run `npx skillpacks install exec-loop` from the project shell before invoking
`$exec` for API-01 versioned HTTP API inventory and contract coverage.

## SCH-01 shipping boundary — 2026-07-28

### User goal

Persist canonical revisioned schedule rules and implement deterministic,
machine-timezone-independent DST resolution with a documented warning policy
through the core, HTTP, and typed MCP boundaries.

### Changed files

`IMPLEMENTATION_PLAN.md`, `SPEC.md`, `src/core/api.ts`,
`src/core/database.ts`, `src/core/repository.ts`, `src/core/scheduler.ts`,
`src/core/service.ts`, `src/mcp/server.ts`, `src/shared/contracts.ts`,
`tasks/history.md`, `tasks/ship-manifest.md`, `tasks/todo.md`,
`tests/domain-contracts.test.ts`, `tests/migrations.test.ts`,
`tests/persistence.test.ts`, `tests/schedule-rules.test.ts`, and
`tests/scheduler.test.ts`.

Generated `.agents/skillpacks/`, `.claude/`, and `.codex/` local artifacts are
unrelated and excluded. No path under `.claude/skills/` or
`.codex/skills/` is tracked. `.agents/project.json` remains tracked and
unchanged. There are no earlier unpushed commits or unrelated tracked changes
in the boundary.

### Per-file purpose

- `src/shared/contracts.ts` defines strict schedule-rule updates, schedulable
  Shorts, draft results, the v1 DST policy, warnings, canonical-value
  constraints, and timezone-database diagnostics.
- `src/core/database.ts` adds migration 16 and preserves legacy rule snapshots
  with explicit `unknown` timezone-database provenance.
- `src/core/repository.ts` reads, creates, and exactly replaces complete
  revisioned snapshots including timezone-database provenance.
- `src/core/scheduler.ts` resolves explicit-zone wall times, implements exact
  gap shifting and earlier-overlap selection, emits selected-slot warnings,
  and returns rule/resolver provenance with deterministic drafts.
- `src/core/service.ts` canonicalizes full snapshots, coordinates first-create
  and CAS updates, requires the persisted rule revision for drafting, validates
  current approved deterministic Renders, binds each Short to its persisted
  owning Episode, and inserts the draft atomically.
- `src/core/api.ts` and `src/mcp/server.ts` expose strict matching rule read,
  update, and persisted-revision draft operations.
- `tests/scheduler.test.ts` covers gaps, overlaps, non-hour transitions,
  historical/future offsets, host-zone independence, warning selection,
  cadence, blackouts, occupation, and Episode spacing.
- `tests/schedule-rules.test.ts` covers creation, canonicalization, CAS,
  invalid snapshots, persisted-revision drafting, Short/Episode ownership, and
  HTTP/MCP parity. The migration, persistence, and domain-contract suites cover
  migration 16 and the expanded strict entity surface.
- `SPEC.md` and `IMPLEMENTATION_PLAN.md` document the implemented DST and
  revision policy and distinguish SCH-02/UI work. `tasks/todo.md` closes
  SCH-01 and promotes SCH-02; `tasks/history.md` records the completed behavior
  and evidence; this manifest records the exact shipping boundary.

### User-goal mapping

The shared schemas, migration, repository, and service form one durable
full-snapshot rule lifecycle with canonical storage and exact revisions. The
resolver and scheduler preserve configured wall-clock intent using an explicit
versioned anomaly policy and expose enough provenance to diagnose runtime
timezone-data differences. HTTP and MCP use the same strict contracts and core
logic. The executable suites exercise every promised persistence, resolution,
transport, and rollback boundary.

### Tests run

- Executable verification: `npm test` passed all 37 test files and 269 tests,
  including real FFmpeg coverage and the new DST/rule/ownership regressions.
- Executable verification: `npm run build` passed application typecheck, Vite
  production build, and Node TypeScript compilation without warnings.
- Repository verification: `git diff --check` passed.
- Security verification: a focused changed-file scan found no private-key,
  credential, token, password, secret, or API-key material.

### Skipped tests

- Native Windows NSIS packaging and Windows timezone-database behavior were
  skipped because the current host is macOS; WIN-03.7 owns the packaged
  calendar acceptance gate.
- Interactive stale-save, spring/fall warning, calendar, and recovery checks
  were skipped because this boundary adds core/HTTP/MCP behavior rather than
  the calendar UI; UI-01.5 owns that acceptance.
- No lint script exists in `package.json`; the full suite, typecheck,
  production build, diff hygiene, and focused security scan are the available
  automated gates.

### Adversarial review

A failure-oriented changed-file review served as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It traced invalid/canonical snapshots, missing and stale revisions,
concurrent first writes, migration preservation, host timezone leakage,
ordinary/gap/overlap resolution, non-one-hour transitions, warning selection,
occupied slots, transaction rollback, approved/current/deterministic Render
eligibility, caller-controlled identity fields, and HTTP/MCP parity.

The review found that an otherwise valid Short/Render could be paired with a
caller-supplied unrelated Episode ID, bypassing same-Episode spacing and
persisting inconsistent ownership. The service now requires the requested
Episode to match the persisted Short, and a regression test proves rejection
leaves the schedule unchanged. No blocking finding remains.

### Residual risk

Runtime `Intl` behavior is covered for ordinary, gap, overlap, non-hour,
historical, future, and host-zone-independent cases on the current Node/macOS
stack, but packaged Windows may ship different timezone data. The stored
write-time and resolver versions make such differences diagnosable; WIN-03.7
must repeat the fixtures on the release build. Move, lock, publication URL,
rerender, and interactive calendar semantics remain explicitly assigned to
SCH-02 and UI-01.5.

### Rollback note

Revert the SCH-01 feature commit before deploying migration 16. After a
database has migrated, restore a pre-migration backup before running older
application code because older code does not write or understand the
timezone-database diagnostic column.

### Next command

Run `npx skillpacks install exec-loop` from the project shell before invoking
`$exec` for SCH-02 draft, move, lock, and publication semantics.

## RND-04 shipping boundary — 2026-07-28

### User goal

Add safe Render cancellation, immutable bounded retry attempts, and
pair-consistent crash recovery without adopting newer Short edits or leaking
unsafe filesystem diagnostics.

### Changed files

`IMPLEMENTATION_PLAN.md`, `SPEC.md`, `src/core/api.ts`,
`src/core/artifact-store.ts`, `src/core/bootstrap.ts`,
`src/core/database.ts`, `src/core/jobs.ts`, `src/core/render.ts`,
`src/core/repository.ts`, `src/core/service.ts`, `src/mcp/server.ts`,
`src/shared/contracts.ts`, `tasks/history.md`, `tasks/ship-manifest.md`,
`tasks/todo.md`, `tests/artifact-store.test.ts`,
`tests/domain-contracts.test.ts`, `tests/migrations.test.ts`,
`tests/render.test.ts`, `tests/repository.test.ts`, and
`tests/transcript-editing.test.ts`.

Generated `.agents/skillpacks/`, `.claude/`, and `.codex/` local artifacts are
unrelated and excluded. No path under `.claude/skills/` or `.codex/skills/` is
tracked. `.agents/project.json` remains tracked and unchanged. There are no
earlier unpushed commits or unrelated tracked changes in the boundary.

### Per-file purpose

- `src/shared/contracts.ts` exposes immutable Render lineage, predecessor, and
  attempt values through the strict public entity contract.
- `src/core/database.ts` adds migration 15 lineage storage, indexes, and
  insert/update integrity triggers while upgrading every legacy Render to a
  one-attempt self-rooted lineage.
- `src/core/repository.ts` creates snapshot-bound retries in immediate
  transactions, caps each lineage at three attempts, guards completion against
  late cancellation, reconciles Render/Job pairs, and identifies invalid
  completed-artifact state.
- `src/core/jobs.ts` atomically cancels queued Render/Job pairs, retains a
  durable cancellation request for running work, bounds automatic reclaim, and
  preserves a committed Render success across a late cancellation race.
- `src/core/render.ts` observes cancellation through dependency checks, input
  hashing, encoding, probing, normalization, artifact finalization, and
  completion; it escalates subprocess termination after two seconds and
  removes interrupted attempt output.
- `src/core/artifact-store.ts` makes streaming hashes cancellation-aware,
  redacts disk/finalization failures, and removes artifact records/files left
  by an interrupted Render.
- `src/core/bootstrap.ts` orders artifact reconciliation, Render validation,
  pair recovery, and interrupted-output cleanup at startup.
- `src/core/service.ts`, `src/core/api.ts`, and `src/mcp/server.ts` expose the
  same manual retry behavior through core, HTTP, and typed MCP boundaries.
- `tests/artifact-store.test.ts`, `tests/migrations.test.ts`,
  `tests/repository.test.ts`, and `tests/render.test.ts` cover redaction,
  upgrades, lineage/retry constraints, pair recovery, cooperative
  cancellation, cleanup, and the real-media path. The remaining test files
  update strict Render fixtures and contract assertions.
- `SPEC.md` and `IMPLEMENTATION_PLAN.md` record the implemented recovery
  boundary and deferred native gates. `tasks/todo.md` closes RND-04 and promotes
  SCH-01; `tasks/history.md` records behavior and evidence; this manifest
  records the exact ship and rollback boundary.

### User-goal mapping

Migration and public contracts make every attempt durably distinguishable.
Repository transactions retain the exact failed/cancelled attempt snapshot and
serialize bounded retries. Job, renderer, and artifact-store changes carry one
durable cancellation signal through all long-running stages and prevent a
cancelled attempt from retaining output. Startup reconciliation restores a
consistent Render/Job pair, preserves committed success, makes interrupted
unsafe work manually recoverable, and removes its artifacts. Focused and
real-media tests exercise each layer through the public and persistence
boundaries.

### Tests run

- Executable verification: `npm test` passed all 36 files and 258 tests,
  including the real FFmpeg render/retry/cancellation path.
- Executable verification: `npm run build` passed application typecheck, Vite
  production build, and Node TypeScript compilation without warnings.
- Repository verification: `git diff --check` passed.
- Security verification: a focused added-line scan found no private-key,
  credential, token, password, secret, or API-key signatures.

### Skipped tests

- Native Windows NSIS packaging and packaged FFmpeg/FFprobe forced-termination
  behavior were skipped because the current host is macOS; WIN-03.6/.9 own
  those release gates.
- A real operating-system crash at every filesystem/database boundary was not
  injected. Repository/startup tests simulate the durable states, and
  real-media tests prove cleanup during controlled cancellation, but native
  packaged fault injection remains a release-gate risk.
- Human UI retry/cancellation history and audiovisual inspection were skipped
  because this boundary adds core/HTTP/MCP behavior rather than the editor
  workflow; UI-01.4 owns that acceptance.
- No lint script exists in `package.json`; the full suite, typecheck,
  production build, diff hygiene, and focused security scan are the available
  automated gates.

### Adversarial review

A failure-oriented changed-file review served as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It traced malformed/legacy lineage, concurrent retries, stale or
unapproved revisions, superseded and exhausted attempts, invalid persisted job
snapshots, queued and running cancellation races, cancellation after artifact
finalization, committed-success recovery, orphan/mismatched Render/Job pairs,
bounded non-Render reclaim, disk exhaustion, path/error redaction, subprocess
termination, and HTTP/MCP parity. Strict schemas, SQLite immediate
transactions/triggers, guarded state transitions, cleanup paths, migration
coverage, and real-media assertions cover the reviewed boundary. No blocking
finding remains.

### Residual risk

The executable evidence covers the macOS process and SQLite behavior, but not
the packaged Windows signal semantics or abrupt native process death between
every individual fsync/rename/transaction step. Those failures should first be
visible as a terminal recovery-required attempt with its own output removed;
WIN-03.6/.9 must close the native packaged gates. The three-attempt retry
surface is available through HTTP/MCP, but the human attempt-history and
recovery experience remains UI-01.4.

### Rollback note

Revert the RND-04 feature commit before deploying migration 15. After migration
15 has run, restore a pre-migration backup instead of down-migrating because
older code does not understand the required lineage columns. Each interrupted
or cancelled attempt owns only its own artifact records and files.

### Next command

Run `npx skillpacks install exec-loop` from the project shell before invoking
`$exec` for SCH-01 revisioned schedule rules and documented DST policy.

## RND-03 shipping boundary — 2026-07-28

### User goal

Gate Render success on persisted normalized frame/audio determinism evidence,
using the first equivalent successful attempt as an immutable baseline.

### Changed files

`IMPLEMENTATION_PLAN.md`, `SPEC.md`, `src/core/database.ts`,
`src/core/render.ts`, `src/core/repository.ts`, `src/core/service.ts`,
`src/shared/contracts.ts`, `src/shared/job-messages.ts`, `tasks/history.md`,
`tasks/ship-manifest.md`, `tasks/todo.md`, `tests/domain-contracts.test.ts`,
`tests/job-messages.test.ts`, `tests/migrations.test.ts`,
`tests/render.test.ts`, and `tests/transcript-editing.test.ts`.

Generated `.agents/skillpacks/`, `.claude/`, and `.codex/` local artifacts are
unrelated and excluded.

### Per-file purpose

- `src/shared/contracts.ts` defines strict versioned normalized evidence and
  adds it to the Render entity; `src/shared/job-messages.ts` adds the same typed
  boundary to Render job results.
- `src/core/database.ts` adds migration 14 evidence storage, lookup indexing,
  and safe demotion of legacy successes that lack evidence.
- `src/core/render.ts` stream-hashes canonical decoded video/audio, binds the
  completed FFmpeg/graph provenance into identity, and removes mismatch output.
- `src/core/repository.ts` persists and validates evidence and serializes
  baseline/match/mismatch completion in an immediate transaction.
- `src/core/service.ts` permits scheduling only from a current approved Render
  with `baseline` or `matched` evidence.
- `tests/domain-contracts.test.ts` and `tests/job-messages.test.ts` prove strict
  public evidence schemas; `tests/migrations.test.ts` proves migration 14 and
  every prior upgrade path.
- `tests/render.test.ts` proves identity changes, normalization redaction, real
  repeated rendering, metadata independence, separate pixel/audio mismatch
  detection, cleanup, and prior-output immutability.
- `tests/transcript-editing.test.ts` updates the existing strict Render fixture
  for the new nullable evidence field.
- `SPEC.md` and `IMPLEMENTATION_PLAN.md` record the completed RND-03 contract
  and retain RND-04/WIN-03.6/UI-01.4 as explicit later work.
- `tasks/todo.md` promotes RND-04; `tasks/history.md` records implementation and
  executable evidence; this manifest records the exact shipping boundary.

### User-goal mapping

The shared contracts and migration make evidence durable and inspectable. The
renderer produces canonical stream evidence with the captured executable, while
the repository transaction establishes one immutable equivalent-attempt
baseline and rejects divergent output. Scheduling enforcement prevents a
validation-only or mismatched Render from becoming downstream publish input.
Contract, migration, and real-media tests exercise each layer of that path.

### Tests run

- Executable verification: `npm test` passed all 36 files and 256 tests,
  including the real FFmpeg baseline, repeat-match, and mismatch-cleanup path.
- Executable verification: `npm run build` passed TypeScript typecheck, Vite
  production build, and Node TypeScript compilation without warnings.
- Repository verification: `git diff --check` passed.
- Security verification: a focused added-line scan found no private-key,
  credential, token, password, or API-key signatures.

### Skipped tests

- Native Windows NSIS packaging and packaged release-FFmpeg/font behavior were
  skipped because the current host is macOS; WIN-03.6 owns that release gate.
- Human visual/audio inspection and interactive attempt history were skipped
  because this change is the core determinism gate; UI-01.4 owns the workflow
  and visible/audible acceptance.
- Crash recovery and retry-lineage fault injection were skipped because RND-04
  is the promoted task that owns those state transitions.
- No lint script exists in `package.json`; typecheck, the full Vitest suite,
  production build, diff hygiene, and focused security scan are the available
  executable gates.

### Adversarial review

A failure-oriented changed-file review served as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It traced malformed evidence, migration compatibility, concurrent
baseline selection, stale revisions, mismatching video or audio, cancellation
between finalization and completion, sidecar/output/artifact rollback,
normalization byte bounds and error redaction, scheduling eligibility, and
unchanged prior successes. The implementation already covers these paths with
strict parsing, an immediate completion transaction, bounded no-shell FFmpeg
decoding, guarded state transitions, and real-media cleanup assertions. No
blocking finding remains.

### Residual risk

The real-media fixture proves the macOS FFmpeg path and exact-build identity,
but does not prove the packaged Windows binary or human audiovisual quality;
WIN-03.6 and UI-01.4 own those checks. A process crash after media finalization
but before database completion may require startup reconciliation, and attempt
retry lineage is not yet user-facing; RND-04 is the concrete next task.

### Rollback note

Revert the RND-03 commit before deploying migration 14. After migration 14 has
run, restore a pre-migration backup rather than attempting a down migration.
Legacy output paths are retained by the migration, and failed new attempts
remove only their own artifact files and records.

### Next command

Run `npx skillpacks install exec-loop` from the project shell before invoking
`$exec` for RND-04 cancellation, retries, and crash recovery.

## RND-02 shipping boundary — 2026-07-28

### User goal

Compose one immutable approved Short revision from original sources with an
explicit FFmpeg graph, validate and atomically finalize its MP4 and optional
caption sidecar, and expose a strict snapshot-bound render-start contract.

### Changed files

`IMPLEMENTATION_PLAN.md`, `SPEC.md`, `src/core/api.ts`,
`src/core/artifact-store.ts`, `src/core/bootstrap.ts`, `src/core/database.ts`,
`src/core/render-composition.ts`, `src/core/render-preflight.ts`,
`src/core/render.ts`, `src/core/repository.ts`, `src/core/service.ts`,
`src/mcp/server.ts`, `src/shared/contracts.ts`,
`src/shared/job-messages.ts`, `tasks/history.md`,
`tasks/ship-manifest.md`, `tasks/todo.md`,
`tests/domain-contracts.test.ts`, `tests/job-messages.test.ts`,
`tests/render.test.ts`, and `tests/transcript-editing.test.ts`.

Generated `.agents/skillpacks/`, `.claude/`, and `.codex/` local artifacts are
unrelated and excluded from the commit. No path under `.claude/skills/` or
`.codex/skills/` is tracked. `.agents/project.json` remains tracked and
unchanged. There are no earlier unpushed commits or unrelated tracked changes
in the shipping boundary.

### Per-file purpose

- `src/core/render-composition.ts` builds the deterministic explicit filter
  script and direct FFmpeg argument vector for ordered source ranges, template
  layers, fit/fill, independent crops, captions, source audio, bed audio, and
  fixed H.264/AAC output settings.
- `src/core/render.ts` executes FFmpeg without a shell, reports progress,
  validates captured inputs and dependency versions before and after encoding,
  ffprobes output, redacts process errors, and coordinates cancellation, stale
  revisions, artifact cleanup, and successful completion.
- `src/core/artifact-store.ts` adds exclusive external-producer reservations,
  streaming hashes, validation, fsync/rename finalization, and rollback of
  finalized artifacts.
- `src/core/database.ts` adds migration 13 bindings from Render attempts to
  immutable preflights plus optional sidecar paths.
- `src/core/repository.ts` atomically creates matching Render/job rows and
  guards Render state transitions and final current-revision approval.
- `src/core/render-preflight.ts` persists and validates the complete typed
  render snapshot needed by the renderer.
- `src/core/bootstrap.ts` installs the render job handler.
- `src/shared/contracts.ts` and `src/shared/job-messages.ts` define strict
  Render, start request/result, sidecar, and job payload shapes.
- `src/core/service.ts`, `src/core/api.ts`, and `src/mcp/server.ts` expose the
  same preflight-bound start operation through core, HTTP, and MCP.
- `tests/render.test.ts` covers strict starts, all starter-template graphs,
  deterministic special/spaced-path arguments, a real composed MP4 and WebVTT
  sidecar, output validation/provenance, and unchanged source bytes. The three
  other test files update existing strict Render/job fixtures.
- `SPEC.md` and `IMPLEMENTATION_PLAN.md` record the implemented RND-02 boundary
  and defer determinism comparison, retry/recovery, UI acceptance, and native
  evidence to their owning tasks.
- `tasks/todo.md`, `tasks/history.md`, and `tasks/ship-manifest.md` close RND-02,
  preserve its evidence, and promote RND-03.

### User-goal mapping

The graph builder converts the immutable RND-01 snapshot into the required
original-source video/audio composition. The executor, external artifact
boundary, migration, and guarded repository lifecycle ensure only a current,
approved, ffprobe-valid result becomes successful. Shared contracts and
HTTP/MCP adapters require the exact passing preflight. The focused graph and
real-media tests prove the executable path, while project/task documentation
routes the intentionally deferred determinism and recovery scope.

### Tests run

- Executable verification: `npm test` passed all 36 test files and 251 tests,
  including `tests/render.test.ts` and its real FFmpeg composition.
- Executable verification: `npm run build` passed application typecheck, Vite
  production build, and Node TypeScript compilation.
- Repository verification: `git diff --check` passed without warnings.
- Security verification: the focused changed-path private-key/token signature
  scan found no secret-like content.

### Skipped tests

- Native Windows NSIS packaging and packaged FFmpeg/font behavior were skipped
  because the current host is macOS; WIN-03.6 owns that release evidence.
- UI progress, visible/audible composition review, and interactive cancellation
  were skipped because UI-01.4 owns the render workflow and Computer Use
  acceptance. The core boundary is instead covered by deterministic graph
  assertions and a real locally rendered H.264/AAC fixture.
- Disk-full fault injection, queued-cancel reconciliation, retry lineage, and
  crash recovery were not used as RND-02 success proof because RND-04 owns those
  advanced interruption/recovery guarantees. RND-02 verifies exclusive output,
  validation cleanup, stale-revision cleanup, and running-process cancellation
  boundaries in its implementation review.
- No lint command exists in `package.json`; TypeScript compilation, the full
  Vitest suite, production build, and diff hygiene are the available executable
  gates.

### Adversarial review

A failure-oriented changed-file review served as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It traced snapshot/job/Render binding, passing-preflight enforcement,
revision races before and after artifact finalization, input byte and dependency
changes, no-shell path handling, filter ordering, crop time bases, audio
concatenation and bed looping, stderr bounds/redaction, cancellation, ffprobe
validation, sidecar rollback, artifact-record/file consistency, migration
compatibility, and HTTP/MCP strictness.

Migration upgrades are covered from every prior schema version by
`tests/migrations.test.ts`, and the real-media test exercises migration 13
through a current database. No blocking finding remains.

### Residual risk

The macOS fixture proves a real one-second speaker render, captions when the
installed FFmpeg supports `drawtext`, source audio, sidecar finalization, and
unchanged original bytes. It does not replace native Windows packaging or
human visual/audio judgment across every media shape. Advanced queued
cancellation, retry attempts, crash recovery, and normalized repeated-render
comparison remain explicit RND-04, WIN-03.6, UI-01.4, and RND-03 work rather
than hidden assumptions in this boundary.

### Rollback note

Revert the RND-02 feature commit before deploying migration 13. After a database
has migrated, restore a pre-migration backup rather than attempting a down
migration. Generated Render artifacts can be discarded with their artifact
records; original source files are never modified.

### Next command

Run `npx skillpacks install exec-loop` from the project shell before invoking
`$exec` for RND-03 normalized determinism evidence.

## RND-01 shipping boundary — 2026-07-28

### User goal

Add an insert-only render preflight that validates one exact approved Short
revision, persists its complete render-decision snapshot, returns typed
actionable findings, and creates no Render, job, or output artifact.

### Changed files

`IMPLEMENTATION_PLAN.md`, `README.md`, `SPEC.md`, `src/core/api.ts`,
`src/core/database.ts`, `src/core/render-preflight.ts`,
`src/core/repository.ts`, `src/core/service.ts`, `src/mcp/server.ts`,
`src/shared/contracts.ts`, `tasks/history.md`, `tasks/ship-manifest.md`,
`tasks/todo.md`, `tests/migrations.test.ts`, and
`tests/render-preflight.test.ts`.

### Per-file purpose

- `src/shared/contracts.ts` defines strict request, result, dependency, category,
  code, severity, remediation, identifier-detail, and help-link contracts.
- `src/core/render-preflight.ts` implements the canonical snapshot, registry,
  stable dependency/resource probing, decision recomputation, safe findings,
  hashing, ordering, revision-bound workflow, and complete validation when one
  asset is reused across multiple bindings.
- `src/core/database.ts` adds migration 12 and database-enforced immutable
  `render_preflights`; `src/core/repository.ts` exposes insert/read-only access
  with an atomic final revision comparison.
- `src/core/service.ts`, `src/core/api.ts`, and `src/mcp/server.ts` expose
  identical strict HTTP/MCP values without internal paths, stderr, or snapshots.
- `tests/render-preflight.test.ts` and `tests/migrations.test.ts` cover contracts,
  hashes, ordering, dependency parsing, duration edges, Content ID help,
  repeatability, stale/concurrent revisions, immutability, redaction, shared
  asset bindings, prior-version upgrades, and no Render/job/artifact side
  effects.
- `README.md`, `SPEC.md`, `IMPLEMENTATION_PLAN.md`, `tasks/todo.md`,
  `tasks/history.md`, and `tasks/ship-manifest.md` record the implemented
  boundary, evidence, and promotion of RND-02.

### User-goal mapping

The contracts establish the public typed boundary; the preflight engine captures
and validates the exact immutable render decision; migration and repository
changes preserve an insert-only audit record with a final atomic revision check;
HTTP/MCP surfaces expose only the safe result; and focused tests prove
repeatability, redaction, immutability, concurrent-edit rejection, and the
no-output invariant.

### Tests run

- Executable verification: `npm test -- --run
  tests/render-preflight.test.ts` passed 10 tests after the adversarial-review
  regression was added.
- Executable verification: `npm test` passed 35 files and 245 tests.
- Executable verification: `npm run build` passed typecheck, Vite production
  build, and Node compilation.
- Repository verification: `git diff --check` and the added-line credential
  scan passed.

### Skipped tests

Native Windows NSIS packaging was skipped because RND-01 changes the
platform-neutral core/schema/transports and creates no packaged or final media.
Visual output inspection was skipped because RND-01 intentionally creates no
output; RND-02 owns the first FFmpeg output artifact and its media fixtures.

### Adversarial review

A failure-oriented changed-file review traced stale and concurrent revisions,
snapshot hash recomputation, database immutability, dependency independence,
resource changes during inspection, public redaction, finding determinism, and
multi-layer asset reuse. It found that the asset inspection map overwrote an
earlier binding when one asset ID appeared on multiple layers. The implementation
now validates every binding while probing each file once, with a focused
regression test. No unresolved finding remains.

### Residual risk

The immutable preflight is executable and tested, but it does not yet feed a
real FFmpeg graph. Cross-platform binary behavior and final audiovisual output
remain unproven until RND-02 and the later Windows gate.

### Rollback note

Revert the RND-01 feature commit before deploying migration 12. After a database
has migrated, restore a pre-migration backup rather than attempting a down
migration.

### Next command

Run `npx skillpacks install exec-loop` from the project shell before invoking
`$exec` for RND-02.

## EDT-03 shipping boundary — 2026-07-28

### User goal

Replace mixed crop keyframes with independent automatic and manual tracks,
deterministic bounded automatic framing, explicit resume markers, and exact-CAS
re-analysis/manual mutations across core, HTTP, and MCP.

### Changed files

- `IMPLEMENTATION_PLAN.md`
- `SPEC.md`
- `src/core/api.ts`
- `src/core/crops.ts`
- `src/core/database.ts`
- `src/core/repository.ts`
- `src/core/service.ts`
- `src/mcp/server.ts`
- `src/shared/contracts.ts`
- `src/shared/python-worker-protocol.ts`
- `src/shared/templates.ts`
- `tasks/history.md`
- `tasks/ship-manifest.md`
- `tasks/todo.md`
- `tests/crop-service.test.ts`
- `tests/crops.test.ts`
- `tests/domain-contracts.test.ts`
- `tests/migrations.test.ts`

Generated `.agents/skillpacks/`, `.claude/`, and `.codex/` local artifacts are
unrelated and excluded from the commit. No path under `.claude/skills/` or
`.codex/skills/` is tracked. `.agents/project.json` remains tracked and
unchanged. There are no earlier unpushed commits or unrelated tracked changes
in the shipping boundary.

### Per-file purpose

- `IMPLEMENTATION_PLAN.md` records EDT-03 implementation evidence and defers
  interactive/native acceptance to their owning milestones.
- `SPEC.md` updates the crop implementation matrix, v1 MCP inventory, and
  changelog.
- `src/core/api.ts` exposes revisioned crop re-analysis and manual control
  routes.
- `src/core/crops.ts` implements source-time remapping, detection selection,
  union/padding/aspect correction, smoothing, interpolation, fallback
  provenance, and manual precedence.
- `src/core/database.ts` adds migration 9 for independent automatic/manual
  tracks and deterministic legacy manual IDs.
- `src/core/repository.ts` validates crop timestamps and applies existing
  render/schedule invalidation transactionally.
- `src/core/service.ts` selects verified visual artifacts and implements exact
  CAS re-analysis plus add/move/remove mutations.
- `src/mcp/server.ts` adds four typed crop tools and safely URL-encodes
  arbitrary layer IDs.
- `src/shared/contracts.ts` defines detection, automatic track, provenance,
  fallback, manual control, layer, and mutation schemas.
- `src/shared/python-worker-protocol.ts` carries optional typed detection
  observations in visual-sampling results.
- `src/shared/templates.ts` gives each starter video layer an independent
  target and crop state.
- `tasks/history.md` records completed behavior, review, validation, and
  remaining acceptance work.
- `tasks/ship-manifest.md` records this exact shipping and rollback boundary.
- `tasks/todo.md` closes EDT-03 and promotes EDT-04 as the sole current task.
- `tests/crop-service.test.ts` covers stale writes, preservation, invalidation,
  invalid inputs, HTTP/MCP parity, and reserved-character layer IDs.
- `tests/crops.test.ts` covers bounds, aspect, fallback, smoothing,
  interpolation, range remapping, and manual precedence.
- `tests/domain-contracts.test.ts` updates strict public composition fixtures.
- `tests/migrations.test.ts` proves deterministic legacy track splitting.

### User-goal mapping

- Independent layer schemas, starter state, and migration 9 replace mixed
  source-tagged keyframes without discarding legacy automatic/manual data.
- The crop engine remaps Episode observations into contiguous Short time,
  selects person/screen/auto observations, and produces bounded aspect-correct
  frames with deterministic smoothing and interpolation.
- Explicit fit/fill fallback reasons and immutable artifact/version provenance
  make unavailable detection behavior auditable.
- UUID-addressed crop and automatic-resume controls remain separate per layer,
  resolve at exact timestamps, and survive automatic re-analysis byte-for-byte.
- Repository-backed exact CAS mutations increment the Short once, clear
  approval, stale succeeded renders, and flag only unpublished schedules.
- Strict HTTP and MCP operations expose equivalent success and typed failure
  behavior, including layer IDs that require URL encoding.

### Tests run

Executable verification against the final source boundary:

- `npm test`: all 31 test files and 208 tests passed.
- `npm run build`: application typecheck, Vite production build, and Node
  TypeScript compilation passed.
- `npx vitest run --config vitest.config.ts tests/crop-service.test.ts`: all 4
  focused service/HTTP/MCP tests passed after the path-encoding review fix.
- `git diff --check`: passed.
- A focused added-line credential/signature scan found no secret-like additions.

Documentation/task verification:

- `scripts/audit-task-docs.mjs` is absent, so the repository defines no
  task-document audit command.
- `tasks/todo.md` contains exactly one current executable item, EDT-04, and
  EDT-03 appears under completed work.

### Skipped tests

- No lint script or standalone check target exists in `package.json`; the full
  Vitest suite and production build cover the available executable gates.
- Interactive crop manipulation, undo, and visual inspection are deferred to
  UI-01.3 because EDT-03 adds the core/public mutation surface, not editor
  controls.
- Native packaged Windows crop and migration validation is deferred to
  WIN-03.4. This macOS host cannot close the Windows release gate.
- No visual inspection was relevant because this boundary changes no UI
  component or rendered visual asset.

### Adversarial review

A failure-oriented changed-file review was used as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It traced migration compatibility and deterministic IDs; malformed,
missing, stale, and reordered visual artifacts; output/source timestamp
boundaries; rectangle bounds and aspect math; missing dimensions/detections;
manual interpolation and exact resume; per-layer independence; duplicate IDs
and timestamps; CAS races and rollback; render/publishing invalidation; strict
schemas; and HTTP/MCP value/error parity.

The review found that MCP crop mutations embedded contract-valid arbitrary
layer IDs directly in URL paths. Reserved characters such as `/` could select
the wrong route. The paths now encode layer IDs, and the transport regression
uses `speaker/primary`. The first production typecheck exposed the generic MCP
callback value as `unknown`; the encoder boundary now converts the
schema-validated value explicitly. The final targeted test, full suite, and
production build pass without warnings. No blocking finding remains.

### Residual risk

- Automatic crop quality still depends on future visual providers populating
  the optional face/person/screen observations; explicit fallbacks cover absent
  capabilities but do not replace native quality evaluation.
- The editor must expose manipulation, undo, and visual recovery at UI-01.3.
- Native SQLite migration behavior, video sampling, and packaged crop workflows
  still require WIN-03.4 evidence on Windows.

### Rollback note

Revert the EDT-03 feature commit before deploying migration 9. After migration
9 has run, restore a pre-migration backup before using older application code.

### Next command

`$exec` for EDT-04, caption data, editing, layout checks, and sidecars.

## EDT-02 archive

## User goal

Complete EDT-02 across contracts, persistence, services, HTTP, and MCP:
revisioned template clones with materialized Short lineage plus complete,
source-preserving image/video/audio asset import.

## Changed files

- `IMPLEMENTATION_PLAN.md`
- `SPEC.md`
- `src/core/api.ts`
- `src/core/database.ts`
- `src/core/media.ts`
- `src/core/repository.ts`
- `src/core/service.ts`
- `src/mcp/server.ts`
- `src/shared/contracts.ts`
- `src/shared/templates.ts`
- `tasks/history.md`
- `tasks/ship-manifest.md`
- `tasks/todo.md`
- `tests/domain-contracts.test.ts`
- `tests/media.test.ts`
- `tests/migrations.test.ts`
- `tests/template-assets.test.ts`

Generated `.agents/skillpacks/`, `.claude/`, and `.codex/` local artifacts are
unrelated and excluded from the commit. No path under `.claude/skills/` or
`.codex/skills/` is tracked. `.agents/project.json` remains tracked and
unchanged. There are no earlier unpushed commits or unrelated tracked changes
in the shipping boundary.

## Per-file purpose

- `IMPLEMENTATION_PLAN.md` records EDT-02 implementation evidence and deferred
  interactive/native acceptance.
- `SPEC.md` marks the template and asset foundations implemented with their
  concrete source and test evidence.
- `src/core/api.ts` exposes strict template clone/update and asset import HTTP
  operations.
- `src/core/database.ts` adds migration 8 for nullable layer asset bindings and
  complete legacy Short template lineage.
- `src/core/media.ts` performs stable, canonical, codec-aware asset inspection.
- `src/core/repository.ts` adds typed asset lookup for composition validation.
- `src/core/service.ts` implements template cloning/updating, persisted-template
  Short snapshots, composition asset validation, and source-in-place import.
- `src/mcp/server.ts` adds MCP parity for template and asset mutations.
- `src/shared/contracts.ts` defines nullable layer asset bindings and strict
  template/asset mutation inputs.
- `src/shared/templates.ts` materializes nullable bindings in every starter
  layer.
- `tests/domain-contracts.test.ts` verifies strict public mutation contracts.
- `tests/media.test.ts` covers supported codecs, metadata, source preservation,
  unstable inputs, malformed media, and dependency failures.
- `tests/migrations.test.ts` proves legacy Template and Short normalization.
- `tests/template-assets.test.ts` covers clone lineage, CAS, immutable
  built-ins, snapshots, asset binding validation, and HTTP/MCP parity.
- `tasks/todo.md` closes EDT-02 and promotes EDT-03 as the sole current task.
- `tasks/history.md` records completed behavior, review, and validation.
- `tasks/ship-manifest.md` records this exact shipping and rollback boundary.

## User-goal mapping

- Nullable `assetId` layer bindings and migration 8 preserve and normalize
  existing Template and Short composition JSON. The migration also stores the
  selected template ID in legacy lineage JSON.
- Built-ins remain immutable. User clones start at version/revision 1, record
  their immediate parent, inherit or override descriptions, and deep-copy the
  source composition. User updates use CAS and increment version/revision once.
- Short creation loads any persisted template, validates bound assets, and
  stores exact selected-template lineage plus an independent composition
  snapshot.
- Asset import requires explicit reusable state and trimmed provenance,
  canonicalizes the source path, stably probes supported still/video/audio
  codecs, persists applicable dimensions/duration, and never copies or mutates
  source bytes.
- Strict HTTP and MCP clone/update/import operations share the public contracts
  and typed core error behavior.

## Tests run

Executable verification against the final source boundary:

- `npm test`: all 29 test files and 197 tests passed.
- `npm run build`: application typecheck, Vite production build, and Node
  TypeScript compilation passed.
- `git diff --check`: passed.
- A focused added-line credential/signature scan found no secret-like additions.

Documentation/task verification:

- `scripts/audit-task-docs.mjs` is absent, so the repository defines no
  task-document audit command.
- `tasks/todo.md` contains exactly one current executable item, EDT-03, and
  EDT-02 appears under completed work.

Focused EDT-02 coverage includes contract strictness, legacy JSON
normalization, path exclusivity, built-in immutability, clone-of-clone lineage,
deep-copy isolation, CAS conflicts, exact version/revision increments, prior
Short stability, bound asset existence/kind checks on both templates and
Shorts, PNG/JPEG/WebP, H.264, AAC/MP3/PCM, metadata persistence, reusable false,
whitespace provenance, missing/empty/changing/malformed/streamless/unsupported
media, dependency failure, source-byte preservation, and HTTP/MCP parity.

## Skipped tests

- No lint script or standalone check target exists in `package.json`; the full
  Vitest suite and production build cover the available executable gates.
- Interactive template cloning, asset selection, and recovery are deferred to
  UI-01.3 because this task adds no desktop editor workflow.
- Native packaged Windows validation is deferred to WIN-03.4. This macOS host
  cannot close the Windows release gate.
- No visual inspection was relevant because EDT-02 changes no UI component or
  rendered visual asset.

## Adversarial review

A failure-oriented changed-file review was used as the equivalent review lane
because no repository-local `quality-sweep` or `expert-review` command is
installed. It traced migration compatibility and malformed JSON, built-in and
clone-of-clone lineage, stale revisions and exact increments, deep-copy
isolation, prior-Short stability, absent and mismatched assets, canonical-path
inspection, changing files, empty/malformed/streamless/unsupported media,
dependency failure, strict unknown-field rejection, HTTP error envelopes, MCP
parity, generated artifacts, and credential patterns.

The review found that template composition updates could persist missing or
mismatched asset bindings and fail only when a Short was later created.
`CoreService.updateTemplate` now validates composition assets before the
repository write, with regression coverage proving the invalid update leaves
the template revision unchanged. No blocking finding remains; all executable
checks pass without warnings.

## Residual risk

- The editor must expose missing/unsupported asset recovery and make immutable
  prior-Short snapshots visible during template updates.
- Native FFprobe/SQLite behavior, Windows path variants, and packaged runtime
  integration still require WIN-03.4 evidence.

## Rollback note

Revert the EDT-02 feature commit before deploying migration 8. Once a database
has migrated, restore a pre-migration backup before running older application
code.

## Next command

`$exec` for EDT-03, independent automatic and manual crop tracks.
