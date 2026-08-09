import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, realpath, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { CoreService } from "./service.js";
import type { Repository } from "./repository.js";
import type { ArtifactStore } from "./artifact-store.js";
import { AppError, normalizeError } from "../shared/errors.js";
import {
  createShortWorkflowInputSchema,
  exportRenderInputSchema,
  shortWorkflowSchema,
  type CreateShortWorkflowInput,
  type MotionGraphicLayer,
  type ShortWorkflow
} from "../shared/domain.js";
import { canonicalJson } from "./analysis-cache.js";

type WorkflowRow = Record<string, unknown>;
const activeStates = new Set<ShortWorkflow["state"]>([
  "importing", "analyzing", "selecting_candidate", "assembling_draft",
  "awaiting_review", "preflighting", "rendering", "exporting"
]);

export class ShortWorkflowService {
  private timer?: NodeJS.Timeout;
  private advancing = new Set<string>();

  constructor(
    private readonly core: CoreService,
    private readonly repository: Repository,
    private readonly artifacts?: ArtifactStore
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.reconcileAll(), 400);
    this.timer.unref?.();
    void this.reconcileAll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async create(raw: unknown): Promise<ShortWorkflow> {
    const input = createShortWorkflowInputSchema.parse(raw);
    const requestHash = createHash("sha256").update(canonicalJson(
      input.idempotencyKey
        ? { version: 2, idempotencyKey: input.idempotencyKey }
        : { version: 2, ...input, sourcePath: resolve(input.sourcePath) }
    )).digest("hex");
    const existing = this.repository.db.prepare(
      "SELECT id FROM short_workflows WHERE request_hash=?"
    ).get(requestHash) as { id: string } | undefined;
    if (existing) return this.get(existing.id);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.repository.db.prepare(`
      INSERT INTO short_workflows(
        id,request_hash,state,revision,input_json,progress,stage,warnings_json,graphics_json,
        created_at,updated_at
      ) VALUES(?,?,'importing',1,?,0.02,'importing source','[]','[]',?,?)
    `).run(id, requestHash, JSON.stringify(input), now, now);
    await this.advanceSafely(id);
    return this.get(id);
  }

  async get(id: string): Promise<ShortWorkflow> {
    await this.advanceSafely(id);
    return this.hydrate(this.read(id));
  }

  async resume(id: string, expectedRevision: number, action: "approve_draft" | "retry") {
    const workflow = this.read(id);
    this.assertRevision(workflow, expectedRevision);
    if (action === "approve_draft") {
      if (workflow.state !== "awaiting_review") {
        throw new AppError("INVALID_STATE", "Only an awaiting-review workflow can be approved", 409);
      }
      this.update(id, expectedRevision, {
        state: "preflighting", progress: 0.64, stage: "draft approved"
      });
    } else {
      if (workflow.state !== "failed" || !workflow.failure?.retryable) {
        throw new AppError("INVALID_STATE", "Workflow failure is not retryable", 409);
      }
      if (workflow.failure.stage === "rendering" && workflow.renderId) {
        const source = this.repository.getRender(workflow.renderId);
        if (source.state === "failed" || source.state === "cancelled") {
          const retried = this.core.retryRenderAttempt(source.id);
          this.update(id, expectedRevision, {
            state: "rendering", progress: 0.72, stage: "render retry queued", failure: null,
            renderId: retried.render.id, renderJobId: retried.job.id
          });
          await this.advanceSafely(id);
          return this.get(id);
        }
      }
      if (workflow.failure.stage === "analyzing" && workflow.episodeId) {
        const job = this.core.startAnalysis(workflow.episodeId, "local");
        this.update(id, expectedRevision, {
          state: "analyzing", progress: .12, stage: "analysis retry queued", failure: null,
          analysisJobId: job.id
        });
        await this.advanceSafely(id);
        return this.get(id);
      }
      const stage = retryState(workflow);
      this.update(id, expectedRevision, {
        state: stage, progress: progressFor(stage), stage: `retrying ${stage}`, failure: null,
        preflightId: workflow.failure.stage === "preflighting" ? null : workflow.preflightId
      });
    }
    await this.advanceSafely(id);
    return this.get(id);
  }

