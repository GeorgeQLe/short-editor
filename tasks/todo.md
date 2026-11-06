# Current work

> Completed items are archived monthly in `tasks/history/`; the ship log stays in `tasks/history.md`.

- [ ] SAAS-CLOUDFLARE-STAGING — Complete live Cloudflare private-beta
  acceptance.
  - Apply the Terraform-owned Worker, D1, private R2, Queue/DLQ, route, and
    Turnstile resources in an isolated staging environment; render the
    Wrangler bindings and apply EnvBank secrets without exposing values.
  - Configure the public Clerk and Turnstile keys for the production-mode web
    build, deploy the version-aligned Worker/assets, and run identity,
    beta-request, private-media, queue-redelivery, deletion, and rollback
    checks from `docs/saas/ROADMAP.md`.
  - Render and inspect mobile, tablet, and desktop production screenshots. The
    supported in-app browser was unavailable during repository verification,
    so responsive visual acceptance remains a live gate.
  - Do not claim the complete upload-to-render journey until its staging
    evidence passes. Retain Railway/PostgreSQL only as the temporary rollback
    path until this gate succeeds.
