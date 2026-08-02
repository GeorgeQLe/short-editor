# Current work

- [x] SAAS-M1 — Make the hosted API runnable against PostgreSQL with
  transaction-local tenant context, production repository adapters, durable
  outbox publication, readiness, migration smoke coverage, and cross-tenant
  integration tests.
  - The ordered execution and acceptance gate are defined in
    `docs/saas/ROADMAP.md`.
  - Clerk, S3/SQS, Stripe, managed processing, and full AWS deployment remain
    later milestones; M1 must preserve the independent Electron build and test
    gates.
- [x] UI-01.1 — Complete the library, watched-folder, relink, provider-status,
  and cloud-authorization workflow.
  - Named-fixture macOS acceptance passed on commit `af8ab23` with isolated
    fixture `UI-01.1-macos-2026-07-29`. Mixed import, watched-folder
    configuration and rescans, relink rejection and confirmed recovery, passive
    provider readiness, private-network acknowledgement reset, and protected
    credential authorization/revocation/removal all passed. The attach-only
    evidence is `UI-01.1-macos-2026-07-29.png`.
- [x] UI-01.2 — Complete transcript editing, Candidate review, and accepted-copy
  workflow.
  - Named-fixture macOS acceptance passed on the working tree based on commit
    `bf73dd3` with isolated fixture `UI-01.2-macos-2026-07-29`. Transcript
    snapshot editing/conflict recovery, downstream invalidation, heuristic and
    accepted-analysis generation, append/replace behavior, Candidate decisions,
    accepted-copy conflict recovery, regeneration retention, and insufficient
    material guidance all passed. The attach-only evidence is
    `UI-01.2-macos-2026-07-29.png`.
- [x] UI-01.3 — Complete timeline, composition, crop, caption, and audio editing
  with session undo/redo.
  - Named-fixture macOS acceptance passed on the working tree based on commit
    `6c7cd70` using isolated fixture `UI-01.3-macos-2026-07-30` on macOS
    26.5.2 (25F84). Template cloning/renaming, durable Short creation/reopening,
    source-aware timeline editing, layer/asset/crop/caption/audio saves,
    cross-section undo/redo, exact stale-save recovery, invalidation semantics,
    and full restart persistence passed through revision 10.
  - The fixture-local native picker imported and bound a credential-free image
    with explicit provenance. The final evidence remains outside git as
    `UI-01.3-macos-2026-07-30.png`, SHA-256
    `8aa0c506ef48afbd95586d52881cbafaef268178d30a87aa8088125b356390da`.
    Native packaged Windows acceptance remains assigned to the Windows release
    gate.
- [x] UI-01.4 — Complete approval, preflight, render progress, cancellation,
  recovery, and retry workflow.
  - Named-fixture macOS acceptance passed on the working tree using isolated,
    credential-free fixture `UI-01.4-macos-2026-07-30-v2`. Exact approval and
    preflight, visible encoding, single cancellation, immutable retry,
    successful MP4/SRT validation, provenance, determinism, unchanged source
    bytes, and full restart persistence passed in lineage
    `de09a110-ce6d-4026-a673-11d575debaa7`.
  - The fixture explicitly pins a native arm64 drawtext-capable FFmpeg 6.0
    binary because the host FFmpeg 8.1.2 build lacks `drawtext`. Final evidence
    remains outside git as `UI-01.4-macos-2026-07-30-v2.png`, SHA-256
    `b8c16af623862ac2753d3bf18d15b53b5e244ca900063ad5927e19652837bcc3`.
    Native packaged Windows acceptance remains assigned to the Windows release
    gate.
