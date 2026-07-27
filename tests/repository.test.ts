import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/core/database";
import { Repository } from "../src/core/repository";
import { starterTemplates } from "../src/shared/templates";
import { AppError } from "../src/shared/errors";
import { candidate, episode } from "./factories";

const databases: ReturnType<typeof openDatabase>[] = [];
const setup = () => {
  const db = openDatabase(":memory:");
  databases.push(db);
  return new Repository(db);
};
afterEach(() => databases.splice(0).forEach((db) => db.close()));

describe("repository revisions and recovery", () => {
  it("rejects stale updates and invalidates renders and schedules", () => {
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
      captions: {
        enabled: true, segments: [],
        style: { fontFamily: "Arial", fontSize: 64, color: "#fff", highlightColor: "#ff0" }
      },
      audio: {
        sourceGainDb: 0, muted: false, fadeInMs: 0, fadeOutMs: 0,
        bedAssetId: null, bedGainDb: null, normalizeLoudness: false
      },
      copy: { cleanedTranscript: "", rewrite: "", hookVariants: [], titles: [], description: "", hashtags: [], thumbnailText: "" },
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
    expect(repository.db.prepare("SELECT state FROM renders WHERE id=?").get(renderId)).toEqual({ state: "stale" });
    expect(repository.db.prepare("SELECT needs_rerender FROM schedule_entries").get()).toEqual({ needs_rerender: 1 });
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

    expect(repository.recoverJobs()).toBe(4);
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
  });
});
