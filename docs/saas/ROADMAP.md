# SiftCut Commercial Roadmap

| Field | Value |
| --- | --- |
| Roadmap version | 0.2.0 |
| Last updated | 2026-08-16 |
| Target | Invited Cloud private beta |
| Architecture | Cloudflare Worker, D1, R2, and Queues |
| Product specification | [`SPEC.md`](SPEC.md) |

Milestones describe evidence, not aspiration. A local test or implemented
adapter is a foundation; a capability becomes **Staging accepted** only after
its live acceptance gate passes and evidence is recorded.

## Status vocabulary

- **Implemented foundation** — code and local tests exist; live acceptance is
  incomplete.
- **Private-beta work** — actively being completed for invited users.
- **Staging accepted** — the named live gate passed in the target environment.
- **Future capability** — planned, with no availability claim.

## Current product truth

| Product | Current status | Commercial position |
| --- | --- | --- |
| SiftCut Desktop | Available local/offline-first editor; root `SPEC.md` remains authoritative | Free and MIT-licensed |
| SiftCut Cloud | Implemented Cloudflare foundations; private-beta work; complete staging journey not yet accepted | Paid managed workspace with bounded included AI/media usage |
| SiftCut Mobile | Roadmap companion for capture, review, approvals, and managed workflows | Paid Cloud companion sharing account, subscription, and quotas |

The repository currently includes a Worker entry point, D1 repositories and
migration, private R2 adapter, Queue/outbox plumbing, Wrangler configuration,
Terraform resources, EnvBank secret mapping, authenticated organization UI,
and local tests. These are implemented foundations, not proof that upload,
analysis, and rendering work end to end in staging.

Railway/PostgreSQL remains available only as a temporary rollback path until
Cloudflare acceptance succeeds. It receives no new product work and is not the
active architecture.

## Milestone map

| ID | Milestone | Status | Exit evidence |
| --- | --- | --- | --- |
| C0 | Product family, brand, and commercial boundary | Private-beta work | Docs and tests agree on names, claims, included usage, and status labels |
| C1 | Cloudflare control plane | Implemented foundation | Terraform plan, Wrangler dry-run, D1 migration, isolated bindings |
| C2 | Identity and organization tenancy | Implemented foundation | Live role/invitation/switching suite with no tenant leakage |
| C3 | Beta request funnel | Private-beta work | Public form and D1 endpoint pass validation, abuse, duplicate, concurrency, privacy, and accessibility checks |
| C4 | Private upload and ingest | Implemented foundation | Real supported media reaches validated private artifacts in staging |
| C5 | Managed transcription and candidate review | Implemented foundation | Real episode yields reviewable revisioned output with bounded usage |
| C6 | Browser review and deterministic render | Implemented foundation | Human-approved candidate becomes a validated downloadable render |
| C7 | Subscription, limits, and trust | Implemented foundation | Invited plan, included limits, lifecycle, deletion, and disclosures pass |
| C8 | SiftCut Mobile companion | Future capability | Capture/review journey passes without claiming a full mobile edit bay |
| C9 | Invited beta readiness | Future capability | Security, operations, restore, accessibility, and live journey gates all pass |

## C0 — Product family, brand, and commercial boundary

Deliver and test the Desktop/Cloud/Mobile definitions, shared Cloud/Mobile
account model, approved descriptions, landing metadata, and claim rules.
Public copy uses “AI-assisted, human-approved,” names no provider as the product,
publishes no dollar pricing, and directs new teams to request beta access.

## C1 — Cloudflare control plane

Terraform owns D1, private Standard R2, three Queue/DLQ pairs, Worker identity,
route, and observability. Wrangler owns versions, static assets, migrations,
bindings, and deploy validation. EnvBank owns secrets. The staging gate includes
clean Terraform validation/plan review, migration application to an isolated
database, Worker dry-run, readiness, rollback rehearsal, and secret-redaction
review.

## C2 — Identity and organization tenancy

Complete signed webhook convergence, invitation limits, organization switching,
role enforcement, recent-auth deletion, and cache isolation. Acceptance covers
forged and stale sessions, known cross-tenant UUIDs, all owner/editor/viewer
operations, and organization-switch races.

## C3 — Beta request funnel

Ship the accessible request form and public API route. Production bot
verification fails closed. Valid new and duplicate requests return identical
202 envelopes. D1 enforces normalized-email uniqueness. Concurrency tests allow
one stored record without exposing the outcome. No public read route, raw IP,
token logging, detailed database error, CRM, or admin UI is introduced.

## C4–C6 — Managed media journey

Validate direct private multipart upload, quota reservation, retry-safe ingest,
managed transcription and analysis, revisioned candidate review, human approval,
deterministic render, and authorized download in order. Each stage promotes
only validated immutable output and tolerates queue redelivery. Until all three
milestones pass together in staging, marketing describes this as Cloud
private-beta work rather than an available end-to-end journey.

## C7 — Subscription, limits, and trust

Cloud and Mobile are paid managed products with an included bounded allowance.
Invited-beta pricing and exact limits are confirmed during onboarding. Complete
subscription lifecycle, concurrent quota enforcement, retention/deletion,
subprocessor disclosure, operational alerting, and support procedures before
self-serve billing. BYOK and overages remain deferred.

## C8 — SiftCut Mobile

Replace the Screenletter public name with SiftCut Mobile while preserving any
required internal compatibility during migration. Scope capture, upload handoff,
status, review, approval, and managed workflow controls. Timeline-heavy editing
continues on Desktop or the appropriate Cloud web surface.

## C9 — Invited beta readiness

Record live evidence for the complete supported journey; tenant and abuse
resistance; queue retry and dead-letter operations; usage correctness; restore
and deletion drills; accessible keyboard, screen-reader, reduced-motion, and
responsive behavior; support escalation; and rollback. Remove Railway only
after the Cloudflare acceptance and rollback gates pass.

## Required continuous gates

Every change preserves Desktop independence, organization-derived
authorization, immutable output identity, optimistic revisions, structured
redacted errors, idempotent webhooks/queues/usage, private media, bounded
payloads, and accurate marketing status. Active SaaS docs must not describe AWS
or Railway as the target deployment.

## Explicitly deferred

BYOK, provider selection, overage billing, public self-serve pricing, automatic
Desktop sync, a full mobile edit bay, global admin UI, CRM automation,
marketing-email sequences, real-time presence, non-US residency, and direct
publishing remain future capabilities.
