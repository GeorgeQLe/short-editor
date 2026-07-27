# Ship manifest — 2026-07-27

## User goal

Complete INV-01: make batch media import identity-safe and format-aware, then
wrap up the session and ship the result.

## Changed files and per-file purpose

- `src/core/media.ts` makes import asynchronous, validates media with FFprobe
  before persistence, samples file content for quick fingerprints, resolves
  ambiguous identity with stable SHA-256 hashes, serializes identity
  finalization, persists probe metadata, and returns safe typed rejections.
- `src/core/repository.ts` returns every quick-fingerprint candidate and supports
  deterministic content-hash lookup.
- `src/core/service.ts` awaits validated imports and queues hashing only when
  identity resolution did not already produce a full hash.
- `src/shared/contracts.ts` defines the typed per-input import rejection shape.
- `src/electron/main.ts`, `src/ui/api.ts`, and `src/ui/App.tsx` expose readable
  video selection, the typed result, and imported/duplicate/rejected counts.
- `src/mcp/server.ts` describes the format-aware source-in-place behavior.
- `tests/media.test.ts` covers mixed formats, malformed and unsupported media,
  canonical/symlink/hard-link/content duplicates, sampled-fingerprint
  collisions, concurrent imports, source mutation, unavailable FFprobe,
  read-only sources, and hash-job scheduling.
- `SPEC.md` reconciles the implementation matrix with the completed INV-01
  boundary and leaves watched folders, missing-source reconciliation, and
  relinking pending.
- `tasks/todo.md` marks INV-01 complete and promotes INV-02 as the sole current
  executable task.
- `tasks/history.md` records the completed import work.
- `tasks/ship-manifest.md` records this exact shipping proof.

Generated `.agents/skillpacks/`, `.claude/skills/`, and `.codex/skills/` local
artifacts are excluded from the commit. `.agents/project.json` is unchanged.

## User-goal mapping

The media and repository changes implement safe batch inspection and identity
resolution. Service and shared-contract changes carry the result through the
core boundary. Electron, UI, and MCP changes expose the broader readable-video
contract. The media suite proves the failure modes and invariants, while SPEC
and task documents reconcile the completed scope and route the next inventory
task.

## Tests run

- `npm test`: 13 test files and 69 tests passed.
- `npm run build`: TypeScript application checking, Vite production build, and
  Node-target TypeScript build passed.
- `git diff --check`: passed.

## Skipped tests

- No lint script or lint/check target exists in `package.json`, and there is no
  Makefile, Justfile, Python, or Cargo validation surface. TypeScript checking,
  the production build, and the full Vitest suite are the available executable
  gates.
- `npm run package:win` is deferred because this macOS development host cannot
  establish Windows-native SQLite, long-path, picker, FFprobe packaging, or
  installer evidence.
- An interactive Electron smoke test was not run because the automated suite
  directly covers import behavior and this environment does not provide the
  representative Windows media corpus required for release acceptance.

## Adversarial review

A failure-oriented changed-file review traced canonical-path, symlink,
hard-link, sampled-fingerprint, and content-hash identity; concurrent calls and
batch ordering; transaction boundaries; source mutation; FFprobe spawn,
non-zero, invalid-JSON, missing-video, missing-metadata, and diagnostic-redaction
paths; hash-job duplication; and API/UI/MCP compatibility.

The full suite additionally exercises every added behavior. No blocking finding
or warning remains.

## Residual risk

- Windows long paths, native file-picker filters, packaged FFprobe discovery,
  read-only permissions, and representative codecs still require the G1
  Windows 11 acceptance run.
- Stability checks use file size and modification time around reads. A source
  rewritten in place while preserving both values could evade mutation
  detection; content hashing still protects ambiguous duplicate merges, but a
  unique import could retain probe metadata from the racing read.
- Import serialization is scoped to the application `MediaService` instance.
  The runtime creates one instance; a future multi-process importer would need a
  database-level content-identity arbitration design.

## Rollback note

Revert the INV-01 commit. This change adds no database migration, so rollback
does not require data restoration; episodes imported under the broader format
contract may remain in an existing database and should be reviewed before
running an older MP4-oriented build.

## Next command

`$exec INV-02`
