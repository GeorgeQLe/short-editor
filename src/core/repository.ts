import type { SqliteDatabase } from "./database.js";
import type {
  AnalysisArtifact, Asset, CandidateContentPackage, CandidateGenerationDiagnostic,
  CandidateGenerationResult, CandidateGenerationRun, ClipCandidate, Composition,
  ContentPackage, Episode, Job, Render, RenderPreflightResult,
  RenderDeterminism,
  ProviderProvenance, ScheduleEntry, ScheduleRuleSet, ShortProject, Template, TranscriptRevision,
  TranscriptSegment, WatchedFolder
} from "../shared/domain.js";
import {
  analysisArtifactSchema,
  renderDeterminismSchema,
  renderPreflightResultSchema,
  sourceRangesSchema,
  timedSegmentsSchema
} from "../shared/domain.js";
import { AppError } from "../shared/errors.js";
import { candidatesConflict, compareCandidates } from "./candidates.js";
import { assertEpisodeTransition, type RelinkContext } from "../shared/episode-transitions.js";
import { createHash, randomUUID } from "node:crypto";
import { validateOwnedRelativePath } from "./artifact-path.js";
import { canonicalJson } from "./analysis-cache.js";

type Row = Record<string, unknown>;
const bool = (value: unknown) => value === 1;
const json = <T>(value: unknown): T => JSON.parse(String(value)) as T;

export interface StoredArtifact {
  id: string;
  kind: string;
  ownerType: string;
  ownerId: string;
  ownerRevision: number | null;
  relativePath: string;
  contentHash: string;
  byteLength: number;
  producerVersion: string;
  state: "temporary" | "complete" | "corrupt" | "superseded";
  createdAt: string;
}

export interface CloudAuthorization {
  id: string;
  scopeType: "project" | "batch";
  scopeId: string;
  provider: string;
  operationClasses: string[];
  credentialHandle: string | null;
  grantedAt: string;
  revokedAt: string | null;
}

export interface RelinkComparison {
  id: string;
  episodeId: string;
  tokenHash: string;
  candidatePath: string;
  canonicalPath: string;
  fingerprint: string;
  contentHash: string;
  fileSize: number;
  modifiedAtMs: number;
  probe: {
    durationMs: number;
    width: number;
    height: number;
    videoCodec: string;
    audioCodec: string | null;
  };
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface StoredRenderPreflight {
  result: RenderPreflightResult;
  snapshot: unknown;
}

export class Repository {
  constructor(readonly db: SqliteDatabase) {}

  transaction<T>(work: () => T): T {
    return this.db.transaction(work)();
  }

  saveWatchedFolder(folder: WatchedFolder): WatchedFolder {
    this.db.prepare(`
      INSERT INTO watched_folders(
        id,canonical_path,enabled,recursive,include_patterns_json,last_scan_status,
        last_scanned_at,last_scan_error,created_at,updated_at
      ) VALUES(@id,@canonicalPath,@enabled,@recursive,@includePatterns,@lastScanStatus,
        @lastScannedAt,@lastScanError,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        canonical_path=excluded.canonical_path,enabled=excluded.enabled,
        recursive=excluded.recursive,include_patterns_json=excluded.include_patterns_json,
        last_scan_status=excluded.last_scan_status,last_scanned_at=excluded.last_scanned_at,
        last_scan_error=excluded.last_scan_error,updated_at=excluded.updated_at
    `).run({
      ...folder,
      enabled: folder.enabled ? 1 : 0,
      recursive: folder.recursive ? 1 : 0,
      includePatterns: JSON.stringify(folder.includePatterns)
    });
    return folder;
  }

  listWatchedFolders(): WatchedFolder[] {
    return (this.db.prepare(
      "SELECT * FROM watched_folders ORDER BY created_at"
    ).all() as Row[]).map(mapWatchedFolder);
  }

  getWatchedFolder(id: string): WatchedFolder {
    const row = this.db.prepare("SELECT * FROM watched_folders WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Watched folder not found", 404);
    return mapWatchedFolder(row);
  }

  updateWatchedFolderScan(
    id: string,
    status: WatchedFolder["lastScanStatus"],
    error: string | null = null
  ): void {
    this.db.prepare(`
      UPDATE watched_folders SET last_scan_status=?,
        last_scanned_at=CASE WHEN ?='scanning' THEN last_scanned_at ELSE ? END,
        last_scan_error=?,updated_at=? WHERE id=?
    `).run(
      status,
      status,
      new Date().toISOString(),
      error,
      new Date().toISOString(),
      id
    );
  }

  listEpisodes(search?: string): Episode[] {
    const wildcard = `%${search ?? ""}%`;
    const rows = this.db.prepare(`
      SELECT e.*,
        (SELECT COUNT(*) FROM candidates c WHERE c.episode_id=e.id AND c.state='active') candidate_count,
        (SELECT COUNT(DISTINCT r.short_id) FROM renders r JOIN short_projects s ON s.id=r.short_id
          WHERE s.episode_id=e.id AND r.state='succeeded') rendered_short_count,
        (SELECT COUNT(*) FROM schedule_entries se WHERE se.episode_id=e.id) scheduled_count
      FROM episodes e
      WHERE (? = '' OR e.source_path LIKE ?)
      ORDER BY e.created_at DESC
    `).all(search ?? "", wildcard) as Row[];
    return rows.map(mapEpisode);
  }

  getEpisode(id: string): Episode {
    const row = this.db.prepare(`
      SELECT e.*,
        (SELECT COUNT(*) FROM candidates c WHERE c.episode_id=e.id AND c.state='active') candidate_count,
        (SELECT COUNT(DISTINCT r.short_id) FROM renders r JOIN short_projects s ON s.id=r.short_id
          WHERE s.episode_id=e.id AND r.state='succeeded') rendered_short_count,
        (SELECT COUNT(*) FROM schedule_entries se WHERE se.episode_id=e.id) scheduled_count
      FROM episodes e WHERE e.id=?
    `).get(id) as Row | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Episode not found", 404);
    return mapEpisode(row);
  }

  findEpisodeByCanonicalPath(path: string): Episode | undefined {
    const row = this.db.prepare("SELECT * FROM episodes WHERE canonical_path=?").get(path) as Row | undefined;
    return row ? mapEpisode({ ...row, candidate_count: 0, rendered_short_count: 0, scheduled_count: 0 }) : undefined;
  }

  findEpisodesByFingerprint(fingerprint: string): Episode[] {
    return (this.db.prepare(
      "SELECT * FROM episodes WHERE fingerprint=? ORDER BY created_at,id"
    ).all(fingerprint) as Row[]).map((row) => mapEpisode({
      ...row, candidate_count: 0, rendered_short_count: 0, scheduled_count: 0
    }));
  }

  findEpisodeByContentHash(contentHash: string): Episode | undefined {
    const row = this.db.prepare(
      "SELECT * FROM episodes WHERE content_hash=? ORDER BY created_at,id LIMIT 1"
    ).get(contentHash) as Row | undefined;
    return row ? mapEpisode({
      ...row, candidate_count: 0, rendered_short_count: 0, scheduled_count: 0
    }) : undefined;
  }

  insertEpisode(input: Omit<Episode, "candidateCount" | "renderedShortCount" | "scheduledCount">): Episode {
    this.db.prepare(`
      INSERT INTO episodes(
        id,source_path,canonical_path,fingerprint,content_hash,file_size,modified_at_ms,
        duration_ms,width,height,video_codec,audio_codec,status,missing,relink_restore_status,
        created_at,updated_at
      ) VALUES(@id,@sourcePath,@canonicalPath,@fingerprint,@contentHash,@fileSize,@modifiedAtMs,
        @durationMs,@width,@height,@videoCodec,@audioCodec,@status,@missing,@relinkRestoreStatus,
        @createdAt,@updatedAt)
    `).run({ ...input, missing: input.missing ? 1 : 0 });
    return this.getEpisode(input.id);
  }

  updateEpisodeMedia(id: string, media: Partial<Pick<Episode,
    "contentHash" | "durationMs" | "width" | "height" | "videoCodec" | "audioCodec" | "status" | "missing">>): void {
    if (media.status !== undefined) {
      const current = this.getEpisode(id);
      assertEpisodeTransition(current.status, media.status);
    }
    const fields: Record<string, unknown> = { id, updatedAt: new Date().toISOString() };
    const clauses: string[] = [];
    const names: Record<string, string> = {
      contentHash: "content_hash", durationMs: "duration_ms", width: "width", height: "height",
      videoCodec: "video_codec", audioCodec: "audio_codec", status: "status", missing: "missing"
    };
    Object.entries(media).forEach(([key, value]) => {
      clauses.push(`${names[key]}=@${key}`);
      fields[key] = typeof value === "boolean" ? (value ? 1 : 0) : value;
    });
    if (clauses.length) this.db.prepare(
      `UPDATE episodes SET ${clauses.join(",")}, updated_at=@updatedAt WHERE id=@id`
    ).run(fields);
  }

  updateEpisodeStatus(
    id: string,
    status: Episode["status"],
    relinkContext?: RelinkContext
  ): Episode {
    return this.transaction(() => {
      const current = this.getEpisode(id);
      assertEpisodeTransition(current.status, status, relinkContext);
      const now = new Date().toISOString();
      const result = this.db.prepare(`
        UPDATE episodes SET status=?,missing=?,updated_at=? WHERE id=? AND status=?
      `).run(status, status === "source_missing" ? 1 : 0, now, id, current.status);
      if (!result.changes) {
        throw new AppError("INVALID_STATE", "Episode changed during its state transition", 409);
      }
      return this.getEpisode(id);
    });
  }

  markEpisodeSourceMissing(id: string): Episode {
    return this.transaction(() => {
      const current = this.getEpisode(id);
      if (current.status === "source_missing") return current;
      assertEpisodeTransition(current.status, "source_missing");
      const restoreStatus = current.status === "discovered" || current.status === "ready"
        ? current.status
        : "indexing";
      this.db.prepare(`
        UPDATE episodes SET status='source_missing',missing=1,
          relink_restore_status=?,updated_at=? WHERE id=?
      `).run(restoreStatus, new Date().toISOString(), id);
      return this.getEpisode(id);
    });
  }

  restoreEpisodeAtCurrentPath(id: string): Episode {
    return this.transaction(() => {
      const current = this.getEpisode(id);
      if (current.status !== "source_missing") return current;
      const status = current.relinkRestoreStatus ?? "indexing";
      this.db.prepare(`
        UPDATE episodes SET status=?,missing=0,relink_restore_status=NULL,updated_at=? WHERE id=?
      `).run(status, new Date().toISOString(), id);
      return this.getEpisode(id);
    });
  }

  commitEpisodeRelink(
    id: string,
    source: {
      sourcePath: string;
      canonicalPath: string;
      fingerprint: string;
      contentHash: string;
      fileSize: number;
      modifiedAtMs: number;
      durationMs: number;
      width: number;
      height: number;
      videoCodec: string;
      audioCodec: string | null;
    },
    forceIndexing = false,
    comparisonId?: string
  ): Episode {
    return this.transaction(() => {
      const current = this.getEpisode(id);
      if (current.status !== "source_missing") {
        throw new AppError("INVALID_STATE", "Only missing Episode sources can be relinked", 409);
      }
      if (comparisonId) {
        const consumed = this.db.prepare(`
          UPDATE relink_comparisons SET consumed_at=?
          WHERE id=? AND episode_id=? AND consumed_at IS NULL AND expires_at>?
        `).run(new Date().toISOString(), comparisonId, id, new Date().toISOString());
        if (!consumed.changes) {
          throw new AppError("VALIDATION_ERROR", "Relink confirmation is expired or already used", 422);
        }
      }
      const status = forceIndexing ? "indexing" : (current.relinkRestoreStatus ?? "indexing");
      try {
        this.db.prepare(`
          UPDATE episodes SET source_path=@sourcePath,canonical_path=@canonicalPath,
            fingerprint=@fingerprint,content_hash=@contentHash,file_size=@fileSize,
            modified_at_ms=@modifiedAtMs,duration_ms=@durationMs,width=@width,height=@height,
            video_codec=@videoCodec,audio_codec=@audioCodec,status=@status,missing=0,
            relink_restore_status=NULL,updated_at=@updatedAt WHERE id=@id
        `).run({ ...source, status, updatedAt: new Date().toISOString(), id });
      } catch {
        throw new AppError("SOURCE_IDENTITY_MISMATCH", "Candidate path conflicts with another Episode", 409);
      }
      if (forceIndexing) {
        const now = new Date().toISOString();
        this.db.prepare(`
          UPDATE renders SET state='stale',updated_at=?
          WHERE state='succeeded' AND short_id IN (
            SELECT id FROM short_projects WHERE episode_id=?
          )
        `).run(now, id);
        this.db.prepare(`
          UPDATE schedule_entries SET needs_rerender=1,revision=revision+1,updated_at=?
          WHERE episode_id=? AND status<>'published'
        `).run(now, id);
      }
      return this.getEpisode(id);
    });
  }

