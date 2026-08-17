# SAAS M2 Clerk and Railway staging acceptance

> **Historical rollback-path record.** This document preserves the 2026-08-02
> evidence and is not an active deployment plan or current staging claim. The
> Cloudflare-first [`SPEC.md`](../SPEC.md) and [`ROADMAP.md`](../ROADMAP.md) are
> authoritative; Railway is temporary rollback-only until Cloudflare acceptance.

| Field | Value |
| --- | --- |
| Date | 2026-08-02 |
| Milestone | M2 — Clerk organizations and permissions |
| Environment | Railway `siftcut-staging` / `staging` |
| Status | In progress |
| Public entry point | Pending Railway-generated web domain |
| Evidence policy | Sanitized text and SHA-256 hashes only |

M2 remains **in progress** until every live gate below passes. Local builds and
automated tests are necessary evidence, but do not substitute for Clerk and
Railway acceptance.

## Implemented

- The web client requests Clerk's session token and defaults API requests to
  the browser origin. The session token is customized with
  `{"aud":"siftcut-api"}` so it retains `sid`, `fva`, and active-organization
  claims.
- The API validates signature, issuer, `aud=siftcut-api`, expiry, authorized
  party, active organization, synchronized membership, and normalized role.
- Both Clerk v1 (`org_id`, `org_role`) and v2 (`o.id`, `o.rol`) organization
  claims are accepted.
- Stale organization deletion returns Clerk's exact `403` strict
  reverification envelope. The client preserves that envelope for
  `useReverification`, retries after successful verification, handles `204`,
  and treats modal cancellation as cancellation.
- Railway assets define private PostgreSQL, migrator, and API services plus one
  public Caddy/Vite gateway. Database migration and runtime roles use separate
  credentials.
- The repository-root EnvBank manifest declares the ten generated, derived,
  and trusted-import records plus the ordered Railway variable contract. It
  contains no credential values or immutable provider IDs.

## Local verification

| Gate | Result | Evidence |
| --- | --- | --- |
| EnvBank manifest check | Pass | 10 records; Railway target; canonical digest `66407628c562fd200b276e48ecdec8b7c3e713d6ee90dceb800efc660ef44f2d` |
| SaaS typecheck | Pass | `npm run typecheck:saas` |
| SaaS unit tests | Pass | 8 files, 50 tests |
| Full M1 verification | Pass | 51 desktop files / 367 tests; 8 SaaS files / 47 tests; 9 PostgreSQL integration tests |
| SaaS production build | Pass | All five SaaS workspaces built |
| Four Docker image builds | Pass | PostgreSQL 17.5, migrator, API, and Caddy/web |
| Container role/migration/readiness smoke | Pass | Separate non-superuser roles, checksum migrations, `/_health`, `/health`, `/ready`, and SPA fallback |

## Clerk dashboard handoff

Use non-personal development test accounts. Do not include email addresses,
tokens, secret fields, or personal data in evidence.

- [ ] Customize the Clerk session token with `{"aud":"siftcut-api"}`.
- [ ] Confirm organization membership limit is five.
- [ ] Confirm member self-deletion is disabled.
- [ ] Confirm custom `org:editor` role exists.
- [ ] After Railway creates the public web domain, register
  `https://<railway-domain>/webhooks/clerk`.
- [ ] Obtain `CLERK_ISSUER`, `CLERK_AUTHORIZED_PARTIES`, `CLERK_SECRET_KEY`,
  `CLERK_WEBHOOK_SIGNING_SECRET`, and `VITE_CLERK_PUBLISHABLE_KEY` for direct
  trusted-stdin intake by EnvBank. Do not copy them into task records or
  evidence.

## Railway deployment handoff

- [ ] Create project `siftcut-staging`, environment `staging`.
- [ ] Select the workspace and plan.
- [ ] Authorize the GitHub repository.
- [ ] Disable automatic GitHub deployments on all four services.
- [ ] Attach a persistent volume at `/var/lib/postgresql/data`.
- [ ] Generate a public domain only for `web`, then finish the Clerk authorized
  party and webhook configuration.
- [ ] Pipe one trusted JSON object with the five Clerk imports directly to
  `envbank bundle prepare --manifest siftcut-staging.envbank.yaml`.
- [ ] Pipe the scoped Railway project token directly to
  `envbank railway bind --manifest siftcut-staging.envbank.yaml`.
- [ ] Run `envbank railway plan --manifest siftcut-staging.envbank.yaml`, review
  names only, confirm `envbank railway apply --plan PLAN_ID`, and run
  `envbank railway verify --bundle short-editor/siftcut-staging/staging`.
- [ ] Deploy in order: PostgreSQL, migrator, API, web.
- [ ] Verify public `/_health`, `/health`, and `/ready`.
- [ ] Confirm PostgreSQL, migrator, and API have no public domain.
- [ ] Monitor deployment/runtime logs and Clerk webhook deliveries for non-2xx
  results.

## Live journey

- [ ] Owner creates Organizations A and B.
- [ ] Editor and viewer invitations are accepted in both organizations.
- [ ] Owner and editor can create projects.
- [ ] Viewer controls are read-only and direct forbidden mutations return
  `403`.
- [ ] Role changes update UI and server authorization after token refresh.
- [ ] Organization switching proves A/B project markers never cross tenants.
- [ ] Owner plus four active members succeeds; a sixth invitation returns
  `SEAT_LIMIT`.
- [ ] After Organization B authentication is older than five minutes, its
  exact name triggers Clerk reverification and the automatic retry returns
  `204`.
- [ ] Organization B is gone after deletion.
- [ ] Organization A and its non-personal test users remain as the regression
  fixture.

## External evidence

Store screenshots outside git. Record only filenames with SHA-256 hashes here
after reviewing each image for tokens, secret inputs, connection strings, and
personal data.

| Evidence | SHA-256 |
| --- | --- |
| Pending | Pending |

EnvBank has no Clerk-dashboard capture path and no provider-variable deletion
command. Apply uses Railway single-variable upserts with `skipDeploys: true`,
so deployment remains a separate manual action. EnvBank verification reports
local committed-write evidence while remote presence stays `unknown`;
`VITE_API_URL` is intended absent, but the workflow neither reads its value nor
deletes it.

## Blockers

- Railway and Clerk dashboard setup require user-controlled sign-in,
  workspace/plan selection, GitHub authorization, trusted Clerk-value intake,
  and a scoped Railway project token.
- No vault was prepared, Railway target bound or applied, service deployed,
  domain created, or Clerk setting mutated during the repository-only manifest
  change.
- Live multi-user acceptance has not yet run.

Do not mark M2 complete in the roadmap or history until these blockers are
cleared and every live checkbox passes.
