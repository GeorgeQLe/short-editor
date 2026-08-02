# SiftCut Commercial Beta SaaS Specification

| Field | Value |
| --- | --- |
| Specification version | 0.1.0 |
| Status | Proposed commercial beta |
| Last updated | 2026-08-01 |
| Region | AWS `us-east-1` only |
| Delivery roadmap | [`ROADMAP.md`](ROADMAP.md) |

This specification is authoritative for the hosted SiftCut product. It does not
change Electron behavior: the repository-root `SPEC.md` remains authoritative
for the independent, offline-first desktop application. Desktop and SaaS data
are not migrated or synchronized in this release.

## Product and access model

The beta is an English-only organization workspace for uploading long-form
episodes, managed transcription and analysis, candidate review, short editing,
templates, server rendering, downloads, and the manual launch calendar.

Clerk is the identity and organization authority. Every application request
MUST validate the Clerk session JWT, then derive the user, active organization,
and role only from its verified claims and synchronized membership. Tenant IDs
supplied in paths or bodies are identifiers, never authorization evidence.
Signed, idempotent Clerk webhooks synchronize users, organizations,
memberships, invitations, and roles.

- Owners can manage billing and members, read and mutate every project, start
  and cancel jobs, download sources and renders, and request deletion.
- Editors can create and edit projects, upload, start and cancel jobs, render,
  and manage the calendar. They cannot manage billing, members, or deletion.
- Viewers can inspect projects, preview media, and download completed renders.
  They cannot mutate state or download sources.

Projects are visible organization-wide. Optimistic `expectedRevision` checks
protect every revisioned mutation. A conflict returns HTTP 409 with expected
and actual revisions; the browser MUST keep unsaved edits and require explicit
reload or manual reapplication.

## Storage, processing, and events

Customer objects are private and use
`orgs/{organizationId}/projects/{projectId}/...` keys. Clients receive
CloudFront signed URLs only after authorization, for no more than 15 minutes.
Client-visible models expose asset IDs, display names, and media metadata,
never workstation paths or raw object keys.

Uploads use S3 multipart upload and support at least 20 GB, per-part SHA-256
checksums, pause, retry, progress, recovery, completion, and abort. Creation
reserves estimated bytes atomically with quota checks. Ingest charges the
source duration once after successful probe; retries and duplicate deliveries
cannot charge again.

Ingest creates a content identity, proxy MP4, waveform, thumbnails, and audio.
Separate ingest, analysis, and render queues feed independently autoscaled
workers. Managed Whisper runs in a versioned GPU image with the pinned model
baked in; analysis credentials come from Secrets Manager; FFmpeg work runs on
CPU workers with bounded scratch space.

Every job payload has a schema version, job UUID, organization, project, input
hash, kind, and request time. Workers validate ownership, claim idempotently,
heartbeat stages, check cancellation between stages, classify failures, verify
temporary outputs before immutable promotion, and always remove scratch data.
Domain mutation and outbox insertion commit together. SQS publication is
retryable and consumers tolerate redelivery.

`GET /v1/events` is an authenticated SSE endpoint backed by durable
organization event records and supports `Last-Event-ID`.

## Billing and quota policy

Stripe owns plan pricing through `STRIPE_TEAM_PRICE_ID`. Signed, idempotent
webhooks synchronize Checkout and Customer Portal state.

| Entitlement | Trial (14 days) | Team |
| --- | ---: | ---: |
| Active members | 5 | 5 |
| Source minutes / period | 120 | 1,200 |
| Stored data | 25 GB | 500 GB |

Limits are hard and have no overage billing. Immutable usage ledger entries
roll up into billing periods. At a limit, sign-in, editing, previews, existing
jobs, and authorized downloads remain available; new uploads and new processing
jobs return a structured quota error. Cancellation remains fully active until
the paid-through instant and then becomes read/download-only.

## Security, privacy, and deletion

Customer data and processing MUST remain in `us-east-1`. RDS, S3, SQS, logs,
and secrets are encrypted at rest, TLS is required in transit, S3 public access
is blocked, databases and workers use private subnets, and task roles are least
privilege. WAF rate limits and administrative audit logging are required.

Logs MUST NOT contain credentials, transcript text, signed URLs, raw object
keys, or absolute worker paths. Metrics may contain durations, resource usage,
provider identifiers, and redacted failure classes.

Owner project deletion immediately revokes access, requests cancellation, and
schedules database/object purge within 24 hours. Organization deletion requires
recent authentication and typed confirmation, immediately disables access, and
purges active data within 24 hours. Policy and UI disclose that encrypted
disaster-recovery backups may retain deleted data for up to 35 days. Sources
and outputs otherwise remain until explicitly deleted.

## Deployment and acceptance

Development, staging, and production use separate accounts or fully isolated
environments. Terraform provisions networking, CloudFront/S3, ALB/ECS, RDS,
SQS, KMS, Secrets Manager, WAF, logs, metrics, and alarms. Images are immutable.
Backward-compatible PostgreSQL migrations run as a one-shot ECS task before
API rollout, followed by health and rollback gates.

Acceptance requires a supported upload-to-render journey, no cross-tenant
authorization finding, retry-safe job processing, accurate quota accounting, a
successful restore drill, deletion within 24 hours, and alarms on all critical
queues and services. Desktop tests and packaging remain required CI gates.

Deferred: watched folders, local Ollama, BYOK, MCP, YouTube publishing,
real-time cursors, desktop synchronization, overages, and non-US residency.
