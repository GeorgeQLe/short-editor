import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { compositionSchema, scheduleRulesSchema, transcriptSegmentSchema } from "../shared/domain.js";
import { errorEnvelope, normalizeError } from "../shared/errors.js";
import {
  candidateGenerateInput,
  confirmRelinkInput,
  type CoreService,
  importPathsInput,
  relinkSourceInput,
  watchedFolderConfigurationInput
} from "./service.js";

const id = z.string().uuid();
const revision = z.number().int().positive();
const ok = <T>(data: T) => ({ apiVersion: "v1" as const, data });

export function createApi(service: CoreService) {
  const app = express();
  app.use(cors({ origin: ["http://localhost:5173", "app://short-editor"] }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/v1/health", (_req, res) => res.json(ok({ status: "ok" })));
  app.get("/v1/library/episodes", (req, res) => res.json(ok(service.listEpisodes(asString(req.query.search)))));
  app.get("/v1/library/episodes/:id", route((req) => service.getEpisode(id.parse(req.params.id))));
  app.post("/v1/library/import", route((req) => service.importPaths(importPathsInput.parse(req.body).paths)));
  app.get("/v1/library/watched-folders", (_req, res) => res.json(ok(service.listWatchedFolders())));
  app.post("/v1/library/watched-folders/configure", route((req) =>
    service.configureWatchedFolder(watchedFolderConfigurationInput.parse(req.body))
  ));
  app.post("/v1/library/watched-folders/:id/rescan", route((req) =>
    service.rescanWatchedFolder(id.parse(req.params.id))
  ));
  app.post("/v1/library/episodes/:id/relink", route((req) => service.relinkSource(
    id.parse(req.params.id), relinkSourceInput.parse(req.body).candidatePath
  )));
  app.post("/v1/library/episodes/:id/relink/confirm", route((req) => service.confirmRelink(
    id.parse(req.params.id), confirmRelinkInput.parse(req.body).confirmationToken
  )));
  app.post("/v1/analysis/start", route((req) => {
    const input = z.object({
      episodeId: id, provider: z.enum(["local", "openai"]).default("local"),
      cloudAuthorized: z.boolean().default(false),
      modelId: z.string().min(1).optional(),
      wordTimestamps: z.boolean().optional()
    }).parse(req.body);
    return service.startAnalysis(input.episodeId, input.provider, input.cloudAuthorized, {
      modelId: input.modelId,
      wordTimestamps: input.wordTimestamps
    });
  }));
  app.get("/v1/analysis/local-transcription/status", route(() =>
    service.transcriptionStatus()
  ));
  app.put("/v1/analysis/:episodeId/transcript", route((req) => service.setTranscript(
    id.parse(req.params.episodeId), z.array(transcriptSegmentSchema).parse(req.body.segments)
  )));
  app.get("/v1/jobs", (_req, res) => res.json(ok(service.listJobs())));
  app.post("/v1/jobs/:id/cancel", route((req) => service.cancelJob(id.parse(req.params.id))));
  app.get("/v1/candidates", route((req) => service.listCandidates(id.parse(req.query.episodeId))));
  app.post("/v1/candidates/generate", route((req) => {
    const input = candidateGenerateInput.parse(req.body);
    return service.generateCandidates(input.episodeId, input.count);
  }));
  app.post("/v1/candidates/:id/review", route((req) => service.reviewCandidate(
    id.parse(req.params.id), z.enum(["approved", "rejected"]).parse(req.body.status)
  )));
  app.post("/v1/shorts", route((req) => {
    const input = z.object({ candidateId: id, templateId: z.string().optional() }).parse(req.body);
    return service.createShort(input.candidateId, input.templateId);
  }));
  app.get("/v1/shorts/:id", route((req) => service.getShort(id.parse(req.params.id))));
  app.put("/v1/shorts/:id/composition", route((req) => service.updateComposition(
    id.parse(req.params.id), revision.parse(req.body.expectedRevision), compositionSchema.parse(req.body.composition)
  )));
  app.put("/v1/shorts/:id/copy", route((req) => {
    const project = service.getShort(id.parse(req.params.id));
    return service.updateCopy(project.id, revision.parse(req.body.expectedRevision),
      project.copy && z.object({
        cleanedTranscript: z.string(), rewrite: z.string(), hookVariants: z.array(z.string()),
        titles: z.array(z.string()), description: z.string(), hashtags: z.array(z.string()),
        thumbnailText: z.string()
      }).parse(req.body.copy));
  }));
  app.post("/v1/shorts/:id/approve", route((req) => service.approveShort(
    id.parse(req.params.id), revision.parse(req.body.expectedRevision)
  )));
  app.get("/v1/templates", (_req, res) => res.json(ok(service.listTemplates())));
  app.get("/v1/assets", (_req, res) => res.json(ok(service.listAssets())));
  app.post("/v1/assets/import", route((req) => {
    const input = z.object({
      path: z.string(), provenance: z.string().min(1), reusable: z.boolean().default(true)
    }).parse(req.body);
    return service.importAsset(input.path, input.provenance, input.reusable);
  }));
  app.get("/v1/renders", (req, res) => res.json(ok(service.listRenders(asString(req.query.shortId)))));
  app.post("/v1/renders/start", route((req) => {
    const input = z.object({ shortId: id, expectedRevision: revision }).parse(req.body);
    return service.startRender(input.shortId, input.expectedRevision);
  }));
  app.post("/v1/renders/validate", route((req) => service.validateRender(
    z.object({ path: z.string() }).parse(req.body).path
  )));
  app.post("/v1/schedule/draft", route((req) => {
    const input = z.object({
      shorts: z.array(z.object({
        shortId: id, renderId: id, episodeId: id, priority: z.number().int(), topic: z.string().optional()
      })),
      rules: scheduleRulesSchema
    }).parse(req.body);
    return service.draftSchedule(input.shorts, input.rules);
  }));
  app.get("/v1/schedule", (_req, res) => res.json(ok(service.getSchedule())));
  app.post("/v1/schedule/:id/move", route((req) => {
    const input = z.object({ expectedRevision: revision, publishAt: z.string().datetime() }).parse(req.body);
    return service.moveScheduleEntry(id.parse(req.params.id), input.expectedRevision, input.publishAt);
  }));
  app.post("/v1/schedule/:id/published", route((req) => {
    const input = z.object({ expectedRevision: revision, youtubeUrl: z.string().url().optional() }).parse(req.body);
    return service.markPublished(id.parse(req.params.id), input.expectedRevision, input.youtubeUrl);
  }));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const normalized = normalizeError(error);
    if (normalized.code === "INTERNAL_ERROR") console.error("Unexpected internal error");
    return res.status(normalized.status).json(errorEnvelope(normalized));
  });
  return app;
}

function route(handler: (request: Request) => unknown | Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try { res.json(ok(await handler(req))); } catch (error) { next(error); }
  };
}
function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
