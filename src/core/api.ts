import cors from "cors";
import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import {
  assetImportInputSchema,
  audioUpdateInputSchema,
  candidateContentPackageAcceptInputSchema,
  captionUpdateInputSchema,
  compositionSchema,
  contentPackageSchema,
  cropReanalysisInputSchema,
  manualCropAddInputSchema,
  manualCropMoveInputSchema,
  manualCropRemoveInputSchema,
  renderPreflightRequestSchema,
  renderStartRequestSchema,
  scheduleDraftInputSchema,
  scheduleMarkPublishedInputSchema,
  scheduleMoveInputSchema,
  scheduleRuleUpdateInputSchema,
  shortApprovalInputSchema,
  shortTimelineUpdateInputSchema,
  templateCloneInputSchema,
  templateUpdateInputSchema,
  transcriptUpdateInputSchema
} from "../shared/domain.js";
import { AppError, errorEnvelope, normalizeError } from "../shared/errors.js";
import {
  candidateGenerateInput,
  confirmRelinkInput,
  type CoreService,
  importPathsInput,
  relinkSourceInput,
  watchedFolderConfigurationInput
} from "./service.js";

export const DEFAULT_API_HOST = "127.0.0.1";

export type ApiAccessClass = "public" | "desktop-token";
export interface ApiRouteInventoryEntry {
  operationId: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  access: ApiAccessClass;
  mutation: boolean;
  destructive: false;
  revisionRequired: boolean | "after-initial-creation";
  longRunning: boolean;
}

type RouteDefinition = ApiRouteInventoryEntry & {
  handle: (service: CoreService, request: Request) => unknown | Promise<unknown>;
};

const uuid = z.string().uuid();
const positiveRevision = z.number().int().positive();
const emptyBody = z.strictObject({});
const pagingFields = {
  limit: z.coerce.number().int().min(1).max(1_000).default(100),
  cursor: z.string().min(1).optional()
};
const pagingQuery = z.strictObject(pagingFields);
const episodeListQuery = z.strictObject({ ...pagingFields, search: z.string().optional() });
const artifactListQuery = z.strictObject(pagingFields);
const candidateListQuery = z.strictObject({ ...pagingFields, episodeId: uuid });
const shortListQuery = z.strictObject({ ...pagingFields, episodeId: uuid.optional() });
const renderListQuery = z.strictObject({ ...pagingFields, shortId: uuid.optional() });
const authorizationListQuery = z.strictObject({ ...pagingFields, scopeId: uuid.optional() });
const providerStatusQuery = z.strictObject({
  episodeId: uuid.optional(),
  authorizationBatchId: uuid.optional()
});
const ollamaStatusQuery = z.strictObject({ baseUrl: z.string().url().optional() });
const transcriptQuery = z.strictObject({
  revision: z.coerce.number().int().positive().optional()
});

const strictImportPathsInput = z.strictObject(importPathsInput.shape);
const candidateReviewInput = z.strictObject({
  expectedRevision: positiveRevision,
  status: z.enum(["approved", "rejected"])
});
const shortCreateInput = z.strictObject({
  candidateId: uuid,
  templateId: z.string().min(1).optional()
});
const compositionUpdateInput = z.strictObject({
  expectedRevision: positiveRevision,
  composition: compositionSchema
});
const copyUpdateInput = z.strictObject({
  expectedRevision: positiveRevision,
  copy: contentPackageSchema
});
const renderValidationInput = z.strictObject({ path: z.string().min(1) });
const manualCropMoveBody = manualCropMoveInputSchema.omit({ controlId: true });
const manualCropRemoveBody = manualCropRemoveInputSchema.omit({ controlId: true });

