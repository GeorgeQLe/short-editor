import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import type { EventRepository } from "@siftcut/infrastructure";
import type {
  AuthenticatedContext,
  Project,
  PublicScreenletterShare,
  ScreenletterEditLaunch,
  ScreenletterRecording,
  UploadSession
} from "@siftcut/saas-contracts";
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
  listRecordings?(context: AuthenticatedContext): Promise<ScreenletterRecording[]>;
  getRecording?(
    context: AuthenticatedContext,
    recordingId: string
  ): Promise<ScreenletterRecording>;
  createRecording?(
    context: AuthenticatedContext,
    raw: unknown
  ): Promise<ScreenletterRecording>;
  deleteRecording?(
    context: AuthenticatedContext,
    recordingId: string
  ): Promise<ScreenletterRecording>;
  retryRecording?(
    context: AuthenticatedContext,
    recordingId: string
  ): Promise<ScreenletterRecording>;
  startEdit?(
    context: AuthenticatedContext,
    recordingId: string,
    raw: unknown
  ): Promise<ScreenletterEditLaunch>;
  publish?(
    context: AuthenticatedContext,
    recordingId: string,
    raw: unknown
  ): Promise<ScreenletterRecording>;
  rollback?(
    context: AuthenticatedContext,
    recordingId: string,
    raw: unknown
  ): Promise<ScreenletterRecording>;
  resolveShare?(shareToken: string): Promise<PublicScreenletterShare>;
  reportAbuse?(
    shareToken: string,
    raw: unknown,
    reporterFingerprint?: string
  ): Promise<void>;
}

export interface AppOptions {
  events?: EventRepository;
  readiness?: () => Promise<{ ready: boolean; reason?: string }>;
  logger?: StructuredLogger;
  sseControllers?: Set<AbortController>;
  bodyLimit?: string;
  clerkWebhook?: RequestHandler;
  deleteOrganization?: (context: AuthenticatedContext, raw: unknown) => Promise<void>;
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
  if (options.clerkWebhook) {
    app.post(
      "/webhooks/clerk",
      express.raw({ type: "application/json", limit: options.bodyLimit ?? "1mb" }),
      options.clerkWebhook
    );
  }
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
  if (service.resolveShare && service.reportAbuse) {
    app.get("/v1/share/:shareToken", async (request, response, next) => {
      try {
        response.set({
          "Cache-Control": "private, no-store",
          "X-Robots-Tag": "noindex, nofollow"
        });
        response.json({
          apiVersion: "v1",
          data: await service.resolveShare!(request.params.shareToken!)
        });
      } catch (error) { next(error); }
    });
    app.post("/v1/share/:shareToken/report", async (request, response, next) => {
      try {
        await service.reportAbuse!(
          request.params.shareToken!,
          request.body,
          request.ip
        );
        response.status(202).json({ apiVersion: "v1", data: { accepted: true } });
      } catch (error) { next(error); }
    });
    app.get("/s/:shareToken", (request, response) => {
      const token = JSON.stringify(request.params.shareToken).replace(/</g, "\\u003c");
      response.set({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Content-Security-Policy": "default-src 'self'; media-src https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
      });
      response.send(screenletterViewer(token));
    });
  }
  app.use("/v1", requireSession(verifier));

  app.get("/v1/session", (request, response) => {
    const context = contextOf(request);
    response.set("Cache-Control", "private, no-store");
    response.json({ apiVersion: "v1", data: context });
  });
  if (options.deleteOrganization) {
    app.delete("/v1/organization", async (request, response, next) => {
      try {
        await options.deleteOrganization!(contextOf(request), request.body);
        response.status(204).end();
      } catch (error) { next(error); }
    });
  }

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

  if (service.createRecording && service.listRecordings && service.getRecording
    && service.deleteRecording && service.retryRecording && service.startEdit
    && service.publish && service.rollback) {
    app.get("/v1/screenletter/recordings", async (request, response, next) => {
      try {
        response.json({
          apiVersion: "v1",
          data: await service.listRecordings!(contextOf(request))
        });
      } catch (error) { next(error); }
    });
    app.post("/v1/screenletter/recordings", async (request, response, next) => {
      try {
        response.status(201).json({
          apiVersion: "v1",
          data: await service.createRecording!(contextOf(request), request.body)
        });
      } catch (error) { next(error); }
    });
    app.get("/v1/screenletter/recordings/:recordingId", async (request, response, next) => {
      try {
        response.json({
          apiVersion: "v1",
          data: await service.getRecording!(
            contextOf(request), request.params.recordingId!
          )
        });
      } catch (error) { next(error); }
    });
    app.delete("/v1/screenletter/recordings/:recordingId", async (request, response, next) => {
      try {
        response.json({
          apiVersion: "v1",
          data: await service.deleteRecording!(
            contextOf(request), request.params.recordingId!
          )
        });
      } catch (error) { next(error); }
    });
    app.post("/v1/screenletter/recordings/:recordingId/retry", async (request, response, next) => {
      try {
        response.json({
          apiVersion: "v1",
          data: await service.retryRecording!(
            contextOf(request), request.params.recordingId!
          )
        });
      } catch (error) { next(error); }
    });
    app.post("/v1/screenletter/recordings/:recordingId/edit", async (request, response, next) => {
      try {
        response.json({
          apiVersion: "v1",
          data: await service.startEdit!(
            contextOf(request), request.params.recordingId!, request.body
          )
        });
      } catch (error) { next(error); }
    });
    app.post("/v1/screenletter/recordings/:recordingId/publish", async (request, response, next) => {
      try {
        response.json({
          apiVersion: "v1",
          data: await service.publish!(
            contextOf(request), request.params.recordingId!, request.body
          )
        });
      } catch (error) { next(error); }
    });
    app.post("/v1/screenletter/recordings/:recordingId/rollback", async (request, response, next) => {
      try {
        response.json({
          apiVersion: "v1",
          data: await service.rollback!(
            contextOf(request), request.params.recordingId!, request.body
          )
        });
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

function screenletterViewer(tokenLiteral: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="robots" content="noindex,nofollow"><title>Screenletter</title>
<style>body{margin:0;background:#0d0f12;color:#f5f6f8;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{width:min(960px,92vw)}video{width:100%;max-height:78vh;background:#000;border-radius:16px}p{color:#a9b0ba}</style>
</head><body><main class="card"><h1 id="title">Screenletter</h1><video id="video" controls playsinline></video><p id="status">Loading…</p></main>
<script>fetch("/v1/share/"+encodeURIComponent(${tokenLiteral})).then(r=>r.ok?r.json():Promise.reject()).then(({data})=>{document.title=data.name+" · Screenletter";document.querySelector("#title").textContent=data.name;document.querySelector("#video").src=data.previewUrl;document.querySelector("#status").textContent="Shared privately with Screenletter";}).catch(()=>{document.querySelector("#status").textContent="This Screenletter is unavailable.";});</script>
</body></html>`;
}
