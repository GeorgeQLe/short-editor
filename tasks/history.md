# Session history

## 2026-08-02

- Completed the integrated Screenletter MVP foundation across SiftCut and the
  private iOS repository. New Clerk users receive deterministic personal
  organizations; forced-RLS public share lookups can resolve only through
  security-definer ownership; and the built-in `screen-demo-v1` composition
  supplies vertical safe areas, fit/crop behavior, and captions.
- Added the iOS 18 SwiftUI capture client with ReplayKit screen-plus-microphone
  recording, camera capture, ten-minute limits, App Group recovery, hashing,
  resumable background multipart state, failed-upload retention, stable
  unlisted sharing, and explicit SiftCut editing handoff. The private
  `GeorgeQLe/screenletter` repository passed Swift package tests and an unsigned
  simulator app/extension build.
- Shipping validation exposed a real cross-Python timeout classification defect:
  this macOS runtime's `socket.timeout` is not a `TimeoutError`. The worker now
  catches both explicitly, and the final aggregate verification passes all 51
  desktop files and 367 tests, the production build, SaaS typechecks, 35 SaaS
  tests, and the nine-test PostgreSQL integration lane.
- Implemented SAAS-M2 Clerk organizations and permissions with production
  configuration, RS256 issuer/audience/expiry/authorized-party verification,
  active-organization and synchronized-role enforcement, signed raw-body
  webhooks, idempotent payload hashes, sequence-aware user/organization/
  membership/invitation convergence, and five-seat enforcement.
- Added the Clerk-backed browser workspace for sign-in/out, organization
  creation and switching, member management, role-aware project controls, and
  immediate tenant-state invalidation during switches. Owner organization
  deletion now requires exact typed confirmation and a signed Clerk
  factor-verification age within five minutes.
- Shipped the pending Screenletter hosted contract foundation: typed project
  kind/origin and recording lifecycle contracts, tenant-safe PostgreSQL
  persistence, candidate-free edit launches, revisioned publish/rollback,
  signed unlisted playback, abuse reporting, HTTP routes, and service tests.
- Failure-oriented review found and fixed two Clerk convergence defects before
  shipping: forced membership RLS prevented `user.deleted` from discovering
  memberships to revoke, and a rejoin with a new Clerk membership ID could
  collide with the stable organization/user key. Tenant-scoped revocation and
  primary-key upsert coverage now protect both paths.
- Executable verification passed 34 SaaS unit tests, 8 PostgreSQL integration
  tests, all 51 desktop files and 365 tests, every SaaS workspace build, the
  desktop production build, and diff hygiene. M2 remains in progress at the
  roadmap level until live staging Clerk invitation, switching, and
  reverification acceptance is completed.
- Completed SAAS-M1 with a runnable role-separated PostgreSQL 17.5 harness,
  checksum- and advisory-lock-aware migrations, transaction-local tenant
  context, forced row-level security, production project/upload/usage/event/job
  adapters, leased outbox publication, readiness, bounded requests,
  structured redacted logging, graceful shutdown, and revision-checked project
  deletion.
- Failure-oriented shipping review found that the pending implementation had
  removed the transaction wrapper from the already-committed M0 migration,
  changing its checksum for previously initialized databases. The migration is
  now byte-for-byte unchanged; the runner unwraps legacy transaction boundaries
  only at execution time, with regression coverage for wrapper compatibility
  and stale, modified, ahead, and unavailable readiness states.
- Executable verification passed 23 SaaS unit tests, 7 role-separated
  PostgreSQL integration tests, all 51 desktop test files and 365 tests, the
  desktop production build, and every SaaS workspace build. A built API
  returned HTTP 200 from `/ready` against the current test schema and handled
  SIGINT with a clean pool/server shutdown. The existing intentional
  `Unexpected internal error` stderr fixture remains accepted; no new warning
  or unresolved validation failure remains.
- Established the hosted SiftCut commercial-beta foundation as npm workspaces
  around the unchanged Electron root package. Shared SaaS contracts now define
  authenticated organization roles, projects, entitlements, usage, public
  upload sessions, assets, versioned jobs, durable events, and structured
  errors; infrastructure-only upload records retain S3 keys and multipart IDs
  without exposing them through API responses.
- Added role-aware, optimistic-revision project and multipart-upload services,
  verified-session middleware, durable SSE handling, quota reservation,
  checksum validation, tenant-scoped object keys, and an atomic
  upload-completion/outbox port. Failure-oriented review added bounds for signed
  part numbers, rejected duplicate completion metadata, sorted completed parts,
  and protected streaming error handling after headers are sent.
- Added the initial tenant-scoped PostgreSQL schema with row-level security,
  immutable usage ledger, webhook idempotency, jobs, artifacts, events, and
  transactional outbox; added versioned worker lifecycle primitives and
  browser upload support; and added initial encrypted S3, KMS, SQS/DLQ,
  lifecycle, logging, secrets, and queue-age Terraform resources constrained to
  `us-east-1`.
- Created `docs/saas/SPEC.md` as the independent hosted-product authority and
  `docs/saas/ROADMAP.md` as an M0–M9 delivery plan with dependencies,
  acceptance gates, critical path, deferred scope, and an explicit distinction
  between foundation code and production readiness. SAAS-M1 is now the active
  task.
- Executable verification passed all 51 desktop test files and 365 tests, the
  desktop production build, all SaaS workspace typechecks/builds, and 12 SaaS
  contract/service/worker tests. Terraform formatting and `git diff --check`
  pass. No live Clerk, PostgreSQL, AWS, Stripe, FFmpeg cloud-worker, or hosted
  end-to-end test was claimed; those remain roadmap milestones.

## 2026-07-31

- Renamed the public product surface from Short Editor to SiftCut while
  preserving the `com.lexcorp.shorteditor` bundle identifier, existing data
  locations, environment variables, and compatibility-facing internal names.
  Repository, support, diagnostics, renderer, release, issue-template, and
  third-party notice copy now use the SiftCut display name.
- Added a deterministic vector app-icon master and Electron exporter. The
  macOS package now uses a single deep-indigo squircle with transparent
  corners and a flat violet/orange film-cut mark. User review refined the mark
  from a horizontal strip to a vertical top/bottom composition; executable
  brand coverage protects that orientation.
- Added a relative-asset renderer smoke test to the release path, generated and
  validated the arm64 `.icns`, and visually accepted the icon at 16–1024 px on
  light/dark backgrounds plus its live Finder and Dock presentation.
- Replaced the sidebar's placeholder `S` tile with the canonical SVG logo,
  rebuilt the unsigned arm64 app, and visually verified the running packaged
  header.
- Added `docs/siftcut-color-options.html`, a self-contained interactive study
  comparing eight purposeful palettes with rationale, hex values, selection
  behavior, and light/dark size contexts.
- Executable verification passed all 51 test files and 365 tests, targeted
  branding/UI runs, production typecheck/build, deterministic icon export,
  exact packaged-ICNS comparison, arm64 packaging, and live packaged-app
  inspection. The intentional `Unexpected internal error` stderr line remains
  the established redacted-500 fixture.

## 2026-07-30

- Published `GeorgeQLe/short-editor` as a public MIT repository at commit
  `db8e151`, enabled issues, OSS topics, private vulnerability reporting,
  dependency alerts and security updates, secret scanning with push
  protection, and immutable releases. Published the exact
  `model-small.en-e0e3c0a` model archive and manifest; GitHub's server-side
  digests match the staged SHA-256 values, and anonymous download checks pass.
- Closed UI-01.5 with isolated credential-free fixture
  `UI-01.5-macos-2026-07-30`. The Electron walkthrough passed first-run rule
  creation, exact revision editing, newest eligible-Render selection,
  prioritized atomic drafting, list/month navigation, occupied-slot feedback,
  a legal planned move, rerender publication blocking, optional YouTube URL
  recording, permanent lock, and complete restart persistence.