const analysisStartInput = z.strictObject({
  episodeId: uuid,
  provider: z.enum(["local", "openai"]).default("local"),
  modelId: z.string().min(1).optional(),
  wordTimestamps: z.boolean().optional(),
  speechMode: z.enum(["transcription", "diarization"]).optional(),
  timeoutMs: z.number().int().positive().optional(),
  authorizationBatchId: uuid.optional()
});
const ollamaStartInput = z.strictObject({
  episodeId: uuid,
  baseUrl: z.string().url().optional(),
  modelId: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
  networkDisclosed: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  intervalMs: z.number().int().positive().optional(),
  maximumSamples: z.number().int().positive().optional()
});
const openAiStartInput = z.strictObject({
  episodeId: uuid,
  modelId: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  intervalMs: z.number().int().positive().optional(),
  maximumSamples: z.number().int().positive().optional(),
  authorizationBatchId: uuid.optional()
});
const synchronizeCredentialsInput = z.strictObject({
  handles: z.array(z.string().min(1)).max(100)
});
const grantAuthorizationInput = z.strictObject({
  scopeType: z.enum(["project", "batch"]),
  scopeId: uuid,
  provider: z.enum(["openai", "ollama"]),
  operationClasses: z.array(z.enum(["transcription", "analysis"])).min(1),
  credentialHandle: z.string().min(1).nullable(),
  dataDescription: z.string().min(1).max(500),
  networkUseConfirmed: z.literal(true),
  costsConfirmed: z.literal(true)
});
const validateAuthorizationInput = z.strictObject({
  scopeType: z.enum(["project", "batch"]),
  scopeId: uuid,
  provider: z.literal("openai"),
  operationClass: z.enum(["transcription", "analysis"]),
  credentialHandle: z.string().min(1)
});

function body<T>(schema: z.ZodType<T>, request: Request): T {
  return schema.parse(request.body ?? {});
}

function query<T>(schema: z.ZodType<T>, request: Request): T {
  return schema.parse(request.query);
}

function route(
  operationId: string,
  method: ApiRouteInventoryEntry["method"],
  path: string,
  options: Partial<Pick<ApiRouteInventoryEntry, "access" | "revisionRequired" | "longRunning">>,
  handle: RouteDefinition["handle"]
): RouteDefinition {
  return {
    operationId,
    method,
    path,
    access: options.access ?? "public",
    mutation: method !== "GET",
    destructive: false,
    revisionRequired: options.revisionRequired ?? false,
    longRunning: options.longRunning ?? false,
    handle
  };
}

