import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { z } from "zod";
import type { Asset, Composition, ScheduleRules, ShortProject, TranscriptSegment } from "../shared/domain.js";
import { AppError } from "../shared/errors.js";
import { starterTemplates, templateById } from "../shared/templates.js";
import { generateCandidates } from "./candidates.js";
import type { Repository } from "./repository.js";
import type { MediaService } from "./media.js";
import type { JobQueue } from "./jobs.js";
import { draftSchedule, type SchedulableShort } from "./scheduler.js";
import { validateRender } from "./render.js";
import type { ArtifactStore } from "./artifact-store.js";

export class CoreService {
  constructor(
    readonly repository: Repository,
    readonly media: MediaService,
    readonly jobs: JobQueue,
    readonly artifacts?: ArtifactStore
  ) {}

  listEpisodes(search?: string) { return this.repository.listEpisodes(search); }
  getEpisode(id: string) { return this.repository.getEpisode(id); }
  async importPaths(paths: string[]) {
    const result = await this.media.importPaths(paths);
    for (const episode of result.imported) {
      if (!episode.contentHash) this.jobs.enqueue({ type: "hash", entityId: episode.id });
    }
    return result;
  }
  listJobs() { return this.jobs.list(); }
  cancelJob(id: string) { return this.jobs.cancel(id); }
  startAnalysis(episodeId: string, provider: "local" | "openai", cloudAuthorized = false) {
    this.repository.getEpisode(episodeId);
    return this.jobs.enqueue({ type: "analyze", entityId: episodeId, provider, cloudAuthorized });
  }

  setTranscript(episodeId: string, segments: TranscriptSegment[]) {
    return this.repository.transaction(() => {
      let episode = this.repository.getEpisode(episodeId);
      if (episode.status === "source_missing") {
        throw new AppError("INVALID_STATE", "Cannot transcribe an Episode with missing source media", 409);
      }
      if (episode.status === "ready") {
        episode = this.repository.updateEpisodeStatus(episodeId, "analyzing");
      } else {
        if (episode.status === "discovered" || episode.status === "error") {
          episode = this.repository.updateEpisodeStatus(episodeId, "indexing");
        }
        if (episode.status !== "analyzing") {
          episode = this.repository.updateEpisodeStatus(episodeId, "analyzing");
        }
      }
      this.repository.replaceTranscript(episodeId, segments);
      this.repository.updateEpisodeStatus(episodeId, "ready");
      return segments;
    });
  }

  generateCandidates(episodeId: string, count?: number) {
    this.repository.getEpisode(episodeId);
    const transcript = this.repository.getTranscript(episodeId);
    if (!transcript.length) throw new AppError("INVALID_STATE", "Episode has no transcript", 409);
    const candidates = generateCandidates(episodeId, transcript, { count });
    this.repository.replaceCandidates(episodeId, candidates);
    return candidates;
  }
  listCandidates(episodeId: string) { return this.repository.listCandidates(episodeId); }
  reviewCandidate(id: string, status: "approved" | "rejected") {
    return this.repository.reviewCandidate(id, status);
  }

  createShort(candidateId: string, templateId = "fullscreen-speaker-v1"): ShortProject {
    const candidate = this.repository.getCandidate(candidateId);
    if (candidate.reviewStatus !== "approved") {
      throw new AppError("INVALID_STATE", "Approve the candidate before creating a Short", 409);
    }
    const template = templateById(templateId);
    if (!template) throw new AppError("NOT_FOUND", "Template not found", 404);
    const now = new Date().toISOString();
    return this.repository.createShort({
      id: randomUUID(), episodeId: candidate.episodeId, candidateId, title: candidate.topic,
      sourceRanges: [{ startMs: candidate.startMs, endMs: candidate.endMs }],
      templateId,
      templateLineage: { templateId, templateVersion: template.version, parentTemplateId: null },
      composition: structuredClone(template.composition),
      captions: {
        enabled: true,
        segments: [],
        style: { fontFamily: "Arial", fontSize: 64, color: "#ffffff", highlightColor: "#ffdc5e" }
      },
      audio: {
        sourceGainDb: 0, muted: false, fadeInMs: 0, fadeOutMs: 0,
        bedAssetId: null, bedGainDb: null, normalizeLoudness: false
      },
      copy: {
        cleanedTranscript: candidate.transcript, rewrite: "", hookVariants: [candidate.hook],
        titles: [candidate.topic], description: "", hashtags: [], thumbnailText: ""
      },
      approved: false, revision: 1, createdAt: now, updatedAt: now
    });
  }
  getShort(id: string) { return this.repository.getShort(id); }
  updateComposition(id: string, expectedRevision: number, composition: Composition) {
    return this.repository.updateShort(id, expectedRevision, { composition });
  }
  updateCopy(id: string, expectedRevision: number, copy: ShortProject["copy"]) {
    return this.repository.updateShort(id, expectedRevision, { copy });
  }
  approveShort(id: string, expectedRevision: number) {
    return this.repository.updateShort(id, expectedRevision, { approved: true });
  }

