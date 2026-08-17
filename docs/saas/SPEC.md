# SiftCut Cloud Commercial Specification

| Field | Value |
| --- | --- |
| Specification version | 0.2.0 |
| Status | Private-beta implementation |
| Last updated | 2026-08-16 |
| Platform | Cloudflare-first |
| Delivery roadmap | [`ROADMAP.md`](ROADMAP.md) |
| Brand system | [`BRAND.md`](BRAND.md) |

This document is authoritative for the commercial SiftCut product surfaces.
The repository-root [`SPEC.md`](../../SPEC.md) remains independently
authoritative for the free, MIT-licensed, local/offline-first desktop editor.
Nothing in this document changes that desktop specification.

## Product family and account model

SiftCut is one provider-neutral, AI-assisted editing platform for podcast,
YouTube, and small-studio creator teams.

- **SiftCut Desktop** is the free, MIT-licensed editor. It runs locally,
  remains useful without a Cloud subscription, and keeps local projects and
  media on the creator's machine unless the creator explicitly uses Cloud.
- **SiftCut Cloud** is the paid managed workspace for team identity, private
  media, collaboration, durable projects, managed processing, deterministic
  rendering, storage, and support.
- **SiftCut Mobile** is a paid Cloud companion for capture, project status,
  review, approval, and bounded managed AI workflows. It is not a full mobile
  edit bay and is not sold as a separate identity or processing account.

Cloud and Mobile share one account, organization membership, subscription,
usage allowance, project identity, and managed-processing boundary. Desktop
does not require that account. Desktop-to-Cloud synchronization and automatic
local-project migration are not part of the private beta.

## Commercial boundary

Cloud subscriptions include bounded managed AI and media processing, storage,
collaboration, and support. Mobile uses the same included allowance. Invited-
beta pricing and limits are confirmed during onboarding; no public dollar
pricing is promised yet. Bring-your-own-key credentials, provider selection,
overages, and self-serve plan changes are deferred.

SiftCut selects and operates processing providers behind its own product
contract. Provider names and credentials are implementation details, not the
product proposition. SiftCut is not a reseller of another AI product and is
not presented as a generic API wrapper.

## Cloudflare-first platform

Cloudflare is the target control plane and request path:

- a Cloudflare Worker serves the version-aligned web application and API;
- D1 stores accounts, organizations, memberships, subscriptions, beta access
  requests, usage, projects, jobs, events, and transactional outbox records;
- private R2 buckets store source media, intermediates, and renders under
  organization/project-scoped keys;
- Queues separate ingest, analysis, and render work, each with a dead-letter
  queue and retry policy;
- Wrangler owns Worker code, static assets, migrations, and runtime bindings;
- Terraform owns D1, R2, Queues, Worker identity, routes, and observability;
- EnvBank supplies secrets to isolated development, staging, and production
  targets without committing their values.

Worker and D1 operations are the canonical hosted path. The previous
Railway/PostgreSQL deployment is retained only as a temporary rollback path
until Cloudflare staging acceptance passes; it is not an active deployment
claim or the target architecture. No new commercial feature should depend on
that rollback path.

Customer objects are private and use
`orgs/{organizationId}/projects/{projectId}/...` keys. Application models
expose opaque asset IDs and media metadata, never workstation paths, raw object
keys, credentials, or reusable storage authorization.

## Identity, tenancy, and collaboration

Every authenticated route verifies the session, then derives user,
organization, and role from verified identity claims and synchronized D1
membership. Tenant identifiers supplied in paths or bodies are never
authorization evidence. Owners, editors, and viewers receive server-enforced
capabilities; optimistic revisions prevent stale edits from overwriting newer
work.

Projects are organization-scoped. Durable event records support resumable
updates. Mutations that schedule work commit their domain change and D1 outbox
record together. Queue consumers validate ownership, claim idempotently,
heartbeat, honor cancellation boundaries, validate outputs before promotion,
and tolerate redelivery.

## Private media and managed processing

Authorized clients upload directly to private R2 multipart sessions. Creation
reserves quota; completion verifies the stored object before ingest is queued.
Ingest, analysis, and render use separately bounded queues and compute workers.
Temporary outputs are validated before immutable promotion and scratch data is
removed after success or failure.

AI assists with transcription, analysis, candidate proposals, captions, and
other explicitly presented steps. A person reviews and approves editorial
decisions. Deterministic revisions, provenance, and render validation remain
part of the product contract regardless of the selected compute provider.

## Beta access requests

`POST /v1/beta-access-requests` is public and runs before session middleware.
It accepts only:

- required `email`, `name`, `teamSize`, `contentType`, `monthlyHours`,
  `consent: true`, and `turnstileToken`;
- optional `teamName` and `notes`.

The endpoint applies strict enums, field-length bounds, a small JSON body
limit, trimmed lowercase email normalization, and production bot verification
that fails closed. D1 stores a UUID, normalized unique email, submitted profile
fields, consent time, source, `pending|invited|declined` status, and timestamps.
It stores no raw IP address. First and duplicate valid submissions both return
HTTP 202 with `{ "apiVersion": "v1", "data": { "accepted": true } }` so the
response cannot enumerate registered addresses.

There is no public lead-list endpoint. Early requests are reviewed with
authenticated Cloudflare/D1 operator tooling; an admin UI, CRM integration,
automatic invitation, and marketing-email sequence are out of scope.

## Security, privacy, and deletion

Private media, TLS, least-privilege bindings, environment isolation, bounded
bodies, structured redacted errors, webhook idempotency, and audit-ready
timestamps are required. Logs must not contain credentials, transcript text,
signed URLs, raw object keys, absolute worker paths, Turnstile tokens, or raw IP
addresses.

Owner deletion requires recent authentication and typed confirmation, disables
access promptly, and schedules data purge. Retention and subprocessors are
disclosed in trust/privacy material. Identity, billing, abuse prevention, and
compute-provider names stay out of headline marketing copy.

## Release truth and acceptance

The following labels are mandatory in documentation and marketing:

- **Available in Desktop**: behavior implemented and accepted in the local app.
- **Cloud private-beta work**: implemented foundations or active work that has
  not passed the complete staging journey.
- **Staging accepted**: a capability that passed its named live acceptance
  evidence in the target environment.
- **Mobile roadmap**: intended companion behavior without a shipped claim.

Repository scaffolding, compilation, mocks, and local Miniflare tests do not
constitute staging acceptance. The full upload-to-render journey must not be
presented as available until its live acceptance record passes.

Before invited beta, acceptance requires tenant-isolation and authorization
tests, beta-request abuse/duplicate/concurrency tests, D1 migration validation,
private R2 checks, queue redelivery safety, correct bounded-usage accounting,
deletion verification, accessibility review, responsive production screenshots,
Worker dry-run, and a supported live upload-to-render staging journey.

## Deferred

Deferred capabilities include BYOK, overages, self-serve public pricing,
provider selection, Desktop/Cloud automatic synchronization, full mobile
timeline editing, global admin UI, automated beta marketing, non-US residency,
real-time cursors, and direct publishing integrations.