const routes: readonly RouteDefinition[] = [
  route("system.health", "GET", "/v1/health", {}, (_service, req) => {
    query(z.strictObject({}), req);
    return { status: "ok" };
  }),
  route("library.listEpisodes", "GET", "/v1/library/episodes", {}, (service, req) => {
    const input = query(episodeListQuery, req);
    return paginate(service.listEpisodes(input.search), input, "library.listEpisodes", { search: input.search ?? "" });
  }),
  route("library.getEpisode", "GET", "/v1/library/episodes/:id", {}, (service, req) => {
    query(z.strictObject({}), req);
    return service.getEpisode(uuid.parse(req.params.id));
  }),
  route("library.importPaths", "POST", "/v1/library/import", {}, (service, req) =>
    service.importPaths(body(strictImportPathsInput, req).paths)),
  route("library.listWatchedFolders", "GET", "/v1/library/watched-folders", {}, (service, req) => {
    const input = query(pagingQuery, req);
    return paginate(service.listWatchedFolders(), input, "library.listWatchedFolders", {});
  }),
  route("library.configureWatchedFolder", "POST", "/v1/library/watched-folders/configure", {}, (service, req) =>
    service.configureWatchedFolder(body(watchedFolderConfigurationInput, req))),
  route("library.rescanWatchedFolder", "POST", "/v1/library/watched-folders/:id/rescan", { longRunning: true }, (service, req) => {
    body(emptyBody, req);
    return service.rescanWatchedFolder(uuid.parse(req.params.id));
  }),
  route("library.relinkSource", "POST", "/v1/library/episodes/:id/relink", {}, (service, req) =>
    service.relinkSource(uuid.parse(req.params.id), body(relinkSourceInput, req).candidatePath)),
  route("library.confirmRelink", "POST", "/v1/library/episodes/:id/relink/confirm", {}, (service, req) =>
    service.confirmRelink(uuid.parse(req.params.id), body(confirmRelinkInput, req).confirmationToken)),
  route("analysis.start", "POST", "/v1/analysis/start", { longRunning: true }, (service, req) => {
    const input = body(analysisStartInput, req);
    return service.startAnalysis(input.episodeId, input.provider, {
      modelId: input.modelId,
      wordTimestamps: input.wordTimestamps,
      speechMode: input.speechMode,
      timeoutMs: input.timeoutMs,
      authorizationBatchId: input.authorizationBatchId
    });
  }),
  route("analysis.localTranscriptionStatus", "GET", "/v1/analysis/local-transcription/status", {}, (service, req) => {
    query(z.strictObject({}), req);
    return service.transcriptionStatus();
  }),
  route("analysis.startOllama", "POST", "/v1/analysis/ollama/start", { longRunning: true }, (service, req) => {
    const input = body(ollamaStartInput, req);
    return service.startOllamaAnalysis(input.episodeId, input);
  }),
  route("analysis.startOpenAi", "POST", "/v1/analysis/openai/start", { longRunning: true }, (service, req) => {
    const input = body(openAiStartInput, req);
    return service.startOpenAiAnalysis(input.episodeId, input);
  }),
  route("providers.listCapabilities", "GET", "/v1/providers/capabilities", {}, (service, req) => {
    query(z.strictObject({}), req);
    return service.listProviderCapabilities();
  }),
  route("providers.getStatus", "GET", "/v1/providers/status", {}, (service, req) =>
    service.getProviderStatus(query(providerStatusQuery, req))),
  route("analysis.ollamaStatus", "GET", "/v1/analysis/ollama/status", {}, (service, req) => {
    const input = query(ollamaStatusQuery, req);
    return input.baseUrl ? service.ollamaStatus(input.baseUrl) : service.ollamaStatus();
  }),
  route("analysis.listArtifacts", "GET", "/v1/analysis/:episodeId/artifacts", {}, (service, req) => {
    const input = query(artifactListQuery, req);
    const episodeId = uuid.parse(req.params.episodeId);
    return paginate(service.listAnalysisArtifacts(episodeId), input, "analysis.listArtifacts", { episodeId });
  }),
  route("analysis.getTranscript", "GET", "/v1/analysis/:episodeId/transcript", {}, (service, req) => {
    const input = query(transcriptQuery, req);
    return service.getTranscript(uuid.parse(req.params.episodeId), input.revision);
  }),
  route("analysis.updateTranscript", "PUT", "/v1/analysis/:episodeId/transcript", { revisionRequired: true }, (service, req) => {
    const input = body(transcriptUpdateInputSchema, req);
    return service.updateTranscript(uuid.parse(req.params.episodeId), input.expectedRevision, input.language, input.segments);
  }),
  route("jobs.list", "GET", "/v1/jobs", {}, (service, req) => {
    const input = query(pagingQuery, req);
    return paginate(service.listJobs(), input, "jobs.list", {});
  }),
  route("jobs.cancel", "POST", "/v1/jobs/:id/cancel", {}, (service, req) => {
    body(emptyBody, req);
    return service.cancelJob(uuid.parse(req.params.id));
  }),
  route("candidates.list", "GET", "/v1/candidates", {}, (service, req) => {
    const input = query(candidateListQuery, req);
    return paginate(service.listCandidates(input.episodeId), input, "candidates.list", { episodeId: input.episodeId });
  }),
  route("candidates.generate", "POST", "/v1/candidates/generate", {}, (service, req) =>
    service.generateCandidates(body(candidateGenerateInput, req))),
  route("candidates.review", "POST", "/v1/candidates/:id/review", { revisionRequired: true }, (service, req) => {
    const input = body(candidateReviewInput, req);
    return service.reviewCandidate(uuid.parse(req.params.id), input.expectedRevision, input.status);
  }),
  route("candidates.getContentPackage", "GET", "/v1/candidates/:id/content-package", {}, (service, req) => {
    query(z.strictObject({}), req);
    return service.getCandidateContentPackage(uuid.parse(req.params.id));
  }),
  route("candidates.acceptContentPackage", "PUT", "/v1/candidates/:id/content-package", { revisionRequired: true }, (service, req) => {
    const input = body(candidateContentPackageAcceptInputSchema, req);
    return service.acceptCandidateContentPackage(uuid.parse(req.params.id), input.expectedRevision, input.contentPackage);
  }),
  route("shorts.create", "POST", "/v1/shorts", {}, (service, req) => {
    const input = body(shortCreateInput, req);
    return service.createShort(input.candidateId, input.templateId);
  }),
  route("shorts.list", "GET", "/v1/shorts", {}, (service, req) => {
    const input = query(shortListQuery, req);
    return paginate(service.listShorts(input.episodeId), input, "shorts.list", {
      episodeId: input.episodeId ?? null
    });
  }),
  route("shorts.get", "GET", "/v1/shorts/:id", {}, (service, req) => {
    query(z.strictObject({}), req);
    return service.getShort(uuid.parse(req.params.id));
  }),
  route("shorts.updateComposition", "PUT", "/v1/shorts/:id/composition", { revisionRequired: true }, (service, req) => {
    const input = body(compositionUpdateInput, req);
    return service.updateComposition(uuid.parse(req.params.id), input.expectedRevision, input.composition);
  }),
  route("shorts.updateTimeline", "PUT", "/v1/shorts/:id/timeline", { revisionRequired: true }, (service, req) => {
    const input = body(shortTimelineUpdateInputSchema, req);
    return service.updateTimeline(uuid.parse(req.params.id), input.expectedRevision, input.sourceRanges);
  }),
  route("shorts.updateCaptions", "PUT", "/v1/shorts/:id/captions", { revisionRequired: true }, (service, req) =>
    service.updateCaptions(uuid.parse(req.params.id), body(captionUpdateInputSchema, req))),
  route("shorts.updateAudio", "PUT", "/v1/shorts/:id/audio", { revisionRequired: true }, (service, req) =>
    service.updateAudio(uuid.parse(req.params.id), body(audioUpdateInputSchema, req))),
  route("shorts.updateCopy", "PUT", "/v1/shorts/:id/copy", { revisionRequired: true }, (service, req) => {
    const input = body(copyUpdateInput, req);
    return service.updateCopy(uuid.parse(req.params.id), input.expectedRevision, input.copy);
  }),
  route("shorts.approve", "POST", "/v1/shorts/:id/approve", { revisionRequired: true }, (service, req) => {
    const input = body(shortApprovalInputSchema, req);
    return service.approveShort(uuid.parse(req.params.id), input.expectedRevision);
  }),
  route("shorts.reanalyzeCrops", "POST", "/v1/shorts/:id/crops/reanalyze", { revisionRequired: true, longRunning: true }, (service, req) =>
    service.reanalyzeCrops(uuid.parse(req.params.id), body(cropReanalysisInputSchema, req))),
  route("shorts.addManualCropControl", "POST", "/v1/shorts/:id/layers/:layerId/crops/manual", { revisionRequired: true }, (service, req) =>
    service.addManualCropControl(uuid.parse(req.params.id), z.string().min(1).parse(req.params.layerId), body(manualCropAddInputSchema, req))),
  route("shorts.moveManualCropControl", "PUT", "/v1/shorts/:id/layers/:layerId/crops/manual/:controlId", { revisionRequired: true }, (service, req) => {
    const input = body(manualCropMoveBody, req);
    return service.moveManualCropControl(uuid.parse(req.params.id), z.string().min(1).parse(req.params.layerId), {
      ...input, controlId: uuid.parse(req.params.controlId)
    });
  }),
  route("shorts.removeManualCropControl", "DELETE", "/v1/shorts/:id/layers/:layerId/crops/manual/:controlId", { revisionRequired: true }, (service, req) => {
    const input = body(manualCropRemoveBody, req);
    return service.removeManualCropControl(uuid.parse(req.params.id), z.string().min(1).parse(req.params.layerId), {
      ...input, controlId: uuid.parse(req.params.controlId)
    });
  }),
  route("templates.list", "GET", "/v1/templates", {}, (service, req) => {
    const input = query(pagingQuery, req);
    return paginate(service.listTemplates(), input, "templates.list", {});
  }),
  route("templates.clone", "POST", "/v1/templates/:id/clone", {}, (service, req) => {
    const input = body(templateCloneInputSchema, req);
    return service.cloneTemplate(z.string().min(1).parse(req.params.id), input.name, input.description);
  }),
  route("templates.update", "PUT", "/v1/templates/:id", { revisionRequired: true }, (service, req) => {
    const input = body(templateUpdateInputSchema, req);
    const { expectedRevision, ...patch } = input;
    return service.updateTemplate(z.string().min(1).parse(req.params.id), expectedRevision, patch);
  }),
  route("assets.list", "GET", "/v1/assets", {}, (service, req) => {
    const input = query(pagingQuery, req);
    return paginate(service.listAssets(), input, "assets.list", {});
  }),
  route("assets.import", "POST", "/v1/assets/import", {}, (service, req) => {
    const input = body(assetImportInputSchema, req);
    return service.importAsset(input.path, input.provenance, input.reusable);
  }),
  route("renders.list", "GET", "/v1/renders", {}, (service, req) => {
    const input = query(renderListQuery, req);
    return paginate(service.listRenders(input.shortId), input, "renders.list", { shortId: input.shortId ?? null });
  }),
  route("renders.preflight", "POST", "/v1/renders/preflight", { revisionRequired: true }, (service, req) => {
    const input = body(renderPreflightRequestSchema, req);
    return service.preflightRender(input.shortId, input.expectedRevision);
  }),
  route("renders.start", "POST", "/v1/renders/start", { revisionRequired: true, longRunning: true }, (service, req) =>
    service.startRenderAttempt(body(renderStartRequestSchema, req))),
  route("renders.retry", "POST", "/v1/renders/:renderId/retry", { longRunning: true }, (service, req) => {
    body(emptyBody, req);
    return service.retryRenderAttempt(uuid.parse(req.params.renderId));
  }),
  route("renders.validate", "POST", "/v1/renders/validate", {}, (service, req) =>
    service.validateRender(body(renderValidationInput, req).path)),
  route("schedule.draft", "POST", "/v1/schedule/draft", { revisionRequired: true }, (service, req) => {
    const input = body(scheduleDraftInputSchema, req);
    return service.draftSchedule(input.shorts, input.expectedRulesRevision);
  }),
  route("schedule.getRules", "GET", "/v1/schedule/rules", {}, (service, req) => {
    query(z.strictObject({}), req);
    return service.getScheduleRules();
  }),
  route("schedule.updateRules", "PUT", "/v1/schedule/rules", { revisionRequired: "after-initial-creation" }, (service, req) =>
    service.updateScheduleRules(body(scheduleRuleUpdateInputSchema, req))),
  route("schedule.list", "GET", "/v1/schedule", {}, (service, req) => {
    const input = query(pagingQuery, req);
    return paginate(service.getSchedule(), input, "schedule.list", {});
  }),
  route("schedule.move", "POST", "/v1/schedule/:id/move", { revisionRequired: true }, (service, req) => {
    const input = body(scheduleMoveInputSchema, req);
    return service.moveScheduleEntry(uuid.parse(req.params.id), input.expectedRevision, input.publishAt);
  }),
  route("schedule.markPublished", "POST", "/v1/schedule/:id/published", { revisionRequired: true }, (service, req) => {
    const input = body(scheduleMarkPublishedInputSchema, req);
    return service.markPublished(uuid.parse(req.params.id), input.expectedRevision, input.youtubeUrl);
  }),
  route("desktop.synchronizeCredentials", "POST", "/v1/desktop/credentials/synchronize", { access: "desktop-token" }, (service, req) => {
    const input = body(synchronizeCredentialsInput, req);
    service.synchronizeCredentialHandles(input.handles);
    return { synchronized: input.handles.length };
  }),
  route("desktop.credentialRemoved", "POST", "/v1/desktop/credentials/:handle/removed", { access: "desktop-token" }, (service, req) => {
    body(emptyBody, req);
    service.removeCredentialHandle(z.string().min(1).parse(req.params.handle));
    return { revoked: true };
  }),
  route("desktop.listCloudAuthorizations", "GET", "/v1/desktop/cloud-authorizations", { access: "desktop-token" }, (service, req) => {
    const input = query(authorizationListQuery, req);
    return paginate(service.listCloudAuthorizations(input.scopeId), input, "desktop.listCloudAuthorizations", {
      scopeId: input.scopeId ?? null
    });
  }),
  route("desktop.grantCloudAuthorization", "POST", "/v1/desktop/cloud-authorizations", { access: "desktop-token" }, (service, req) =>
    service.grantCloudAuthorization(body(grantAuthorizationInput, req))),
  route("desktop.revokeCloudAuthorization", "POST", "/v1/desktop/cloud-authorizations/:id/revoke", { access: "desktop-token" }, (service, req) => {
    body(emptyBody, req);
    service.revokeCloudAuthorization(uuid.parse(req.params.id));
    return { revoked: true };
  }),
  route("desktop.validateCloudAuthorization", "POST", "/v1/desktop/cloud-authorizations/validate", { access: "desktop-token" }, (service, req) => ({
    authorized: service.validateCloudAuthorization(body(validateAuthorizationInput, req))
  }))
];