  listTemplates() { return this.repository.listTemplates(); }
  listAssets() {
    return this.repository.listAssets();
  }
  importAsset(path: string, provenance: string, reusable: boolean) {
    const sourcePath = resolve(path);
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      throw new AppError("NOT_FOUND", "Asset file does not exist", 404);
    }
    const extension = extname(sourcePath).toLowerCase();
    const kind: Asset["kind"] | null = [".png", ".jpg", ".jpeg", ".webp"].includes(extension) ? "image"
      : [".mp4", ".mov", ".webm"].includes(extension) ? "video" : null;
    if (!kind) throw new AppError("VALIDATION_ERROR", "Unsupported asset type", 422);
    const now = new Date().toISOString();
    const asset = {
      id: randomUUID(), sourcePath, ownedArtifactPath: null, kind, provenance, reusable,
      tags: [], width: null, height: null, durationMs: null, createdAt: now, updatedAt: now
    };
    return this.repository.saveAsset(asset);
  }
  listRenders(shortId?: string) {
    return this.repository.listRenders(shortId);
  }
  startRender(shortId: string, expectedRevision: number) {
    const project = this.repository.getShort(shortId);
    if (project.revision !== expectedRevision) {
      throw new AppError("REVISION_CONFLICT", "Short revision is stale", 409);
    }
    if (!project.approved) throw new AppError("INVALID_STATE", "Approve the Short before rendering", 409);
    return this.jobs.enqueue({ type: "render", entityId: shortId, payload: { revision: expectedRevision } });
  }
  validateRender(path: string) { return validateRender(path); }
  draftSchedule(shorts: SchedulableShort[], rules: ScheduleRules) {
    for (const item of shorts) {
      const eligible = this.repository.db.prepare(`
        SELECT 1 FROM renders r JOIN short_projects s ON s.id=r.short_id
        WHERE r.id=? AND r.short_id=? AND r.state='succeeded' AND r.project_revision=s.revision
          AND s.approved=1
      `).get(item.renderId, item.shortId);
      if (!eligible) throw new AppError(
        "INVALID_STATE", `Short ${item.shortId} needs an approved current validated render`, 409
      );
    }
    const occupied = (this.repository.db.prepare("SELECT publish_at FROM schedule_entries").all() as { publish_at: string }[])
      .map((row) => row.publish_at);
    const draft = draftSchedule(shorts, rules, occupied);
    const now = new Date().toISOString();
    const insert = this.repository.db.prepare(`
      INSERT INTO schedule_entries(id,short_id,render_id,episode_id,publish_at,timezone,status,
        priority,rationale,locked,youtube_url,needs_rerender,revision,created_at,updated_at)
      VALUES(@id,@shortId,@renderId,@episodeId,@publishAt,@timezone,'draft',
        @priority,@rationale,0,NULL,0,1,@now,@now)
    `);
    this.repository.db.transaction(() => draft.forEach((entry) => insert.run({ ...entry, now })))();
    return draft;
  }
  getSchedule() {
    return this.repository.db.prepare("SELECT * FROM schedule_entries ORDER BY publish_at").all();
  }
  moveScheduleEntry(entryId: string, expectedRevision: number, publishAt: string) {
    const instant = new Date(publishAt);
    if (Number.isNaN(instant.getTime())) throw new AppError("VALIDATION_ERROR", "Invalid publish instant", 422);
    const row = this.repository.db.prepare("SELECT * FROM schedule_entries WHERE id=?").get(entryId) as
      { revision: number; locked: number } | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Schedule entry not found", 404);
    if (row.revision !== expectedRevision) throw new AppError("REVISION_CONFLICT", "Schedule entry revision is stale", 409);
    if (row.locked) throw new AppError("INVALID_STATE", "Schedule entry is locked", 409);
    try {
      this.repository.db.prepare(`
        UPDATE schedule_entries SET publish_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?
      `).run(instant.toISOString(), new Date().toISOString(), entryId, expectedRevision);
    } catch {
      throw new AppError("SCHEDULE_COLLISION", "Another entry already occupies that instant", 409);
    }
    return this.repository.db.prepare("SELECT * FROM schedule_entries WHERE id=?").get(entryId);
  }
  markPublished(entryId: string, expectedRevision: number, youtubeUrl?: string) {
    const update = this.repository.db.prepare(`
      UPDATE schedule_entries SET status='published',youtube_url=?,locked=1,
        revision=revision+1,updated_at=? WHERE id=? AND revision=? AND needs_rerender=0
    `).run(youtubeUrl ?? null, new Date().toISOString(), entryId, expectedRevision);
    if (!update.changes) throw new AppError("REVISION_CONFLICT", "Entry is stale or needs rerender", 409);
    return this.repository.db.prepare("SELECT * FROM schedule_entries WHERE id=?").get(entryId);
  }
}

export const importPathsInput = z.object({ paths: z.array(z.string()).min(1) });
export const candidateGenerateInput = z.object({ episodeId: z.string().uuid(), count: z.number().int().min(5).max(10).optional() });
