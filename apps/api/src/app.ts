import express, { type ErrorRequestHandler } from "express";
import type { EventRepository } from "@siftcut/infrastructure";
import type { SessionVerifier } from "./auth.js";
import { contextOf, requireSession } from "./auth.js";
import { normalizeError } from "./errors.js";
import type { ApiService } from "./service.js";

export function createApp(
  service: ApiService,
  verifier: SessionVerifier,
  events?: EventRepository
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
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
  app.post("/v1/uploads", async (request, response, next) => {
    try {
      response.status(201).json({
        apiVersion: "v1",
        data: await service.createUpload(contextOf(request), request.body)
      });
    } catch (error) { next(error); }
  });
  app.post("/v1/uploads/:uploadId/parts", async (request, response, next) => {
    try {
      response.json({
        apiVersion: "v1",
        data: await service.signUploadParts(
          contextOf(request), request.params.uploadId!, request.body
        )
      });
    } catch (error) { next(error); }
  });
  app.post("/v1/uploads/:uploadId/complete", async (request, response, next) => {
    try {
      response.json({
        apiVersion: "v1",
        data: await service.completeUpload(
          contextOf(request), request.params.uploadId!, request.body
        )
      });
    } catch (error) { next(error); }
  });
  app.delete("/v1/uploads/:uploadId", async (request, response, next) => {
    try {
      await service.abortUpload(contextOf(request), request.params.uploadId!);
      response.status(204).end();
    } catch (error) { next(error); }
  });

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
      request.once("close", () => abort.abort());
      for await (const event of events.stream(contextOf(request), cursor, abort.signal)) {
        response.write(`id: ${event.id}\n`);
        response.write(`event: ${event.type}\n`);
        response.write(`data: ${JSON.stringify(event)}\n\n`);
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
    response.status(normalized.status).json({
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
