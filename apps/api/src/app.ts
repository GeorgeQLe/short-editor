import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import type { EventRepository } from "@siftcut/infrastructure";
import type { AuthenticatedContext, Project, UploadSession } from "@siftcut/saas-contracts";
import type { SessionVerifier } from "./auth.js";
import { contextOf, requireSession } from "./auth.js";
import { normalizeError } from "./errors.js";
import type { StructuredLogger } from "./logging.js";

export interface ApiRouteService {
  listProjects(context: AuthenticatedContext): Promise<Project[]>;
  getProject(context: AuthenticatedContext, projectId: string): Promise<Project>;
  createProject(context: AuthenticatedContext, raw: unknown): Promise<Project>;
  updateProject(context: AuthenticatedContext, projectId: string, raw: unknown): Promise<Project>;
  deleteProject(context: AuthenticatedContext, projectId: string, raw: unknown): Promise<Project>;
  createUpload?(context: AuthenticatedContext, raw: unknown): Promise<UploadSession>;
  signUploadParts?(context: AuthenticatedContext, uploadId: string, raw: unknown): Promise<unknown>;
  completeUpload?(context: AuthenticatedContext, uploadId: string, raw: unknown): Promise<UploadSession>;
  abortUpload?(context: AuthenticatedContext, uploadId: string): Promise<void>;
}

export interface AppOptions {
  events?: EventRepository;
  readiness?: () => Promise<{ ready: boolean; reason?: string }>;
  logger?: StructuredLogger;
  sseControllers?: Set<AbortController>;
  bodyLimit?: string;
}

export function createApp(
  service: ApiRouteService,
  verifier: SessionVerifier,
  eventRepositoryOrOptions?: EventRepository | AppOptions
) {
  const options: AppOptions = eventRepositoryOrOptions && "after" in eventRepositoryOrOptions
    ? { events: eventRepositoryOrOptions }
    : eventRepositoryOrOptions ?? {};
  const events = options.events;
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const startedAt = Date.now();
    const supplied = request.header("x-request-id");
    const requestId = supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
      ? supplied
      : randomUUID();
    response.setHeader("x-request-id", requestId);
    response.once("finish", () => options.logger?.info("http_request", {
      requestId,
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Date.now() - startedAt
    }));
    next();
  });
  app.use(express.json({ limit: options.bodyLimit ?? "1mb" }));
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/ready", async (_request, response) => {
    try {
      const readiness = await options.readiness?.() ?? { ready: true };
      response.status(readiness.ready ? 200 : 503).json({
        status: readiness.ready ? "ready" : "unavailable",
        ...(readiness.reason ? { reason: readiness.reason } : {})
      });
    } catch {
      response.status(503).json({ status: "unavailable", reason: "database_not_ready" });
    }
  });
  app.use("/v1", requireSession(verifier));

  app.get("/v1/projects", async (request, response, next) => {
    try {
      response.json({ apiVersion: "v1", data: await service.listProjects(contextOf(request)) });
    } catch (error) { next(error); }
  });
  app.post("/v1/projects", async (request, response, next) => {
    try {
      response.status(201).json({
        apiVersion: "v1",
        data: await service.createProject(contextOf(request), request.body)
      });
    } catch (error) { next(error); }
  });
  app.get("/v1/projects/:projectId", async (request, response, next) => {
    try {
      response.json({
        apiVersion: "v1",
        data: await service.getProject(contextOf(request), request.params.projectId!)
      });
    } catch (error) { next(error); }
  });
  app.put("/v1/projects/:projectId", async (request, response, next) => {
    try {
      response.json({
        apiVersion: "v1",
        data: await service.updateProject(
          contextOf(request), request.params.projectId!, request.body
        )
      });
    } catch (error) { next(error); }
  });
  app.delete("/v1/projects/:projectId", async (request, response, next) => {
    try {
      response.json({
        apiVersion: "v1",
        data: await service.deleteProject(
          contextOf(request), request.params.projectId!, request.body
        )
      });
    } catch (error) { next(error); }
  });
  if (service.createUpload && service.signUploadParts && service.completeUpload && service.abortUpload) {
  app.post("/v1/uploads", async (request, response, next) => {
    try {
      response.status(201).json({
        apiVersion: "v1",
        data: await service.createUpload!(contextOf(request), request.body)
      });
    } catch (error) { next(error); }
  });
  app.post("/v1/uploads/:uploadId/parts", async (request, response, next) => {
    try {
      response.json({
        apiVersion: "v1",
        data: await service.signUploadParts!(
          contextOf(request), request.params.uploadId!, request.body
        )
      });
    } catch (error) { next(error); }
  });
  app.post("/v1/uploads/:uploadId/complete", async (request, response, next) => {
    try {
      response.json({
        apiVersion: "v1",
        data: await service.completeUpload!(
          contextOf(request), request.params.uploadId!, request.body
        )
      });
    } catch (error) { next(error); }
  });
  app.delete("/v1/uploads/:uploadId", async (request, response, next) => {
    try {
      await service.abortUpload!(contextOf(request), request.params.uploadId!);
      response.status(204).end();
    } catch (error) { next(error); }
  });
  }

  app.get("/v1/events", async (request, response, next) => {
    if (!events) return next(new Error("Event repository is not configured"));
    try {
      const parsed = Number(request.header("last-event-id") ?? "0");
      const lastEventId = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
      response.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      });
      response.flushHeaders();
      let cursor = lastEventId;
      const records = await events.after(contextOf(request), cursor, 100);
      for (const event of records) {
        response.write(`id: ${event.id}\n`);
        response.write(`event: ${event.type}\n`);
        response.write(`data: ${JSON.stringify(event)}\n\n`);
        cursor = event.id;
      }
      const abort = new AbortController();
      options.sseControllers?.add(abort);
      request.once("close", () => abort.abort());
      try {
        for await (const event of events.stream(contextOf(request), cursor, abort.signal)) {
          response.write(`id: ${event.id}\n`);
          response.write(`event: ${event.type}\n`);
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      } finally {
        options.sseControllers?.delete(abort);
      }
      if (!response.writableEnded) response.end();
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      next(error);
    }
  });

  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    const normalized = normalizeError(error);
    const status = error && typeof error === "object" && "status" in error && error.status === 413
      ? 413
      : normalized.status;
    response.status(status).json({
      apiVersion: "v1",
      error: {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
        retryable: normalized.retryable
      }
    });
  };
  app.use(errors);
  return app;
}
