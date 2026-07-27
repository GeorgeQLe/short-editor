# Short Editor v1 Engineering Specification

| Field | Value |
| --- | --- |
| Specification version | 1.1.0 |
| Status | Active; owner review required before acceptance |
| Last updated | 2026-07-27 |
| Owners | Short Editor maintainers |
| Normative review | Must be recorded by an owner in REL-01 evidence |
| Release-acceptance platform | Windows 11 |

This document is the authoritative engineering specification for Short Editor v1.
If this document conflicts with the README, source comments, tests, UI copy, an
issue, or an implementation detail, this document wins. Code describes current
behavior; it does not silently redefine required behavior.

## 1. Normative language and change control

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and
**MAY** are to be interpreted as described by RFC 2119 and RFC 8174 when, and only
when, they appear in all capitals.

- A change to normative product scope, privacy boundaries, persistence, public
  interfaces, output formats, or release acceptance MUST increment the
  specification version and add a changelog entry.
- A backwards-compatible clarification SHOULD increment the patch version. A
  backwards-compatible requirement addition SHOULD increment the minor version.
  An incompatible requirement change MUST increment the major version.
- An implementation-status or evidence-link update MAY change the capability
  matrix without changing the specification version.
- External platform facts MUST include a verification date and MUST be rechecked
  before every release candidate.
- Proposed behavior is not accepted behavior until it is merged into this
  document. Normative changes MUST be reviewed by at least one owner.

## 2. Product definition

### 2.1 Goal and users

Short Editor is an English-only, offline-first, single-user Windows 11 desktop
application that turns a user's long-form, spoken-word media into a reviewed set
of vertical YouTube Shorts and a manual publication schedule.

The primary user is an individual creator or editor working on one Windows
workstation. The product MUST support the complete workflow:

1. inventory local source media without changing it;
2. transcribe and analyze the source;
3. generate and review 5–10 highlight candidates;
4. create a non-destructive Short project and content package;
5. edit timing, layout, reframing, captions, and audio;
6. approve, preflight, render, and validate the Short;
7. place it on a deterministic launch calendar; and
8. manually upload it, then record its publication status and optional URL.

### 2.2 Terms

- **Episode**: one inventoried source-media record.
- **Candidate**: a scored, sentence-aligned proposed excerpt from an Episode.
- **Short** or **Short project**: a revisioned edit decision list, composition,
  captions, audio settings, and content package derived from an Episode.
- **Content package**: cleaned transcript, planning rewrite, hook variants,
  titles, description, hashtags, and thumbnail text.
- **Template**: a versioned reusable composition definition.
- **Render**: an immutable output attempt bound to one Short revision.
- **Artifact**: a generated transcript, analysis result, proxy, waveform,
  thumbnail, caption file, render, or provider result.
- **Provider**: a local or cloud implementation used for transcription or
  analysis.
- **Accepted artifact**: the user-selected or edited value used by downstream
  work. Provider output MUST remain distinguishable from accepted data.
- **Project cloud authorization**: an explicit user grant, made through the UI,
  allowing named cloud operations for a project or batch.
- **Source relinking**: reconnecting an Episode to moved media after identity
  checks pass.
- **Primary UI state transition**: a user action that persists domain state,
  starts/cancels/retries work, or changes lifecycle status.

### 2.3 Non-goals

Short Editor v1 MUST NOT:

- publish to YouTube or implement YouTube OAuth;
- provide a general-purpose multitrack nonlinear editor;
- provide multi-user collaboration, accounts, or remote project sync;
- synthesize or clone voiceover;
- automatically download or source web media;
- silently send data to a cloud provider;
- destructively alter source media; or
- expose destructive project, Episode, asset, or artifact deletion to either the
  UI, HTTP API, or MCP.

The v1 calendar is a planning and recordkeeping tool, not an uploader. The user
remains responsible for rights clearance, Content ID consequences, upload
settings, and final publication.

## 3. Platform, privacy, and support boundaries

### 3.1 Release platform

- Windows 11 is the only v1 release-acceptance platform.
- Development on other platforms MAY be supported, but results there MUST NOT be
  used to declare v1 complete.
- The installer MUST be a signed or explicitly developer-identified Windows
  installer that installs the Electron application, the local core, the Python
  analysis environment or packaged worker, and licensed FFmpeg/ffprobe binaries.
- Installation and first launch MUST NOT require administrator privileges unless
  a documented Windows policy makes that unavoidable.

### 3.2 Input and output

- MP4 containing H.264 video and AAC audio is the guaranteed input.
- Other media that the bundled FFmpeg build can read SHOULD be accepted on a
  best-effort basis. Unsupported or malformed media MUST fail per file without
  aborting the rest of a batch.
- Candidate duration MUST be 20–90 seconds, measured from source-range start to
  end after sentence-boundary adjustment.
- A final render MUST NOT exceed 180 seconds.
- The guaranteed output MUST be MP4 with 1080×1920 pixels, H.264 video, AAC
  audio, a playable video stream, and a playable audio stream.
- The original speaker audio MUST remain in every render. A content-package
  rewrite is a planning artifact and MUST NOT replace, synthesize, or silently
  alter the spoken audio.

### 3.3 Offline-first and privacy guarantees

- In local mode, all persistent data, source reads, transcription, analysis,
  editing, and rendering MUST remain on the workstation.
- Merely importing, opening, indexing, editing, rendering, scheduling, or
  launching the application MUST NOT make a cloud request.
- Sources MUST be referenced in place and MUST NOT be modified. Generated files
  MUST live in the application artifact store.
- The application MUST display whether an operation is local, network, or cloud
  before it begins.
- Local transcription MUST support faster-whisper. Local language-model analysis
  MUST support Ollama.