  async cancel(id: string, expectedRevision: number): Promise<ShortWorkflow> {
    const workflow = this.read(id);
    this.assertRevision(workflow, expectedRevision);
    if (!activeStates.has(workflow.state)) {
      throw new AppError("INVALID_STATE", "Workflow is not active", 409);
    }
    for (const jobId of [workflow.analysisJobId, workflow.renderJobId]) {
      if (!jobId) continue;
      const job = this.core.listJobs().find(({ id: candidate }) => candidate === jobId);
      if (job?.state === "queued" || job?.state === "running") this.core.cancelJob(jobId);
    }
    this.update(id, expectedRevision, {
      state: "cancelled", progress: workflow.progress.value, stage: "cancelled", failure: null
    });
    return this.hydrate(this.read(id));
  }

  async exportRender(raw: unknown): Promise<{ renderId: string; path: string; contentHash: string }> {
    const input = exportRenderInputSchema.parse(raw);
    if (!this.artifacts) throw new AppError("DEPENDENCY_UNAVAILABLE", "Artifact store is unavailable", 503);
    const render = this.repository.getRender(input.renderId);
    if (render.state !== "succeeded" || !render.outputPath || !render.contentHash || !render.validation?.valid) {
      throw new AppError("INVALID_STATE", "Only a validated successful Render can be exported", 409);
    }
    let directory: string;
    if (input.directory.split(/[\\/]+/).includes("..")) {
      throw new AppError("VALIDATION_ERROR", "Export directory must not contain traversal segments", 422);
    }
    try {
      directory = await realpath(input.directory);
      if (!(await stat(directory)).isDirectory()) throw new Error("not directory");
    } catch {
      throw new AppError("NOT_FOUND", "Export directory does not exist", 404);
    }
    const filename = input.filename ?? `siftcut-${render.id}.mp4`;
    if (basename(filename) !== filename || filename === "." || filename === ".." || !filename.toLowerCase().endsWith(".mp4")) {
      throw new AppError("VALIDATION_ERROR", "Export filename must be a plain .mp4 filename", 422);
    }
    const destination = join(directory, filename);
    try {
      await copyFile(this.artifacts.resolveOwnedPath(render.outputPath), destination, constants.COPYFILE_EXCL);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") throw new AppError("INVALID_STATE", "Export destination already exists", 409);
      throw new AppError("DEPENDENCY_UNAVAILABLE", "Render export failed", 503, undefined, true);
    }
    return { renderId: render.id, path: destination, contentHash: render.contentHash };
  }

  private async reconcileAll(): Promise<void> {
    const rows = this.repository.db.prepare(`
      SELECT id FROM short_workflows
      WHERE state NOT IN ('failed','cancelled','completed') ORDER BY updated_at,id
    `).all() as Array<{ id: string }>;
    for (const row of rows) await this.advanceSafely(row.id);
  }

  private async advanceSafely(id: string): Promise<void> {
    if (this.advancing.has(id)) return;
    this.advancing.add(id);
    try { await this.advance(id); }
    catch (error) {
      const current = this.read(id);
      if (!activeStates.has(current.state)) return;
      const normalized = normalizeError(error);
      this.update(id, current.revision, {
        state: "failed", stage: "failed", failure: {
          code: normalized.code,
          message: normalized.message,
          retryable: normalized.retryable || ["DEPENDENCY_UNAVAILABLE", "SOURCE_MISSING", "INTERNAL_ERROR"].includes(normalized.code),
          stage: current.state
        }
      });
    } finally { this.advancing.delete(id); }
  }

