# SiftCut Commercial Beta Roadmap

| Field | Value |
| --- | --- |
| Roadmap version | 0.1.0 |
| Last updated | 2026-08-02 |
| Product specification | [`SPEC.md`](SPEC.md) |
| Target | Invited commercial beta |
| Deployment region | AWS `us-east-1` |

This document sequences the work required to deliver the hosted SiftCut
commercial beta. The SaaS specification defines required behavior; this roadmap
tracks implementation order and readiness. The repository-root `SPEC.md`
continues to govern the independent Electron desktop application.

The roadmap does not assign calendar dates. A milestone is complete only when
its acceptance gate passes in the target environment. Code scaffolding,
successful compilation, and mocked tests are useful progress but do not by
themselves make a cloud capability production-ready.

## Status convention

- **Complete**: implemented and verified against the milestone acceptance gate.
- **In progress**: implementation is active but the acceptance gate has not
  passed.
- **Foundation**: contracts or scaffolding exist, but production adapters or
  end-to-end verification are missing.
- **Not started**: no material implementation exists.
- **Blocked**: an explicit external decision or dependency prevents progress.

## Current baseline

The repository has a verified architectural foundation:

- npm workspaces isolate `desktop`, `web`, `api`, `worker`, shared SaaS
  contracts, and infrastructure interfaces;
- the existing Electron application remains independently buildable and its
  desktop test suite passes;
- authenticated organization, role, project, entitlement, usage, upload,
  asset, job, event, and SaaS error contracts exist;
- API service logic covers role-aware projects, optimistic revisions, upload
  reservations, tenant-scoped object keys, multipart completion, and atomic
  completion/outbox boundaries;
- the initial PostgreSQL migration defines tenant tables, usage ledgers,
  webhook idempotency, durable events, an outbox, and row-level security;
- the worker processor covers idempotent claims, ownership checks, cancellation,
  heartbeats, validation-before-promotion, failure classification, and scratch
  cleanup;
- the browser has an environment-configured authenticated API client and a
  multipart upload primitive with checksums, progress, pause, and retry;
- Terraform defines initial KMS, S3, SQS/DLQ, lifecycle, logging, secrets, and
  queue-age alarm resources; and
- targeted tests cover contracts, tenant isolation behavior, role denial,
  optimistic conflicts, upload reservations, outbox creation, worker
  redelivery, and artifact promotion ordering.

These items are at **Foundation** status. No hosted environment should yet be
described as a working beta: live Clerk, PostgreSQL, AWS storage/queue,
CloudFront, Stripe, media-processing, and deployment adapters are still
required.

## Milestone map

| ID | Milestone | Status | Depends on | Exit outcome |
| --- | --- | --- | --- | --- |
| M0 | Repository and contract foundation | Complete | — | Desktop remains isolated; SaaS packages build and test |
| M1 | Runnable API and PostgreSQL tenancy | Complete | M0 | Authenticated tenant-safe project API runs against PostgreSQL |
| M2 | Clerk organizations and permissions | In progress | M1 | Invitations, switching, and roles work end to end |
| M3 | Direct upload and ingest | Foundation | M1, M2 | A real 20 GB-capable upload produces validated media artifacts |
| M4 | Managed transcription and analysis | Foundation | M3 | An episode produces a reviewed transcript and candidates |
| M5 | Browser editing and server rendering | Foundation | M4 | A reviewed candidate becomes a validated downloadable render |
| M6 | Stripe subscriptions and quota enforcement | Foundation | M2, M3 | Trial, Team plan, portal, cancellation, and hard limits are correct |
| M7 | Deletion, security, and privacy controls | Foundation | M3, M6 | Access revocation and purge requirements pass |
| M8 | Production infrastructure and delivery | Foundation | M1–M7 | Staging and production deploy safely with observability |
| M9 | Operational acceptance and invited beta | Not started | M8 | All beta acceptance gates pass |

## M0 — Repository and contract foundation

**Status: Complete**

Delivered:

- workspace boundaries for desktop, browser, API, workers, shared contracts,
  and infrastructure interfaces;
- separate SaaS specification and desktop/SaaS test commands;
- versioned job and artifact metadata contracts;
- initial PostgreSQL and Terraform definitions;
- mocked unit tests for tenant, revision, quota-reservation, upload, and worker
  invariants.

Acceptance evidence:

- desktop tests and production build pass;
- SaaS typechecks, builds, and targeted tests pass;
- Terraform formatting and repository diff checks pass.

## M1 — Runnable API and PostgreSQL tenancy

**Status: Complete**