- Added `CalendarWorkspace`, paginated schedule API reads and exact mutations,
  a browser-safe shared wall-time resolver, active-zone list/month formatting,
  detailed DST warnings, local legal-move explanations, irreversible publication
  confirmation, and permanent stored-state indicators without changing frozen
  HTTP/MCP contracts.
- Interactive UAT found and fixed a strict replacement defect where persisted
  rule metadata leaked into the editable form. Existing rules now become an
  explicit seven-field `ScheduleRules` snapshot; a component regression proves
  that revisioned saves contain no entity metadata. Final evidence is
  `UI-01.5-macos-2026-07-30.png`, SHA-256
  `21214f4c07d2c80ca791a29aa8f446bb66c6ae403370e2b992ccf425dfb4c7f2`.
  The accepted database contained zero cloud authorizations, and no upload,
  authentication, or remote verification occurred.
- Failure-oriented shipping review found that React's `busy` state alone left
  a same-tick duplicate schedule mutation window. A synchronous operation guard
  now covers rule saves, drafts, moves, and publication recording; the exact
  rule-save regression submits twice while the first request is unresolved and
  proves only one mutation is sent.
- Closed UI-01.4 with the fresh credential-free macOS fixture
  `UI-01.4-macos-2026-07-30-v2`. The accepted lineage visibly encoded, cancelled
  once with both Job and Render at `cancelled`/`JOB_CANCELLED`, retried from the
  immutable snapshot, and succeeded with independently verified 1080×1920
  H.264/AAC output, a valid non-empty UTF-8 SRT, completed provenance and
  determinism evidence, unchanged source bytes, and identical-environment
  restart persistence.
- Diagnosed the discarded manual fixture boundary precisely: the host FFmpeg
  8.1.2 build lacks the `drawtext` filter used by captioned compositions. The
  reproducible replacement fixture pins a credential-free native arm64 static
  FFmpeg 6.0 under `/tmp`; no production dependency, API, schema, renderer, or
  UI change was required. Final attach-only evidence is
  `UI-01.4-macos-2026-07-30-v2.png`, SHA-256
  `b8c16af623862ac2753d3bf18d15b53b5e244ca900063ad5927e19652837bcc3`.
- Added the UI-01.4 implementation checkpoint: the Editor now approves exact
  Short revisions, runs typed preflight with actionable findings and Library
  relink routing, starts the exact passing immutable snapshot with selectable
  caption sidecars, and restores render lineages with live progress, encoder,
  validation, determinism, failure, cancellation, and bounded retry state.
- Added exact renderer API contracts and component/API regressions for
  pagination, approval, preflight/start bodies, dirty-state guards, default SRT
  output, durable successful-output history, newest-failure retry, progress,
  and duplicate cancellation suppression. Failure-oriented review found the
  missing cancellation interaction coverage and added it before shipping.
- The isolated macOS walkthrough passed missing-source blocking/relink
  recovery, exact-snapshot start, retry lineage persistence, and restart
  recovery. UI-01.4 remains open: both attempts hit a fixture-local FFmpeg exit
  code 8 before cancellation or success could be accepted. The continuation is
  recorded in `docs/ui-01.4-macos-uat.md`.
- Shipping validation exposed parallel-load flakes in multiple MCP-heavy tests
  against Vitest's five-second default. Raising the per-test ceiling to 15
  seconds preserved parallel execution and produced a clean full run of all 48
  files and 346 tests; the final focused UI run passed all 11 workflow tests.
  Production build/typecheck, the 11-function Electron preload smoke, and diff
  hygiene also pass. The intentional `Unexpected internal error` stderr line
  remains the existing redacted-500 fixture.
- Added the UI-01.3 implementation checkpoint: durable Short project listing,
  reopening, creation from approved Candidates, explicit duplicate creation,
  and template clone/edit entry points now replace the Editor placeholder.
- Added a source-aware portrait preview and transport plus section-scoped
  timeline, composition/layer, automatic/manual crop, caption, and audio
  editors. Local history supports undo/redo; saves use exact Short revisions,
  preserve unrelated dirty sections, and expose explicit discard-or-rebase
  recovery after conflicts.
- Added composition-layer visibility with migration 18 and made preflight and
  render graph generation omit hidden layers. Added secure inventory media URLs,
  byte-range responses, an asset picker, paginated Short listing across HTTP
  and MCP, and regenerated the frozen release-interface artifacts.
- Automated verification passes all 48 test files and 340 tests, production
  build/typecheck, deterministic release-interface regeneration, the
  11-function Electron preload smoke, focused credential-signature scanning,
  and diff hygiene. The intentional `Unexpected internal error` stderr line is
  the existing redacted-500 fixture.
- Closed UI-01.3 on the working tree based on commit `6c7cd70` after the
  isolated `UI-01.3-macos-2026-07-30` Electron walkthrough passed on macOS
  26.5.2 (25F84). The app and Electron profile used fixture-local directories,
  npm's host Node, and an environment with inherited OpenAI variables removed;
  the database retained zero cloud authorizations and the profile contained no
  protected credential file.
- Cloned News Brief + Speaker through the in-app desktop form, renamed the
  clone to `UI-01.3 Final News Brief`, created and reopened
  `UI-01.3 Primary Short`, and preserved its cloned template lineage. Timeline
  transport and exact range editing saved two ordered ranges with 32 seconds
  output and visible output/source mapping. Composition covered layer movement,
  sizing, order, visibility, fit, safe area, background, automatic crop
  provenance, edited manual controls, and automatic resume.
- Imported the deterministic local PNG through the native picker with an
  explicit provenance note, bound the newly imported asset, and confirmed the
  binding after restart. Caption cue text/timing, word timing, weight,
  transform, position, and color persisted with visible overflow, safe-area,
  and outside-source warnings. Audio persisted source gain `-2`, unmuted state,
  1 ms cut fade, the local AAC bed, and `-19` dB bed gain.
- Cross-section undo/redo preserved unrelated dirty sections. A second local
  HTTP client advanced revision 6 to 7 while Audio remained dirty; the UI
  displayed `Revision conflict: expected 6, actual 7. Local draft retained.`,
  rebased the retained draft onto revision 7, and saved successfully. The final
  native asset binding produced revision 10, which reopened with every saved
  timeline, composition, crop, caption, audio, asset, and template decision.
- Render-affecting saves cleared approval, marked the seeded successful render
  stale, and left the draft schedule at `needs_rerender=1`. The locked
  published schedule remained byte-for-byte at revision 1 with its original
  timestamps and publication URL. Acceptance also replaced unsupported
  Electron `window.prompt` template actions with an in-app form and surfaced
  structured expected/actual conflict revisions; component regressions cover
  both discoveries. Failure-oriented review additionally found and fixed a
  repeated-submission race in the template form; the component regression now
  proves that two immediate submits produce one mutation.
- The readable credential-free Composition & Crops evidence remains outside git
  at `UI-01.3-macos-2026-07-30.png`, SHA-256
  `8aa0c506ef48afbd95586d52881cbafaef268178d30a87aa8088125b356390da`.
  Final verification includes all 48 test files and 342 tests, a post-review
  7-test component run, production build/typecheck, the 11-function Electron
  preload smoke, and `git diff --check`. Native packaged Windows acceptance
  remains deferred to the existing Windows release gate.

## 2026-07-29

- Completed UI-01.2 with an Episode-scoped Transcript/Candidates workspace,
  exact revision-safe transcript snapshots, preserved word timings, structured
  validation details, explicit conflict reloads, accepted-analysis selection,
  deterministic Candidate diagnostics/review, and immutable-proposal versus
  editable accepted-copy handling.