  private async advance(id: string): Promise<void> {
    for (let guard = 0; guard < 8; guard++) {
      const workflow = this.read(id);
      if (workflow.state === "importing") {
        const imported = await this.core.importPaths([workflow.input.sourcePath]);
        const episode = imported.imported[0] ?? imported.duplicates[0] ?? imported.relinked[0];
        if (!episode) {
          const rejected = imported.rejected[0];
          throw new AppError("VALIDATION_ERROR", rejected?.reason ?? "MP4 import failed", 422);
        }
        if (!episode.sourcePath.toLowerCase().endsWith(".mp4")) {
          throw new AppError("VALIDATION_ERROR", "Workflow source must be an MP4 file", 422);
        }
        let analysisJobId: string | null = null;
        try { this.repository.getAcceptedTranscriptRevision(episode.id); }
        catch {
          analysisJobId = this.core.listJobs().find((job) =>
            job.type === "analyze" && job.entityId === episode.id &&
            (job.state === "queued" || job.state === "running")
          )?.id ?? this.core.startAnalysis(episode.id, "local").id;
        }
        this.update(id, workflow.revision, {
          state: analysisJobId ? "analyzing" : "selecting_candidate",
          progress: analysisJobId ? 0.12 : 0.38,
          stage: analysisJobId ? "local transcription queued" : "using accepted transcript",
          episodeId: episode.id, analysisJobId
        });
        continue;
      }
      if (workflow.state === "analyzing") {
        const job = this.core.listJobs().find(({ id: jobId }) => jobId === workflow.analysisJobId);
        if (!job) throw new AppError("INTERNAL_ERROR", "Persisted analysis job is missing", 500);
        if (job.state === "failed") throw new AppError(
          (job.errorCode ?? "DEPENDENCY_UNAVAILABLE") as never,
          job.errorMessage ?? "Local analysis failed", 503, undefined, true
        );
        if (job.state === "cancelled") throw new AppError("JOB_CANCELLED", "Analysis was cancelled", 409);
        if (job.state !== "succeeded") {
          this.updateProgress(id, workflow.revision, 0.12 + job.progress * 0.24, job.stage);
          return;
        }
        this.update(id, workflow.revision, {
          state: "selecting_candidate", progress: 0.38, stage: "selecting candidate"
        });
        continue;
      }
      if (workflow.state === "selecting_candidate") {
        if (!workflow.candidateId) {
          const generated = this.core.generateCandidates({
            episodeId: workflow.episodeId!, count: 8, strategy: "append_pending", mode: "heuristic"
          });
          const candidates = generated.candidates;
          if (!candidates.length) throw new AppError("INVALID_STATE", "Analysis produced no Short candidates", 409);
          const target = workflow.input.targetDurationMs;
          const candidate = [...candidates].sort((left, right) => {
            const leftPenalty = Math.abs((left.endMs - left.startMs) - target) / target;
            const rightPenalty = Math.abs((right.endMs - right.startMs) - target) / target;
            return (right.score - rightPenalty) - (left.score - leftPenalty) || left.id.localeCompare(right.id);
          })[0]!;
          this.update(id, workflow.revision, {
            state: "selecting_candidate", progress: .44,
            stage: "candidate selected", candidateId: candidate.id
          });
          continue;
        }
        const candidate = this.repository.getCandidate(workflow.candidateId);
        const accepted = this.core.getCandidateContentPackage(candidate.id);
        if (!accepted.accepted) this.core.acceptCandidateContentPackage(
          candidate.id, accepted.candidateRevision, accepted.proposed
        );
        const fresh = this.repository.getCandidate(candidate.id);
        if (fresh.reviewStatus !== "approved") {
          this.core.reviewCandidate(candidate.id, fresh.revision, "approved");
        }
        this.update(id, workflow.revision, {
          state: "assembling_draft", progress: 0.48, stage: "assembling draft", candidateId: candidate.id
        });
        continue;
      }
      if (workflow.state === "assembling_draft") {
        let project = this.core.listShorts(workflow.episodeId!).find(
          ({ candidateId }) => candidateId === workflow.candidateId
        ) ?? this.core.createShort(workflow.candidateId!, workflow.input.templateId);
        const initialDuration = project.sourceRanges.reduce(
          (sum, range) => sum + range.endMs - range.startMs, 0
        );
        if (initialDuration > workflow.input.targetDurationMs) {
          const first = project.sourceRanges[0]!;
          project = this.repository.updateShortTimeline(project.id, project.revision, [{
            startMs: first.startMs,
            endMs: first.startMs + workflow.input.targetDurationMs
          }]);
        }
        const duration = project.sourceRanges.reduce((sum, range) => sum + range.endMs - range.startMs, 0);
        const warnings = [...workflow.warnings];
        if (workflow.input.creativeDirection) warnings.push("Creative direction is recorded for review; v2 presets remain deterministic.");
        if (!workflow.input.captionsEnabled && project.captions.enabled) {
          project = this.repository.updateShortCaptions(project.id, project.revision, {
            ...project.captions, enabled: false
          });
        }
        if (workflow.input.graphics.enabled) {
          const layers = graphicsLayers(workflow.input, project.title, duration);
          this.update(id, workflow.revision, {
            state: workflow.input.reviewMode === "auto_approve" ? "preflighting" : "awaiting_review",
            progress: workflow.input.reviewMode === "auto_approve" ? 0.64 : 0.6,
            stage: workflow.input.reviewMode === "auto_approve" ? "auto-approving draft" : "awaiting draft review",
            shortId: project.id, warnings, graphicsProposal: layers
          });
          continue;
        }
        this.update(id, workflow.revision, {
          state: workflow.input.reviewMode === "auto_approve" ? "preflighting" : "awaiting_review",
          progress: workflow.input.reviewMode === "auto_approve" ? 0.64 : 0.6,
          stage: workflow.input.reviewMode === "auto_approve" ? "auto-approving draft" : "awaiting draft review",
          shortId: project.id, warnings, graphicsProposal: []
        });
        continue;
      }
      if (workflow.state === "awaiting_review") return;
      if (workflow.state === "preflighting") {
        let project = this.core.getShort(workflow.shortId!);
        if (!project.approved) project = this.core.approveShort(project.id, project.revision);
        const existingRender = [...this.core.listRenders(project.id)].reverse().find((render) =>
          render.projectRevision === project.revision &&
          (render.state === "queued" || render.state === "running" || render.state === "succeeded")
        );
        if (existingRender) {
          const existingJob = this.core.listJobs().find(
            ({ payloadReference }) => payloadReference === `render:${existingRender.id}`
          );
          if (!existingJob) throw new AppError("INTERNAL_ERROR", "Persisted workflow Render job is missing", 500);
          this.update(id, workflow.revision, {
            state: "rendering", progress: existingRender.state === "succeeded" ? .94 : .72,
            stage: existingRender.state === "succeeded" ? "render complete" : "reattached render",
            preflightId: existingRender.preflightId,
            renderId: existingRender.id, renderJobId: existingJob.id
          });
          continue;
        }
        const preflight = workflow.preflightId
          ? this.core.getRenderPreflight(workflow.preflightId)
          : await this.core.preflightWorkflowRender(
            project.id, project.revision, workflow.graphicsProposal
          );
        if (preflight.status !== "passed") {
          throw new AppError("VALIDATION_ERROR", "Render preflight failed", 422, preflight.findings);
        }
        if (!workflow.preflightId) {
          this.update(id, workflow.revision, {
            state: "preflighting", progress: .68, stage: "preflight passed",
            preflightId: preflight.id,
            warnings: [
              ...workflow.warnings,
              ...preflight.findings.filter(({ severity }) => severity === "warning").map(({ message }) => message)
            ]
          });
          continue;
        }
        const started = this.core.startRenderAttempt({
          shortId: project.id, expectedRevision: project.revision,
          preflightId: preflight.id, sidecarFormat: workflow.input.captionsEnabled ? "srt" : null
        });
        this.update(id, workflow.revision, {
          state: "rendering", progress: 0.72, stage: "render queued",
          preflightId: preflight.id, renderId: started.render.id, renderJobId: started.job.id,
          warnings: workflow.warnings
        });
        return;
      }
      if (workflow.state === "rendering") {
        const render = this.repository.getRender(workflow.renderId!);
        const job = this.core.listJobs().find(({ id: jobId }) => jobId === workflow.renderJobId);
        if (render.state === "failed" || render.state === "stale") {
          throw new AppError("DEPENDENCY_UNAVAILABLE", render.error?.message ?? "Render failed", 503, undefined, true);
        }
        if (render.state === "cancelled") throw new AppError("JOB_CANCELLED", "Render was cancelled", 409);
        if (render.state !== "succeeded") {
          this.updateProgress(id, workflow.revision, 0.72 + (job?.progress ?? 0) * 0.22, job?.stage ?? "rendering");
          return;
        }
        if (workflow.input.exportDirectory) {
          this.update(id, workflow.revision, { state: "exporting", progress: 0.96, stage: "exporting render" });
          continue;
        }
        this.update(id, workflow.revision, { state: "completed", progress: 1, stage: "complete" });
        return;
      }
      if (workflow.state === "exporting") {
        const render = this.repository.getRender(workflow.renderId!);
        const recoveredPath = join(
          await realpath(workflow.input.exportDirectory!), `siftcut-${workflow.renderId}.mp4`
        );
        try {
          if (render.contentHash && await fileHash(recoveredPath) === render.contentHash) {
            this.update(id, workflow.revision, {
              state: "completed", progress: 1, stage: "complete", exportPath: recoveredPath
            });
            return;
          }
        } catch { /* no completed export to recover */ }
        const exported = await this.exportRender({
          renderId: workflow.renderId!, directory: workflow.input.exportDirectory!
        });
        this.update(id, workflow.revision, {
          state: "completed", progress: 1, stage: "complete", exportPath: exported.path
        });
        return;
      }
      return;
    }
  }