Deliverables:

- add validated runtime configuration with secret-safe failure messages;
- create the API server entry point, PostgreSQL connection pool, readiness
  probe, graceful shutdown, request IDs, bounded JSON bodies, and structured
  logging;
- implement PostgreSQL adapters for projects, uploads, usage, entitlements,
  durable events, jobs, and the transactional outbox;
- set `app.organization_id` transaction-locally from verified authorization
  context before tenant queries;
- implement backward-compatible migration execution and a migration smoke test;
- implement outbox claiming with `FOR UPDATE SKIP LOCKED`, retry accounting,
  delivery marking, and abandoned-claim recovery;
- add project deletion state transitions without exposing deleted records;
- add local integration infrastructure for PostgreSQL without changing desktop
  runtime dependencies.

Acceptance gate:

- integration tests prove that every repository operation denies another
  organization's known UUID;
- concurrent revision updates allow exactly one winner and return a structured
  conflict to the loser;
- an upload completion and its outbox row survive or roll back together;
- duplicate outbox publication does not create duplicate jobs;
- readiness fails when required database state or migrations are unavailable;
- API shutdown drains active requests and releases database connections; and
- desktop tests and packaging remain unchanged.

Acceptance evidence (2026-08-02):

- the checksum/advisory-lock migration suite passed against the pinned local
  PostgreSQL 17.5 harness and the built API returned ready against the current
  schema;
- role-separated integration coverage passed tenant isolation, concurrent
  revision, atomic completion/outbox, job redelivery, claim-token, retry, and
  abandoned-lease cases; and
- the complete `npm run verify:saas:m1` constituent gates passed: M1 suites,
  the full desktop test suite, desktop typecheck/production build, and every
  SaaS workspace build.

## M2 — Clerk organizations and permissions

**Status: In progress**

Deliverables:

- verify Clerk session JWT issuer, audience, signature, expiry, user, active
  organization, and organization role on every application route;
- synchronize users, organizations, memberships, invitations, and role changes
  through signed Clerk webhooks;
- store webhook event IDs and payload hashes before applying idempotent changes;
- handle duplicate and out-of-order membership events safely;
- enforce the five-active-member entitlement during invitations and membership
  activation;
- add browser sign-in, sign-out, organization creation/switching, invitation,
  and member management;
- hide or disable controls by role while retaining server-side enforcement;
- require recent authentication for organization deletion.

Acceptance gate:

- owner, editor, and viewer browser tests cover every protected operation;
- forged, expired, wrong-audience, and organization-less sessions are rejected;
- request body and path tenant IDs cannot alter authorization scope;
- duplicate and out-of-order webhook fixtures converge on correct membership
  state;
- the sixth active member is rejected with `SEAT_LIMIT`; and
- organization switching cannot leak cached projects, events, or signed URLs.

## M3 — Direct upload and ingest

**Status: Foundation**

Deliverables:

- implement S3 multipart creation, part signing, completion, inspection, and
  abort adapters using checksum-aware requests;
- persist enough browser upload state to recover after reload without storing
  credentials or signed URLs;
- reconcile upload sessions left in `completing` after S3 or database failure;
- settle reserved storage against actual S3 bytes through immutable usage
  ledger entries;
- publish ingest work through SQS and consume it idempotently;
- probe real media with `ffprobe`, validate supported formats, calculate source
  identity, and charge source minutes exactly once;
- generate a lower-resolution MP4 proxy, waveform, thumbnails, and extracted
  audio with bounded scratch storage;
- write outputs to temporary keys, validate them, promote them to immutable
  organization/project keys, and then complete artifact records;
- implement authorized 15-minute CloudFront preview and source-download URLs;
- configure incomplete-multipart and temporary-object cleanup.

Acceptance gate:

- supported media completes the browser-to-S3-to-ingest journey;
- at least one 20 GB test object completes without API data proxying;
- pause, resume, page reload, expired part URL, checksum mismatch, duplicate
  completion, abort, and abandoned-session cases behave correctly;
- malformed and unsupported files fail independently without changing other
  projects;
- worker termination and SQS visibility-timeout expiry are retry-safe;
- duplicate delivery charges neither storage nor source minutes twice;
- viewer preview works while viewer source download is denied; and
- source, proxy, waveform, thumbnail, and audio objects are not publicly
  accessible.

## M4 — Managed transcription and analysis

**Status: Foundation**

Deliverables:

- extract existing transcript revision, artifact identity, candidate generation,
  scoring, acceptance, and invalidation rules into shared domain packages;