- Added typed renderer clients for artifact and Candidate pagination,
  transcript updates, generation/review, and Candidate content packages. Added
  component/API coverage for missing transcript recovery, draft preservation,
  both generation modes and pending strategies, accepted-artifact filtering,
  score/provenance display, insufficient material, decision/copy revision
  synchronization, regeneration retention, and removal of the Candidates
  placeholder.
- The isolated `UI-01.2-macos-2026-07-29` Electron walkthrough passed on the
  working tree based on commit `bf73dd3`, macOS 26.5.2 (25F84). A second local
  client produced the visible transcript conflict `expected 1, actual 2` and
  copy conflict `expected 3, actual 4`; both local drafts remained intact until
  explicit reload, then reapplied saves succeeded.
- Persisted fixture checks confirmed transcript revision 4 with edited text,
  50 ms start, `moderator`, and one preserved word timestamp; both dependent
  Shorts unapproved; the succeeded draft Render stale; draft schedule
  `needs_rerender`; and the published schedule unchanged. The final active
  Candidate set contains one approved, one rejected, and six pending rows, and
  retains accepted copy at Candidate revision 5 after regeneration.
- Heuristic append and accepted-analysis replace runs passed, including a
  retained-decision regeneration with six new pending proposals. The short
  Episode returned deterministic `INSUFFICIENT_MATERIAL` with eligible/rejection
  counts and recovery guidance. The credential-free full-window evidence
  `UI-01.2-macos-2026-07-29.png` remains outside git under the isolated fixture
  directory and has SHA-256
  `85ba172352205f6a29826f20cfc772c509ccfe3025e44c2655fcbb1f68a13650`.
- Final verification passes all 47 test files and 333 tests, production
  build/typecheck, the nine-function preload smoke, and `git diff --check`.
  Native packaged Windows acceptance remains deferred to WIN-03.3.

- Closed UI-01.1 after a clean rerun of fixture
  `UI-01.1-macos-2026-07-29` on commit `af8ab23`, macOS 26.5.2 (25F84).
  The Electron bridge now unwraps the core's paginated cloud-authorization
  response before returning it to the renderer, with a regression using the
  exact live `{ items, nextCursor }` shape.
- The named-fixture walkthrough visibly passed the three-result mixed import;
  watched-folder create, discovery, edit/disable, queued manual rescan, and
  recovery; wrong-candidate relink rejection followed by memory-only
  confirmation and successful relink; passive Episode-scoped provider status;
  private-LAN per-operation disclosure and endpoint-change reset; and routing
  an unauthorized OpenAI action to Cloud Access. A clearly fake fixture
  credential was saved, used to grant and revoke the scoped authorization, and
  removed without starting a provider job. The initial direct-launch ABI
  failure was recovered by supplying npm's host Node and the complete rerun
  passed.
- The readable, credential-free, full-window Providers evidence is attached as
  `UI-01.1-macos-2026-07-29.png` and remains outside git. Final verification
  passes all 46 test files and 325 tests, the production build/typecheck, the
  nine-function preload smoke, and diff hygiene.
- Fixed the sandboxed Electron preload boundary by compiling the preload as
  CommonJS `dist/electron/preload.cjs`, resolving it through shared
  side-effect-free BrowserWindow options, and adding a hidden-window Electron
  smoke harness. Focused options coverage, all 45 test files and 323 tests, the
  production build/typecheck, the nine-function preload smoke, and diff hygiene
  pass.
- Resumed the isolated `UI-01.1-macos-2026-07-29` Computer Use walkthrough.
  DevTools showed no preload error, the native import picker opened, and the
  named batch visibly produced one imported Episode, one identity duplicate,
  and one FFprobe rejection. Watched-folder discovery succeeded; the relink
  workflow visibly rejected the wrong candidate, required the in-memory
  confirmation for the valid no-hash candidate, and recovered successfully.
  Provider readiness and public Ollama endpoint classification also passed.
  Cloud Access then crashed to a blank renderer with
  `TypeError: authorizations.filter is not a function` in
  `CloudAccess.tsx:166`. Fake credential authorization/revocation could not run,
  no final Providers screenshot was captured, and UI-01.1 remains open on this
  exact blocker.

- Prepared the isolated `UI-01.1-macos-2026-07-29` acceptance fixture for
  commit `af8ab23` on macOS 26.5.2 (25F84). Its deterministic H.264/AAC inputs
  include a byte-identical mixed-import duplicate, malformed rejection input,
  watched-folder media, a wrong relink candidate, and a moved valid candidate;
  the seeded relink Episode is `source_missing` with no stored content hash.
- Enabled the project-local `guided-walkthrough` pack, reset the Node kernel,
  and reinitialized the plugin-owned Computer Use runtime. The mandatory
  `sky.list_apps()` gate recovered and the app/core opened against the isolated
  fixture. Mouse click, coordinate click, and focused-keyboard activation of
  Import episodes all failed to open the native picker. Electron DevTools
  exposed the current blocker: `dist/electron/preload.js` is rejected with
  `SyntaxError: Cannot use import statement outside a module`, leaving
  `window.desktop` unavailable. Native import, watched-folder, relink, and
  protected-credential checkpoints could not run; no final screenshot was
  captured and UI-01.1 remains open. The post-walkthrough gates still pass all
  44 test files and 321 tests, the production build/typecheck, and diff hygiene.

- Added the UI-01.1 inventory/provider implementation: complete paginated
  Episode and watched-folder reads, per-input import outcomes, missing-source
  prioritization and relink confirmation, watched-folder configuration/rescan,
  provider readiness and exact model selection, explicit private-network
  disclosure, user-only cloud authorization gates, and cancellable provider
  job status.
- Split the React workflow into focused library, cloud-access, desktop-bridge,
  and utility modules; added native directory/relink pickers, the strict Ollama
  endpoint status contract, structured API errors, and component/API
  transition coverage.
- A live Electron smoke test found that development launched the core under
  Electron's native-module ABI. The launcher now uses npm's host Node in
  development and preserves Electron for packaged builds; focused regression
  coverage and a successful app/core launch verify the fix.
- Full automated verification passes 44 test files and 321 tests, production
  build/typecheck and diff hygiene pass, and the live core reports ready.
  UI-01.1 remains open because the required named-fixture Computer Use
  walkthrough and screenshot could not run: the Computer Use native pipe
  failed to start twice.

- Added the immutable News Brief + Speaker starter template with a related-media
  upper region, tracked speaker lower region, Short-title topic binding, logo
  slot, and split-centered uppercase captions.
- Extended strict composition contracts with text and image-or-video media
  layers, migrated existing caption styles to an explicit no-transform default,
  and preserved user templates while installing the new built-in.
- Advanced the render graph to v2 with deterministic Inter text measurement,
  wrapping and ellipsis, aligned word highlights, caption transforms, media
  final-frame repeat, and a real FFmpeg split-composition regression.
- Full verification passes 41 test files and 311 tests plus production
  build/typecheck, deterministic interface generation, diff hygiene, focused
  secret scanning, and failure-oriented review. The remaining work is the five
  promoted UI-01 workflow slices.

- Completed API-03 by freezing the exact generated HTTP route inventory and MCP
  Draft-07 input/output schemas behind a deterministic, digest-bearing v1
  release manifest and generated interface guide.
- Added bidirectional compatibility evidence: every MCP tool maps to one exact
  HTTP operation/method/path, generated files fail tests on any drift, and
  pagination continues after a stable ID without duplication when rows are
  inserted between pages.
- Added the versioned `diagnostic-export-v1` filter. Credential keys and
  recognizable credential strings are always removed; transcript, source, and
  path detail requires explicit opt-in. Focused interface suites, full
  verification, production build/typecheck, generation stability, diff hygiene,
  and secret scanning complete the release contract.