export const API_ROUTE_INVENTORY: readonly ApiRouteInventoryEntry[] = Object.freeze(
  routes.map(({ handle: _handle, ...metadata }) => Object.freeze(metadata))
);

export function serializeApiRouteInventory(): string {
  return `${JSON.stringify([...API_ROUTE_INVENTORY].sort((left, right) =>
    left.operationId.localeCompare(right.operationId)), null, 2)}\n`;
}

export function createApi(service: CoreService, desktopToken?: string) {
  const app = express();
  app.use(cors({ origin: ["http://localhost:5173", "app://short-editor"] }));
  app.use(express.json({ limit: "2mb" }));

  const desktopOnly: RequestHandler = (req, res, next) => {
    const supplied = req.header("x-short-editor-desktop-token");
    if (!desktopToken || !supplied || !safeEqual(desktopToken, supplied)) {
      return res.status(403).json(errorEnvelope(new AppError(
        "CLOUD_NOT_AUTHORIZED",
        "This security gate is available only through the desktop application",
        403
      )));
    }
    next();
  };

  for (const definition of routes) {
    const handlers: RequestHandler[] = [];
    if (definition.access === "desktop-token") handlers.push(desktopOnly);
    handlers.push(async (req, res, next) => {
      try {
        res.json({ apiVersion: "v1", data: await definition.handle(service, req) });
      } catch (error) {
        next(error);
      }
    });
    app[definition.method.toLowerCase() as "get" | "post" | "put" | "delete"](
      definition.path,
      ...handlers
    );
  }

  app.use("/v1", (_req, res) => res.status(404).json(errorEnvelope(
    new AppError("NOT_FOUND", "API operation not found", 404)
  )));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const malformedJson = error instanceof SyntaxError
      && typeof error === "object"
      && error !== null
      && "type" in error
      && error.type === "entity.parse.failed";
    const normalized = malformedJson
      ? new AppError("VALIDATION_ERROR", "Invalid request", 422)
      : normalizeError(error);
    if (normalized.code === "INTERNAL_ERROR") console.error("Unexpected internal error");
    return res.status(normalized.status).json(errorEnvelope(normalized));
  });
  return app;
}