- retain SQLite desktop adapters and add PostgreSQL SaaS adapters against the
  same domain behavior;
- create a versioned managed Whisper worker image with the pinned English model
  baked in and no runtime model download;
- run transcription on autoscaled GPU EC2 workers and analysis on a separate
  queue/service;
- read managed analysis credentials from Secrets Manager through least-
  privilege roles and KMS;
- preserve provider provenance without logging transcript or prompt content;
- support stage progress, cancellation, provider timeouts, corrupt output, and
  retry classification;
- expose transcript review and candidate review workflows in the browser.

Acceptance gate:

- shared domain tests produce equivalent revision and invalidation behavior
  through desktop and PostgreSQL adapters;
- a real uploaded episode yields an immutable transcript revision and candidate
  set;
- retry or redelivery does not duplicate transcript, candidate, usage, or job
  records;
- cancellation between stages stops downstream work;
- pinned worker images start without external model downloads;
- transcripts, prompts, credentials, and signed URLs are absent from logs; and
- GPU workers scale to zero and recover within the accepted beta startup
  latency.

## M5 — Browser editing and server rendering

**Status: Foundation**

Deliverables:

- reuse shared short, composition, caption, crop, audio, template, render
  preflight, and schedule rules without importing Electron or filesystem
  adapters into the browser or cloud workers;
- replace client-visible paths with authorized assets and media metadata;
- preview the generated proxy with crop, caption, audio, and layout overlays;
- implement candidate-to-short creation, editing, approval, templates, and the
  manual calendar;
- preserve unsaved edits on HTTP 409, fetch the current revision, show the
  changed version, and require explicit reload or reapplication;
- run final FFmpeg rendering on CPU-optimized workers;
- validate rendered media before immutable promotion and download exposure;
- generate 15-minute authorized render download URLs.

Acceptance gate:

- a reviewed candidate can be edited, approved, rendered, validated, downloaded,
  and scheduled entirely in the browser;
- render output matches the accepted desktop composition fixtures within
  documented tolerances;
- stale revisions never overwrite newer edits or produce current renders;
- corrupt or incomplete render objects are never downloadable;
- owner/editor/viewer controls and server permissions match the specification;
- concurrent schedule edits respect organization-scoped slot uniqueness; and
- watched folders, local providers, MCP, setup diagnostics, and YouTube
  publishing are absent from the hosted UI.

## M6 — Stripe subscriptions and quota enforcement

**Status: Foundation**

Deliverables:

- implement Checkout using `STRIPE_TEAM_PRICE_ID` without hardcoded pricing;
- implement Customer Portal sessions and owner-only billing access;
- validate and store signed, idempotent Stripe webhooks;
- create 14-day trials without requiring payment;
- synchronize subscription, paid-through, cancellation, and read-only state;
- aggregate immutable usage ledger entries into billing periods;
- enforce five seats, trial/Team source minutes, and trial/Team storage limits
  under concurrent reservations;
- block new uploads and new processing jobs at a limit while preserving editing,
  previews, existing jobs, and authorized downloads;
- expose subscription state, usage meters, quota explanations, conversion, and
  portal entry in the browser.

Acceptance gate:

- trial creation, conversion, renewal, cancellation, webhook retry, duplicate
  event, and out-of-order event scenarios pass contract tests;
- reservation races cannot exceed hard storage or minute limits;
- actual bytes and probed minutes are charged once;
- abandoned reservations are released;
- cancellation remains writable through the paid-through instant and then
  becomes read/download-only; and
- neither plan prices nor Stripe secrets appear in browser bundles or logs.

## M7 — Deletion, security, and privacy controls

**Status: Foundation**

Deliverables:

- implement owner project deletion with immediate access revocation, queued-job
  cancellation, a durable deletion job, and purge within 24 hours;
- implement organization deletion with recent authentication, typed
  confirmation, immediate disablement, and purge within 24 hours;
- delete database records and active S3 objects idempotently while retaining
  auditable, non-content deletion evidence;
- publish the 35-day encrypted backup-retention disclosure in policy and UI;
- add log redaction for credentials, transcript content, signed URLs, object
  keys, and worker paths;
- isolate FFmpeg and provider calls with bounded CPU, memory, disk, time, and
  output;
- implement rate limits, webhook replay protection, MIME spoofing checks,
  administrative audit events, and security alerting.

Acceptance gate:

- project and organization deletion complete within 24 hours in a measured
  drill;
- revoked users and deleted tenants lose API, event, preview, and download
  access immediately;