- The pre-ship adversarial review expanded credential-field and embedded-token
  coverage for API keys, GitHub/AWS/JWT values, bearer tokens, and private-key
  blocks; the focused and full suites passed after the correction.

- Completed API-02 with one authoritative 44-tool registry shared by MCP
  discovery, runtime registration, request construction, and deterministic
  generated documentation. Removed the four undocumented MCP helpers while
  preserving their HTTP operations.
- Every tool now has a strict concrete input, typed versioned success/error
  output, non-destructive annotations, and a stable HTTP operation mapping.
  Composition and audio use canonical domain fields; list tools accept
  `limit`/opaque `cursor`, preserve filters, and return one HTTP page unchanged.
- Added a shared redacted HTTP/MCP translator that preserves complete valid
  envelopes in text and structured content, plus a server factory and thin
  stdio entrypoint. Added the UI/HTTP transition audit covering user-only
  credential/cloud gates and diagnostic read-only helpers.
- Added generated-artifact, discovery, schema, annotation, pagination, cursor,
  URI, forged-authorization, malformed-core, network-redaction, and exact
  envelope regressions; updated existing workflow parity assertions for
  versioned envelopes. Full verification passes 40 test files and 296 tests,
  production build/typecheck, generation stability, diff hygiene, and focused
  secret scanning. Promoted API-03.

## 2026-07-28

- Completed API-01 by replacing ad hoc Express registration with one
  authoritative 60-operation inventory: 54 ordinary routes and six
  desktop-token gates carry stable operation IDs plus access, mutation,
  revision, and long-operation classifications. The deterministic generated
  JSON inventory exposes no HTTP endpoint and contains no durable-entity
  deletion operation.
- All ten unbounded collections now return `{items,nextCursor}` in the v1
  success envelope with default 100, limits from 1–1,000, deterministic
  repository ID tie-breakers, and opaque operation/filter-bound cursors that
  reject malformed, stale, cross-route, and cross-filter use. The UI unwraps
  its first pages and the current MCP adapter traverses pages to retain its
  existing behavior pending API-02 schemas.
- Every route now uses the shared success/error boundary. Mutations and queries
  are strict, empty-body actions reject fields, malformed JSON and unknown
  routes/methods use redacted registered envelopes, unexpected exceptions stay
  redacted, and the production listener shares the contract-tested
  `127.0.0.1` default. A ship review found and closed missing unknown-query
  rejection on the four queryless reads. Added focused inventory, pagination,
  fallback, redaction, no-deletion, loopback, and desktop-token coverage.
  Promoted API-02 while MCP envelope/schema parity remains partial.

- Completed SCH-02 with transactional eligibility checks, stable priority/ID
  drafting, existing-entry Episode spacing, duplicate scheduling protection,
  and camel-case domain reads.
- Moves now require exact entry revisions and a current rules-legal,
  collision-free instant, enforce same-Episode spacing, and transition unlocked
  entries to `planned`. Publication is manual, rejects rerender-needed entries,
  accepts only optional HTTPS YouTube URLs, increments exactly once, and locks
  the entry permanently.
- Added strict shared HTTP/MCP contracts and focused state, collision, stale
  revision, same-Episode move spacing, URL, lock, and parity regressions. Full
  verification passes 38 test files and 275 tests plus production
  build/typecheck and diff hygiene.
  Interactive calendar and packaged Windows proof remain UI-01.5/WIN-03.7.
  Promoted API-01.

- Completed SCH-01 with migration 16, one canonical revisioned `default`
  schedule-rule snapshot, first-create and exact-CAS replacement semantics,
  canonical weekday/time/blackout ordering, and write-time timezone-database
  provenance while preserving migrated rows as `unknown`.
- Added the documented `shift-forward-gap-earlier-overlap-v1` resolver using
  explicit IANA zones: nonexistent local times shift by the exact transition
  gap, ambiguous times select the earlier instant, and selected anomalous slots
  return typed diagnostics plus resolver timezone-database provenance.
- Drafting now requires an exact persisted rules revision across HTTP and typed
  MCP and creates entries transactionally. Failure-oriented review found and
  fixed a caller-controlled Episode mismatch that could bypass same-Episode
  spacing; eligibility now binds the Short, Render, and persisted owning
  Episode before scheduling.
- Full verification passes 37 test files and 269 tests plus production
  build/typecheck, diff hygiene, and focused secret scanning. Interactive
  calendar proof remains UI-01.5/WIN-03.7. Promoted SCH-02.

- Completed RND-04 with migration 15 and strict public Render lineage fields:
  roots are attempt 1, retries point to the immediately previous immutable
  attempt, `(lineage_id, attempt)` is unique, and each lineage is capped at
  three attempts.
- Added transactional manual retry over the exact persisted preflight,
  project revision, decision hash, and sidecar choice. Failed/cancelled
  attempts can retry through HTTP or typed MCP; stale, unapproved, active,
  succeeded, legacy-unbound, superseded-attempt, and exhausted-lineage cases
  fail without creating a Render or Job.
- Queued cancellation now atomically terminates its paired Render and Job.
  Running encoding, dependency probes, output probing, normalization, and file
  hashing cooperatively observe cancellation, send graceful termination, force
  termination after two seconds, and remove staged/finalized artifacts.
- Startup reconciliation is Render/Job-pair aware: it preserves atomically
  completed successes, aligns terminal pairs, repairs durable cancellation,
  retains valid queued pairs, turns interrupted running attempts into
  `recovery_required`, cleans their artifacts, and limits automatic reclaim of
  other idempotent jobs to three executions. Disk-full/finalization diagnostics
  are redacted and actionable.
- Full verification passes 36 test files and 258 tests, including the real
  FFmpeg retry/cancellation path, plus production build/typecheck, diff hygiene,
  focused secret scanning, and failure-oriented review. Native Windows
  termination/fault injection and the human recovery workflow remain assigned
  to WIN-03.6/.9 and UI-01.4. Promoted SCH-01.

- Completed RND-03 with strict `render-determinism-v1` evidence: canonical
  1080×1920 `yuv420p` video and signed-16-bit 48 kHz stereo PCM SHA-256 hashes
  and byte counts, plus a canonical identity over the decision snapshot,
  normalization version, completed graph/encoder provenance, and exact FFmpeg
  build. Render list/start and job-result schemas expose nullable/required
  evidence at their existing boundaries.
- Migration 14 adds `renders.determinism_json` and the equivalent-attempt lookup
  index, demoting pre-evidence successes to actionable `stale` rows while
  retaining legacy output paths. Atomic immediate completion selects the
  earliest successful baseline, records later matches, or retains mismatch
  evidence while failing with `ARTIFACT_CORRUPT`; the new MP4, sidecar, and
  artifact records are rolled back without changing prior success.
- Streaming FFmpeg normalization excludes metadata, subtitles, and container
  structure and caps decoded output and process diagnostics. Real-media tests
  prove repeat matches, remux/metadata independence, independent pixel/sample
  detection, normalization/mismatch cleanup, prior-output immutability, strict
  contracts, and upgrades from every prior schema. Full verification passes 36
  files and 256 tests; RND-04 is promoted for retry lineage and recovery.

- Completed RND-02 with strict snapshot-bound `renders.start` contracts requiring
  an explicit passing preflight, migration 13 Render bindings, and atomic
  queued Render/job creation. Render state now advances through guarded
  `queued → running → succeeded|failed|cancelled|stale` transitions.
- Added deterministic `ffmpeg-composition-v1` filter scripts for ordered source
  trims/concatenation, stored-order layers, fit/fill, independent interpolated
  crops, reusable still/video assets, packaged-Inter caption burn-in with timed
  word highlighting, source gain/fades, continuous bed playback, 48 kHz stereo
  mixing, and silence fallback. FFmpeg is spawned without a shell using an
  argument array, `-nostdin`, a filter-script file, capped/redacted stderr, and
  parsed progress timestamps.