  saveRelinkComparison(comparison: RelinkComparison): void {
    this.db.prepare(`
      INSERT INTO relink_comparisons(
        id,episode_id,token_hash,candidate_path,canonical_path,fingerprint,content_hash,
        file_size,modified_at_ms,probe_json,expires_at,consumed_at,created_at
      ) VALUES(@id,@episodeId,@tokenHash,@candidatePath,@canonicalPath,@fingerprint,@contentHash,
        @fileSize,@modifiedAtMs,@probe,@expiresAt,@consumedAt,@createdAt)
    `).run({ ...comparison, probe: JSON.stringify(comparison.probe) });
  }

  findRelinkComparison(tokenHash: string): RelinkComparison | undefined {
    const row = this.db.prepare(
      "SELECT * FROM relink_comparisons WHERE token_hash=?"
    ).get(tokenHash) as Row | undefined;
    return row ? mapRelinkComparison(row) : undefined;
  }

  replaceTranscript(episodeId: string, segments: TranscriptSegment[]): TranscriptRevision {
    const now = new Date().toISOString();
    return this.replaceTranscriptWithProvenance(episodeId, segments, "und", {
      provider: "manual",
      providerClass: "local",
      modelId: "manual",
      providerVersion: "1",
      optionsVersion: "1",
      createdAt: now
    });
  }

  replaceTranscriptWithProvenance(
    episodeId: string,
    segments: TranscriptSegment[],
    language: string,
    provenance: ProviderProvenance
  ): TranscriptRevision {
    return this.db.transaction(() => {
      const latest = this.db.prepare(
        "SELECT COALESCE(MAX(revision),0) revision FROM transcript_revisions WHERE episode_id=?"
      ).get(episodeId) as { revision: number };
      return this.acceptTranscriptRevision(
        episodeId,
        latest.revision,
        language,
        segments,
        provenance
      );
    })();
  }

  updateAcceptedTranscript(
    episodeId: string,
    expectedRevision: number,
    language: string,
    segments: TranscriptSegment[]
  ): TranscriptRevision {
    return this.db.transaction(() => {
      const episode = this.getEpisode(episodeId);
      if (episode.missing) {
        throw new AppError(
          "SOURCE_MISSING",
          "Cannot edit a transcript while its source media is missing",
          409,
          { episodeId }
        );
      }
      this.getTranscriptRevision(episodeId);
      const now = new Date().toISOString();
      return this.acceptTranscriptRevision(episodeId, expectedRevision, language, segments, {
        provider: "manual",
        providerClass: "local",
        modelId: "manual-edit",
        providerVersion: "1",
        optionsVersion: "full-snapshot-v1",
        createdAt: now
      });
    })();
  }