- repeated deletion jobs are safe;
- IDOR, signed-URL expiry, webhook signature, MIME spoofing, FFmpeg isolation,
  rate-limit, and log-redaction tests pass;
- a backup restore drill confirms deleted data is used only for disaster
  recovery and remains inaccessible to the active product.

## M8 — Production infrastructure and delivery

**Status: Foundation**

Deliverables:

- complete Terraform for VPC, private subnets, NAT/VPC endpoints, ALB, WAF,
  CloudFront, ECS/Fargate API and CPU workers, GPU EC2 capacity, RDS PostgreSQL,
  IAM task roles, autoscaling, Secrets Manager, KMS, DNS, certificates, and
  backup policy;
- isolate development, staging, and production in separate accounts or
  equivalently reviewed environments;
- build immutable API and worker images with software bills of materials and
  vulnerability scanning;
- implement GitHub Actions gates for tests, images, Terraform plans, one-shot
  migrations, health checks, rollout, and rollback;
- make migrations backward compatible with the previous API release;
- add dashboards and alerts for API latency/errors, webhooks, upload completion,
  queue depth/age, worker failures/duration, GPU utilization, storage growth,
  quota events, render validation, deletion age, and DLQs;
- document incident response, restore, rollback, credential rotation, and
  queue-recovery runbooks.

Acceptance gate:

- staging can be recreated from Terraform without manual data-plane changes;
- a previous API version operates safely during every migration;
- failed health checks and migrations block or roll back releases;
- all critical queues, DLQs, services, database states, and deletion deadlines
  have tested alerts;
- restore, rollback, secret rotation, and worker-capacity drills succeed; and
- production has no cross-region customer-data path.

## M9 — Operational acceptance and invited beta

**Status: Not started**

Rollout stages:

1. internal staging;
2. allowlisted internal production accounts;
3. invited design partners;
4. commercial beta.

Acceptance gate:

- supported upload-to-render completes successfully in production;
- independent authorization review finds no cross-tenant access;
- jobs remain correct under termination, timeout, cancellation, and redelivery;
- quota accounting reconciles to source probes and S3 inventory;
- deletion and restore drills meet policy;
- load tests cover API traffic, 20 GB uploads, concurrent transcription, and
  concurrent rendering independently;
- alarms and on-call runbooks cover every critical service;
- support, privacy, deletion, billing, and backup-retention copy is approved;
- desktop tests and packaging pass against the same release commit; and
- the allowlist remains in place until operational owners record acceptance.

## Critical path

The shortest path to useful risk reduction is:

`M1 PostgreSQL runtime → M2 Clerk tenancy → M3 upload/ingest → M4 analysis → M5 render → M6 billing → M7 security/deletion → M8 deployment → M9 beta`

M6 billing can proceed in parallel after M2, but quota settlement must integrate
with the real upload and probe paths from M3. Infrastructure work in M8 should
grow alongside each milestone, while final production acceptance waits for all
product and security behavior.

The immediate next deliverable is the M1 acceptance gate. The first customer-
visible vertical checkpoint is M3: an authenticated editor creates a project,
uploads a real large episode directly to private S3, and observes validated
ingest artifacts through durable SSE without any cross-tenant access.

## Cross-cutting release gates

Every milestone must preserve:

- desktop/SaaS dependency isolation;
- UUID identity and immutable completed artifacts;
- organization scope derived from verified authorization;
- optimistic revision protection on mutations;
- structured, non-secret errors and logs;
- idempotency for webhooks, queues, usage, and worker outputs;
- no transcript text, credentials, signed URLs, object keys, or absolute worker
  paths in logs;
- backward-compatible API/job/artifact versions during rolling releases; and
- complete desktop test and build gates.

## Explicitly deferred

The commercial beta does not include:

- watched folders;
- local Ollama or other local providers;
- bring-your-own provider credentials;
- MCP;
- YouTube publishing;
- real-time cursors or presence;
- desktop-to-cloud migration or synchronization;
- overage billing;
- non-US processing or residency;
- languages other than English.

Deferred scope must not be pulled into a milestone without first updating the
SaaS specification and recording the effect on security, billing, operations,
and acceptance.

## Roadmap maintenance

Update this document when:

- a milestone changes status;
- an acceptance requirement is added, removed, or materially reinterpreted;
- a dependency changes the critical path;
- a rollout gate passes or fails; or
- implementation reveals a new operational or security requirement.

Each status change should link to durable evidence such as tests, a migration,
an infrastructure plan, a staging run, a security report, or an operational
drill. Do not mark a capability complete solely because its interface,
placeholder, or mocked test exists.