function paginate<T extends { id: string }>(
  items: readonly T[],
  request: { limit: number; cursor?: string },
  operationId: string,
  filters: Record<string, unknown>
): { items: T[]; nextCursor: string | null } {
  let start = 0;
  if (request.cursor) {
    const decoded = decodeCursor(request.cursor);
    if (decoded.operationId !== operationId || stableJson(decoded.filters) !== stableJson(filters)) {
      throw invalidCursor();
    }
    const index = items.findIndex((item) => item.id === decoded.lastId);
    if (index < 0) throw invalidCursor();
    start = index + 1;
  }
  const pageItems = items.slice(start, start + request.limit);
  const hasMore = start + pageItems.length < items.length;
  return {
    items: pageItems,
    nextCursor: hasMore
      ? Buffer.from(JSON.stringify({
        version: 1,
        operationId,
        filters,
        lastId: pageItems.at(-1)!.id
      })).toString("base64url")
      : null
  };
}

function decodeCursor(value: string): {
  version: 1;
  operationId: string;
  filters: Record<string, unknown>;
  lastId: string;
} {
  try {
    const parsed = z.strictObject({
      version: z.literal(1),
      operationId: z.string().min(1),
      filters: z.record(z.string(), z.json()),
      lastId: z.string().min(1)
    }).parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (Buffer.from(JSON.stringify(parsed)).toString("base64url") !== value) throw invalidCursor();
    return parsed;
  } catch {
    throw invalidCursor();
  }
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  ));
}

function invalidCursor(): AppError {
  return new AppError("VALIDATION_ERROR", "Invalid or stale pagination cursor", 422);
}

function safeEqual(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}