  private read(id: string): ShortWorkflow {
    const row = this.repository.db.prepare("SELECT * FROM short_workflows WHERE id=?").get(id) as WorkflowRow | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Workflow not found", 404);
    return mapWorkflow(row);
  }

  private hydrate(workflow: ShortWorkflow): ShortWorkflow {
    return shortWorkflowSchema.parse({
      ...workflow,
      candidate: workflow.candidateId ? this.repository.getCandidate(workflow.candidateId) : null,
      short: workflow.shortId ? this.repository.getShort(workflow.shortId) : null,
      composition: workflow.shortId ? this.repository.getShort(workflow.shortId).composition : null,
      graphicsProposal: workflow.graphicsProposal,
      preflight: workflow.preflightId ? this.repository.getRenderPreflight(workflow.preflightId).result : null,
      render: workflow.renderId ? this.repository.getRender(workflow.renderId) : null
    });
  }

  private update(id: string, revision: number, patch: Partial<{
    state: ShortWorkflow["state"]; progress: number; stage: string; warnings: string[];
    episodeId: string | null; analysisJobId: string | null; candidateId: string | null;
    shortId: string | null; preflightId: string | null; renderId: string | null;
    renderJobId: string | null; exportPath: string | null; failure: ShortWorkflow["failure"];
    graphicsProposal: MotionGraphicLayer[];
  }>): void {
    const current = this.read(id);
    this.assertRevision(current, revision);
    const next = { ...current, ...patch };
    const changed = this.repository.db.prepare(`
      UPDATE short_workflows SET state=?,revision=revision+1,progress=?,stage=?,warnings_json=?,graphics_json=?,
        episode_id=?,analysis_job_id=?,candidate_id=?,short_id=?,preflight_id=?,render_id=?,
        render_job_id=?,export_path=?,failure_json=?,updated_at=? WHERE id=? AND revision=?
    `).run(
      next.state, patch.progress ?? current.progress.value,
      patch.stage ?? current.progress.stage, JSON.stringify(next.warnings),
      JSON.stringify(next.graphicsProposal), next.episodeId,
      next.analysisJobId, next.candidateId, next.shortId, next.preflightId, next.renderId,
      next.renderJobId, next.exportPath, next.failure ? JSON.stringify(next.failure) : null,
      new Date().toISOString(), id, revision
    );
    if (!changed.changes) throw new AppError("REVISION_CONFLICT", "Workflow changed concurrently", 409);
  }