- Extended artifact staging for external producers with exclusive temporary
  paths, validation, streaming SHA-256, fsync, atomic rename, collision
  rejection, and cleanup. Render completion now rechecks dependencies and every
  captured input before and after encoding, enforces current-revision approval,
  ffprobes H.264/AAC 1080×1920 positive-duration output, persists graph/encoder
  provenance and hashes, and optionally finalizes regenerated SRT/WebVTT beside
  the MP4. Added deterministic graph/contract and compact real-media coverage,
  including spaced paths and unchanged-source proof. Promoted RND-03.
- Full verification passes 36 test files and 251 tests, including a real
  FFmpeg-rendered MP4/sidecar fixture, plus the production build and diff/secret
  hygiene. Failure-oriented review traced graph determinism, input/dependency
  identity, cancellation, stale revisions, validation, artifact rollback, and
  transport binding with no blocking finding. Native Windows packaging, UI
  visual/audio acceptance, and advanced queued-cancel, retry, and crash
  recovery remain assigned to WIN-03.6, UI-01.4, and RND-04.

- Completed RND-01 with strict `{ shortId, expectedRevision }` preflight,
  canonical `render-snapshot-v1` SHA-256 identity, migration 12 immutable audit
  records, a centralized typed finding registry, and independent
  FFmpeg/FFprobe version checks.
- Snapshot capture now binds the exact Short revision, materialized
  composition/lineage, ordered ranges, recomputed caption layouts, crop and
  audio decisions, fixed v1 output requirements, and stable Episode/asset file
  identity, metadata, and hashes. A transactional final revision check prevents
  concurrent edits from being recorded under the requested revision.
- Added matching strict HTTP `POST /v1/renders/preflight` and MCP
  `renders.preflight` values with no public paths, stderr, or internal snapshot.
  Focused tests cover canonical hashing and ordering, duration boundaries,
  Content ID help, stale/concurrent revisions, repeatability, database
  immutability, redaction, shared-asset binding validation, and no
  Render/job/artifact creation. Adversarial review found and fixed an
  overwritten-binding gap when one asset is reused by multiple layers. Full
  verification passes 35 test files and 245 tests plus production build and
  diff hygiene. Promoted RND-02 as current work.

- Completed EDT-05 with migration 11 strict source/bed audio state, bounded gain
  and cut fades, nullable-pair asset binding, deterministic derived warnings,
  and removal of legacy loudness normalization.
- Added the pure revisioned audio decision engine: every ordered Episode range
  retains its synchronized source route at contiguous output timestamps, all
  entrances/exits receive half-range-capped fades, and optional beds start at
  zero, remain continuous across cuts, loop when short, and trim exactly.
- Added exact-CAS audio updates over service, HTTP, and typed MCP with one Short
  revision increment, approval clearing, successful-Render staleness,
  non-published-only rerender flags, and byte-preserved published schedules.
  Engine, threshold, strict-schema, migration, lifecycle, asset, and parity
  tests pass. Full verification passes 34 test files and 234 tests plus the
  production build/typecheck and diff hygiene. FFmpeg composition/preflight
  remain RND-01/RND-02, and UI controls remain UI-01.3. Promoted RND-01 as
  current work.

### EDT-05 ship manifest

- **User goal:** Implement the strict revisioned audio model and deterministic
  source/bed decision engine with migration, lifecycle invalidation, HTTP, and
  MCP parity while leaving FFmpeg mixing to RND-02.
- **Changed files:** `IMPLEMENTATION_PLAN.md`, `SPEC.md`, `tasks/todo.md`,
  `tasks/history.md`, `src/shared/contracts.ts`, `src/core/audio.ts`,
  `src/core/database.ts`, `src/core/repository.ts`, `src/core/service.ts`,
  `src/core/api.ts`, `src/mcp/server.ts`, `tests/audio.test.ts`,
  `tests/migrations.test.ts`, `tests/short-lifecycle.test.ts`,
  `tests/caption-service.test.ts`, `tests/crop-service.test.ts`,
  `tests/domain-contracts.test.ts`, `tests/persistence.test.ts`,
  `tests/repository.test.ts`, and `tests/transcript-editing.test.ts`.
- **Per-file purpose:** `src/shared/contracts.ts` defines strict audio settings,
  warnings, decisions, and transport results; `src/core/audio.ts` implements
  warning derivation and deterministic source/bed decisions;
  `src/core/database.ts` upgrades legacy audio state in migration 11;
  `src/core/repository.ts` provides transactional CAS persistence and
  invalidation; `src/core/service.ts` validates asset bindings and coordinates
  updates; `src/core/api.ts` and `src/mcp/server.ts` expose matching mutation
  surfaces. `tests/audio.test.ts`, `tests/migrations.test.ts`, and
  `tests/short-lifecycle.test.ts` cover the new engine, migration, lifecycle,
  HTTP, and MCP behavior; the remaining test files update existing typed
  fixtures to the new schema. `SPEC.md` and `IMPLEMENTATION_PLAN.md` record the
  implemented boundary, while `tasks/todo.md` and `tasks/history.md` close
  EDT-05 and route RND-01.
- **User-goal mapping:** The contracts, engine, migration, repository, service,
  and transport files implement the accepted EDT-05 behavior end to end. The
  focused tests prove each promised boundary, fixture changes preserve
  regression coverage under the new state shape, and the planning/task docs
  distinguish completed deterministic decisions from deferred preflight,
  FFmpeg mixing, and interactive controls.
- **Tests run:** `npm test` passed 34 files and 234 tests; `npm run build` and
  `git diff --check` passed.
- **Skipped tests:** Windows NSIS packaging was skipped because this core,
  schema, and transport change does not alter packaging and the current host is
  macOS. Manual UI/visual testing was skipped because EDT-05 adds no UI or
  rendered artifact; FFmpeg output verification belongs to the explicitly
  deferred RND-02 renderer.
- **Adversarial review:** A failure-oriented changed-file review scanned for
  stale legacy audio fields, invalid nullable bed pairs, non-finite/out-of-range
  gains and fades, discontinuous range/bed boundaries, threshold errors, stale
  CAS writes, incorrect asset kinds, and accidental published-row mutation.
  The targeted tests exercise those cases, a repository-wide scan found legacy
  fields only in migration fixtures/defaults, and no unresolved finding
  remained.
- **Residual risk:** The decision model is executable and fully covered, but no
  rendered media consumes it yet. RND-01 must snapshot and validate the typed
  decision, and RND-02 must prove FFmpeg gain/fade/loop behavior against media
  fixtures before users can rely on audible output.
- **Rollback note:** Revert the EDT-05 feature commit before deploying migration
  11. After migration, restore a pre-migration backup instead of down-migrating.
- **Next command:** Run `npx skillpacks install exec-loop` from the project
  shell before invoking `$exec` for RND-01 immutable-revision typed preflight.

- Completed EDT-04 with migration 10 independent caption cues/words, complete
  approved Inter Regular/Bold styles, persisted typed warnings and sidecar
  references, and official OFL-licensed Inter 4.1 resources included in
  Electron packaging.
- Added deterministic OpenType advance/line/glyph analysis for explicit line
  breaks, whitespace wrapping, safe areas, canvas overflow, missing glyphs,
  sub-500 ms cues, overlaps, and source-range containment.
- Added exact-CAS caption updates over service, HTTP, and MCP with one revision
  increment, approval clearing, successful-render staleness, non-published-only
  schedule flags, published-entry preservation, and transcript independence.
  Revision-owned LF-normalized UTF-8-without-BOM SRT/WebVTT sidecars remap
  disjoint Episode ranges to contiguous output time and are finalized in the
  same rollback boundary as the Short and artifact records.