  acceptTranscriptRevision(
    episodeId: string,
    expectedRevision: number,
    language: string,
    segments: TranscriptSegment[],
    provenance: ProviderProvenance
  ): TranscriptRevision {
    return this.db.transaction(() => {
      const episode = this.getEpisode(episodeId);
      if (episode.missing) {
        throw new AppError(
          "SOURCE_MISSING",
          "Cannot edit a transcript while its source media is missing",
          409,
          { episodeId }
        );
      }
      const currentRow = this.db.prepare(`
        SELECT * FROM transcript_revisions
        WHERE episode_id=? AND accepted_state='accepted'
        LIMIT 1
      `).get(episodeId) as Row | undefined;
      const actualRevision = currentRow ? Number(currentRow.revision) : 0;
      if (actualRevision !== expectedRevision) {
        throw revisionConflict("Transcript", expectedRevision, actualRevision);
      }
      if (language.trim().length < 2) {
        throw new AppError("VALIDATION_ERROR", "Transcript language must not be empty", 422);
      }

      const parsed = timedSegmentsSchema.safeParse(segments);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid transcript snapshot", 422,
          parsed.error.issues.map(({ path, message }) => ({ path, message })));
      }
      if (new Set(parsed.data.map((segment) => segment.id)).size !== parsed.data.length) {
        throw new AppError("VALIDATION_ERROR", "Transcript segment IDs must be unique", 422);
      }
      if (episode.durationMs !== null) {
        const outside = parsed.data.findIndex((segment) => segment.endMs > episode.durationMs!);
        if (outside !== -1) {
          throw new AppError("VALIDATION_ERROR", "Transcript timing exceeds Episode duration", 422, [{
            path: ["segments", outside, "endMs"],
            message: "Segment timing must be within the Episode duration"
          }]);
        }
      }

      const now = new Date().toISOString();
      const revision: TranscriptRevision = {
        id: randomUUID(),
        episodeId,
        revision: actualRevision + 1,
        language: language.trim(),
        segments: parsed.data,
        provenance,
        acceptedState: "accepted",
        createdAt: now,
        updatedAt: now
      };

      this.db.prepare(`
        UPDATE transcript_revisions SET accepted_state='superseded',updated_at=?
        WHERE episode_id=? AND accepted_state='accepted'
      `).run(now, episodeId);
      this.db.prepare(`
        INSERT INTO transcript_revisions(
          id,episode_id,revision,language,segments_json,provenance_json,
          accepted_state,created_at,updated_at
        ) VALUES(@id,@episodeId,@revision,@language,@segments,@provenance,
          'accepted',@createdAt,@updatedAt)
      `).run({
        ...revision,
        segments: JSON.stringify(revision.segments),
        provenance: JSON.stringify(revision.provenance)
      });

      this.db.prepare("DELETE FROM transcript_segments WHERE episode_id=?").run(episodeId);
      const insert = this.db.prepare(`
        INSERT INTO transcript_segments(id,episode_id,start_ms,end_ms,text,words_json,speaker,confidence)
        VALUES(@id,@episodeId,@startMs,@endMs,@text,@words,@speaker,@confidence)
      `);
      for (const segment of revision.segments) insert.run({
        ...segment,
        episodeId,
        words: JSON.stringify(segment.words)
      });

      this.db.prepare(`
        UPDATE analysis_artifacts SET state='superseded'
        WHERE entity_id=? AND owner_type='episode' AND kind='episode_analysis'
          AND state IN ('proposed','accepted')
      `).run(episodeId);
      this.db.prepare(`
        UPDATE short_projects SET approved=0,revision=revision+1,updated_at=?
        WHERE episode_id=?
      `).run(now, episodeId);
      this.db.prepare(`
        UPDATE renders SET state='stale',updated_at=?
        WHERE state='succeeded' AND short_id IN (
          SELECT id FROM short_projects WHERE episode_id=?
        )
      `).run(now, episodeId);
      this.db.prepare(`
        UPDATE schedule_entries
        SET needs_rerender=1,revision=revision+1,updated_at=?
        WHERE episode_id=? AND status<>'published'
      `).run(now, episodeId);
      return revision;
    })();
  }

  getTranscript(episodeId: string): TranscriptSegment[] {
    const revision = this.db.prepare(`
      SELECT segments_json FROM transcript_revisions
      WHERE episode_id=? AND accepted_state='accepted'
      ORDER BY revision DESC LIMIT 1
    `).get(episodeId) as { segments_json: string } | undefined;
    if (revision) return json<TranscriptSegment[]>(revision.segments_json);
    return (this.db.prepare(
      "SELECT * FROM transcript_segments WHERE episode_id=? ORDER BY start_ms"
    ).all(episodeId) as Row[]).map((row) => ({
      id: String(row.id), startMs: Number(row.start_ms), endMs: Number(row.end_ms),
      text: String(row.text), words: JSON.parse(String(row.words_json)),
      speaker: row.speaker === null ? null : String(row.speaker),
      confidence: row.confidence === null ? null : Number(row.confidence)
    }));
  }

  saveTranscriptRevision(revision: TranscriptRevision, expectedRevision: number): TranscriptRevision {
    return this.transaction(() => {
      const row = this.db.prepare(`
        SELECT COALESCE(MAX(revision),0) revision
        FROM transcript_revisions WHERE episode_id=?
      `).get(revision.episodeId) as { revision: number };
      if (row.revision !== expectedRevision) {
        throw revisionConflict("Transcript", expectedRevision, row.revision);
      }
      if (revision.revision !== expectedRevision + 1) {
        throw new AppError("VALIDATION_ERROR", "Transcript revision must increment exactly once", 422);
      }
      if (revision.acceptedState === "accepted") {
        this.db.prepare(`
          UPDATE transcript_revisions SET accepted_state='superseded',updated_at=?
          WHERE episode_id=? AND accepted_state='accepted'
        `).run(revision.updatedAt, revision.episodeId);
      }
      this.db.prepare(`
        INSERT INTO transcript_revisions(
          id,episode_id,revision,language,segments_json,provenance_json,
          accepted_state,created_at,updated_at
        ) VALUES(@id,@episodeId,@revision,@language,@segments,@provenance,
          @acceptedState,@createdAt,@updatedAt)
      `).run({
        ...revision,
        segments: JSON.stringify(revision.segments),
        provenance: JSON.stringify(revision.provenance)
      });
      return revision;
    });
  }

  listTranscriptRevisions(episodeId: string): TranscriptRevision[] {
    return (this.db.prepare(`
      SELECT * FROM transcript_revisions WHERE episode_id=? ORDER BY revision
    `).all(episodeId) as Row[]).map(mapTranscriptRevision);
  }

  getAcceptedTranscriptRevision(episodeId: string): TranscriptRevision {
    const row = this.db.prepare(`
      SELECT * FROM transcript_revisions
      WHERE episode_id=? AND accepted_state='accepted'
      ORDER BY revision DESC LIMIT 1
    `).get(episodeId) as Row | undefined;
    if (!row) throw new AppError("INVALID_STATE", "Episode has no accepted transcript", 409);
    return mapTranscriptRevision(row);
  }

  getTranscriptRevision(episodeId: string, revision?: number): TranscriptRevision {
    this.getEpisode(episodeId);
    const row = revision === undefined
      ? this.db.prepare(`
        SELECT * FROM transcript_revisions
        WHERE episode_id=? AND accepted_state='accepted'
        LIMIT 1
      `).get(episodeId) as Row | undefined
      : this.db.prepare(`
        SELECT * FROM transcript_revisions WHERE episode_id=? AND revision=?
      `).get(episodeId, revision) as Row | undefined;
    if (!row) {
      throw new AppError(
        "NOT_FOUND",
        revision === undefined ? "Accepted transcript not found" : "Transcript revision not found",
        404,
        revision === undefined ? { episodeId } : { episodeId, revision }
      );
    }
    return mapTranscriptRevision(row);
  }

  saveCandidateGeneration(input: {
    episodeId: string;
    transcriptRevision: number;
    mode: "heuristic" | "analysis";
    analysisArtifactId: string | null;
    provider: ProviderProvenance | null;
    strategy: "replace_pending" | "append_pending";
    generationVersion: string;
    requestedCount: number;
    proposals: ClipCandidate[];
    diagnostic: CandidateGenerationDiagnostic;
  }): CandidateGenerationResult {
    return this.db.transaction(() => {
      const existing = (this.db.prepare(`
        SELECT c.*, EXISTS(
          SELECT 1 FROM analysis_artifacts a
          WHERE a.entity_id=c.id AND a.owner_type='candidate'
            AND a.kind='content_package' AND a.accepted_projection_json IS NOT NULL
        ) has_accepted_copy
        FROM candidates c WHERE c.episode_id=? AND c.state='active'
      `).all(input.episodeId) as Row[]).map((row) => ({
        candidate: mapCandidate(row),
        hasAcceptedCopy: bool(row.has_accepted_copy)
      }));
      const retainedDecisions = existing.filter(
        ({ candidate, hasAcceptedCopy }) =>
          candidate.reviewStatus !== "pending" || hasAcceptedCopy
      ).map(({ candidate }) => candidate);
      const retainedPending = input.strategy === "append_pending"
        ? existing.filter(
          ({ candidate, hasAcceptedCopy }) =>
            candidate.reviewStatus === "pending" && !hasAcceptedCopy
        ).map(({ candidate }) => candidate)
        : [];
      let retainedDecisionConflictCount = 0;
      let retainedPendingConflictCount = 0;
      const novel = input.proposals.filter((proposal) => {
        if (retainedDecisions.some((candidate) => candidatesConflict(candidate, proposal))) {
          retainedDecisionConflictCount++;
          return false;
        }
        if (retainedPending.some((candidate) => candidatesConflict(candidate, proposal))) {
          retainedPendingConflictCount++;
          return false;
        }
        return true;
      });
      const now = new Date().toISOString();
      if (input.strategy === "replace_pending") {
        this.db.prepare(`
          UPDATE candidates SET state='superseded',revision=revision+1,updated_at=?
          WHERE episode_id=? AND state='active' AND review_status='pending'
            AND NOT EXISTS (
              SELECT 1 FROM analysis_artifacts a
              WHERE a.entity_id=candidates.id AND a.owner_type='candidate'
                AND a.kind='content_package' AND a.accepted_projection_json IS NOT NULL
            )
        `).run(now, input.episodeId);
      }
      const runId = randomUUID();
      const diagnostic: CandidateGenerationDiagnostic = novel.length >= 5
        ? { sufficient: true, requestedCount: input.requestedCount, generatedCount: novel.length }
        : {
          ...(input.diagnostic.sufficient
            ? {
              sufficient: false as const,
              code: "INSUFFICIENT_NOVEL_MATERIAL" as const,
              minimumCandidateCount: 5 as const,
              requestedCount: input.requestedCount,
              generatedCount: novel.length,
              eligibleWindowCount: input.proposals.length,
              rejectionCounts: {
                duration: 0, quality: 0, overlap: 0, semanticDuplication: 0
              }
            }
            : { ...input.diagnostic, generatedCount: novel.length }),
          code: input.diagnostic.sufficient
            ? "INSUFFICIENT_NOVEL_MATERIAL" as const
            : input.diagnostic.code
        };
      const run: CandidateGenerationRun = {
        id: runId,
        episodeId: input.episodeId,
        transcriptRevision: input.transcriptRevision,
        mode: input.mode,
        analysisArtifactId: input.analysisArtifactId,
        provider: input.provider,
        strategy: input.strategy,
        generationVersion: input.generationVersion,
        requestedCount: input.requestedCount,
        proposedCount: input.proposals.length,
        insertedCount: novel.length,
        retainedDecisionConflictCount,
        retainedPendingConflictCount,
        diagnostic,
        createdAt: now
      };
      this.db.prepare(`
        INSERT INTO candidate_generation_runs(
          id,episode_id,transcript_revision,mode,analysis_artifact_id,
          provider_provenance_json,strategy,generation_version,requested_count,
          proposed_count,inserted_count,retained_decision_conflict_count,
          retained_pending_conflict_count,diagnostic_json,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        run.id, run.episodeId, run.transcriptRevision, run.mode, run.analysisArtifactId,
        run.provider ? JSON.stringify(run.provider) : null, run.strategy,
        run.generationVersion, run.requestedCount, run.proposedCount, run.insertedCount,
        run.retainedDecisionConflictCount, run.retainedPendingConflictCount,
        JSON.stringify(run.diagnostic), run.createdAt
      );
      const insert = this.db.prepare(`
        INSERT INTO candidates(id,episode_id,start_ms,end_ms,transcript,topic,hook,reason,
          score,scores_json,duplicate_group,review_status,created_at,generation_artifact_id,
          transcript_revision,generation_version,provider_provenance_json,generation_run_id,
          revision,state,updated_at)
        VALUES(@id,@episodeId,@startMs,@endMs,@transcript,@topic,@hook,@reason,
          @score,@scores,@duplicateGroup,@reviewStatus,@createdAt,@artifactId,
          @transcriptRevision,@generationVersion,@provider,@generationRunId,
          @revision,@state,@updatedAt)
      `);
      const inserted = novel.map((candidate) => ({
        ...candidate,
        generationRunId: runId,
        revision: 1,
        state: "active" as const,
        updatedAt: now
      }));
      inserted.forEach((candidate) => {
        insert.run({
        ...candidate,
        scores: JSON.stringify(candidate.scores),
        artifactId: candidate.generationProvenance.artifactId,
        transcriptRevision: candidate.generationProvenance.transcriptRevision,
        generationVersion: candidate.generationProvenance.generationVersion,
        provider: candidate.generationProvenance.provider
          ? JSON.stringify(candidate.generationProvenance.provider)
          : null
        });
        this.insertCandidateContentPackage(candidate, runId);
      });
      return { candidates: inserted, diagnostic, run };
    })();
  }

  /** Compatibility helper for repository fixtures; production generation uses saveCandidateGeneration. */
  replaceCandidates(episodeId: string, candidates: ClipCandidate[]): void {
    this.db.transaction(() => {
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE candidates SET state='superseded',revision=revision+1,updated_at=?
        WHERE episode_id=? AND state='active' AND review_status='pending'
      `).run(now, episodeId);
      const insert = this.db.prepare(`
        INSERT INTO candidates(id,episode_id,start_ms,end_ms,transcript,topic,hook,reason,
          score,scores_json,duplicate_group,review_status,created_at,generation_artifact_id,
          transcript_revision,generation_version,provider_provenance_json,generation_run_id,
          revision,state,updated_at)
        VALUES(@id,@episodeId,@startMs,@endMs,@transcript,@topic,@hook,@reason,
          @score,@scores,@duplicateGroup,@reviewStatus,@createdAt,@artifactId,
          @transcriptRevision,@generationVersion,@provider,@generationRunId,
          @revision,@state,@updatedAt)
      `);
      for (const candidate of candidates) {
        insert.run({
          ...candidate,
          scores: JSON.stringify(candidate.scores),
          artifactId: candidate.generationProvenance.artifactId,
          transcriptRevision: candidate.generationProvenance.transcriptRevision,
          generationVersion: candidate.generationProvenance.generationVersion,
          provider: candidate.generationProvenance.provider
            ? JSON.stringify(candidate.generationProvenance.provider)
            : null
        });
        this.insertCandidateContentPackage(candidate, candidate.generationRunId ?? "legacy");
      }
    })();
  }

  private insertCandidateContentPackage(candidate: ClipCandidate, runId: string): void {
    const proposed: ContentPackage = {
      cleanedTranscript: candidate.transcript,
      rewrite: "",
      hookVariants: [candidate.hook],
      titles: [candidate.topic],
      description: "",
      hashtags: [],
      thumbnailText: ""
    };
    const provenance = candidate.generationProvenance.provider ?? {
      provider: "short-editor",
      providerClass: "local" as const,
      modelId: "candidate-content-seed",
      providerVersion: candidate.generationProvenance.generationVersion,
      optionsVersion: "1",
      createdAt: candidate.createdAt
    };
    const identity = JSON.stringify({
      transcriptRevision: candidate.generationProvenance.transcriptRevision,
      generationRunId: runId,
      generationVersion: candidate.generationProvenance.generationVersion,
      analysisArtifactId: candidate.generationProvenance.artifactId,
      provider: provenance,
      proposed: normalizedContentPackageIdentity(proposed)
    });
    this.db.prepare(`
      INSERT INTO analysis_artifacts(
        id,entity_id,owner_type,kind,state,provenance_json,input_hash,
        raw_output_json,accepted_projection_json,created_at
      ) VALUES(?,?,'candidate','content_package','proposed',?,?,?,NULL,?)
    `).run(
      randomUUID(), candidate.id, JSON.stringify(provenance),
      createHash("sha256").update(identity).digest("hex"),
      JSON.stringify(proposed), candidate.createdAt
    );
  }

  listCandidates(episodeId: string): ClipCandidate[] {
    return (this.db.prepare(
      "SELECT * FROM candidates WHERE episode_id=? AND state='active'"
    ).all(episodeId) as Row[]).map(mapCandidate).sort(compareCandidates);
  }

  getCandidate(id: string): ClipCandidate {
    const row = this.db.prepare("SELECT * FROM candidates WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Candidate not found", 404);
    return mapCandidate(row);
  }

  reviewCandidate(
    id: string,
    expectedRevision: number,
    status: "approved" | "rejected"
  ): ClipCandidate {
    return this.db.transaction(() => {
      const current = this.getCandidate(id);
      if (current.revision !== expectedRevision) {
        throw revisionConflict("Candidate", expectedRevision, current.revision);
      }
      if (current.state !== "active") {
        throw new AppError("INVALID_STATE", "Superseded Candidate cannot be reviewed", 409);
      }
      const now = new Date().toISOString();
      const info = this.db.prepare(`
        UPDATE candidates SET review_status=?,revision=revision+1,updated_at=?
        WHERE id=? AND revision=? AND state='active'
      `).run(status, now, id, expectedRevision);
      if (!info.changes) throw revisionConflict("Candidate", expectedRevision, current.revision);
      return this.getCandidate(id);
    })();
  }

  getCandidateContentPackage(id: string): CandidateContentPackage {
    const candidate = this.getCandidate(id);
    const row = this.db.prepare(`
      SELECT * FROM analysis_artifacts
      WHERE entity_id=? AND owner_type='candidate' AND kind='content_package'
      ORDER BY created_at DESC LIMIT 1
    `).get(id) as Row | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Candidate content package not found", 404);
    return {
      candidateId: id,
      candidateRevision: candidate.revision,
      proposalArtifactId: String(row.id),
      proposed: json<ContentPackage>(row.raw_output_json),
      accepted: row.accepted_projection_json
        ? json<ContentPackage>(row.accepted_projection_json)
        : null,
      proposalProvenance: json<ProviderProvenance>(row.provenance_json),
      inputHash: String(row.input_hash)
    };
  }

  acceptCandidateContentPackage(
    id: string,
    expectedRevision: number,
    contentPackage: ContentPackage
  ): CandidateContentPackage {
    return this.db.transaction(() => {
      const current = this.getCandidate(id);
      if (current.revision !== expectedRevision) {
        throw revisionConflict("Candidate", expectedRevision, current.revision);
      }
      if (current.state !== "active") {
        throw new AppError("INVALID_STATE", "Superseded Candidate copy cannot be accepted", 409);
      }
      const artifact = this.db.prepare(`
        SELECT id FROM analysis_artifacts
        WHERE entity_id=? AND owner_type='candidate' AND kind='content_package'
        ORDER BY created_at DESC LIMIT 1
      `).get(id) as { id: string } | undefined;
      if (!artifact) throw new AppError("NOT_FOUND", "Candidate content package not found", 404);
      this.db.prepare(`
        UPDATE analysis_artifacts
        SET accepted_projection_json=?,state='accepted' WHERE id=?
      `).run(JSON.stringify(contentPackage), artifact.id);
      const now = new Date().toISOString();
      const changed = this.db.prepare(`
        UPDATE candidates SET revision=revision+1,updated_at=?
        WHERE id=? AND revision=? AND state='active'
      `).run(now, id, expectedRevision);
      if (!changed.changes) throw revisionConflict("Candidate", expectedRevision, current.revision);
      return this.getCandidateContentPackage(id);
    })();
  }

  createShort(project: ShortProject): ShortProject {
    this.db.prepare(`
      INSERT INTO short_projects(id,episode_id,candidate_id,title,source_ranges_json,
        template_id,composition_json,copy_json,approved,revision,created_at,updated_at,
        template_lineage_json,captions_json,audio_json,copy_state,copy_source)
      VALUES(@id,@episodeId,@candidateId,@title,@sourceRanges,@templateId,@composition,
        @copy,@approved,@revision,@createdAt,@updatedAt,@templateLineage,@captions,@audio,
        @copyState,@copySource)
    `).run({
      ...project, sourceRanges: JSON.stringify(project.sourceRanges),
      composition: JSON.stringify(project.composition), copy: JSON.stringify(project.copy),
      templateLineage: JSON.stringify(project.templateLineage),
      captions: JSON.stringify(project.captions),
      audio: JSON.stringify(project.audio),
      approved: project.approved ? 1 : 0
    });
    return project;
  }

  getShort(id: string): ShortProject {
    const row = this.db.prepare("SELECT * FROM short_projects WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Short not found", 404);
    return mapShort(row);
  }

  updateShort(id: string, expectedRevision: number, patch: {
    composition?: Composition;
    copy?: ShortProject["copy"];
    title?: string;
    captions?: ShortProject["captions"];
    audio?: ShortProject["audio"];
    copyState?: ShortProject["copyState"];
    copySource?: ShortProject["copySource"];
  }): ShortProject {
    return this.db.transaction(() => {
      const current = this.getShort(id);
      if (current.revision !== expectedRevision) {
        throw new AppError("REVISION_CONFLICT", "Short was edited by another client", 409, {
          expectedRevision, actualRevision: current.revision
        });
      }
      const renderAffecting = patch.composition !== undefined
        || patch.captions !== undefined
        || patch.audio !== undefined;
      if (patch.composition) {
        validateCompositionCropTimes(patch.composition, outputDuration(current.sourceRanges));
      }
      const next = {
        ...current,
        ...patch,
        copyState: patch.copy !== undefined ? (patch.copyState ?? "accepted") : current.copyState,
        copySource: patch.copy !== undefined ? (patch.copySource ?? "user_accepted") : current.copySource,
        approved: renderAffecting ? false : current.approved,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString()
      };
      const update = this.db.prepare(`
        UPDATE short_projects SET title=?,source_ranges_json=?,composition_json=?,captions_json=?,
          audio_json=?,copy_json=?,copy_state=?,copy_source=?,approved=?,revision=?,updated_at=?
        WHERE id=? AND revision=?
      `).run(
        next.title, JSON.stringify(next.sourceRanges), JSON.stringify(next.composition),
        JSON.stringify(next.captions), JSON.stringify(next.audio), JSON.stringify(next.copy),
        next.copyState, next.copySource, next.approved ? 1 : 0, next.revision,
        next.updatedAt, id, expectedRevision
      );
      if (!update.changes) throw revisionConflict("Short", expectedRevision, current.revision);
      if (renderAffecting) {
        this.db.prepare(`
          UPDATE renders SET state='stale',updated_at=?
          WHERE short_id=? AND project_revision<>? AND state='succeeded'
        `).run(next.updatedAt, id, next.revision);
        this.db.prepare(`
          UPDATE schedule_entries SET needs_rerender=1,updated_at=?,revision=revision+1
          WHERE short_id=? AND status<>'published'
        `).run(next.updatedAt, id);
      }
      return next;
    })();
  }

  updateShortTimeline(
    id: string,
    expectedRevision: number,
    sourceRanges: ShortProject["sourceRanges"]
  ): ShortProject {
    return this.db.transaction(() => {
      const current = this.getShort(id);
      if (current.revision !== expectedRevision) {
        throw revisionConflict("Short", expectedRevision, current.revision);
      }
      const episode = this.getEpisode(current.episodeId);
      assertSourceAvailable(episode);
      validateSourceRanges(sourceRanges, episode.durationMs);
      validateCompositionCropTimes(current.composition, outputDuration(sourceRanges));

      const now = new Date().toISOString();
      const nextRevision = current.revision + 1;
      const changed = this.db.prepare(`
        UPDATE short_projects
        SET source_ranges_json=?,approved=0,revision=?,updated_at=?
        WHERE id=? AND revision=?
      `).run(JSON.stringify(sourceRanges), nextRevision, now, id, expectedRevision);
      if (!changed.changes) {
        const actual = this.getShort(id).revision;
        throw revisionConflict("Short", expectedRevision, actual);
      }
      this.db.prepare(`
        UPDATE renders SET state='stale',updated_at=?
        WHERE short_id=? AND state='succeeded'
      `).run(now, id);
      this.db.prepare(`
        UPDATE schedule_entries SET needs_rerender=1,updated_at=?,revision=revision+1
        WHERE short_id=? AND status<>'published'
      `).run(now, id);
      return this.getShort(id);
    })();
  }

  updateShortCaptions(
    id: string,
    expectedRevision: number,
    captions: ShortProject["captions"]
  ): ShortProject {
    return this.transaction(() => {
      const current = this.getShort(id);
      if (current.revision !== expectedRevision) {
        throw revisionConflict("Short", expectedRevision, current.revision);
      }
      const now = new Date().toISOString();
      const nextRevision = expectedRevision + 1;
      const changed = this.db.prepare(`
        UPDATE short_projects
        SET captions_json=?,approved=0,revision=?,updated_at=?
        WHERE id=? AND revision=?
      `).run(JSON.stringify(captions), nextRevision, now, id, expectedRevision);
      if (!changed.changes) {
        throw revisionConflict("Short", expectedRevision, this.getShort(id).revision);
      }
      this.db.prepare(`
        UPDATE renders SET state='stale',updated_at=?
        WHERE short_id=? AND state='succeeded' AND project_revision<?
      `).run(now, id, nextRevision);
      this.db.prepare(`
        UPDATE schedule_entries SET needs_rerender=1,updated_at=?,revision=revision+1
        WHERE short_id=? AND status<>'published'
      `).run(now, id);
      return this.getShort(id);
    });
  }

  updateShortAudio(
    id: string,
    expectedRevision: number,
    audio: ShortProject["audio"]
  ): ShortProject {
    return this.transaction(() => {
      const current = this.getShort(id);
      if (current.revision !== expectedRevision) {
        throw revisionConflict("Short", expectedRevision, current.revision);
      }
      const now = new Date().toISOString();
      const nextRevision = expectedRevision + 1;
      const changed = this.db.prepare(`
        UPDATE short_projects
        SET audio_json=?,approved=0,revision=?,updated_at=?
        WHERE id=? AND revision=?
      `).run(JSON.stringify(audio), nextRevision, now, id, expectedRevision);
      if (!changed.changes) {
        throw revisionConflict("Short", expectedRevision, this.getShort(id).revision);
      }
      this.db.prepare(`
        UPDATE renders SET state='stale',updated_at=?
        WHERE short_id=? AND state='succeeded' AND project_revision<?
      `).run(now, id, nextRevision);
      this.db.prepare(`
        UPDATE schedule_entries SET needs_rerender=1,updated_at=?,revision=revision+1
        WHERE short_id=? AND status<>'published'
      `).run(now, id);
      return this.getShort(id);
    });
  }

  approveShort(id: string, expectedRevision: number): ShortProject {
    return this.db.transaction(() => {
      const current = this.getShort(id);
      if (current.revision !== expectedRevision) {
        throw revisionConflict("Short", expectedRevision, current.revision);
      }
      if (current.approved) {
        throw new AppError("INVALID_STATE", "Short is already approved", 409);
      }
      if (current.copyState !== "accepted") {
        throw new AppError("INVALID_STATE", "Accept the Short copy before approval", 409);
      }
      const episode = this.getEpisode(current.episodeId);
      assertSourceAvailable(episode);
      validateSourceRanges(current.sourceRanges, episode.durationMs);

      const now = new Date().toISOString();
      const changed = this.db.prepare(`
        UPDATE short_projects SET approved=1,revision=revision+1,updated_at=?
        WHERE id=? AND revision=? AND approved=0
      `).run(now, id, expectedRevision);
      if (!changed.changes) {
        const actual = this.getShort(id).revision;
        throw revisionConflict("Short", expectedRevision, actual);
      }
      return this.getShort(id);
    })();
  }

  insertAnalysisArtifact(artifact: AnalysisArtifact): AnalysisArtifact {
    this.db.prepare(`
      INSERT INTO analysis_artifacts(
        id,entity_id,owner_type,kind,state,provenance_json,input_hash,
        raw_output_json,accepted_projection_json,created_at
      ) VALUES(@id,@entityId,@ownerType,@kind,@state,@provenance,@inputHash,
        @rawOutput,@acceptedProjection,@createdAt)
    `).run({
      ...artifact,
      provenance: JSON.stringify(artifact.provenance),
      rawOutput: JSON.stringify(artifact.rawOutput),
      acceptedProjection: artifact.acceptedProjection === null
        ? null
        : JSON.stringify(artifact.acceptedProjection)
    });
    return artifact;
  }

  insertAnalysisArtifactWinner(artifact: AnalysisArtifact): AnalysisArtifact {
    return this.transaction(() => {
      const existing = this.findAnalysisArtifact(
        artifact.entityId,
        artifact.kind,
        artifact.inputHash
      );
      if (existing) return existing;
      try {
        return this.insertAnalysisArtifact(artifact);
      } catch (error) {
        const winner = this.findAnalysisArtifact(
          artifact.entityId,
          artifact.kind,
          artifact.inputHash
        );
        if (winner) return winner;
        throw error;
      }
    });
  }

  listAnalysisArtifacts(entityId: string): AnalysisArtifact[] {
    return (this.db.prepare(`
      SELECT * FROM analysis_artifacts WHERE entity_id=? ORDER BY created_at
    `).all(entityId) as Row[]).map(mapAnalysisArtifact);
  }

  getAnalysisArtifact(id: string): AnalysisArtifact {
    const row = this.db.prepare(
      "SELECT * FROM analysis_artifacts WHERE id=?"
    ).get(id) as Row | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Analysis artifact not found", 404);
    try {
      return analysisArtifactSchema.parse(mapAnalysisArtifact(row));
    } catch {
      throw new AppError("PROVIDER_OUTPUT_INVALID", "Analysis artifact is malformed", 422);
    }
  }

  findAnalysisArtifact(
    entityId: string,
    kind: AnalysisArtifact["kind"],
    inputHash: string
  ): AnalysisArtifact | undefined {
    const row = this.db.prepare(`
      SELECT * FROM analysis_artifacts
      WHERE entity_id=? AND kind=? AND input_hash=? AND state IN ('proposed','accepted')
      ORDER BY created_at DESC LIMIT 1
    `).get(entityId, kind, inputHash) as Row | undefined;
    if (!row) return undefined;
    try {
      const artifact = mapAnalysisArtifact(row);
      const parsed = analysisArtifactSchema.safeParse(artifact);
      if (parsed.success) return parsed.data;
    } catch {
      // Mark an unreadable cache record below and force recomputation.
    }
    this.db.prepare(
      "UPDATE analysis_artifacts SET state='corrupt' WHERE id=?"
    ).run(String(row.id));
    return undefined;
  }

  createTemplate(template: Template): Template {
    this.db.prepare(`
      INSERT INTO templates(
        id,name,description,version,revision,parent_template_id,built_in,
        composition_json,created_at,updated_at
      ) VALUES(@id,@name,@description,@version,@revision,@parentTemplateId,@builtIn,
        @composition,@createdAt,@updatedAt)
    `).run({
      ...template,
      builtIn: template.builtIn ? 1 : 0,
      composition: JSON.stringify(template.composition)
    });
    return template;
  }

  getTemplate(id: string): Template {
    const row = this.db.prepare("SELECT * FROM templates WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Template not found", 404);
    return mapTemplate(row);
  }

  listTemplates(): Template[] {
    return (this.db.prepare(
      "SELECT * FROM templates ORDER BY built_in DESC, created_at, id"
    ).all() as Row[]).map(mapTemplate);
  }

  updateTemplate(
    id: string,
    expectedRevision: number,
    patch: Pick<Partial<Template>, "name" | "description" | "composition">
  ): Template {
    return this.transaction(() => {
      const current = this.getTemplate(id);
      if (current.builtIn) throw new AppError("INVALID_STATE", "Built-in templates are immutable", 409);
      if (current.revision !== expectedRevision) {
        throw revisionConflict("Template", expectedRevision, current.revision);
      }
      const next = {
        ...current,
        ...patch,
        revision: current.revision + 1,
        version: current.version + 1,
        updatedAt: new Date().toISOString()
      };
      const result = this.db.prepare(`
        UPDATE templates SET name=?,description=?,composition_json=?,version=?,
          revision=?,updated_at=? WHERE id=? AND revision=? AND built_in=0
      `).run(
        next.name, next.description, JSON.stringify(next.composition), next.version,
        next.revision, next.updatedAt, id, expectedRevision
      );
      if (!result.changes) throw revisionConflict("Template", expectedRevision, current.revision);
      return next;
    });
  }

  saveAsset(asset: Asset): Asset {
    if (asset.ownedArtifactPath !== null) {
      asset = {
        ...asset,
        ownedArtifactPath: validateOwnedRelativePath(asset.ownedArtifactPath)
      };
    }
    this.db.prepare(`
      INSERT INTO assets(
        id,source_path,owned_artifact_path,kind,provenance,reusable,tags_json,
        width,height,duration_ms,created_at,updated_at
      ) VALUES(@id,@sourcePath,@ownedArtifactPath,@kind,@provenance,@reusable,@tags,
        @width,@height,@durationMs,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        source_path=excluded.source_path,owned_artifact_path=excluded.owned_artifact_path,
        kind=excluded.kind,provenance=excluded.provenance,reusable=excluded.reusable,
        tags_json=excluded.tags_json,width=excluded.width,height=excluded.height,
        duration_ms=excluded.duration_ms,updated_at=excluded.updated_at
    `).run({
      ...asset,
      reusable: asset.reusable ? 1 : 0,
      tags: JSON.stringify(asset.tags)
    });
    return asset;
  }

  getAsset(id: string): Asset {
    const row = this.db.prepare("SELECT * FROM assets WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Asset not found", 404);
    return mapAsset(row);
  }

  listAssets(): Asset[] {
    return (this.db.prepare("SELECT * FROM assets ORDER BY created_at").all() as Row[]).map(mapAsset);
  }

  insertRender(render: Render): Render {
    if (render.outputPath !== null) {
      render = { ...render, outputPath: validateOwnedRelativePath(render.outputPath) };
    }
    if (render.determinism !== null) {
      render = {
        ...render,
        determinism: renderDeterminismSchema.parse(render.determinism)
      };
    }
    this.db.prepare(`
      INSERT INTO renders(
        id,short_id,project_revision,preflight_id,output_path,sidecar_path,encoder_json,validation_json,
        determinism_json,state,
        error_code,error_message,content_hash,decision_hash,lineage_id,previous_render_id,
        attempt,created_at,updated_at
      ) VALUES(@id,@shortId,@projectRevision,@preflightId,@outputPath,@sidecarPath,@encoder,@validation,
        @determinism,@state,
        @errorCode,@errorMessage,@contentHash,@decisionHash,@lineageId,@previousRenderId,
        @attempt,@createdAt,@updatedAt)
    `).run({
      ...render,
      encoder: JSON.stringify(render.encoder),
      validation: render.validation === null ? null : JSON.stringify(render.validation),
      determinism: render.determinism === null ? null : JSON.stringify(render.determinism),
      errorCode: render.error?.code ?? null,
      errorMessage: render.error?.message ?? null
    });
    return render;
  }

  listRenders(shortId?: string): Render[] {
    const rows = shortId
      ? this.db.prepare("SELECT * FROM renders WHERE short_id=? ORDER BY created_at").all(shortId)
      : this.db.prepare("SELECT * FROM renders ORDER BY created_at").all();
    return (rows as Row[]).map(mapRender);
  }

  getRender(id: string): Render {
    const row = this.db.prepare("SELECT * FROM renders WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Render not found", 404);
    return mapRender(row);
  }

  startRenderAttempt(input: {
    shortId: string;
    expectedRevision: number;
    preflightId: string;
    sidecarFormat: "srt" | "webvtt" | null;
  }): { render: Render; job: Job } {
    return this.transaction(() => {
      const project = this.getShort(input.shortId);
      if (project.revision !== input.expectedRevision) {
        throw revisionConflict("Short", input.expectedRevision, project.revision);
      }
      if (!project.approved) {
        throw new AppError("INVALID_STATE", "Approve the Short before rendering", 409);
      }
      const preflight = this.getRenderPreflight(input.preflightId).result;
      if (
        preflight.status !== "passed" ||
        preflight.shortId !== input.shortId ||
        preflight.revision !== input.expectedRevision
      ) {
        throw new AppError(
          "INVALID_STATE",
          "Render preflight must be passing and match the approved Short revision",
          409
        );
      }
      const now = new Date().toISOString();
      const render: Render = {
        id: randomUUID(),
        shortId: input.shortId,
        projectRevision: input.expectedRevision,
        lineageId: "",
        previousRenderId: null,
        attempt: 1,
        preflightId: input.preflightId,
        encoder: {
          ffmpegVersion: preflight.dependencyVersions.ffmpeg!,
          videoCodec: "libx264",
          audioCodec: "aac",
          settings: {
            graphVersion: "ffmpeg-composition-v1",
            width: 1080,
            height: 1920,
            frameRate: 30,
            pixelFormat: "yuv420p",
            crf: 18,
            preset: "medium",
            audioSampleRate: 48_000,
            audioChannels: 2,
            audioBitrate: "192k"
          }
        },
        outputPath: null,
        sidecarPath: null,
        validation: null,
        determinism: null,
        state: "queued",
        error: null,
        contentHash: null,
        decisionHash: preflight.snapshotHash,
        createdAt: now,
        updatedAt: now
      };
      render.lineageId = render.id;
      const job: Job = {
        id: randomUUID(),
        type: "render",
        entityId: input.shortId,
        provider: "local",
        state: "queued",
        progress: 0,
        stage: "queued",
        attempts: 0,
        errorCode: null,
        errorMessage: null,
        cancelRequested: false,
        payloadReference: `render:${render.id}`,
        createdAt: now,
        updatedAt: now
      };
      this.insertRender(render);
      this.insertJob(job, {
        apiVersion: "v1",
        type: "render",
        shortId: input.shortId,
        projectRevision: input.expectedRevision,
        renderId: render.id,
        preflightId: input.preflightId,
        sidecarFormat: input.sidecarFormat
      });
      return { render, job };
    });
  }

  retryRenderAttempt(renderId: string): { render: Render; job: Job } {
    return this.db.transaction(() => {
      const source = this.getRender(renderId);
      const project = this.getShort(source.shortId);
      if (source.state === "stale") {
        throw new AppError(
          "REVISION_CONFLICT",
          "The source Render no longer matches the approved current Short revision",
          409,
          {
            expectedRevision: source.projectRevision,
            actualRevision: project.revision
          }
        );
      }
      if (source.state !== "failed" && source.state !== "cancelled") {
        throw new AppError(
          "INVALID_STATE",
          "Only failed or cancelled Render attempts can be retried",
          409
        );
      }
      if (source.preflightId === null) {
        throw new AppError(
          "INVALID_STATE",
          "This legacy Render is not bound to an immutable preflight and cannot be retried",
          409
        );
      }
      if (project.revision !== source.projectRevision) {
        throw revisionConflict("Short", source.projectRevision, project.revision);
      }
      if (!project.approved) {
        throw new AppError(
          "REVISION_CONFLICT",
          "The source Short revision is no longer approved",
          409,
          { expectedRevision: source.projectRevision, actualRevision: project.revision }
        );
      }
      const lineage = this.db.prepare(`
        SELECT MAX(attempt) AS maximum_attempt,COUNT(*) AS attempt_count
        FROM renders WHERE lineage_id=?
      `).get(source.lineageId) as { maximum_attempt: number; attempt_count: number };
      if (Number(lineage.maximum_attempt) !== source.attempt) {
        throw new AppError(
          "INVALID_STATE",
          "A newer attempt already exists in this Render lineage",
          409
        );
      }
      if (Number(lineage.attempt_count) >= 3 || source.attempt >= 3) {
        throw new AppError(
          "INVALID_STATE",
          "This Render lineage has reached the three-attempt limit",
          409
        );
      }
      const sourceJob = this.db.prepare(`
        SELECT payload_json FROM jobs
        WHERE payload_reference=? AND type='render'
        ORDER BY created_at DESC LIMIT 1
      `).get(`render:${source.id}`) as { payload_json: string } | undefined;
      if (!sourceJob) {
        throw new AppError(
          "INVALID_STATE",
          "The source Render has no persisted job snapshot and cannot be retried",
          409
        );
      }
      const sourcePayload = json<{
        preflightId?: unknown;
        sidecarFormat?: unknown;
        projectRevision?: unknown;
      }>(sourceJob.payload_json);
      if (
        sourcePayload.preflightId !== source.preflightId ||
        sourcePayload.projectRevision !== source.projectRevision ||
        (sourcePayload.sidecarFormat !== null &&
          sourcePayload.sidecarFormat !== "srt" &&
          sourcePayload.sidecarFormat !== "webvtt")
      ) {
        throw new AppError(
          "INVALID_STATE",
          "The persisted Render retry snapshot is invalid",
          409
        );
      }
      const preflight = this.getRenderPreflight(source.preflightId).result;
      if (
        preflight.status !== "passed" ||
        preflight.shortId !== source.shortId ||
        preflight.revision !== source.projectRevision ||
        source.decisionHash !== preflight.snapshotHash
      ) {
        throw new AppError(
          "INVALID_STATE",
          "The immutable Render preflight no longer matches the source attempt",
          409
        );
      }
      const now = new Date().toISOString();
      const render: Render = {
        id: randomUUID(),
        shortId: source.shortId,
        projectRevision: source.projectRevision,
        lineageId: source.lineageId,
        previousRenderId: source.id,
        attempt: source.attempt + 1,
        preflightId: source.preflightId,
        encoder: {
          ffmpegVersion: preflight.dependencyVersions.ffmpeg!,
          videoCodec: "libx264",
          audioCodec: "aac",
          settings: {
            graphVersion: "ffmpeg-composition-v1",
            width: 1080,
            height: 1920,
            frameRate: 30,
            pixelFormat: "yuv420p",
            crf: 18,
            preset: "medium",
            audioSampleRate: 48_000,
            audioChannels: 2,
            audioBitrate: "192k"
          }
        },
        outputPath: null,
        sidecarPath: null,
        validation: null,
        determinism: null,
        state: "queued",
        error: null,
        contentHash: null,
        decisionHash: source.decisionHash,
        createdAt: now,
        updatedAt: now
      };
      const job: Job = {
        id: randomUUID(),
        type: "render",
        entityId: source.shortId,
        provider: "local",
        state: "queued",
        progress: 0,
        stage: "queued",
        attempts: 0,
        errorCode: null,
        errorMessage: null,
        cancelRequested: false,
        payloadReference: `render:${render.id}`,
        createdAt: now,
        updatedAt: now
      };
      this.insertRender(render);
      this.insertJob(job, {
        apiVersion: "v1",
        type: "render",
        shortId: source.shortId,
        projectRevision: source.projectRevision,
        renderId: render.id,
        preflightId: source.preflightId,
        sidecarFormat: sourcePayload.sidecarFormat
      });
      return { render, job };
    }).immediate();
  }

  transitionRender(
    id: string,
    from: Render["state"] | readonly Render["state"][],
    patch: Partial<Pick<
      Render,
      "state" | "outputPath" | "sidecarPath" | "validation" | "error" |
      "contentHash" | "decisionHash" | "encoder" | "determinism"
    >>
  ): Render {
    return this.transaction(() => {
      const current = this.getRender(id);
      const allowed = Array.isArray(from) ? from : [from];
      if (!allowed.includes(current.state)) {
        throw new AppError("INVALID_STATE", "Render state transition is no longer valid", 409);
      }
      const next: Render = {
        ...current,
        ...patch,
        outputPath: patch.outputPath === undefined ? current.outputPath
          : patch.outputPath === null ? null : validateOwnedRelativePath(patch.outputPath),
        sidecarPath: patch.sidecarPath === undefined ? current.sidecarPath
          : patch.sidecarPath === null ? null : validateOwnedRelativePath(patch.sidecarPath),
        updatedAt: new Date().toISOString()
      };
      if (next.determinism !== null) {
        next.determinism = renderDeterminismSchema.parse(next.determinism);
      }
      const result = this.db.prepare(`
        UPDATE renders SET output_path=?,sidecar_path=?,encoder_json=?,validation_json=?,
          determinism_json=?,state=?,error_code=?,error_message=?,content_hash=?,decision_hash=?,updated_at=?
        WHERE id=? AND state=?
      `).run(
        next.outputPath,
        next.sidecarPath,
        JSON.stringify(next.encoder),
        next.validation === null ? null : JSON.stringify(next.validation),
        next.determinism === null ? null : JSON.stringify(next.determinism),
        next.state,
        next.error?.code ?? null,
        next.error?.message ?? null,
        next.contentHash,
        next.decisionHash,
        next.updatedAt,
        id,
        current.state
      );
      if (!result.changes) {
        throw new AppError("INVALID_STATE", "Render state transition lost a concurrent update", 409);
      }
      return next;
    });
  }

  completeRenderAttempt(
    id: string,
    expectedRevision: number,
    patch: Omit<Pick<
      Render,
      "outputPath" | "sidecarPath" | "validation" | "contentHash" | "encoder"
    >, "validation"> & {
      validation: NonNullable<Render["validation"]>;
      determinism: Omit<RenderDeterminism, "comparison" | "referenceRenderId">;
    },
    jobId?: string
  ): Render {
    return this.db.transaction(() => {
      const render = this.getRender(id);
      if (render.state !== "running") {
        throw new AppError("INVALID_STATE", "Render is not running", 409);
      }
      if (jobId) {
        const job = this.db.prepare(`
          SELECT cancel_requested FROM jobs
          WHERE id=? AND payload_reference=?
        `).get(jobId, `render:${id}`) as { cancel_requested: number } | undefined;
        if (!job) {
          throw new AppError("INVALID_STATE", "Render completion is not bound to its Job", 409);
        }
        if (job.cancel_requested === 1) {
          return this.transitionRender(id, "running", {
            state: "cancelled",
            error: { code: "JOB_CANCELLED", message: "Render was cancelled" }
          });
        }
      }
      const project = this.getShort(render.shortId);
      if (project.revision !== expectedRevision || !project.approved) {
        return this.transitionRender(id, "running", {
          state: "stale",
          validation: patch.validation,
          encoder: patch.encoder
        });
      }
      if (!patch.validation.valid) {
        throw new AppError("VALIDATION_ERROR", "Render completion requires passing validation", 422);
      }
      const referenceRow = this.db.prepare(`
        SELECT * FROM renders
        WHERE id<>? AND state='succeeded'
          AND json_extract(determinism_json, '$.identityHash')=?
        ORDER BY
          CASE json_extract(determinism_json, '$.comparison')
            WHEN 'baseline' THEN 0 ELSE 1
          END,
          created_at,
          id
        LIMIT 1
      `).get(id, patch.determinism.identityHash) as Row | undefined;
      const reference = referenceRow ? mapRender(referenceRow) : null;
      const matches = reference === null || (
        reference.determinism !== null &&
        reference.determinism.video.sha256 === patch.determinism.video.sha256 &&
        reference.determinism.video.byteCount === patch.determinism.video.byteCount &&
        reference.determinism.audio.sha256 === patch.determinism.audio.sha256 &&
        reference.determinism.audio.byteCount === patch.determinism.audio.byteCount
      );
      const determinism = renderDeterminismSchema.parse({
        ...patch.determinism,
        comparison: reference === null ? "baseline" : matches ? "matched" : "mismatch",
        referenceRenderId: reference?.id ?? null
      });
      if (!matches) {
        return this.transitionRender(id, "running", {
          outputPath: null,
          sidecarPath: null,
          validation: patch.validation,
          determinism,
          contentHash: null,
          encoder: patch.encoder,
          state: "failed",
          error: {
            code: "ARTIFACT_CORRUPT",
            message: "Normalized render content does not match the established baseline"
          }
        });
      }
      return this.transitionRender(id, "running", {
        ...patch,
        determinism,
        state: "succeeded",
        error: null
      });
    }).immediate();
  }

  insertRenderPreflight(
    expectedRevision: number,
    snapshot: unknown,
    result: RenderPreflightResult
  ): RenderPreflightResult {
    return this.transaction(() => {
      const current = this.db.prepare(
        "SELECT revision FROM short_projects WHERE id=?"
      ).get(result.shortId) as { revision: number } | undefined;
      if (!current) throw new AppError("NOT_FOUND", "Short not found", 404);
      if (current.revision !== expectedRevision) {
        throw revisionConflict("Short", expectedRevision, current.revision);
      }
      const parsed = renderPreflightResultSchema.parse(result);
      if (parsed.revision !== expectedRevision) {
        throw new AppError("VALIDATION_ERROR", "Render preflight revision does not match", 422);
      }
      const snapshotHash = `sha256:${createHash("sha256")
        .update(canonicalJson(snapshot))
        .digest("hex")}`;
      if (parsed.snapshotHash !== snapshotHash) {
        throw new AppError("VALIDATION_ERROR", "Render preflight snapshot hash does not match", 422);
      }
      this.db.prepare(`
        INSERT INTO render_preflights(
          id,short_id,project_revision,snapshot_json,snapshot_hash,result_json,created_at
        ) VALUES(?,?,?,?,?,?,?)
      `).run(
        parsed.id,
        parsed.shortId,
        parsed.revision,
        JSON.stringify(snapshot),
        parsed.snapshotHash,
        JSON.stringify(parsed),
        parsed.createdAt
      );
      return parsed;
    });
  }

  getRenderPreflight(id: string): StoredRenderPreflight {
    const row = this.db.prepare(
      "SELECT snapshot_json,result_json FROM render_preflights WHERE id=?"
    ).get(id) as Row | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Render preflight not found", 404);
    return {
      snapshot: json<unknown>(row.snapshot_json),
      result: renderPreflightResultSchema.parse(json<unknown>(row.result_json))
    };
  }

  listRenderPreflights(shortId?: string): RenderPreflightResult[] {
    const rows = shortId
      ? this.db.prepare(`
          SELECT result_json FROM render_preflights
          WHERE short_id=? ORDER BY created_at,id
        `).all(shortId)
      : this.db.prepare(
          "SELECT result_json FROM render_preflights ORDER BY created_at,id"
        ).all();
    return (rows as Row[]).map((row) =>
      renderPreflightResultSchema.parse(json<unknown>(row.result_json))
    );
  }

  createScheduleRuleSet(ruleSet: ScheduleRuleSet): ScheduleRuleSet {
    this.db.prepare(`
      INSERT INTO schedule_rule_sets(
        id,revision,start_date,timezone,allowed_weekdays_json,times_json,max_per_day,
        blackout_dates_json,minimum_same_episode_spacing_hours,created_at,updated_at
      ) VALUES(@id,@revision,@startDate,@timezone,@allowedWeekdays,@times,@maxPerDay,
        @blackoutDates,@minimumSameEpisodeSpacingHours,@createdAt,@updatedAt)
    `).run(serializeScheduleRuleSet(ruleSet));
    return ruleSet;
  }

  getScheduleRuleSet(id: string): ScheduleRuleSet {
    const row = this.db.prepare("SELECT * FROM schedule_rule_sets WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Schedule rule set not found", 404);
    return mapScheduleRuleSet(row);
  }

  updateScheduleRuleSet(
    id: string,
    expectedRevision: number,
    patch: Partial<Omit<ScheduleRuleSet, "id" | "revision" | "createdAt" | "updatedAt">>
  ): ScheduleRuleSet {
    return this.transaction(() => {
      const current = this.getScheduleRuleSet(id);
      if (current.revision !== expectedRevision) {
        throw revisionConflict("Schedule rule set", expectedRevision, current.revision);
      }
      const next = {
        ...current,
        ...patch,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString()
      };
      const values = serializeScheduleRuleSet(next);
      const result = this.db.prepare(`
        UPDATE schedule_rule_sets SET revision=@revision,start_date=@startDate,
          timezone=@timezone,allowed_weekdays_json=@allowedWeekdays,times_json=@times,
          max_per_day=@maxPerDay,blackout_dates_json=@blackoutDates,
          minimum_same_episode_spacing_hours=@minimumSameEpisodeSpacingHours,
          updated_at=@updatedAt WHERE id=@id AND revision=@expectedRevision
      `).run({ ...values, expectedRevision });
      if (!result.changes) {
        throw revisionConflict("Schedule rule set", expectedRevision, current.revision);
      }
      return next;
    });
  }

  insertScheduleEntry(entry: ScheduleEntry): ScheduleEntry {
    this.db.prepare(`
      INSERT INTO schedule_entries(
        id,short_id,render_id,episode_id,publish_at,timezone,status,priority,rationale,
        locked,youtube_url,needs_rerender,revision,created_at,updated_at
      ) VALUES(@id,@shortId,@renderId,@episodeId,@publishAt,@timezone,@status,@priority,
        @rationale,@locked,@youtubeUrl,@needsRerender,@revision,@createdAt,@updatedAt)
    `).run({
      ...entry,
      locked: entry.locked ? 1 : 0,
      needsRerender: entry.needsRerender ? 1 : 0
    });
    return entry;
  }

  getScheduleEntry(id: string): ScheduleEntry {
    const row = this.db.prepare("SELECT * FROM schedule_entries WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Schedule entry not found", 404);
    return mapScheduleEntry(row);
  }

  updateScheduleEntry(
    id: string,
    expectedRevision: number,
    patch: Pick<Partial<ScheduleEntry>, "publishAt" | "status" | "priority" | "rationale" | "youtubeUrl">
  ): ScheduleEntry {
    return this.transaction(() => {
      const current = this.getScheduleEntry(id);
      if (current.revision !== expectedRevision) {
        throw revisionConflict("Schedule entry", expectedRevision, current.revision);
      }
      if (current.locked) throw new AppError("INVALID_STATE", "Published schedule entries are locked", 409);
      if (patch.status === "published" && current.needsRerender) {
        throw new AppError("INVALID_STATE", "A stale render cannot be published", 409);
      }
      const nextStatus = patch.status ?? current.status;
      const next = {
        ...current,
        ...patch,
        status: nextStatus,
        locked: nextStatus === "published",
        revision: current.revision + 1,
        updatedAt: new Date().toISOString()
      };
      try {
        const result = this.db.prepare(`
          UPDATE schedule_entries SET publish_at=?,status=?,priority=?,rationale=?,
            youtube_url=?,locked=?,revision=?,updated_at=?
          WHERE id=? AND revision=? AND locked=0
        `).run(
          next.publishAt, next.status, next.priority, next.rationale, next.youtubeUrl,
          next.locked ? 1 : 0, next.revision, next.updatedAt, id, expectedRevision
        );
        if (!result.changes) throw revisionConflict("Schedule entry", expectedRevision, current.revision);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError("SCHEDULE_COLLISION", "Another entry already occupies that instant", 409);
      }
      return next;
    });
  }

  saveArtifactRecord(artifact: StoredArtifact): StoredArtifact {
    artifact = { ...artifact, relativePath: validateOwnedRelativePath(artifact.relativePath) };
    this.db.prepare(`
      INSERT INTO artifact_records(
        id,kind,owner_type,owner_id,owner_revision,relative_path,content_hash,
        byte_length,producer_version,state,created_at
      ) VALUES(@id,@kind,@ownerType,@ownerId,@ownerRevision,@relativePath,@contentHash,
        @byteLength,@producerVersion,@state,@createdAt)
    `).run(artifact);
    return artifact;
  }

  listArtifactRecords(ownerId?: string): StoredArtifact[] {
    const rows = ownerId
      ? this.db.prepare(
        "SELECT * FROM artifact_records WHERE owner_id=? ORDER BY created_at,rowid"
      ).all(ownerId)
      : this.db.prepare("SELECT * FROM artifact_records ORDER BY created_at,rowid").all();
    return (rows as Row[]).map(mapStoredArtifact);
  }

  markArtifactCorrupt(id: string): void {
    this.db.prepare(
      "UPDATE artifact_records SET state='corrupt' WHERE id=? AND state IN ('temporary','complete')"
    ).run(id);
  }

  deleteArtifactRecord(id: string): void {
    this.db.prepare("DELETE FROM artifact_records WHERE id=?").run(id);
  }

  grantCloudAuthorization(authorization: CloudAuthorization): CloudAuthorization {
    this.db.prepare(`
      INSERT INTO cloud_authorizations(
        id,scope_type,scope_id,provider,operation_classes_json,credential_handle,
        granted_at,revoked_at
      ) VALUES(@id,@scopeType,@scopeId,@provider,@operationClasses,@credentialHandle,
        @grantedAt,@revokedAt)
      ON CONFLICT(scope_type,scope_id,provider) DO UPDATE SET
        id=excluded.id,operation_classes_json=excluded.operation_classes_json,
        credential_handle=excluded.credential_handle,granted_at=excluded.granted_at,
        revoked_at=excluded.revoked_at
    `).run({ ...authorization, operationClasses: JSON.stringify(authorization.operationClasses) });
    return authorization;
  }

  revokeCloudAuthorization(id: string, revokedAt = new Date().toISOString()): void {
    const result = this.db.prepare(`
      UPDATE cloud_authorizations SET revoked_at=? WHERE id=? AND revoked_at IS NULL
    `).run(revokedAt, id);
    if (!result.changes) throw new AppError("NOT_FOUND", "Active cloud authorization not found", 404);
  }

  hasCloudAuthorization(
    scopeType: CloudAuthorization["scopeType"],
    scopeId: string,
    provider: string,
    operationClass: string
  ): boolean {
    return Boolean(this.findCloudAuthorization(scopeType, scopeId, provider, operationClass));
  }

  findCloudAuthorization(
    scopeType: CloudAuthorization["scopeType"],
    scopeId: string,
    provider: string,
    operationClass: string
  ): CloudAuthorization | undefined {
    const row = this.db.prepare(`
      SELECT * FROM cloud_authorizations
      WHERE scope_type=? AND scope_id=? AND provider=? AND revoked_at IS NULL
    `).get(scopeType, scopeId, provider) as Row | undefined;
    if (!row) return undefined;
    const authorization = mapCloudAuthorization(row);
    return authorization.operationClasses.includes(operationClass) ? authorization : undefined;
  }

  revokeCloudAuthorizationsForCredential(
    credentialHandle: string,
    revokedAt = new Date().toISOString()
  ): number {
    return this.db.prepare(`
      UPDATE cloud_authorizations SET revoked_at=?
      WHERE credential_handle=? AND revoked_at IS NULL
    `).run(revokedAt, credentialHandle).changes;
  }

  listCloudAuthorizations(scopeId?: string): CloudAuthorization[] {
    const rows = scopeId
      ? this.db.prepare(
        "SELECT * FROM cloud_authorizations WHERE scope_id=? ORDER BY granted_at"
      ).all(scopeId)
      : this.db.prepare("SELECT * FROM cloud_authorizations ORDER BY granted_at").all();
    return (rows as Row[]).map(mapCloudAuthorization);
  }

  insertJob(job: Job, payload: unknown): void {
    this.db.prepare(`
      INSERT INTO jobs(id,type,entity_id,state,progress,stage,payload_json,attempts,
        error_code,error_message,cancel_requested,created_at,updated_at,provider,payload_reference)
      VALUES(@id,@type,@entityId,@state,@progress,@stage,@payload,@attempts,
        @errorCode,@errorMessage,@cancelRequested,@createdAt,@updatedAt,@provider,@payloadReference)
    `).run({
      ...job,
      cancelRequested: job.cancelRequested ? 1 : 0,
      payload: JSON.stringify(payload)
    });
  }

  listJobs(): Job[] {
    return (this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all() as Row[]).map(mapJob);
  }

  reconcileRenderArtifacts(): number {
    const now = new Date().toISOString();
    return this.transaction(() => {
      const changed = this.db.prepare(`
        UPDATE renders
        SET state='failed',error_code='ARTIFACT_CORRUPT',
          error_message='The completed Render artifact is missing or corrupt; manual retry is required',
          updated_at=?
        WHERE state='succeeded' AND (
          output_path IS NULL OR NOT EXISTS (
            SELECT 1 FROM artifact_records a
            WHERE a.owner_type='render' AND a.owner_id=renders.id
              AND a.kind='render' AND a.relative_path=renders.output_path
              AND a.state='complete'
          )
          OR (
            sidecar_path IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM artifact_records a
              WHERE a.owner_type='render' AND a.owner_id=renders.id
                AND a.relative_path=renders.sidecar_path
                AND a.state='complete'
            )
          )
        )
      `).run(now).changes;
      if (changed) {
        this.db.prepare(`
          UPDATE schedule_entries SET needs_rerender=1,updated_at=?
          WHERE status<>'published' AND render_id IN (
            SELECT id FROM renders
            WHERE state='failed' AND error_code='ARTIFACT_CORRUPT'
              AND error_message='The completed Render artifact is missing or corrupt; manual retry is required'
          )
        `).run(now);
      }
      return changed;
    });
  }

  recoverJobs(): number {
    const now = new Date().toISOString();
    return this.transaction(() => {
      let renderChanges = 0;
      const renderJobs = this.db.prepare(`
        SELECT j.id AS job_id,j.state AS job_state,j.cancel_requested,j.attempts,
          j.payload_reference,r.id AS render_id,r.state AS render_state,
          r.error_code AS render_error_code,r.error_message AS render_error_message
        FROM jobs j
        LEFT JOIN renders r
          ON j.payload_reference='render:' || r.id
        WHERE j.type='render' AND j.state IN ('queued','running')
      `).all() as Array<{
        job_id: string;
        job_state: Job["state"];
        cancel_requested: number;
        attempts: number;
        payload_reference: string | null;
        render_id: string | null;
        render_state: Render["state"] | null;
        render_error_code: NonNullable<Render["error"]>["code"] | null;
        render_error_message: string | null;
      }>;
      for (const pair of renderJobs) {
        if (!pair.render_id || !pair.render_state) {
          renderChanges += this.db.prepare(`
            UPDATE jobs SET state='failed',stage='recovery_required',
              error_code='INTERNAL_ERROR',
              error_message='Interrupted work is not safe to retry automatically',
              updated_at=? WHERE id=?
          `).run(now, pair.job_id).changes;
          continue;
        }
        if (pair.cancel_requested === 1 || pair.job_state === "cancelled") {
          renderChanges += this.db.prepare(`
            UPDATE renders SET state='cancelled',error_code='JOB_CANCELLED',
              error_message='Cancellation was recovered after restart',updated_at=?
            WHERE id=? AND state IN ('queued','running')
          `).run(now, pair.render_id).changes;
          renderChanges += this.db.prepare(`
            UPDATE jobs SET state='cancelled',stage='cancelled',
              error_code='JOB_CANCELLED',
              error_message='Cancellation was recovered after restart',updated_at=?
            WHERE id=? AND state IN ('queued','running')
          `).run(now, pair.job_id).changes;
          continue;
        }
        if (pair.render_state === "succeeded") {
          renderChanges += this.db.prepare(`
            UPDATE jobs SET state='succeeded',progress=1,stage='complete',
              error_code=NULL,error_message=NULL,updated_at=?
            WHERE id=? AND state IN ('queued','running')
          `).run(now, pair.job_id).changes;
          continue;
        }
        if (
          pair.render_state === "failed" ||
          pair.render_state === "cancelled" ||
          pair.render_state === "stale"
        ) {
          const cancelled = pair.render_state === "cancelled";
          renderChanges += this.db.prepare(`
            UPDATE jobs SET state=?,stage=?,
              error_code=?,error_message=?,updated_at=?
            WHERE id=? AND state IN ('queued','running')
          `).run(
            cancelled ? "cancelled" : "failed",
            cancelled ? "cancelled" : "failed",
            cancelled ? "JOB_CANCELLED"
              : pair.render_state === "stale"
                ? "REVISION_CONFLICT"
                : pair.render_error_code ?? "INTERNAL_ERROR",
            cancelled ? "Render cancellation was recovered after restart"
              : pair.render_state === "stale"
                ? "Render became stale before its Job completed"
                : pair.render_error_message ?? "Render failure was recovered after restart",
            now,
            pair.job_id
          ).changes;
          continue;
        }
        if (pair.render_state === "queued" && pair.job_state === "running") {
          if (pair.attempts < 3) {
            renderChanges += this.db.prepare(`
              UPDATE jobs SET state='queued',stage='recovered',
                error_code=NULL,error_message=NULL,updated_at=? WHERE id=? AND state='running'
            `).run(now, pair.job_id).changes;
          } else {
            this.db.prepare(`
              UPDATE renders SET state='failed',error_code='INTERNAL_ERROR',
                error_message='Rendering was repeatedly interrupted before start; manual retry is required',
                updated_at=? WHERE id=? AND state='queued'
            `).run(now, pair.render_id);
            renderChanges += this.db.prepare(`
              UPDATE jobs SET state='failed',stage='recovery_required',
                error_code='INTERNAL_ERROR',
                error_message='Rendering was repeatedly interrupted before start; manual retry is required',
                updated_at=? WHERE id=? AND state='running'
            `).run(now, pair.job_id).changes;
          }
          continue;
        }
        if (pair.render_state === "running") {
          renderChanges += this.db.prepare(`
            UPDATE renders SET state='failed',output_path=NULL,sidecar_path=NULL,
              content_hash=NULL,error_code='INTERNAL_ERROR',
              error_message='Rendering was interrupted; manual retry is required',
              updated_at=? WHERE id=? AND state='running'
          `).run(now, pair.render_id).changes;
          renderChanges += this.db.prepare(`
            UPDATE jobs SET state='failed',stage='recovery_required',
              error_code='INTERNAL_ERROR',
              error_message='Rendering was interrupted; manual retry is required',
              updated_at=? WHERE id=? AND state IN ('queued','running')
          `).run(now, pair.job_id).changes;
        }
      }
      const queuedCancelMismatches = this.db.prepare(`
        UPDATE renders SET state='cancelled',error_code='JOB_CANCELLED',
          error_message='Queued cancellation was repaired after restart',updated_at=?
        WHERE state='queued' AND id IN (
          SELECT substr(payload_reference,8) FROM jobs
          WHERE type='render' AND state='cancelled' AND cancel_requested=1
            AND payload_reference LIKE 'render:%'
        )
      `).run(now).changes;
      const cancelled = this.db.prepare(`
        UPDATE jobs SET state='cancelled',stage='cancelled',error_code='JOB_CANCELLED',
          error_message='Cancellation was recovered after restart',updated_at=?
        WHERE type<>'render' AND state='running' AND cancel_requested=1
      `).run(now).changes;
      const retried = this.db.prepare(`
        UPDATE jobs SET state='queued',stage='recovered',error_code=NULL,error_message=NULL,updated_at=?
        WHERE type<>'render' AND state='running' AND cancel_requested=0 AND attempts < 3
          AND (
            type IN ('probe','hash','candidates','watched_folder_scan','source_reconcile')
            OR (type='analyze' AND provider='local')
          )
      `).run(now).changes;
      const failed = this.db.prepare(`
        UPDATE jobs SET state='failed',stage='recovery_required',
          error_code='INTERNAL_ERROR',
          error_message='Interrupted work is not safe to retry automatically',updated_at=?
        WHERE type<>'render' AND state='running' AND cancel_requested=0
      `).run(now).changes;
      return Number(renderChanges + queuedCancelMismatches + cancelled + retried + failed);
    });
  }
}

