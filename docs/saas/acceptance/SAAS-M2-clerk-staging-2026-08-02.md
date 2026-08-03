# SAAS M2 Clerk and Railway staging acceptance

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

## Local verification

| Gate | Result | Evidence |
| --- | --- | --- |
| SaaS typecheck | Pass | `npm run typecheck:saas` |
| SaaS unit tests | Pass | 8 files, 47 tests |
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
- [ ] Copy the new webhook signing secret directly into Railway's masked
  `CLERK_WEBHOOK_SIGNING_SECRET` field.
- [ ] Copy the Clerk secret key directly into Railway's masked
  `CLERK_SECRET_KEY` field.

## Railway deployment handoff

- [ ] Create project `siftcut-staging`, environment `staging`.
- [ ] Select the workspace and plan.
- [ ] Authorize the GitHub repository.
- [ ] Disable automatic GitHub deployments on all four services.
- [ ] Generate independent PostgreSQL administrator, migrator, and API
  passwords and enter them only in masked Railway fields.
- [ ] Attach a persistent volume at `/var/lib/postgresql/data`.
- [ ] Deploy in order: PostgreSQL, migrator, API, web.
- [ ] Generate a public domain only for `web`.
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

## Blockers

- Railway and Clerk dashboard setup require user-controlled sign-in,
  workspace/plan selection, GitHub authorization, and direct masked secret
  entry.
- Live multi-user acceptance has not yet run.

Do not mark M2 complete in the roadmap or history until these blockers are
cleared and every live checkbox passes.