- Added migration, schema, layout, timing, encoding, lifecycle, transport,
  missing-dependency, and artifact rollback coverage. Full verification passes
  33 test files and 222 tests plus production build/typecheck and diff hygiene.
  UI controls remain UI-01.3; burned-in composition/preflight remain
  RND-01/RND-02. Promoted EDT-05 as the sole current executable task.

### EDT-04 ship manifest

- **User goal:** Complete EDT-04 with deterministic editable caption data,
  layout and timing checks, revision-owned SRT/WebVTT sidecars, and public
  service/HTTP/MCP mutation parity.
- **Changed files:** `IMPLEMENTATION_PLAN.md`, `SPEC.md`, `package.json`,
  `package-lock.json`, `resources/fonts/Inter-Regular.otf`,
  `resources/fonts/Inter-Bold.otf`, `resources/fonts/OFL.txt`,
  `src/core/api.ts`, `src/core/artifact-store.ts`, `src/core/captions.ts`,
  `src/core/database.ts`, `src/core/repository.ts`, `src/core/service.ts`,
  `src/mcp/server.ts`, `src/shared/contracts.ts`,
  `tests/artifact-store.test.ts`, `tests/caption-service.test.ts`,
  `tests/captions.test.ts`, `tests/crop-service.test.ts`,
  `tests/domain-contracts.test.ts`, `tests/factories.ts`,
  `tests/migrations.test.ts`, `tests/persistence.test.ts`,
  `tests/repository.test.ts`, `tests/short-lifecycle.test.ts`,
  `tests/transcript-editing.test.ts`, `tasks/todo.md`, and
  `tasks/history.md`.
- **Per-file purpose:** `IMPLEMENTATION_PLAN.md` and `SPEC.md` record EDT-04
  completion and separate remaining audio/render/UI scope; `package.json` and
  `package-lock.json` add deterministic OpenType metrics and package the fonts;
  the three `resources/fonts/*` files provide approved Inter Regular/Bold
  runtime resources and their license; `src/core/captions.ts` implements
  layout, glyph, timing, overlap, source-range, and sidecar logic;
  `src/shared/contracts.ts` defines strict caption inputs, state, warnings, and
  results; `src/core/database.ts` migrates legacy caption state;
  `src/core/artifact-store.ts` atomically finalizes multi-file artifact batches;
  `src/core/repository.ts` persists exact-CAS caption changes and dependent
  invalidation; `src/core/service.ts` coordinates analysis, sidecars, and the
  Short mutation; `src/core/api.ts` and `src/mcp/server.ts` expose transport
  parity; `tests/captions.test.ts`, `tests/caption-service.test.ts`,
  `tests/artifact-store.test.ts`, and `tests/migrations.test.ts` cover the new
  behavior and rollback boundaries; `tests/factories.ts` centralizes valid
  caption fixtures; the six remaining changed test files migrate existing
  fixtures and assertions to the new contract; `tasks/todo.md` closes EDT-04
  and promotes EDT-05; and `tasks/history.md` records the work and evidence.
- **User-goal mapping:** The schema, engine, fonts, migration, artifact batch,
  repository/service mutation, and HTTP/MCP surfaces form the complete EDT-04
  path. Dedicated tests prove each contract and existing-suite fixture updates
  preserve compatibility with the new persisted shape.
- **Tests run:** Executable verification: `npm test` passed all 33 files and
  222 tests after the final review fix; `npm run build` passed application
  typecheck, Vite production build, and Node TypeScript compilation. Targeted
  executable verification: `npm test -- --run tests/captions.test.ts` passed
  all 8 caption-engine tests. Repository verification: `git diff --check`
  passed without warnings.
- **Skipped tests:** Interactive caption editing remains UI-01.3 because this
  change exposes core/HTTP/MCP behavior but does not add the editor controls.
  Burned-in caption composition and render preflight remain RND-01/RND-02.
  Packaged native Windows font loading remains part of the later WIN gate; the
  current environment verifies the same packaged font files through the
  platform-neutral engine and build configuration.
- **Adversarial review:** A failure-oriented review traced caption schema,
  migration, layout, source-time remapping, sidecar encoding, artifact/Short
  rollback, stale-write handling, and public interface parity. It found that an
  adjacent-pair overlap scan missed a later cue nested beneath one long-running
  cue, and that disabled captions unnecessarily loaded a font. The engine now
  tracks the latest-ending active cue, bypasses font loading when disabled, and
  has regression coverage for both cases. No blocking findings remain.
- **Residual risk:** Windows packaged-resource resolution and real rendered
  visual placement are not exercised on this macOS core-test boundary. A user
  would first notice either issue during packaged Windows caption editing or
  RND composition; UI-01.3, RND-01/RND-02, and the later WIN gate own those
  checks.
- **Rollback note:** Revert the EDT-04 feature commit before deploying
  migration 10. After a database has migrated, restore a pre-migration backup
  rather than attempting a down migration.
- **Next command:** `$exec` for EDT-05, deterministic source and bed audio
  decisions.

- Completed EDT-03 with migration 9 independent automatic/manual crop tracks,
  typed face/person/screen observations, explicit starter person/screen targets,
  deterministic legacy manual UUIDs, and Short-output-time timestamp bounds.
- Added deterministic source-range remapping, target selection, person/face
  unions, padding, aspect correction, clamping, temporal smoothing, linear
  interpolation, explicit fit/fill fallbacks, and exact manual-to-automatic
  precedence.
- Added strict CAS re-analysis and manual add/move/remove operations over HTTP
  and MCP. Each successful mutation increments once, clears approval, stales
  successful renders, flags only unpublished schedules, and preserves manual
  tracks bit-for-bit across repeated automatic analysis.
- Added crop engine, service, interface-parity, migration, and contract fixtures.
  Adversarial review found and fixed unencoded arbitrary layer IDs in MCP crop
  mutation paths; the transport regression now exercises a slash-containing ID.
- Full `npm test` passes all 31 files and 208 tests; `npm run build`,
  `git diff --check`, and the focused added-line credential scan pass without
  warnings. Interactive editing remains UI-01.3 and native packaged evidence
  remains WIN-03.4. Promoted EDT-04 as the sole current executable task.

- Completed EDT-02 with nullable composition asset bindings, migration-backed
  legacy normalization, immutable built-ins, immediate-parent template clones,
  exact CAS version/revision increments, and persisted-template Short creation
  with immutable lineage/composition snapshots.
- Added canonical source-in-place asset import with explicit reusable and
  trimmed provenance inputs, stable FFprobe inspection, complete still/video/
  audio metadata, requested codec support, and typed rejection of missing,
  empty, changing, malformed, streamless, unsupported, or dependency-blocked
  sources.
- Added strict HTTP/MCP template clone/update and asset list/import parity plus
  contract, migration, lineage, snapshot, asset-binding, codec, source-byte,
  validation, immutable-state, dependency, and conflict coverage.
- Adversarial review found and fixed a deferred-validation gap so invalid
  template asset bindings are rejected before persistence; the template
  revision remains unchanged after failure.
- Full `npm test` passes all 29 files and 197 tests; `npm run build`,
  `git diff --check`, and the focused added-line credential scan pass without
  warnings.
- Interactive template/asset workflow evidence remains assigned to UI-01.3 and
  packaged Windows evidence to WIN-03.4. Promoted EDT-03 as the sole current
  executable task.

## 2026-07-27

- Completed EDT-01 with guarded revision-1 Short creation, independent accepted
  transcript caption snapshots, strict integer-millisecond timeline contracts,
  bounded same-Episode ranges, atomic timeline and approval compare-and-swap
  operations, and typed HTTP/MCP parity.
