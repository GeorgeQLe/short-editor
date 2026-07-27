import type { SqliteDatabase } from "./database.js";
import type {
  ClipCandidate, Composition, Episode, Job, ShortProject, TranscriptSegment
} from "../shared/domain.js";
import { AppError } from "../shared/errors.js";

type Row = Record<string, unknown>;
const bool = (value: unknown) => value === 1;

export class Repository {
  constructor(readonly db: SqliteDatabase) {}

  listEpisodes(search?: string): Episode[] {
    const wildcard = `%${search ?? ""}%`;
    const rows = this.db.prepare(`
      SELECT e.*,
        (SELECT COUNT(*) FROM candidates c WHERE c.episode_id=e.id) candidate_count,
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
        (SELECT COUNT(*) FROM candidates c WHERE c.episode_id=e.id) candidate_count,
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

  findEpisodeByFingerprint(fingerprint: string): Episode | undefined {
    const row = this.db.prepare("SELECT * FROM episodes WHERE fingerprint=? LIMIT 1").get(fingerprint) as Row | undefined;
    return row ? mapEpisode({ ...row, candidate_count: 0, rendered_short_count: 0, scheduled_count: 0 }) : undefined;
  }

  insertEpisode(input: Omit<Episode, "candidateCount" | "renderedShortCount" | "scheduledCount">): Episode {
    this.db.prepare(`
      INSERT INTO episodes(
        id,source_path,canonical_path,fingerprint,content_hash,file_size,modified_at_ms,
        duration_ms,width,height,video_codec,audio_codec,status,missing,created_at,updated_at
      ) VALUES(@id,@sourcePath,@canonicalPath,@fingerprint,@contentHash,@fileSize,@modifiedAtMs,
        @durationMs,@width,@height,@videoCodec,@audioCodec,@status,@missing,@createdAt,@updatedAt)
    `).run({ ...input, missing: input.missing ? 1 : 0 });
    return this.getEpisode(input.id);
  }

  updateEpisodeMedia(id: string, media: Partial<Pick<Episode,
    "contentHash" | "durationMs" | "width" | "height" | "videoCodec" | "audioCodec" | "status" | "missing">>): void {
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

  replaceTranscript(episodeId: string, segments: TranscriptSegment[]): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM transcript_segments WHERE episode_id=?").run(episodeId);
      const insert = this.db.prepare(`
        INSERT INTO transcript_segments(id,episode_id,start_ms,end_ms,text,words_json,speaker,confidence)
        VALUES(@id,@episodeId,@startMs,@endMs,@text,@words,@speaker,@confidence)
      `);
      for (const segment of segments) insert.run({
        ...segment, episodeId, words: JSON.stringify(segment.words)
      });
    })();
  }

  getTranscript(episodeId: string): TranscriptSegment[] {
    return (this.db.prepare(
      "SELECT * FROM transcript_segments WHERE episode_id=? ORDER BY start_ms"
    ).all(episodeId) as Row[]).map((row) => ({
      id: String(row.id), startMs: Number(row.start_ms), endMs: Number(row.end_ms),
      text: String(row.text), words: JSON.parse(String(row.words_json)),
      speaker: row.speaker === null ? null : String(row.speaker),
      confidence: row.confidence === null ? null : Number(row.confidence)
    }));
  }

  replaceCandidates(episodeId: string, candidates: ClipCandidate[]): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM candidates WHERE episode_id=? AND review_status='pending'").run(episodeId);
      const insert = this.db.prepare(`
        INSERT INTO candidates(id,episode_id,start_ms,end_ms,transcript,topic,hook,reason,
          score,scores_json,duplicate_group,review_status,created_at)
        VALUES(@id,@episodeId,@startMs,@endMs,@transcript,@topic,@hook,@reason,
          @score,@scores,@duplicateGroup,@reviewStatus,@createdAt)
      `);
      candidates.forEach((candidate) => insert.run({
        ...candidate, scores: JSON.stringify(candidate.scores)
      }));
    })();
  }

  listCandidates(episodeId: string): ClipCandidate[] {
    return (this.db.prepare(
      "SELECT * FROM candidates WHERE episode_id=? ORDER BY score DESC"
    ).all(episodeId) as Row[]).map(mapCandidate);
  }

  getCandidate(id: string): ClipCandidate {
    const row = this.db.prepare("SELECT * FROM candidates WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Candidate not found", 404);
    return mapCandidate(row);
  }

  reviewCandidate(id: string, status: "approved" | "rejected"): ClipCandidate {
    const info = this.db.prepare("UPDATE candidates SET review_status=? WHERE id=?").run(status, id);
    if (!info.changes) throw new AppError("NOT_FOUND", "Candidate not found", 404);
    return this.getCandidate(id);
  }

  createShort(project: ShortProject): ShortProject {
    this.db.prepare(`
      INSERT INTO short_projects(id,episode_id,candidate_id,title,source_ranges_json,
        template_id,composition_json,copy_json,approved,revision,created_at,updated_at)
      VALUES(@id,@episodeId,@candidateId,@title,@sourceRanges,@templateId,@composition,
        @copy,@approved,@revision,@createdAt,@updatedAt)
    `).run({
      ...project, sourceRanges: JSON.stringify(project.sourceRanges),
      composition: JSON.stringify(project.composition), copy: JSON.stringify(project.copy),
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
    approved?: boolean;
  }): ShortProject {
    return this.db.transaction(() => {
      const current = this.getShort(id);
      if (current.revision !== expectedRevision) {
        throw new AppError("REVISION_CONFLICT", "Short was edited by another client", 409, {
          expectedRevision, actualRevision: current.revision
        });
      }
      const next = { ...current, ...patch, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      this.db.prepare(`
        UPDATE short_projects SET title=?,composition_json=?,copy_json=?,approved=?,
          revision=?,updated_at=? WHERE id=? AND revision=?
      `).run(next.title, JSON.stringify(next.composition), JSON.stringify(next.copy),
        next.approved ? 1 : 0, next.revision, next.updatedAt, id, expectedRevision);
      this.db.prepare(`
        UPDATE renders SET state='stale',updated_at=? WHERE short_id=? AND project_revision<>?
      `).run(next.updatedAt, id, next.revision);
      this.db.prepare(`
        UPDATE schedule_entries SET needs_rerender=1,updated_at=?,revision=revision+1 WHERE short_id=?
      `).run(next.updatedAt, id);
      return next;
    })();
  }

  insertJob(job: Job, payload: unknown): void {
    this.db.prepare(`
      INSERT INTO jobs(id,type,entity_id,state,progress,stage,payload_json,attempts,
        error_code,error_message,created_at,updated_at)
      VALUES(@id,@type,@entityId,@state,@progress,@stage,@payload,@attempts,
        @errorCode,@errorMessage,@createdAt,@updatedAt)
    `).run({ ...job, payload: JSON.stringify(payload) });
  }

  listJobs(): Job[] {
    return (this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all() as Row[]).map(mapJob);
  }

  recoverJobs(): number {
    const now = new Date().toISOString();
    return Number(this.db.prepare(`
      UPDATE jobs SET state='queued',stage='recovered',updated_at=?
      WHERE state='running'
    `).run(now).changes);
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
    reviewStatus: row.review_status as ClipCandidate["reviewStatus"], createdAt: String(row.created_at)
  };
}

function mapShort(row: Row): ShortProject {
  return {
    id: String(row.id), episodeId: String(row.episode_id),
    candidateId: row.candidate_id ? String(row.candidate_id) : null, title: String(row.title),
    sourceRanges: JSON.parse(String(row.source_ranges_json)), templateId: String(row.template_id),
    composition: JSON.parse(String(row.composition_json)), copy: JSON.parse(String(row.copy_json)),
    approved: bool(row.approved), revision: Number(row.revision),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function mapJob(row: Row): Job {
  return {
    id: String(row.id), type: row.type as Job["type"], entityId: row.entity_id ? String(row.entity_id) : null,
    state: row.state as Job["state"], progress: Number(row.progress), stage: String(row.stage),
    attempts: Number(row.attempts), errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}
