# Session history

## 2026-07-27

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