- An Ollama endpoint on an IP loopback address is a local operation. An endpoint
  on an RFC1918 or otherwise private-LAN address is a network operation: the UI
  MUST disclose the endpoint class, data sent, and network use before starting,
  but project cloud authorization is not required. A public or non-private
  endpoint is a cloud operation and MUST have persisted authorization for the
  project or explicitly selected batch before any data is transmitted.
- Provider redirects MUST be resolved and reclassified before transmitting
  operation data. A redirect MUST NOT weaken the authorization required by the
  originally selected endpoint; the effective requirement is the stricter of
  the original and redirect-target classifications.
- OpenAI MUST be an explicit opt-in provider. There MUST be no silent fallback
  from a local provider to OpenAI or from one cloud model to another.
- Model IDs MUST be configurable. The specification MUST NOT freeze a provider's
  marketing term such as “latest” into durable product behavior.
- Credentials MUST be stored with Windows-protected credential storage or an
  equivalently reviewed adapter. They MUST NOT be written to logs, SQLite,
  project exports, MCP results, command arguments visible to other users, or
  plaintext configuration files.
- Logs and structured errors MUST redact credentials and SHOULD avoid transcript
  text and absolute paths unless the user enables diagnostic detail.

## 4. Architecture and ownership

### 4.1 Required process model

The application MUST use these boundaries:

1. **Electron/React desktop shell** owns windows, native file dialogs, navigation,
   accessibility, user confirmation, and user-only security gates.
2. **Local core service** owns all domain rules and exposes a versioned localhost
   HTTP API. It MUST bind only to loopback by default.
3. **SQLite database** is owned exclusively by the core service. UI, MCP, Python,
   and FFmpeg processes MUST NOT write SQLite directly.
4. **Python analysis worker** performs local transcription, diarization where
   available, vision sampling, and provider adapters through versioned job
   messages. It MUST return typed artifacts to the core.
5. **FFmpeg boundary** performs probing, proxy/media extraction, waveform and
   thumbnail generation, and composition rendering. FFmpeg MUST NOT define domain
   lifecycle or overwrite sources.
6. **MCP adapter** translates typed tools to the same localhost API used by the
   UI. It MUST NOT contain an alternate business-logic implementation.

### 4.2 Local persistence

The application data directory MUST contain, at minimum:

```text
ShortEditor/
  short-editor.db
  artifacts/
    episodes/<episode-uuid>/
    shorts/<short-uuid>/revisions/<revision>/
    renders/<render-uuid>/
  logs/
```

- SQLite migrations MUST be ordered, transactional, and recorded.
- SQLite MUST enforce foreign keys. A write-ahead log and a finite busy timeout
  SHOULD be used.
- Artifact paths persisted in SQLite SHOULD be relative to the application data
  directory when the artifact is application-owned.
- Source paths MAY be absolute because sources remain in place.
- Artifact creation MUST use a temporary name followed by an atomic rename after
  validation. Partial artifacts MUST NOT be presented as complete.
- Every application-owned artifact MUST record its kind, owning entity, revision
  if applicable, path, content hash, byte length, created timestamp, producer
  version, and lifecycle state.
- Startup MUST reconcile interrupted jobs and temporary artifacts. Work that is
  safe to retry MUST return to `queued`; otherwise it MUST fail with a structured,
  actionable error.

### 4.3 Windows packaging

- The packaged Electron main process MUST start and stop the local core with the
  application.
- The installer MUST include architecture-compatible native SQLite bindings and
  the required FFmpeg/ffprobe distribution.
- The Python worker and its models MAY be bundled or installed through a
  resumable first-run flow. The UI MUST state disk, network, license, and privacy
  implications before downloading models.
- The packaging gate MUST exercise installation, launch, import, local analysis,
  edit, render, restart recovery, and uninstall on a clean supported Windows 11
  machine.
- Uninstall MUST NOT delete source media. Removal of the application data
  directory MUST require a separate explicit user choice.

## 5. Domain model and invariants

All primary records MUST use stable UUIDs generated once and never derived from a
mutable path or title. Timestamps MUST be ISO 8601 instants in UTC; a separate
IANA timezone MUST be retained where wall-clock meaning matters.

### 5.1 Core entities

The required persistent entities are:

- `Episode`: UUID, current source path, canonical path, quick fingerprint,
  optional full content hash, file metadata, probe metadata, lifecycle status,
  missing flag, and timestamps.
- `WatchedFolder`: UUID, canonical path, enabled flag, recursive flag, include
  patterns, last scan status, and timestamps.
- `TranscriptRevision`: UUID, Episode ID, revision, language, timed segments,
  word timing when available, speaker labels when available, provider provenance,
  and accepted status.
- `AnalysisArtifact`: UUID, entity ID, kind, provider, model ID, provider/options
  version, input hash, raw structured output, accepted projection, and timestamp.
- `Candidate`: UUID, Episode ID, source range, transcript, topic, hook, rationale,
  component scores, duplicate group, review status, generation provenance, and
  timestamp.
- `ShortProject`: UUID, Episode ID, optional Candidate ID, title, ordered source
  ranges, template lineage, composition, caption state, audio state, content
  package, approval, revision, and timestamps.
- `Template`: stable ID, name, version, parent/clone lineage, immutable built-in
  flag, and composition.
- `Asset`: UUID, source path or owned artifact path, kind, rights/provenance note,
  reusable flag, tags, media metadata, and timestamps.
- `Render`: UUID, Short ID, Short revision, encoder settings, output path,
  validation result, state, error, hashes, and timestamps.
- `ScheduleRuleSet`: UUID or singleton stable ID, revision, start date, IANA
  timezone, weekdays, wall-clock times, daily limit, blackout dates, minimum
  same-Episode spacing, and timestamps.