- Classified composition, ranges, captions, audio, and accepted-transcript
  changes as render-affecting while title/content-package changes preserve
  approval, successful Render state, and schedule flags. Render-affecting
  changes stale successful Renders and mark only non-published schedule entries;
  published rows remain byte-for-byte unchanged.
- Added creation, range, lifecycle, invalidation, HTTP, and MCP fixtures in
  `tests/short-lifecycle.test.ts`; interactive editor and packaged Windows
  evidence remain assigned to UI-01.3 and WIN-03.
- Full `npm test` passes all 28 files and 188 tests; `npm run build`,
  `git diff --check`, and the focused added-line credential scan also pass.
- Promoted EDT-02 as the sole current executable task.

- Completed TRC-03 with durable Candidate generation runs, explicit
  replace-pending and append-pending strategies, retained reviewed decisions,
  accepted-copy preservation, conflict suppression, and superseded history for
  stale-write detection.
- Added immutable proposed and nullable accepted Candidate content packages,
  optimistic Candidate review/copy revisions, compatible legacy migration,
  explicit proposed/accepted Short copy lineage, and HTTP/MCP parity. Full
  `npm test` (27 files, 178 tests), `npm run build`, and `git diff --check`
  pass without warnings.

### TRC-03 ship manifest

- **User goal:** Preserve reviewed Candidate decisions and accepted user copy
  across explicit append/replace regeneration while keeping provider proposals
  separate and concurrency-safe.
- **Changed files:**
  `IMPLEMENTATION_PLAN.md`, `SPEC.md`, `src/core/api.ts`,
  `src/core/candidates.ts`, `src/core/database.ts`,
  `src/core/repository.ts`, `src/core/service.ts`, `src/mcp/server.ts`,
  `src/shared/contracts.ts`, `tests/candidate-integration.test.ts`,
  `tests/candidates.test.ts`, `tests/domain-contracts.test.ts`,
  `tests/factories.ts`, `tests/migrations.test.ts`,
  `tests/persistence.test.ts`, `tests/repository.test.ts`,
  `tests/transcript-editing.test.ts`, `tasks/todo.md`, and
  `tasks/history.md`.
- **Per-file purpose:**
  `IMPLEMENTATION_PLAN.md` records TRC-03 completion evidence;
  `SPEC.md` reconciles the implementation matrix and changelog;
  `src/core/api.ts` adds revisioned Candidate review/copy endpoints;
  `src/core/candidates.ts` exposes shared conflict detection and revisioned
  proposal defaults; `src/core/database.ts` adds migration 7 and legacy
  backfill; `src/core/repository.ts` implements atomic generation strategies,
  lineage, copy acceptance, and Short copy metadata;
  `src/core/service.ts` binds generation, review, copy, and Short creation;
  `src/mcp/server.ts` adds typed MCP parity; `src/shared/contracts.ts` defines
  strategies, runs, revisions, content packages, and copy lineage;
  `tests/candidate-integration.test.ts` covers end-to-end preservation,
  conflicts, rollback, and public interfaces; `tests/candidates.test.ts`
  updates deterministic comparison for revision timestamps;
  `tests/domain-contracts.test.ts` verifies the new public schemas;
  `tests/factories.ts` supplies revisioned Candidate fixtures;
  `tests/migrations.test.ts` proves legacy upgrade behavior;
  `tests/persistence.test.ts`, `tests/repository.test.ts`, and
  `tests/transcript-editing.test.ts` update persisted Short fixtures;
  `tasks/todo.md` closes TRC-03 and promotes EDT-01; and
  `tasks/history.md` records the session and this manifest.
- **User-goal mapping:** Atomic append/replace persistence and conflict
  suppression preserve reviewed rows; accepted projections preserve user copy;
  Candidate revisions reject stale operations; generation-run and copy-source
  metadata keep provider output auditable and distinct from accepted edits.
- **Tests run:** Executable verification: `npm test` passed all 27 files and
  178 tests; `npm run build` passed application typecheck, Vite production
  build, and Node TypeScript compilation. Repository verification:
  `git diff --check` passed. A targeted added-line credential/signature scan
  found no secret-like additions.
- **Skipped tests:** Interactive macOS Candidate UI validation and packaged
  native Windows validation remain assigned to UI-01.2 and WIN-03.3 because
  this repository boundary has no completed Candidate UI workflow or packaged
  Windows runtime in the current environment.
- **Adversarial review:** Reviewed the exact source/migration/API/MCP diff for
  transaction rollback, legacy acceptance preservation, append/replace
  conflicts, accepted-copy retention, superseded/stale writes, provider
  switching, proposal immutability, and public schema parity. No blocking
  findings remained; dedicated fixtures exercise each high-risk boundary.
- **Residual risk:** Native SQLite migration and interactive conflict recovery
  still need packaged Windows/UI evidence at their assigned gates. The
  deterministic automated suite covers the platform-neutral persistence and
  interface behavior.
- **Rollback note:** Revert the TRC-03 feature commit before deploying migration
  7. After a database has migrated, restore a pre-migration backup rather than
  attempting a down migration.
- **Next command:** `$exec` for EDT-01, the Short timeline and approval
  lifecycle.

- Completed TRC-02 with versioned deterministic Candidate generation, explicit
  heuristic or selected-analysis modes, accepted-transcript revision binding,
  provider/artifact provenance, complete aligned 20–90 second enumeration,
  quality floors, stable ranking and duplicate groups, and explicit
  insufficient-material diagnostics through service, HTTP, and MCP.
- Added a separate-label anonymized `candidate-corpus-v1` and enforced the
  approved `balanced-beta-v1` gate. Recorded 100% validity, highlight recall,
  generated precision, and pairwise ranking accuracy against thresholds of
  100%, 80%, 60%, and 75%, respectively.
- Added deterministic repeat/tie/boundary/alignment tests, analysis visual-score
  ranking, stale/mismatched/malformed artifact rejection without fallback,
  actual revision/provenance binding, persistence ordering, and HTTP/MCP
  diagnostics. Full `npm test` (27 files, 171 tests), `npm run build`, and
  `git diff --check` pass.
- Completed TRC-01 with immutable accepted transcript snapshots, exact/current
  revision reads, full-snapshot optimistic edits, manual-edit provenance, and
  validation for nonempty text plus ordered/bounded segment and word timing.
- Added atomic transcript-dependent invalidation: accepted/proposed Episode
  analysis is superseded, Short approval is cleared with a revision increment,
  successful Renders become stale, and non-published schedule entries require
  rerendering while published entries and raw transcript artifacts are
  preserved.
- Added typed HTTP and MCP transcript read/update operations with structured
  conflict, validation, missing-source, and not-found errors that do not echo
  transcript text.
- Added repository, HTTP, and MCP fixtures covering manual corrections,
  nullable no-diarization data, 1,001 segments, stale clients, invalid timing,
  dependent invalidation, exact history, and privacy. Full `npm test` (25 files,
  160 tests), `npm run build`, credential-signature scan, and `git diff --check`
  pass.
- Completed PRO-05 with an Electron-owned OpenAI HTTP adapter and a typed
  child-process bridge; plaintext credentials remain confined to Electron and
  inherited OpenAI credential environment variables are stripped from the core.
- Added explicit `transcription` and `diarization` speech modes, 20-minute mono
  MP3 chunk preparation below the 25 MB upload limit, timeline offsets,
  chunk-scoped speaker identities, raw/accepted transcript artifacts, progress,
  cleanup, cancellation, and no model fallback.
- Added strict Responses API episode analysis with an explicit configured model,
  refusal/incomplete/schema/model validation, request provenance, independent
  `analysis` authorization, and proposed raw typed artifacts.
- Centralized canonical analysis cache identity for Ollama and OpenAI, added a
  migration-safe unique successful-cache constraint and transactional winner
  selection, required authorization before reuse, and rejected corrupt cache
  rows.
