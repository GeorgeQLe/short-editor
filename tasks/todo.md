# Current work

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
- [ ] UI-01.4 — Complete approval, preflight, render progress, cancellation,
  recovery, and retry workflow.
- [ ] UI-01.5 — Complete schedule rules, list/calendar, move, collision, and
  publication-recording workflow.

## Completed

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