- [x] UI-01.5 — Complete schedule rules, list/calendar, move, collision, and
  publication-recording workflow.
  - Isolated credential-free macOS acceptance passed with fixture
    `UI-01.5-macos-2026-07-30`. First-run and exact revisioned rules,
    prioritized eligible-Render drafting, list/month inspection, local occupied
    collision feedback, legal move preview/submission, rerender publication
    blocking, optional YouTube URL recording, and locked restart persistence
    passed. The attach-only evidence is `UI-01.5-macos-2026-07-30.png`,
    SHA-256
    `21214f4c07d2c80ca791a29aa8f446bb66c6ae403370e2b992ccf425dfb4c7f2`.
    No upload, authentication, or remote verification occurred. Native packaged
    Windows acceptance remains assigned to WIN-03.7.

## Completed

- [x] Establish the SiftCut commercial-beta SaaS foundation without changing
  Electron behavior: add isolated npm workspaces, authenticated multi-tenant
  contracts, infrastructure ports, a role/revision/quota-aware API service,
  multipart browser upload and worker primitives, a tenant-scoped PostgreSQL
  schema, initial `us-east-1` Terraform resources, executable SaaS tests, a
  separate hosted-product specification, and an M0–M9 delivery roadmap.
- [x] Establish the SiftCut product identity across application copy, release
  metadata, support surfaces, and repository documentation; add a reproducible
  vertical film-cut app icon, use it in the macOS package and sidebar header,
  validate the packaged renderer and icon set, and provide an interactive
  eight-palette color study.
- [x] Produce reproducible macOS release inputs, secure model installation,
  concrete runtime manifests, GPL corresponding source, unsigned arm64 test
  artifacts, and automated release validation.
- [x] Prepare Short Editor for public OSS operation with an MIT project
  license, explicit third-party notices, contribution and conduct policies,
  private vulnerability reporting guidance, issue/PR templates, and Dependabot.
- [x] Add the News Brief + Speaker starter template with bound topic text,
  image-or-video related media, split composition, uppercase caption preset,
  migration compatibility, and executable render coverage.
- [x] API-03 — Freeze schemas and generate release-facing interface
  documentation.
- [x] API-02 — Deliver concrete MCP schemas and complete parity.
- [x] API-01 — Complete and contract-test the versioned HTTP API.
- [x] SCH-02 — Complete draft, move, lock, and publication semantics.
- [x] SCH-01 — Persist revisioned schedule rules with a documented DST policy.
- [x] RND-04 — Add safe cancellation, retry attempts, and crash recovery.
- [x] RND-03 — Gate Render success on normalized determinism evidence.
- [x] RND-02 — Compose originals with an explicit FFmpeg graph.
- [x] RND-01 — Build typed preflight from an immutable revision snapshot.
- [x] EDT-05 — Implement deterministic source and bed audio decisions.
- [x] EDT-04 — Implement caption data, editing, layout checks, and sidecars.
- [x] EDT-03 — Add independent automatic and manual crop tracks.
- [x] EDT-02 — Persist template clones, materialized lineage, and complete
  assets.
- [x] EDT-01 — Complete the Short timeline and approval lifecycle.
- [x] TRC-03 — Preserve decisions and accepted copy across Candidate
  regeneration.
- [x] TRC-02 — Make Candidate generation deterministic, diagnostic, and
  corpus-tested.
- [x] TRC-01 — Add accepted transcript revisions and safe editing.
- [x] PRO-05 — Implement OpenAI adapters, provenance, and cache identity.
- [x] PRO-04 — Add Windows-protected credentials and persisted cloud
  authorization.
- [x] PRO-03 — Implement Ollama analysis and local visual sampling.
- [x] PRO-02 — Implement local faster-whisper transcription.
- [x] PRO-01 — Define and supervise the versioned Python worker protocol.
- [x] INV-02/INV-03 — Add watched-folder reconciliation, missing-source
  detection, and identity-safe relinking.
- [x] INV-01 — Make batch import identity-safe and format-aware.
- [x] FND-03 — Enforce the artifact store and startup reconciliation.
- [x] FND-02 — Add complete transactional persistence and migrations.
- [x] FND-01 — Complete domain schemas, provider classifications, versioned job
  messages, the error registry, and the Episode transition matrix.
- [x] Add platform-aware application data directory resolution for Windows,
  macOS, and Linux development hosts.