- `ScheduleEntry`: UUID, Short ID, Render ID, Episode ID, publish instant,
  timezone, status, priority, rationale, lock, optional YouTube URL,
  rerender-needed flag, revision, and timestamps.
- `Job`: UUID, typed job kind, entity ID, provider, state, progress, stage,
  attempts, cancellation request, structured error, payload reference, and
  timestamps.

### 5.2 Lifecycles

Episode status MUST follow:

```text
discovered -> indexing -> analyzing -> ready
     |            |           |
     +------------+-----------+-> error
     +----------------------------> source_missing
source_missing --successful relink--> indexing or prior safe state
```

Job state MUST follow:

```text
queued -> running -> succeeded
   |         |-----> failed
   |         +-----> cancelled
   +---------------> cancelled
```

Candidate review status MUST be `pending`, `approved`, or `rejected`. A Short
MUST be created only from an approved Candidate, except for a future explicitly
specified manual-create operation.

Render state MUST distinguish at least `queued`, `running`, `succeeded`,
`failed`, `cancelled`, and `stale`. `succeeded` MUST mean composition finished
and validation passed.

Schedule-entry status MUST distinguish at least `draft`, `planned`, and
`published`. Published entries MUST be locked. A published record MUST NOT imply
that Short Editor performed the upload.

### 5.3 Revisions and invalidation

- Every mutable Short, template clone, schedule rule set, and schedule entry MUST
  have a positive integer revision.
- Every mutation MUST include `expectedRevision`. A stale write MUST fail with
  `REVISION_CONFLICT` and include expected and actual revisions.
- A successful mutation MUST increment the revision exactly once.
- A Render MUST bind to one Short revision and MUST never be silently rebound.
- Any change to source ranges, composition, crop keyframes, captions, audio, or
  accepted transcript that affects output MUST mark older Renders `stale` and
  set `needsRerender` on dependent non-published schedule entries.
- Copy-only changes that cannot affect pixels or audio MAY avoid render
  invalidation only when the affected fields are enumerated and tested.
- Relinking to content with a different verified hash MUST be rejected as
  `SOURCE_IDENTITY_MISMATCH`. If no prior full hash exists, relinking MUST require
  explicit user confirmation after quick-fingerprint and probe comparison.
- Re-analysis MUST preserve reviewed Candidates and accepted edits. New pending
  provider results MUST NOT overwrite accepted data.

### 5.4 Error contract

Structured errors MUST use:

```json
{
  "apiVersion": "v1",
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "Short was edited by another client",
    "details": {},
    "retryable": false
  }
}
```

The v1 registry MUST include:

- `NOT_FOUND`
- `VALIDATION_ERROR`
- `REVISION_CONFLICT`
- `SOURCE_MISSING`
- `SOURCE_IDENTITY_MISMATCH`
- `DEPENDENCY_UNAVAILABLE`
- `PROVIDER_UNAVAILABLE`
- `PROVIDER_OUTPUT_INVALID`
- `CLOUD_NOT_AUTHORIZED`
- `CLOUD_CONFIRMATION_REQUIRED`
- `INVALID_STATE`
- `SCHEDULE_COLLISION`
- `JOB_CANCELLED`
- `ARTIFACT_CORRUPT`
- `INTERNAL_ERROR`

Unknown internal exceptions MUST become `INTERNAL_ERROR` without returning
credentials, provider secrets, stack traces, or unredacted sensitive payloads.

## 6. Functional requirements

### 6.1 Inventory, watched folders, and relinking

- The user MUST be able to import multiple files and configure multiple watched
  folders.
- Watched folders MUST support enable/disable, recursive scanning, and manual
  rescan. Initial v1 discovery MAY use polling or filesystem events, but missed
  events MUST be repaired by reconciliation scans.
- A batch MUST return imported, duplicate, and rejected results per input.
- Import MUST preserve each source byte-for-byte.
- Exact canonical paths MUST deduplicate. A quick fingerprint SHOULD identify
  likely duplicates; a full SHA-256 content hash MUST resolve ambiguous identity
  before duplicate records are merged.
- Distinct files that merely share size and modification time MUST NOT be
  permanently collapsed without content verification.
- Missing sources MUST remain visible with `source_missing` state. The user MUST
  be able to relink them through the UI or typed MCP operation.
- Relinking MUST validate identity, update the stored path atomically, and resume
  only work whose inputs remain valid.
- Probe results MUST include duration, dimensions, video codec, and audio codec.

### 6.2 Transcription and analysis

- The Python worker MUST implement local faster-whisper transcription in English.
- Timed transcript segments are REQUIRED. Word timestamps SHOULD be produced
  where the selected provider supports them.
- Speaker labels SHOULD be produced where the selected local or cloud provider
  supports diarization, and absence of diarization MUST be represented
  explicitly rather than guessed.
- The user MUST be able to edit transcript segment text, word timing, speaker
  labels, and accepted caption timing with revision checks.
- Analysis SHOULD sample visual activity and speaker framing in addition to text.
- Local LLM analysis MUST support a configurable Ollama base URL and model ID.
- OpenAI transcription and analysis MUST use configurable model IDs and typed
  structured outputs. Provider results MUST be schema-validated before storage.
- Analysis cache identity MUST include source hash, relevant transcript revision,
  provider, model ID, prompt/schema version, and normalized options. Matching
  successful artifacts SHOULD be reused; changed inputs MUST miss the cache.
- Provider provenance MUST be retained for raw and accepted results, including
  local/cloud classification and creation time.

Official OpenAI documentation is a capability reference, not a pinned-model
requirement:

- [Speech-to-text and timestamped transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
  (verified 2026-07-26).
- [Speaker-diarized transcription model capability](https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize)
  (verified 2026-07-26).
- [Schema-constrained structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
  (verified 2026-07-26).

### 6.3 Candidate selection

- Candidate generation MUST return between 5 and 10 Candidates when the Episode
  contains enough eligible, distinct material.
- Each Candidate MUST be 20–90 seconds, align to transcript sentence or segment
  boundaries, and represent an independently understandable idea.
- Candidate scoring MUST retain explainable component scores for hook,
  coherence, payoff, independence, delivery, and visual activity.
- Results MUST be ranked deterministically for identical accepted inputs and
  generation version, except that UUIDs and timestamps MAY differ.
- Substantially overlapping or semantically duplicate proposals MUST be grouped
  or suppressed.
- If fewer than five valid distinct Candidates exist, the application MUST return
  the available set and an explicit diagnostic; it MUST NOT pad the set with
  low-quality duplicates.
- Candidate review MUST be non-destructive. Regeneration MUST preserve approved
  and rejected decisions and replace or append only pending proposals according
  to an explicit strategy.

### 6.4 Short project and content package

- Creating a Short MUST copy the selected Candidate range and accepted transcript
  into a new revision-1 project without changing the Episode or Candidate.
- Source ranges MUST be ordered, non-overlapping within a single source, positive,
  and within Episode duration.
- v1 MAY support multiple ranges from the same Episode for tightening pauses, but
  MUST NOT become a general multitrack timeline.
- The UI MUST allow range boundary and supported gap adjustments with frame- or
  millisecond-precise persisted values.
- Content packages MUST contain cleaned transcript, planning rewrite, hook
  variants, title variants, description, hashtags, and thumbnail text.
- Generated copy MUST remain proposed provider output until accepted. User edits
  MUST take precedence and MUST survive regeneration.
- Rewrites MUST be labeled as planning/copy aids and MUST NOT imply generated
  voiceover.
- Short approval MUST be a revisioned explicit action. Any subsequent
  render-affecting edit MUST clear approval or require reapproval before render.

### 6.5 Templates, composition, and assets

- The composition coordinate system MUST be normalized while the output canvas
  remains exactly 1080×1920.
- v1 MUST ship versioned starter templates for:
  - subject media above a speaker;
  - a full-screen tracked speaker; and
  - screen content above a speaker.
- Built-in templates MUST be immutable. Users MUST be able to clone a template
  and update the clone with optimistic revision control.
- Existing Shorts MUST retain their materialized composition and template
  lineage when a template clone changes.
- Composition layers MUST support Episode video, imported image/video assets,
  captions, shapes, and logos as appropriate to the template.
- Asset import MUST require a provenance/rights note and reusable choice. The
  application MUST NOT infer that imported media is licensed.
- Automated web-media discovery or download is outside v1.
- Safe areas MUST be visible in the editor and enforced or warned during
  preflight.

### 6.6 Reframing and editor

- Automatic reframing SHOULD use face/person/screen detections to produce smooth,
  bounded crop keyframes.
- Each video layer MUST support independent crop tracks.
- Crop rectangles MUST remain inside source bounds and MUST not expose invalid
  dimensions.
- Users MUST be able to add, move, and remove manual crop keyframes and override
  automatic framing for any interval.
- Manual keyframes MUST take precedence over automatic keyframes and MUST survive
  automatic re-analysis.
- The interactive editor MUST provide synchronized preview, play/pause, seek,
  timeline/range adjustment, crop manipulation, layer visibility/selection,
  caption editing, audio controls, undo/redo for the current editing session, and
  explicit save/revision feedback.
- Preview may use proxies, but the final render MUST use the original source and
  persisted decisions.

### 6.7 Captions

- Captions MUST derive initially from the accepted transcript and remain
  independently editable.
- Caption data MUST retain text plus start/end timing and SHOULD retain
  word-level timing for highlighting when available.
- The editor MUST support line breaking, position, font family from an approved
  packaged set, size, color, outline/background treatment, and per-word highlight
  style.
- Caption layout MUST respect safe areas and MUST warn about overflow, missing
  glyphs, unreadably short cues, overlaps, and cues outside source ranges.
- Burned-in captions are REQUIRED in the rendered MP4.
- The render pipeline SHOULD also emit a UTF-8 SRT or WebVTT sidecar for user
  convenience, but the sidecar does not replace burned-in captions.

### 6.8 Audio

- Original speaker audio MUST be included and synchronized across all source
  ranges.
- v1 MUST support source gain, mute, short fades at cuts, and an optional imported
  music/bed asset with independent gain.
- Background audio MUST NOT obscure speech. Preflight SHOULD warn when configured
  levels exceed the product's reviewed speech-to-background threshold.
- Loudness normalization MAY be offered, but it MUST be deterministic and MUST
  not change the accepted edit without a visible setting.
- Generated voiceover and automatic cloud speech synthesis are outside v1.

### 6.9 Rendering and validation

- Render preflight MUST run without creating a final output and return typed
  errors and warnings for source availability, revisions, approval, range bounds,
  assets, captions, crop bounds, duration, dependencies, and output settings.
- Rendering MUST use an explicit FFmpeg filter graph derived from the immutable
  Short revision snapshot.
- The job MUST support cancellation at safe boundaries and retry from the same
  persisted revision.
- A retry MUST create a new job attempt and MUST NOT overwrite a prior successful
  Render.
- The output MUST be deterministic in edit decisions and frame/audio content for
  identical inputs, settings, and FFmpeg build. Container metadata that is
  inherently variable MUST be normalized or excluded from determinism checks.
- A Render MUST become `succeeded` only after ffprobe confirms 1080×1920, H.264,
  AAC, audio and video streams, nonzero valid duration, and duration at most 180
  seconds.
- The renderer MUST preserve aspect ratio according to the chosen fit/fill rule
  and MUST not stretch source imagery.
- The UI and API MUST expose progress, stage, output path, validation results,
  encoder provenance, and actionable failure details.

### 6.10 Calendar and manual publication

- Schedule rules MUST support start date, IANA timezone, allowed weekdays,
  multiple wall-clock times, maximum posts per day, blackout dates, and minimum
  same-Episode spacing.
- Draft assignment MUST sort by explicit priority with a stable ID tie-breaker
  and choose the earliest legal unoccupied slot.
- Daylight-saving transitions MUST preserve configured local wall-clock intent.
  Nonexistent or ambiguous local times MUST use a documented, tested policy and
  MUST produce a warning.
- Only approved Shorts with a current, successful, validated Render may enter the
  schedule.
- Moving a schedule entry MUST reject occupied instants and stale revisions.
- The calendar UI MUST allow list and calendar inspection, draft generation,
  movement of unlocked entries, rule editing, and marking an entry published.
- Marking published MUST be a manual recordkeeping action with an optional valid
  YouTube URL. It MUST lock the entry.
- Short Editor MUST NOT upload, authenticate to YouTube, or claim to confirm
  remote publication in v1.

As of 2026-07-26, YouTube states that eligible square or vertical uploads up to
three minutes may be categorized as Shorts. It also states that a Short longer
than one minute with an active Content ID claim can be blocked globally.
Preflight MUST show the latter warning for renders over 60 seconds and MUST link
to [YouTube Help: Understand three-minute YouTube Shorts](https://support.google.com/youtube/answer/15424877?hl=en).
This externally controlled rule MUST be reverified before release.

### 6.11 Accessibility and recovery

- All primary workflows MUST be keyboard operable with visible focus.
- Controls MUST have accessible names, and status/progress updates MUST be
  announced without stealing focus.
- Color MUST NOT be the only status indicator. Text and meaningful controls MUST
  meet WCAG 2.2 AA contrast.
- The UI MUST respect Windows text scaling and SHOULD respect reduced motion.
- Timeline and crop operations MUST have keyboard-accessible numeric alternatives.
- A crash or power loss MUST not corrupt accepted state. On restart, the
  application MUST reconcile jobs, expose interrupted work, and allow safe retry.
- Missing dependencies, models, sources, or artifacts MUST produce a recovery
  action rather than an infinite queued state.

## 7. Public interfaces and agent parity

### 7.1 HTTP API

- The core MUST expose `/v1` on `127.0.0.1` by default.
- Successful responses MUST be `{ "apiVersion": "v1", "data": ... }`.
- Error responses MUST use the envelope in section 5.4 and MUST also include
  `apiVersion`.
- IDs in public contracts MUST be UUIDs except for documented stable template or
  provider IDs.
- Long-running operations MUST immediately return a durable Job handle containing
  at least `id`, `type`, `state`, `progress`, and `stage`.
- Mutations of revisioned entities MUST require `expectedRevision`.
- API payloads and responses MUST NOT contain plaintext credentials.
- Unknown fields SHOULD be rejected on security-sensitive or mutation requests.
- Pagination MUST be added before any unbounded collection can exceed 1,000
  records; cursor behavior then becomes part of v1 compatibility.

### 7.2 MCP contract

MCP MUST use the HTTP API and return the same stable IDs, domain values,
`apiVersion`, job handles, and structured error fields. Human-readable text MAY
wrap the JSON, but machine-readable data MUST not be discarded. MCP MUST never
return credentials.

Every primary UI state transition MUST have a typed MCP equivalent unless this
spec explicitly labels the transition a user-only security gate. Tool schemas
MUST use concrete fields rather than arbitrary records where a domain schema is
known.

The following existing v1 tools MUST remain available:

```text
library.list_episodes       library.get_episode
library.import_paths
analysis.start
jobs.list                   jobs.cancel
candidates.list             candidates.generate
candidates.review
shorts.create               shorts.get
shorts.update_composition   shorts.update_copy
renders.start               renders.validate
renders.list
schedule.get                schedule.draft
schedule.move               schedule.mark_published
templates.list
assets.list                 assets.import
```

Complete v1 parity additionally requires these non-destructive tools:

```text
library.list_watched_folders
library.configure_watched_folder
library.relink_source

analysis.get_transcript
analysis.update_transcript
providers.list_capabilities
providers.get_status

shorts.update_timeline
shorts.update_captions
shorts.update_audio
shorts.approve

schedule.get_rules
schedule.update_rules

templates.clone
templates.update

renders.preflight
renders.retry
```

Names MAY gain aliases before v1 release, but the behavior above MUST remain
discoverable and typed. Destructive deletion tools MUST NOT be added in v1.
The explicit v1 inventory contains exactly 40 tools. `shorts.update_audio` MUST
be non-destructive, require `expectedRevision`, and use concrete fields for
source gain, source mute, cut-fade duration, optional bed-asset ID, and bed gain.

### 7.3 Cloud security gate

- Creating, editing, or selecting credentials and granting project cloud
  authorization are user-only security gates and MUST occur in the desktop UI.
- The UI MUST show provider, operation classes, data to be sent, network use, and
  cost implications before authorization.
- Authorization MUST be scoped to a project or an explicitly selected batch and
  MUST be revocable.
- MCP MAY request cloud work only for a project or batch with a current matching
  authorization. MCP MUST NOT create credentials, grant authorization, expand
  its scope, or bypass cost/network confirmation.
- A boolean supplied by an MCP caller is not proof of authorization. The core
  MUST verify persisted authorization state.
- If authorization is absent or insufficient, the operation MUST fail before any
  cloud request with `CLOUD_NOT_AUTHORIZED` or
  `CLOUD_CONFIRMATION_REQUIRED`.

## 8. Current implementation and evidence

Status meanings:

- **Implemented**: the named foundation exists and is covered by relevant
  repository evidence; this does not imply the entire normative feature is done.
- **Partial**: meaningful behavior exists, but one or more required paths or
  release tests are absent.
- **Pending**: only a stub/interface exists, or no complete behavior was found.

Queued job types without installed handlers are not complete functionality.

| Capability | Status | Evidence and gap |
| --- | --- | --- |
| SQLite schema, foreign keys, migrations | Implemented | [`src/core/database.ts`](src/core/database.ts), [`src/core/repository.ts`](src/core/repository.ts), [`tests/migrations.test.ts`](tests/migrations.test.ts), and [`tests/persistence.test.ts`](tests/persistence.test.ts) define and verify ordered transactional migrations, WAL/busy timeout, foreign keys, legacy upgrades, complete entity fields, artifact metadata, template clones, provider provenance, scoped authorization metadata, CAS guards, and rollback after interruption. Windows-native packaged SQLite remains a WIN-03 release gate. |
| Platform-aware application data path | Implemented | [`src/core/bootstrap.ts`](src/core/bootstrap.ts), [`src/core/startup.ts`](src/core/startup.ts), [`tests/bootstrap.test.ts`](tests/bootstrap.test.ts), and [`tests/startup.test.ts`](tests/startup.test.ts) resolve native paths, create the database/artifacts/logs layout, apply the deterministic four-case native/legacy decision, checkpoint and verify staged migrations, preserve timestamped backups, quarantine failed staging, and refuse both-populated startup without writes. Packaged Windows 11 validation remains a WIN-02/WIN-03 gate. |
| Owned artifact store | Implemented | [`src/core/artifact-path.ts`](src/core/artifact-path.ts), [`src/core/artifact-store.ts`](src/core/artifact-store.ts), [`src/core/repository.ts`](src/core/repository.ts), and [`tests/artifact-store.test.ts`](tests/artifact-store.test.ts) enforce contained normalized paths, typed ownership metadata, exclusive temporary writes, validation, fsync, atomic rename, SHA-256 and byte counts, collision rejection, corrupt/missing detection, and quarantine of temporary, corrupt, and post-rename orphan files. Provider, proxy, caption, and renderer producers adopt this boundary in their respective tasks. |
| Stable schemas and UUID validation | Implemented | [`src/shared/contracts.ts`](src/shared/contracts.ts), [`src/shared/validators.ts`](src/shared/validators.ts), [`src/shared/error-contracts.ts`](src/shared/error-contracts.ts), [`src/shared/job-messages.ts`](src/shared/job-messages.ts), and [`src/shared/episode-transitions.ts`](src/shared/episode-transitions.ts) define the complete v1 entity, lifecycle, provider-classification, job-message, and 15-code error inventories. [`src/core/repository.ts`](src/core/repository.ts) now round-trips the complete contracts; later tasks adopt them in complete workflows and interfaces. |
| Source-in-place media inventory | Partial | [`src/core/media.ts`](src/core/media.ts) and [`tests/media.test.ts`](tests/media.test.ts) validate FFprobe-readable video before persistence, preserve source files, return independent per-input groups, persist probe metadata, and confirm identity by canonical path or SHA-256 after content-sampled quick fingerprinting. Watched-folder configuration has repository persistence; watched-folder scanning, missing-source reconciliation, and relinking remain pending. |
| Probe and full hashing foundations | Partial | Probe/hash implementations exist in [`src/core/media.ts`](src/core/media.ts) and are installed in [`src/core/bootstrap.ts`](src/core/bootstrap.ts). Hash results are stored, but ambiguous import identity is not resolved with full hashes, cross-file content deduplication is absent, and probe/hash fixtures are incomplete. |
| Durable jobs and restart recovery | Partial | [`src/core/jobs.ts`](src/core/jobs.ts), [`src/core/repository.ts`](src/core/repository.ts), [`src/core/artifact-store.ts`](src/core/artifact-store.ts), and their tests implement queueing, cancellation flags, claiming, progress, failure, startup artifact cleanup, cancellation recovery, retry of idempotent probe/hash/local-analysis/candidate work, and actionable terminal failure for unsafe interrupted cloud-analysis or render work. Subprocess cancellation and bounded per-workflow retry remain pending. |
| Local/cloud request boundary | Pending | [`src/core/repository.ts`](src/core/repository.ts) persists scoped, revocable project/batch authorization metadata without credential secrets, but [`src/core/jobs.ts`](src/core/jobs.ts) still trusts a caller-supplied boolean and [`src/mcp/server.ts`](src/mcp/server.ts) exposes it directly. Desktop credential management and non-bypassable core authorization enforcement remain PRO-04 work. |
| Transcription and vision workers | Pending | `analyze` is a job type, but [`src/core/bootstrap.ts`](src/core/bootstrap.ts) installs no analysis handler. No faster-whisper, Ollama, OpenAI, diarization, or vision worker is present. |
| Transcript persistence and replacement | Partial | [`src/core/database.ts`](src/core/database.ts), [`src/core/repository.ts`](src/core/repository.ts), and [`tests/persistence.test.ts`](tests/persistence.test.ts) persist revision history, language, provider provenance, accepted state, timed segments, and CAS conflicts, including legacy transcript migration and a 1,001-segment fixture. Typed retrieval/update HTTP and MCP, transcript-driven render invalidation, and interactive editing remain pending. |
| Candidate generation and review | Partial | [`src/core/candidates.ts`](src/core/candidates.ts), [`src/core/repository.ts`](src/core/repository.ts), [`tests/candidates.test.ts`](tests/candidates.test.ts), and [`tests/persistence.test.ts`](tests/persistence.test.ts) implement bounded segment-window scoring, ranking, overlap filtering, 5–10 targeting, transactional replacement of pending rows while retaining reviewed rows, and complete generation provenance persistence. Explicit insufficient-material diagnostics and representative quality fixtures remain pending; regeneration also does not account for overlap with retained reviewed Candidates. |
| Revisioned Short projects and invalidation | Partial | [`src/core/repository.ts`](src/core/repository.ts), [`tests/repository.test.ts`](tests/repository.test.ts), and [`tests/persistence.test.ts`](tests/persistence.test.ts) persist source ranges, lineage, composition, captions, audio, and copy; enforce expected revisions; clear approval on render-affecting edits; stale prior renders; and invalidate only non-published schedule entries. Complete timeline/editor endpoints, transcript-driven invalidation, and selective copy-only invalidation remain pending. |
| Starter templates and composition schema | Partial | Three immutable versioned starter layouts are seeded from [`src/shared/templates.ts`](src/shared/templates.ts); [`src/core/repository.ts`](src/core/repository.ts) persists clone lineage and applies CAS updates while rejecting built-in mutation. Clone/update APIs and complete editor behavior remain pending. |
| Asset inventory foundation | Partial | [`src/core/service.ts`](src/core/service.ts) and [`src/core/repository.ts`](src/core/repository.ts) persist source or owned-artifact paths, provenance, reusable flags, tags, and media metadata. Metadata probing, rights UX, and editor integration are pending. |
| Crop tracking and overrides | Pending | Crop-keyframe schemas exist in [`src/shared/domain.ts`](src/shared/domain.ts), but detection, smoothing, tracking, and an interactive override workflow do not. |
| Captions and audio editing | Pending | Caption layers exist in templates and complete caption/audio state now round-trips with Short revisions, but editor controls, sidecars, rendering composition, and dedicated update interfaces are absent. |
| Render validation contract | Partial | [`src/core/render.ts`](src/core/render.ts) probes an existing output and checks dimensions, codecs, audio/video presence, and the 180-second ceiling; [`src/core/repository.ts`](src/core/repository.ts) can persist validation, encoder provenance, hashes, errors, and attempt numbers. The render workflow does not reject zero duration, transition a Render only after validation, or provide preflight/retry; deterministic media fixtures are also absent. |
| FFmpeg composition renderer | Pending | `render` can be queued, but [`src/core/bootstrap.ts`](src/core/bootstrap.ts) installs no render handler and no composition filter graph exists. |
| Deterministic scheduling | Partial | [`src/core/scheduler.ts`](src/core/scheduler.ts), [`src/core/repository.ts`](src/core/repository.ts), [`tests/scheduler.test.ts`](tests/scheduler.test.ts), and [`tests/persistence.test.ts`](tests/persistence.test.ts) cover priority, stable tie-breaking, blackouts, occupied slots, Episode spacing, ordinary offset changes across DST, and CAS-persisted versioned rule sets/entries. Rule-set APIs, explicit ambiguous/nonexistent-time policy and warnings, move-time rule validation, publication URL edge cases, Content ID warnings, and UI are pending. |
| Versioned localhost HTTP API | Partial | [`src/core/api.ts`](src/core/api.ts) exposes a loopback-oriented `/v1` service with success envelopes and validation. Errors lack the required v1 envelope/retryable field, and complete workflow endpoints are pending. |
| Typed MCP adapter | Partial | [`src/mcp/server.ts`](src/mcp/server.ts) exposes the original tools over the core API. Several inputs are arbitrary records, structured errors are flattened, `apiVersion` is discarded, and the parity additions in section 7.2 are pending. |
| Electron/React shell and library UI | Partial | [`src/electron/main.ts`](src/electron/main.ts), [`src/electron/preload.ts`](src/electron/preload.ts), and [`src/ui/App.tsx`](src/ui/App.tsx) provide a desktop shell, native MP4 import, searchable inventory, metrics, job polling, and local-analysis queue action. Candidate, editor, and calendar views are placeholders. |
| Accessibility | Partial | The library uses semantic tables, labels, live status, keyboard-native controls, and non-color text states in [`src/ui/App.tsx`](src/ui/App.tsx). No formal WCAG/keyboard/text-scaling audit covers the full workflow. |
| Windows installer | Partial | [`package.json`](package.json) defines an NSIS target and packaged-resource boundary. No evidence establishes bundled working FFmpeg/Python resources or a clean Windows 11 end-to-end packaging test. |

## 9. Release gates

v1 is complete only when every MUST in this document is implemented and all gates
below pass on Windows 11 against a representative beta corpus. A gate MAY contain
multiple automated and manual tests. A passing unit test on another platform is
supporting evidence, not release acceptance.

### G1. Import and inventory

- Import a mixed batch containing guaranteed MP4, best-effort readable media,
  malformed media, duplicate paths, a true content duplicate, Unicode paths,
  long Windows paths, read-only sources, zero-byte files, video without audio,
  and audio without video.
- Verify per-file results, no source mutation, no false permanent deduplication,
  correct probing, watched-folder discovery/reconciliation, missing-source state,
  successful valid relink, and rejected wrong-content relink.

### G2. Provider and privacy fixtures

- Run deterministic fixtures for faster-whisper and Ollama plus mocked success,
  timeout, rate-limit, malformed-output, and partial-output OpenAI responses.
- Exercise loopback, private-LAN, and public/non-private Ollama endpoints plus
  redirects across those classes; verify pre-operation labels/disclosure,
  persisted authorization for cloud-class endpoints, reclassification before
  data transmission, and the rule that redirects cannot weaken authorization.
- Verify provider/model/schema provenance and cache keys.
- Verify local mode generates no network traffic.
- Verify OpenAI cannot run without persisted project authorization and that MCP
  cannot create or bypass authorization.
- Verify credentials and transcript payloads do not leak to logs, SQLite fields
  not designated for artifacts, errors, MCP output, or process arguments.

### G3. Transcripts and Candidates

- Validate segment, word timing, optional speaker labels, revision conflict,
  manual corrections, cache invalidation, and decision preservation.
- On a representative labeled corpus, verify 5–10 Candidates where sufficient
  material exists, 20–90 second limits, sentence alignment, distinctness,
  rankings, rationales, and the explicit insufficient-material path.
- Record and meet an owner-approved beta quality threshold before release.

### G4. Templates, assets, and reframing

- Exercise every starter template across landscape, portrait, square, screen
  share, single-speaker, multi-speaker, and intermittent-face material.
- Verify clone/update lineage, immutable built-ins, independent crops, bounded
  interpolation, smooth auto-tracking, manual keyframe precedence, persistence,
  and survival across re-analysis.
- Verify missing/unsupported assets fail preflight without damaging the project.

### G5. Timeline, captions, and audio

- Exercise cut/range boundaries, sync, undo/redo, revision conflicts, source
  duration bounds, and reapproval/invalidation.
- Test long words, punctuation, rapid cues, overlaps, line wrapping, Unicode
  glyph failures, safe areas, caption style persistence, burned-in output, and
  sidecar encoding.
- Verify original speaker audio remains audible and synchronized, cuts have the
  configured fades, optional bed mixing is deterministic, and no rewrite becomes
  voiceover.
- Exercise HTTP, MCP, and UI audio mutations for value parity, strict schema
  rejection, revision conflicts, stale Render invalidation, `needsRerender` only
  on dependent non-published schedule entries, and published-entry immutability.

### G6. Rendering

- Verify preflight errors and warnings are typed and actionable.
- Render every template from original source with deterministic fixtures; compare
  normalized frame/audio hashes across repeated runs using the release FFmpeg
  build.
- Validate 1080×1920 H.264/AAC output, audio/video presence, duration, aspect
  behavior, crop bounds, captions, cancellation, retry, crash recovery, disk-full
  behavior, stale revisions, and non-overwrite of prior success.
- Verify a 180-second render can pass and any longer render cannot.

### G7. Scheduling and platform rules

- Verify stable priority order, daily caps, weekdays, blackouts, occupied slots,
  Episode spacing, moves, locks, stale revisions, rerender invalidation, and
  manual published URL recording.
- Test spring-forward nonexistent times, fall-back ambiguous times, and timezone
  rule changes with documented warning behavior.
- Verify renders over 60 seconds display the current Content ID warning and
  release owners have rechecked the linked YouTube rule.

### G8. HTTP and MCP contracts

- Contract-test every HTTP operation and every tool in section 7.2 for success,
  schema rejection, not-found, invalid state, revision conflict, cancellation,
  and provider failure.
- Verify MCP discovery contains exactly the 40 unique tools in section 7.2.
- Verify success/error envelopes include `apiVersion`, IDs remain stable, jobs
  are durable, errors remain structured, and credentials never appear.
- Run a UI-to-MCP parity inventory and prove every primary persisted UI
  transition has a typed MCP equivalent or is the documented user-only cloud
  security gate.
- Verify `shorts.update_audio` matches the HTTP operation for values, errors,
  revision conflicts, Render invalidation, non-published schedule rerender flags,
  and published-entry immutability.
- Verify no destructive deletion operation is discoverable.

### G9. Accessibility and recovery

- Complete the entire workflow using keyboard only and at 200% Windows text
  scaling.
- Test screen-reader names/status announcements, focus restoration, contrast,
  reduced motion, and numeric alternatives for spatial controls.
- Force-close the UI, core, Python worker, and FFmpeg at each job stage; restart
  and verify database integrity, correct reconciliation, no false success, and a
  safe retry or actionable terminal error.

### G10. Windows packaging

- On a clean, supported Windows 11 VM, install without development tools, launch,
  complete an offline local workflow, complete an explicitly authorized cloud
  fixture, render, restart, upgrade from the prior beta, and uninstall.
- Verify packaged native modules, FFmpeg/ffprobe, Python worker/model setup,
  loopback binding, application-data permissions, installer identity, shortcuts,
  crash logs, and absence of source deletion.

## 10. Changelog

### 1.1.0 — 2026-07-27

- Added typed, non-destructive `shorts.update_audio` parity and increased the
  explicit MCP inventory from 39 to 40 tools.
- Classified loopback Ollama endpoints as local, private-LAN endpoints as
  disclosed network operations, and public/non-private endpoints as authorized
  cloud operations; redirects are reclassified before transmission and cannot
  weaken the original authorization requirement.
- Retained the existing accepted-transcript revision and render/schedule
  invalidation requirements; this change adds no transcript tool or lifecycle.
- Requires owner review of this backwards-compatible normative addition, with
  the approval record closed by REL-01.

### 1.0.0 — 2026-07-26

- Established the original complete product plan as a normative RFC-style
  specification.
- Reconciled required behavior with current repository evidence instead of
  treating queued stubs or interface boundaries as completed functionality.
- Made Windows 11 the only release-acceptance platform.
- Added the evidence-linked `Implemented`/`Partial`/`Pending` capability matrix.
- Required complete, non-destructive MCP workflow parity while reserving
  credential and cloud-authorization grants as UI-only security gates.
- Recorded the verified YouTube three-minute Shorts and over-one-minute Content
  ID warning.
- Adopted configurable provider model IDs and official OpenAI transcription,
  diarization, and structured-output capability references.