- Added non-secret provider capability/status HTTP operations and read-only MCP
  tools, bounded timeout/network/429/retryable-5xx retries with revocation
  checks, and deterministic OpenAI/security/cache fixtures. Full `npm test`
  (148 tests), `npm run build`, and `git diff --check` pass; native packaged
  Windows execution remains the WIN-03 gate.
- Hardened the typed Electron bridge after adversarial review by rejecting
  responses whose job ID does not match the pending request; the targeted
  OpenAI core suite (8 tests) and production build pass after the fix.
- Completed PRO-04 with an OS-protected desktop credential vault backed by
  Electron safeStorage (Windows DPAPI), opaque handles, atomic ciphertext-only
  persistence, create/edit/remove UI, and locked-vault failure behavior.
- Added a desktop-only authenticated core channel for credential-handle
  synchronization and scoped cloud grant/list/revoke operations; credential
  removal transactionally revokes every linked authorization.
- Removed caller-controlled cloud authorization booleans from HTTP and MCP.
  OpenAI queueing and claiming now verify a matching persisted project grant,
  named operation class, and currently available protected credential handle.
- Added explicit provider/data/network/cost disclosure controls and tests for
  protected persistence, locked storage, mismatched scopes, forged booleans,
  missing confirmation, revocation, and queued-job authorization races.
- Hardened the final security boundary after adversarial review by revoking
  grants before deleting protected credential bytes, clearing stale UI
  selections, and surfacing credential-removal and grant-revocation failures.
- Completed PRO-03 with configurable Ollama base URL/model selection,
  schema-constrained structured analysis, model capability discovery, typed
  provider provenance, and no silent provider fallback.
- Classified loopback, private-LAN, and public endpoints before execution;
  required disclosure for private-LAN use, persisted scoped authorization for
  public endpoints, and reclassified redirects before sending analysis data
  while preserving the stricter original/target policy.
- Added local FFmpeg frame sampling with bounded interval/count options and
  visual-activity scores; speaker framing, face detection, and screen-share
  detection are explicitly unsupported when the installed stack lacks them.
- Added prompt/schema/visual option versions and cache identity over source
  hash, accepted transcript revision, provider/model/endpoint class, normalized
  options, and sampling configuration.
- Added deterministic Ollama and visual fixtures for success, unavailable,
  timeout, malformed output, schema drift, endpoint policy/redirects, no-face,
  multi-face, screen-share, and option-driven cache misses.
- Completed PRO-02 with installed-model-only faster-whisper English
  transcription, normalized timed segments and optional words, explicit absent
  diarization, typed local provenance, progress, and bounded cancellation.
- Added local model inventory/status and an explicit external download handoff;
  the worker resolves an existing model directory and uses local-only loading
  without model switching, OpenAI fallback, or network clients.
- Installed local `analyze` job handling through the supervised worker and core
  transaction so successful results become accepted transcript revisions with
  provider/model/version provenance.
- Added deterministic provider and core fixtures for timing normalization,
  optional words, silence, unsupported audio, missing models, cancellation,
  local-only loading, inventory, and persistence.
- Preserved worker-provided retryability through the supervisor so missing
  installed models remain explicit, non-retryable setup failures.
- Completed PRO-01 with a strict versioned Python worker protocol covering
  transcription, diarization, visual sampling, and provider calls, plus typed
  capability, dependency, progress, result, cancellation, and status messages.
- Added a bounded stdio supervisor with NDJSON frame limits, heartbeat/job
  timeouts, cancellation grace, crash restart limits, credential-free launch
  arguments, fully redacted stderr, and typed error mapping before storage.
- Added a SQLite-free development worker host and compatibility/fault fixtures
  for malformed/partial/version-mismatched frames, missing runtime, oversized
  output, timeout, crash, restart, cancellation, and startup/shutdown.
- Completed the combined INV-02/INV-03 inventory milestone with persisted
  watched-folder configuration, debounced chokidar events, durable startup,
  manual, and five-minute scans, scan deduplication/progress/cancellation, and
  safe recovery of interrupted reconciliation jobs.
- Added canonical root validation, recursive/nonrecursive root-relative glob
  discovery, no directory-symlink traversal, contained file-link support, and
  identity-safe import/relink behavior for duplicate discoveries.
- Added migration 5 Episode restore state and expiring one-use relink comparison
  records; missing sources remain visible and restore to a safe lifecycle state.
- Added automatic SHA-256 move repair and explicit no-hash comparison/
  confirmation with candidate revalidation, transactional path/metadata/hash
  updates, and render/schedule invalidation while preserving accepted work.
- Added typed HTTP and MCP watched-folder/relink operations, lifecycle shutdown,
  versioned scan/reconciliation job messages, and reconciliation/relink fixtures.
- Completed INV-01 with FFprobe-gated, format-aware batch import that preserves
  independent imported, duplicate, and typed rejected results.
- Added content-sampled quick fingerprints, SHA-256 resolution for ambiguous
  identity, serialized concurrent finalization, persisted probe metadata, and
  safe handling for dependency failures and sources changed during inspection.
- Updated the Electron picker, UI copy, HTTP/MCP boundary, and shared contracts
  for readable video formats while retaining MP4 H.264/AAC as the guaranteed
  input.
- Completed FND-03 with contained application-owned paths, atomic validated
  finalization, hashes and byte counts, collision handling, and startup
  quarantine for temporary, corrupt, missing, and orphaned artifact state.
- Added deterministic native/legacy startup selection, verified staged database
  and artifact migration, timestamped legacy backup, failed-copy quarantine,
  and no-write recovery when both locations are populated.
- Added per-job restart policy: idempotent local work is requeued, recovered
  cancellation is terminally cancelled, and unsafe interrupted cloud-analysis
  or render work fails with an actionable recovery stage.
- Completed FND-02 with ordered transactional schema upgrades, legacy v1/v2
  compatibility, complete entity storage, artifact metadata, and scoped
  authorization records that contain no credential secrets.
- Added repository transactions and compare-and-swap guards for transcripts,
  Shorts, template clones, schedule rule sets, and schedule entries, including
  forbidden-state enforcement and render/schedule invalidation.
- Added fresh/every-version/interrupted migration, foreign-key, large-fixture,
  round-trip, rollback, UTC, revision-conflict, and forbidden-edge tests.
- Completed FND-01 shared domain contracts and split the public schema surface
  into validators, entities, error contracts, job messages, and Episode
  transitions.
- Added strict entity, lifecycle, range, timing, error-redaction, HTTP-envelope,
  and job-message contract tests.
- Added platform-aware application data paths and documented macOS development
  constraints while retaining Windows 11 as the release-acceptance platform.
- Reconciled SPEC implementation evidence and routed the next executable work to
  FND-02 transactional persistence and migrations.
- Prepared the complete Apple Silicon release boundary: reproducible FFmpeg
  8.1.2/x264 r3222 and ffprobe, a hash-pinned frozen Python 3.12 worker,
  deterministic small.en model and corresponding-source archives, concrete
  runtime manifests, secure resumable/atomic model installation, deep native
  validation, and unsigned app/DMG evidence.
- Verified two identical rebuilds of FFmpeg, ffprobe, the worker, model archive,
  and corresponding-source archive; passed real offline frozen-worker
  transcription, `npm run validate:runtime`, preload smoke, production build,
  and the complete 50-file/363-test suite with four workers.
- Audited all 45 Git commits and the current shipping tree with redacted
  Gitleaks scans. The only detections were the intentional `REDACTED` fixture;
  no repository or Actions secrets, variables, deployments, or private source
  artifacts were found.
- Added the MIT project license, explicit third-party licensing boundary,
  contribution, conduct, support, and security policies, structured issue/PR
  templates, generated-skill exclusions, and monthly npm Dependabot metadata
  for public OSS operation.