  private updateProgress(id: string, revision: number, value: number, stage: string): void {
    this.update(id, revision, { progress: value, stage });
  }

  private assertRevision(workflow: ShortWorkflow, expected: number): void {
    if (workflow.revision !== expected) throw new AppError("REVISION_CONFLICT", "Workflow changed concurrently", 409, {
      expectedRevision: expected, actualRevision: workflow.revision
    });
  }
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolvePromise);
    stream.once("error", reject);
  });
  return hash.digest("hex");
}

function mapWorkflow(row: WorkflowRow): ShortWorkflow {
  return shortWorkflowSchema.parse({
    id: String(row.id), state: row.state, revision: Number(row.revision),
    input: JSON.parse(String(row.input_json)),
    progress: { value: Number(row.progress), stage: String(row.stage) },
    warnings: JSON.parse(String(row.warnings_json)),
    graphicsProposal: JSON.parse(String(row.graphics_json)),
    episodeId: row.episode_id ? String(row.episode_id) : null,
    analysisJobId: row.analysis_job_id ? String(row.analysis_job_id) : null,
    candidateId: row.candidate_id ? String(row.candidate_id) : null,
    shortId: row.short_id ? String(row.short_id) : null,
    preflightId: row.preflight_id ? String(row.preflight_id) : null,
    renderId: row.render_id ? String(row.render_id) : null,
    renderJobId: row.render_job_id ? String(row.render_job_id) : null,
    exportPath: row.export_path ? String(row.export_path) : null,
    failure: row.failure_json ? JSON.parse(String(row.failure_json)) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  });
}