function mapEpisode(row: Row): Episode {
  return {
    id: String(row.id), sourcePath: String(row.source_path), canonicalPath: String(row.canonical_path),
    fingerprint: String(row.fingerprint), contentHash: row.content_hash === null ? null : String(row.content_hash),
    fileSize: Number(row.file_size), modifiedAtMs: Number(row.modified_at_ms),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    width: row.width == null ? null : Number(row.width), height: row.height == null ? null : Number(row.height),
    videoCodec: row.video_codec == null ? null : String(row.video_codec),
    audioCodec: row.audio_codec == null ? null : String(row.audio_codec),
    status: row.status as Episode["status"], missing: bool(row.missing),
    relinkRestoreStatus: row.relink_restore_status == null
      ? null
      : row.relink_restore_status as Episode["relinkRestoreStatus"],
    candidateCount: Number(row.candidate_count ?? 0),
    renderedShortCount: Number(row.rendered_short_count ?? 0),
    scheduledCount: Number(row.scheduled_count ?? 0),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function mapCandidate(row: Row): ClipCandidate {
  return {
    id: String(row.id), episodeId: String(row.episode_id), startMs: Number(row.start_ms),
    endMs: Number(row.end_ms), transcript: String(row.transcript), topic: String(row.topic),
    hook: String(row.hook), reason: String(row.reason), score: Number(row.score),
    scores: JSON.parse(String(row.scores_json)), duplicateGroup: row.duplicate_group ? String(row.duplicate_group) : null,
    reviewStatus: row.review_status as ClipCandidate["reviewStatus"],
    generationProvenance: {
      artifactId: row.generation_artifact_id ? String(row.generation_artifact_id) : null,
      transcriptRevision: Number(row.transcript_revision),
      generationVersion: String(row.generation_version),
      provider: row.provider_provenance_json
        ? json<ClipCandidate["generationProvenance"]["provider"]>(row.provider_provenance_json)
        : null
    },
    generationRunId: row.generation_run_id ? String(row.generation_run_id) : null,
    revision: Number(row.revision),
    state: row.state as ClipCandidate["state"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapShort(row: Row): ShortProject {
  return {
    id: String(row.id), episodeId: String(row.episode_id),
    candidateId: row.candidate_id ? String(row.candidate_id) : null, title: String(row.title),
    sourceRanges: JSON.parse(String(row.source_ranges_json)), templateId: String(row.template_id),
    templateLineage: {
      templateId: String(row.template_id),
      ...json<Omit<ShortProject["templateLineage"], "templateId">>(row.template_lineage_json)
    },
    composition: JSON.parse(String(row.composition_json)),
    captions: json<ShortProject["captions"]>(row.captions_json),
    audio: json<ShortProject["audio"]>(row.audio_json),
    copy: JSON.parse(String(row.copy_json)),
    copyState: row.copy_state as ShortProject["copyState"],
    copySource: row.copy_source as ShortProject["copySource"],
    approved: bool(row.approved), revision: Number(row.revision),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function normalizedContentPackageIdentity(content: ContentPackage): ContentPackage {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
  return {
    cleanedTranscript: normalize(content.cleanedTranscript),
    rewrite: normalize(content.rewrite),
    hookVariants: content.hookVariants.map(normalize),
    titles: content.titles.map(normalize),
    description: normalize(content.description),
    hashtags: content.hashtags.map(normalize),
    thumbnailText: normalize(content.thumbnailText)
  };
}

function mapJob(row: Row): Job {
  return {
    id: String(row.id), type: row.type as Job["type"], entityId: row.entity_id ? String(row.entity_id) : null,
    provider: row.provider ? String(row.provider) : null,
    state: row.state as Job["state"], progress: Number(row.progress), stage: String(row.stage),
    attempts: Number(row.attempts), errorCode: row.error_code ? String(row.error_code) as Job["errorCode"] : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    cancelRequested: bool(row.cancel_requested),
    payloadReference: row.payload_reference ? String(row.payload_reference) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function mapWatchedFolder(row: Row): WatchedFolder {
  return {
    id: String(row.id),
    canonicalPath: String(row.canonical_path),
    enabled: bool(row.enabled),
    recursive: bool(row.recursive),
    includePatterns: json<string[]>(row.include_patterns_json),
    lastScanStatus: row.last_scan_status as WatchedFolder["lastScanStatus"],
    lastScannedAt: row.last_scanned_at ? String(row.last_scanned_at) : null,
    lastScanError: row.last_scan_error ? String(row.last_scan_error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapRelinkComparison(row: Row): RelinkComparison {
  return {
    id: String(row.id),
    episodeId: String(row.episode_id),
    tokenHash: String(row.token_hash),
    candidatePath: String(row.candidate_path),
    canonicalPath: String(row.canonical_path),
    fingerprint: String(row.fingerprint),
    contentHash: String(row.content_hash),
    fileSize: Number(row.file_size),
    modifiedAtMs: Number(row.modified_at_ms),
    probe: json<RelinkComparison["probe"]>(row.probe_json),
    expiresAt: String(row.expires_at),
    consumedAt: row.consumed_at ? String(row.consumed_at) : null,
    createdAt: String(row.created_at)
  };
}

function mapTranscriptRevision(row: Row): TranscriptRevision {
  return {
    id: String(row.id),
    episodeId: String(row.episode_id),
    revision: Number(row.revision),
    language: String(row.language),
    segments: json<TranscriptSegment[]>(row.segments_json),
    provenance: json<TranscriptRevision["provenance"]>(row.provenance_json),
    acceptedState: row.accepted_state as TranscriptRevision["acceptedState"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapAnalysisArtifact(row: Row): AnalysisArtifact {
  return {
    id: String(row.id),
    entityId: String(row.entity_id),
    ownerType: row.owner_type as AnalysisArtifact["ownerType"],
    kind: row.kind as AnalysisArtifact["kind"],
    state: row.state as AnalysisArtifact["state"],
    provenance: json<AnalysisArtifact["provenance"]>(row.provenance_json),
    inputHash: String(row.input_hash),
    rawOutput: json<unknown>(row.raw_output_json),
    acceptedProjection: row.accepted_projection_json === null
      ? null
      : json<unknown>(row.accepted_projection_json),
    createdAt: String(row.created_at)
  };
}

function mapTemplate(row: Row): Template {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    version: Number(row.version),
    revision: Number(row.revision),
    parentTemplateId: row.parent_template_id ? String(row.parent_template_id) : null,
    builtIn: bool(row.built_in),
    composition: json<Composition>(row.composition_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapAsset(row: Row): Asset {
  return {
    id: String(row.id),
    sourcePath: row.source_path ? String(row.source_path) : null,
    ownedArtifactPath: row.owned_artifact_path ? String(row.owned_artifact_path) : null,
    kind: row.kind as Asset["kind"],
    provenance: String(row.provenance),
    reusable: bool(row.reusable),
    tags: json<string[]>(row.tags_json),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapRender(row: Row): Render {
  return {
    id: String(row.id),
    shortId: String(row.short_id),
    projectRevision: Number(row.project_revision),
    lineageId: String(row.lineage_id),
    previousRenderId: row.previous_render_id ? String(row.previous_render_id) : null,
    attempt: Number(row.attempt),
    preflightId: row.preflight_id ? String(row.preflight_id) : null,
    encoder: json<Render["encoder"]>(row.encoder_json),
    outputPath: row.output_path ? String(row.output_path) : null,
    sidecarPath: row.sidecar_path ? String(row.sidecar_path) : null,
    validation: row.validation_json ? json<Render["validation"]>(row.validation_json) : null,
    determinism: row.determinism_json
      ? renderDeterminismSchema.parse(json<unknown>(row.determinism_json))
      : null,
    state: row.state as Render["state"],
    error: row.error_code
      ? { code: row.error_code as NonNullable<Render["error"]>["code"], message: String(row.error_message) }
      : null,
    contentHash: row.content_hash ? String(row.content_hash) : null,
    decisionHash: row.decision_hash ? String(row.decision_hash) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function serializeScheduleRuleSet(ruleSet: ScheduleRuleSet): Record<string, unknown> {
  return {
    ...ruleSet,
    allowedWeekdays: JSON.stringify(ruleSet.allowedWeekdays),
    times: JSON.stringify(ruleSet.times),
    blackoutDates: JSON.stringify(ruleSet.blackoutDates)
  };
}

function mapScheduleRuleSet(row: Row): ScheduleRuleSet {
  return {
    id: String(row.id),
    revision: Number(row.revision),
    startDate: String(row.start_date),
    timezone: String(row.timezone),
    allowedWeekdays: json<number[]>(row.allowed_weekdays_json),
    times: json<string[]>(row.times_json),
    maxPerDay: Number(row.max_per_day),
    blackoutDates: json<string[]>(row.blackout_dates_json),
    minimumSameEpisodeSpacingHours: Number(row.minimum_same_episode_spacing_hours),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapScheduleEntry(row: Row): ScheduleEntry {
  return {
    id: String(row.id),
    shortId: String(row.short_id),
    renderId: String(row.render_id),
    episodeId: String(row.episode_id),
    publishAt: String(row.publish_at),
    timezone: String(row.timezone),
    status: row.status as ScheduleEntry["status"],
    priority: Number(row.priority),
    rationale: String(row.rationale),
    locked: bool(row.locked),
    youtubeUrl: row.youtube_url ? String(row.youtube_url) : null,
    needsRerender: bool(row.needs_rerender),
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapStoredArtifact(row: Row): StoredArtifact {
  return {
    id: String(row.id),
    kind: String(row.kind),
    ownerType: String(row.owner_type),
    ownerId: String(row.owner_id),
    ownerRevision: row.owner_revision == null ? null : Number(row.owner_revision),
    relativePath: String(row.relative_path),
    contentHash: String(row.content_hash),
    byteLength: Number(row.byte_length),
    producerVersion: String(row.producer_version),
    state: row.state as StoredArtifact["state"],
    createdAt: String(row.created_at)
  };
}

function mapCloudAuthorization(row: Row): CloudAuthorization {
  return {
    id: String(row.id),
    scopeType: row.scope_type as CloudAuthorization["scopeType"],
    scopeId: String(row.scope_id),
    provider: String(row.provider),
    operationClasses: json<string[]>(row.operation_classes_json),
    credentialHandle: row.credential_handle ? String(row.credential_handle) : null,
    grantedAt: String(row.granted_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null
  };
}

function revisionConflict(entity: string, expectedRevision: number, actualRevision: number): AppError {
  return new AppError("REVISION_CONFLICT", `${entity} was edited by another client`, 409, {
    expectedRevision,
    actualRevision
  });
}

function assertSourceAvailable(episode: Episode): void {
  if (episode.missing || episode.status === "source_missing") {
    throw new AppError("SOURCE_MISSING", "Episode source media is unavailable", 409, {
      episodeId: episode.id
    });
  }
}

function validateSourceRanges(
  sourceRanges: ShortProject["sourceRanges"],
  durationMs: number | null
): void {
  if (durationMs === null) {
    throw new AppError("INVALID_STATE", "Episode duration is unknown", 409);
  }
  const parsed = sourceRangesSchema.safeParse(sourceRanges);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid Short source ranges", 422, parsed.error.issues);
  }
  const outside = parsed.data.findIndex((range) => range.endMs > durationMs);
  if (outside !== -1) {
    throw new AppError("VALIDATION_ERROR", "Short source range exceeds Episode duration", 422, [{
      path: ["sourceRanges", outside, "endMs"],
      message: "Range must be within the Episode duration"
    }]);
  }
}

function outputDuration(sourceRanges: ShortProject["sourceRanges"]): number {
  return sourceRanges.reduce((total, range) => total + range.endMs - range.startMs, 0);
}

function validateCompositionCropTimes(composition: Composition, durationMs: number): void {
  composition.layers.forEach((layer, layerIndex) => {
    if (layer.type !== "video") return;
    const tracks = [
      ["automaticCropTrack", layer.automaticCropTrack.frames] as const,
      ["manualCropTrack", layer.manualCropTrack] as const
    ];
    for (const [trackName, controls] of tracks) {
      controls.forEach((control, controlIndex) => {
        if (control.atMs > durationMs) {
          throw new AppError("VALIDATION_ERROR", "Crop timestamp exceeds the Short output duration", 422, [{
            path: ["composition", "layers", layerIndex, trackName, controlIndex, "atMs"],
            message: `Crop timestamp must be at most ${durationMs}`
          }]);
        }
      });
    }
  });
}
