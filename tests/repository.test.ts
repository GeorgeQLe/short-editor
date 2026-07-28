import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/core/database";
import { Repository } from "../src/core/repository";
import { starterTemplates } from "../src/shared/templates";
import { AppError } from "../src/shared/errors";
import type { Job, Render } from "../src/shared/domain";
import { candidate, captionState, episode } from "./factories";

const databases: ReturnType<typeof openDatabase>[] = [];
const setup = () => {
  const db = openDatabase(":memory:");
  databases.push(db);
  return new Repository(db);
};
afterEach(() => databases.splice(0).forEach((db) => db.close()));

describe("repository revisions and recovery", () => {
  it("rejects stale updates while copy-only title changes preserve renders and schedules", () => {
    const repository = setup();
    const source = episode();
    repository.insertEpisode(source);
    const proposal = candidate(source.id);
    repository.replaceCandidates(source.id, [proposal]);
    const now = new Date().toISOString();
    const project = repository.createShort({
      id: crypto.randomUUID(), episodeId: source.id, candidateId: proposal.id, title: "A",
      sourceRanges: [{ startMs: 0, endMs: 30_000 }],
      templateId: starterTemplates[1]!.id,
      templateLineage: {
        templateId: starterTemplates[1]!.id, templateVersion: starterTemplates[1]!.version, parentTemplateId: null
      },
      composition: structuredClone(starterTemplates[1]!.composition),
      captions: captionState(),
      audio: {
        sourceGainDb: 0, sourceMuted: false, cutFadeMs: 0,
        bedAssetId: null, bedGainDb: null, warnings: []
      },
      copy: { cleanedTranscript: "", rewrite: "", hookVariants: [], titles: [], description: "", hashtags: [], thumbnailText: "" },
      copyState: "accepted", copySource: "legacy_accepted",
      approved: true, revision: 1, createdAt: now, updatedAt: now
    });
    const renderId = crypto.randomUUID();
    repository.db.prepare(`
      INSERT INTO renders(id,short_id,project_revision,encoder_json,state,created_at,updated_at)
      VALUES(?,?,1,'{}','succeeded',?,?)
    `).run(renderId, project.id, now, now);
    repository.db.prepare(`
      INSERT INTO schedule_entries(id,short_id,render_id,episode_id,publish_at,timezone,status,
        priority,rationale,created_at,updated_at)
      VALUES(?,?,?,?,?,'UTC','draft',0,'test',?,?)
    `).run(crypto.randomUUID(), project.id, renderId, source.id, "2026-08-01T12:00:00.000Z", now, now);

    const updated = repository.updateShort(project.id, 1, { title: "B" });
    expect(updated.revision).toBe(2);
    expect(repository.db.prepare("SELECT state FROM renders WHERE id=?").get(renderId)).toEqual({ state: "succeeded" });
    expect(repository.db.prepare("SELECT needs_rerender FROM schedule_entries").get()).toEqual({ needs_rerender: 0 });
    try {
      repository.updateShort(project.id, 1, { title: "C" });
      expect.fail("Expected a revision conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("REVISION_CONFLICT");
    }
  });

  it("requeues interrupted work after restart", () => {
    const repository = setup();
    const now = new Date().toISOString();
    const analyzeId = crypto.randomUUID();
    repository.insertJob({
      id: analyzeId, type: "analyze", entityId: null, state: "running",
      progress: .3, provider: "local", stage: "transcribing", attempts: 1,
      cancelRequested: false, errorCode: null, errorMessage: null, payloadReference: null,
      createdAt: now, updatedAt: now
    }, {});
    const renderId = crypto.randomUUID();
    repository.insertJob({
      id: renderId, type: "render", entityId: null, state: "running",
      progress: .7, provider: null, stage: "encoding", attempts: 1,
      cancelRequested: false, errorCode: null, errorMessage: null, payloadReference: null,
      createdAt: now, updatedAt: now
    }, {});
    const cancelledId = crypto.randomUUID();
    repository.insertJob({
      id: cancelledId, type: "hash", entityId: null, state: "running",
      progress: .5, provider: null, stage: "hashing", attempts: 1,
      cancelRequested: true, errorCode: null, errorMessage: null, payloadReference: null,
      createdAt: now, updatedAt: now
    }, {});
    const cloudAnalyzeId = crypto.randomUUID();
    repository.insertJob({
      id: cloudAnalyzeId, type: "analyze", entityId: null, state: "running",
      progress: .4, provider: "openai", stage: "requesting", attempts: 1,
      cancelRequested: false, errorCode: null, errorMessage: null, payloadReference: null,
      createdAt: now, updatedAt: now
    }, {});
    const exhaustedId = crypto.randomUUID();
    repository.insertJob({
      id: exhaustedId, type: "hash", entityId: null, state: "running",
      progress: .9, provider: null, stage: "hashing", attempts: 3,
      cancelRequested: false, errorCode: null, errorMessage: null, payloadReference: null,
      createdAt: now, updatedAt: now
    }, {});

    expect(repository.recoverJobs()).toBe(5);
    const recovered = new Map(repository.listJobs().map((job) => [job.id, job]));
    expect(recovered.get(analyzeId)).toMatchObject({
      state: "queued", stage: "recovered", progress: .3
    });
    expect(recovered.get(renderId)).toMatchObject({
      state: "failed",
      stage: "recovery_required",
      errorCode: "INTERNAL_ERROR",
      errorMessage: "Interrupted work is not safe to retry automatically"
    });
    expect(recovered.get(cancelledId)).toMatchObject({
      state: "cancelled", stage: "cancelled", errorCode: "JOB_CANCELLED"
    });
    expect(recovered.get(cloudAnalyzeId)).toMatchObject({
      state: "failed", stage: "recovery_required", errorCode: "INTERNAL_ERROR"
    });
    expect(recovered.get(exhaustedId)).toMatchObject({
      state: "failed", stage: "recovery_required", attempts: 3
    });
  });

  it("reconciles Render and Job pairs without undoing committed success", () => {
    const repository = setup();
    const source = episode();
    repository.insertEpisode(source);
    const now = new Date().toISOString();
    const projectId = crypto.randomUUID();
    repository.db.prepare(`
      INSERT INTO short_projects(
        id,episode_id,title,source_ranges_json,template_id,composition_json,
        copy_json,approved,revision,created_at,updated_at
      ) VALUES(?,?,'Recovery','[]','fullscreen-speaker-v1','{}','{}',1,1,?,?)
    `).run(projectId, source.id, now, now);
    const pair = (
      renderState: Render["state"],
      jobState: Job["state"],
      cancelRequested = false
    ) => {
      const renderId = crypto.randomUUID();
      repository.insertRender({
        id: renderId,
        shortId: projectId,
        projectRevision: 1,
        lineageId: renderId,
        previousRenderId: null,
        attempt: 1,
        preflightId: null,
        encoder: {
          ffmpegVersion: "8",
          videoCodec: "libx264",
          audioCodec: "aac",
          settings: {}
        },
        outputPath: renderState === "succeeded"
          ? `artifacts/renders/${renderId}/final.mp4`
          : null,
        sidecarPath: null,
        validation: null,
        determinism: null,
        state: renderState,
        error: null,
        contentHash: null,
        decisionHash: null,
        createdAt: now,
        updatedAt: now
      });
      const jobId = crypto.randomUUID();
      repository.insertJob({
        id: jobId,
        type: "render",
        entityId: projectId,
        provider: "local",
        state: jobState,
        progress: 0.5,
        stage: "encoding",
        attempts: 1,
        errorCode: null,
        errorMessage: null,
        cancelRequested,
        payloadReference: `render:${renderId}`,
        createdAt: now,
        updatedAt: now
      }, {});
      return { renderId, jobId };
    };
    const committed = pair("succeeded", "running");
    const interrupted = pair("running", "running");
    const beforeStart = pair("queued", "running");
    const queuedCancel = pair("queued", "cancelled", true);

    repository.recoverJobs();

    expect(repository.getRender(committed.renderId).state).toBe("succeeded");
    expect(repository.listJobs().find((job) => job.id === committed.jobId))
      .toMatchObject({ state: "succeeded", stage: "complete", progress: 1 });
    expect(repository.getRender(interrupted.renderId)).toMatchObject({
      state: "failed",
      outputPath: null,
      error: {
        code: "INTERNAL_ERROR",
        message: "Rendering was interrupted; manual retry is required"
      }
    });
    expect(repository.listJobs().find((job) => job.id === interrupted.jobId))
      .toMatchObject({ state: "failed", stage: "recovery_required" });
    expect(repository.getRender(beforeStart.renderId).state).toBe("queued");
    expect(repository.listJobs().find((job) => job.id === beforeStart.jobId))
      .toMatchObject({ state: "queued", stage: "recovered" });
    expect(repository.getRender(queuedCancel.renderId))
      .toMatchObject({ state: "cancelled", error: { code: "JOB_CANCELLED" } });
  });
});