function retryState(workflow: ShortWorkflow): ShortWorkflow["state"] {
  const failedAt = workflow.failure!.stage;
  if (failedAt === "rendering" && workflow.renderId) return "preflighting";
  if (failedAt === "exporting" && workflow.renderId) return "exporting";
  if (workflow.shortId) return "preflighting";
  if (workflow.candidateId) return "assembling_draft";
  if (workflow.episodeId) return "selecting_candidate";
  return "importing";
}

function progressFor(state: ShortWorkflow["state"]): number {
  return { importing: .02, analyzing: .12, selecting_candidate: .38, assembling_draft: .48,
    awaiting_review: .6, preflighting: .64, rendering: .72, exporting: .96,
    failed: 0, cancelled: 0, completed: 1 }[state];
}

function graphicsLayers(input: CreateShortWorkflowInput, title: string, duration: number) {
  const chosen = new Set(input.graphics.presets);
  const layers: MotionGraphicLayer[] = [];
  const base = { visible: true, source: "none", assetId: null, fit: "fit" } as const;
  if (chosen.has("hook")) layers.push({ ...base, id: "workflow-hook", type: "motion_graphic", preset: "hook",
    startMs: 0, endMs: Math.min(duration, 3_500), primaryText: title.slice(0, 160), secondaryText: "",
    theme: "accent", region: { x: .07, y: .08, width: .86, height: .24 } });
  if (chosen.has("lower_third") && duration > 1_000) layers.push({ ...base, id: "workflow-lower-third",
    type: "motion_graphic", preset: "lower_third", startMs: Math.min(800, duration - 1),
    endMs: Math.min(duration, 6_000), primaryText: input.graphics.speakerName ?? "Speaker",
    secondaryText: input.graphics.speakerRole ?? "", theme: "dark",
    region: { x: .06, y: .72, width: .74, height: .15 } });
  if (chosen.has("end_card")) layers.push({ ...base, id: "workflow-end-card", type: "motion_graphic",
    preset: "end_card", startMs: Math.max(0, duration - 4_000), endMs: duration,
    primaryText: input.graphics.callToAction ?? "Watch the full story", secondaryText: title.slice(0, 160),
    theme: "dark", region: { x: .08, y: .3, width: .84, height: .4 } });
  return layers;
}
