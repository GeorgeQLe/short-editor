import { Hono, type Context, type MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { authenticatedContextSchema, jobEnvelopeSchema, type AuthenticatedContext } from "@siftcut/saas-contracts";
import {
  D1EntitlementRepository,
  D1EventRepository,
  D1JobControl,
  D1ProjectRepository,
  D1ScreenletterRepository,
  D1TransactionalOutbox,
  D1UploadRepository,
  D1UsageRepository
} from "@siftcut/infrastructure";
import { ApiService } from "./service.js";
import { normalizeError, SaasError } from "./errors.js";
import { R2ArtifactStorage } from "./r2.js";
import { ScreenletterService } from "./screenletter-service.js";
import {
  parseBetaAccessRequest,
  storeBetaAccessRequest,
  verifyTurnstile
} from "./beta-access.js";

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  INGEST_QUEUE: Queue;
  ANALYSIS_QUEUE: Queue;
  RENDER_QUEUE: Queue;
  ASSETS: Fetcher;
  PUBLIC_BASE_URL: string;
  CLERK_ISSUER: string;
  CLERK_AUDIENCE: string;
  CLERK_AUTHORIZED_PARTIES: string;
  CLERK_WEBHOOK_SIGNING_SECRET: string;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
  DEV_AUTH_TOKENS?: string;
  MEDIA_TOKEN_SIGNING_SECRET: string;
  INTERNAL_WORKER_TOKEN: string;
  SCREENLETTER_ABUSE_HASH_SALT?: string;
  ENVIRONMENT: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_TEST_BYPASS_TOKEN?: string;
}
type Variables = { auth: AuthenticatedContext; requestId: string };
type Bindings = { Bindings: Env; Variables: Variables };

export function createWorkerApp() {
  const app = new Hono<Bindings>();
  app.use("*", async (context, next) => {
    const supplied = context.req.header("x-request-id");
    const requestId = supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
      ? supplied : crypto.randomUUID();
    context.set("requestId", requestId);
    await next();
    context.header("x-request-id", requestId);
  });
  app.get("/health", (context) => context.json({ status: "ok" }));
  app.get("/ready", async (context) => {
    try {
      await context.env.DB.prepare("SELECT 1").first();
      const migration = await context.env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1").first();
      return migration ? context.json({ status: "ready" })
        : context.json({ status: "unavailable", reason: "schema_stale" }, 503);
    } catch { return context.json({ status: "unavailable", reason: "database_not_ready" }, 503); }
  });

  app.post("/v1/beta-access-requests", async (context) => {
    const contentLength = Number(context.req.header("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 16_384) {
      throw new SaasError("VALIDATION_ERROR", "Beta access request is too large");
    }
    const rawText = await context.req.text();
    if (new TextEncoder().encode(rawText).byteLength > 16_384) {
      throw new SaasError("VALIDATION_ERROR", "Beta access request is too large");
    }
    let raw: unknown;
    try { raw = JSON.parse(rawText); }
    catch { throw new SaasError("VALIDATION_ERROR", "Invalid JSON body"); }
    const request = parseBetaAccessRequest(raw);
    await verifyTurnstile({
      token: request.turnstileToken,
      secret: context.env.TURNSTILE_SECRET_KEY,
      environment: context.env.ENVIRONMENT,
      testBypassToken: context.env.TURNSTILE_TEST_BYPASS_TOKEN
    });
    await storeBetaAccessRequest(context.env.DB, request);
    return context.json(envelope({ accepted: true }), 202, {
      "cache-control": "no-store"
    });
  });

  app.post("/webhooks/clerk", async (context) => {
    const eventId = requiredHeader(context, "svix-id");
    const timestamp = requiredHeader(context, "svix-timestamp");
    const signatures = requiredHeader(context, "svix-signature");
    if (!Number.isSafeInteger(Number(timestamp)) || Math.abs(Date.now() - Number(timestamp) * 1000) > 300_000)
      throw new SaasError("AUTHENTICATION_REQUIRED", "Webhook timestamp is invalid");
    const raw = await context.req.text();
    if (!await verifySvix(context.env.CLERK_WEBHOOK_SIGNING_SECRET, `${eventId}.${timestamp}.${raw}`, signatures))
      throw new SaasError("AUTHENTICATION_REQUIRED", "Webhook signature is invalid");
    const event = JSON.parse(raw) as { type?: unknown; data?: unknown };
    if (typeof event.type !== "string" || !event.data || typeof event.data !== "object")
      throw new SaasError("VALIDATION_ERROR", "Webhook payload is invalid");
    const result = await applyClerkWebhook(context.env.DB, eventId, event.type,
      event.data as Record<string, unknown>, await sha256(raw));
    return context.json({ received: true, result });
  });

  app.put("/media/upload/:token", async (context) => {
    const storage = storageFor(context);
    const token = await storage.verify(context.req.param("token"), "upload");
    if (!token?.uploadId || !Number.isInteger(token.partNumber) || token.partNumber! < 1) {
      return context.json({ apiVersion: "v1", error: errorBody("AUTHENTICATION_REQUIRED", "Upload URL is invalid or expired") }, 401);
    }
    const body = context.req.raw.body;
    if (!body) return context.json({ apiVersion: "v1", error: errorBody("VALIDATION_ERROR", "Part body is required") }, 422);
    const part = await context.env.MEDIA.resumeMultipartUpload(token.objectKey, token.uploadId)
      .uploadPart(token.partNumber!, body);
    return context.json({ etag: part.etag, partNumber: part.partNumber });
  });
  app.get("/media/read/:token", async (context) => {
    const token = await storageFor(context).verify(context.req.param("token"), "read");
    if (!token) return context.json({ apiVersion: "v1", error: errorBody("AUTHENTICATION_REQUIRED", "Media URL is invalid or expired") }, 401);
    const range = parseRange(context.req.header("range"));
    if (range === "invalid") return new Response(null, { status: 416 });
    const object = await context.env.MEDIA.get(token.objectKey, range ? { range } : undefined);
    if (!object) return context.json({ apiVersion: "v1", error: errorBody("OBJECT_UNAVAILABLE", "Media object is unavailable") }, 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("accept-ranges", "bytes");
    if (range && "offset" in range) {
      const returned = object.range && "offset" in object.range ? object.range : undefined;
      const offset = returned?.offset ?? range.offset ?? 0;
      const length = returned?.length ?? ("length" in range && range.length !== undefined
        ? range.length : object.size - offset);
      headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set("content-length", String(length));
      return new Response(object.body, { status: 206, headers });
    }
    headers.set("content-length", String(object.size));
    return new Response(object.body, { headers });
  });

  app.get("/v1/share/:shareToken", async (context) => context.json(envelope(
    await screenletterFor(context).resolveShare(context.req.param("shareToken"))), 200,
    { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow" }));
  app.post("/v1/share/:shareToken/report", async (context) => {
    await screenletterFor(context).reportAbuse(context.req.param("shareToken"), await jsonBody(context),
      context.req.header("cf-connecting-ip"));
    return context.json(envelope({ accepted: true }), 202);
  });
  app.get("/s/:shareToken", (context) => context.html(screenletterViewer(context.req.param("shareToken")), 200,
    { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow",
      "content-security-policy": "default-src 'self'; media-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" }));

  app.use("/v1/*", sessionMiddleware());
  app.get("/v1/session", (context) => context.json(envelope(context.get("auth")), 200,
    { "cache-control": "private, no-store" }));
  app.delete("/v1/organization", async (context) => {
    const auth = context.get("auth");
    if (auth.role !== "owner") throw new SaasError("FORBIDDEN_ROLE", "Only an owner can delete the organization");
    const authenticatedAt = auth.authenticatedAt ? new Date(auth.authenticatedAt).getTime() : 0;
    if (!authenticatedAt || Date.now() - authenticatedAt > 300_000)
      return context.json({ clerk_error: { type: "forbidden", reason: "reverification-error",
        metadata: { reverification: "strict" } } }, 403);
    const body = await jsonBody(context) as { confirmation?: unknown };
    const organization = await context.env.DB.prepare(`SELECT clerk_organization_id,name FROM organizations
      WHERE id=? AND state<>'deleting'`).bind(auth.organizationId)
      .first<{ clerk_organization_id: string; name: string }>();
    if (!organization) throw new SaasError("NOT_FOUND", "Organization not found");
    if (body.confirmation !== organization.name)
      throw new SaasError("VALIDATION_ERROR", "Organization name confirmation does not match");
    const response = await fetch(`https://api.clerk.com/v1/organizations/${encodeURIComponent(organization.clerk_organization_id)}`,
      { method: "DELETE", headers: { authorization: `Bearer ${context.env.CLERK_SECRET_KEY}` } });
    if (!response.ok) throw new SaasError("INTERNAL_ERROR", "The identity provider could not delete the organization",
      null, response.status >= 500);
    const now = new Date();
    await context.env.DB.prepare(`UPDATE organizations SET state='deleting',deletion_requested_at=?,purge_after=?,updated_at=?
      WHERE id=? AND state<>'deleting'`).bind(now.toISOString(), new Date(now.getTime() + 86400000).toISOString(),
      now.toISOString(), auth.organizationId).run();
    return context.body(null, 204);
  });
  app.get("/v1/projects", async (context) => context.json(envelope(
    await serviceFor(context).listProjects(context.get("auth")))));
  app.post("/v1/projects", async (context) => context.json(envelope(
    await serviceFor(context).createProject(context.get("auth"), await jsonBody(context))), 201));
  app.get("/v1/projects/:projectId", async (context) => context.json(envelope(
    await serviceFor(context).getProject(context.get("auth"), context.req.param("projectId")))));
  app.put("/v1/projects/:projectId", async (context) => context.json(envelope(
    await serviceFor(context).updateProject(context.get("auth"), context.req.param("projectId"),
      await jsonBody(context)))));
  app.delete("/v1/projects/:projectId", async (context) => context.json(envelope(
    await serviceFor(context).deleteProject(context.get("auth"), context.req.param("projectId"),
      await jsonBody(context)))));
  app.post("/v1/uploads", async (context) => context.json(envelope(
    await serviceFor(context).createUpload(context.get("auth"), await jsonBody(context))), 201));
  app.post("/v1/uploads/:uploadId/parts", async (context) => context.json(envelope(
    await serviceFor(context).signUploadParts(context.get("auth"), context.req.param("uploadId"),
      await jsonBody(context)))));
  app.post("/v1/uploads/:uploadId/complete", async (context) => context.json(envelope(
    await serviceFor(context).completeUpload(context.get("auth"), context.req.param("uploadId"),
      await jsonBody(context)))));
  app.delete("/v1/uploads/:uploadId", async (context) => {
    await serviceFor(context).abortUpload(context.get("auth"), context.req.param("uploadId"));
    return context.body(null, 204);
  });
  app.get("/v1/screenletter/recordings", async (context) => context.json(envelope(
    await screenletterFor(context).listRecordings(context.get("auth")))));
  app.post("/v1/screenletter/recordings", async (context) => context.json(envelope(
    await screenletterFor(context).createRecording(context.get("auth"), await jsonBody(context))), 201));
  app.get("/v1/screenletter/recordings/:recordingId", async (context) => context.json(envelope(
    await screenletterFor(context).getRecording(context.get("auth"), context.req.param("recordingId")))));
  app.delete("/v1/screenletter/recordings/:recordingId", async (context) => context.json(envelope(
    await screenletterFor(context).deleteRecording(context.get("auth"), context.req.param("recordingId")))));
  app.post("/v1/screenletter/recordings/:recordingId/retry", async (context) => context.json(envelope(
    await screenletterFor(context).retryRecording(context.get("auth"), context.req.param("recordingId")))));
  app.post("/v1/screenletter/recordings/:recordingId/edit", async (context) => context.json(envelope(
    await screenletterFor(context).startEdit(context.get("auth"), context.req.param("recordingId"),
      await jsonBody(context)))));
  app.post("/v1/screenletter/recordings/:recordingId/publish", async (context) => context.json(envelope(
    await screenletterFor(context).publish(context.get("auth"), context.req.param("recordingId"),
      await jsonBody(context)))));
  app.post("/v1/screenletter/recordings/:recordingId/rollback", async (context) => context.json(envelope(
    await screenletterFor(context).rollback(context.get("auth"), context.req.param("recordingId"),
      await jsonBody(context)))));
  app.get("/v1/events", async (context) => {
    const parsed = Number(context.req.header("last-event-id") ?? "0");
    let cursor = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
    const events = new D1EventRepository(context.env.DB, 1_000);
    return streamSSE(context, async (stream) => {
      const deadline = Date.now() + 50_000;
      while (!stream.closed && Date.now() < deadline) {
        const records = await events.after(context.get("auth"), cursor, 100);
        for (const event of records) {
          cursor = event.id;
          await stream.writeSSE({ id: String(event.id), event: event.type,
            data: JSON.stringify(event) });
        }
        if (!records.length) await stream.sleep(1_000);
      }
    }, async (error) => { throw error; });
  });

  app.use("/internal/*", internalMiddleware());
  app.get("/internal/media/*", async (context) => {
    const objectKey = context.req.path.slice("/internal/media/".length);
    if (!objectKey.startsWith("orgs/")) throw new SaasError("VALIDATION_ERROR", "Media object key is invalid");
    const object = await context.env.MEDIA.get(objectKey);
    if (!object) throw new SaasError("OBJECT_UNAVAILABLE", "Media object is unavailable");
    const headers = new Headers({ "content-length": String(object.size), etag: object.httpEtag });
    object.writeHttpMetadata(headers);
    return new Response(object.body, { headers });
  });
  app.post("/internal/jobs/:jobId/claim", async (context) => {
    const job = jobEnvelopeSchema.parse(await jsonBody(context));
    if (job.jobId !== context.req.param("jobId")) throw new SaasError("VALIDATION_ERROR", "Job ID does not match envelope");
    const jobs = new D1JobControl(context.env.DB);
    await jobs.assertOrganizationOwnsInputs(job);
    return context.json({ result: await jobs.claim(job) });
  });
  app.get("/internal/jobs/:jobId/cancellation", async (context) => context.json({
    cancellationRequested: await new D1JobControl(context.env.DB).cancellationRequested(context.req.param("jobId"))
  }));
  app.post("/internal/jobs/:jobId/heartbeat", async (context) => {
    const body = await jsonBody(context) as { stage?: unknown; progress?: unknown };
    if (typeof body.stage !== "string" || typeof body.progress !== "number" || body.progress < 0 || body.progress > 1)
      throw new SaasError("VALIDATION_ERROR", "Heartbeat is invalid");
    await new D1JobControl(context.env.DB).heartbeat(context.req.param("jobId"), body.stage, body.progress);
    return context.json({ accepted: true });
  });
  app.post("/internal/jobs/:jobId/success", async (context) => {
    const body = await jsonBody(context);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SaasError("VALIDATION_ERROR", "Result is invalid");
    await new D1JobControl(context.env.DB).succeed(context.req.param("jobId"), body as Record<string, unknown>);
    return context.json({ accepted: true });
  });
  app.post("/internal/jobs/:jobId/failure", async (context) => {
    const body = await jsonBody(context) as { code?: unknown; message?: unknown; retryable?: unknown };
    if (typeof body.code !== "string" || typeof body.message !== "string" || typeof body.retryable !== "boolean")
      throw new SaasError("VALIDATION_ERROR", "Failure is invalid");
    await new D1JobControl(context.env.DB).fail(context.req.param("jobId"), body as { code: string; message: string; retryable: boolean });
    return context.json({ accepted: true });
  });

  app.onError((error, context) => {
    const normalized = normalizeError(error);
    return context.json({ apiVersion: "v1", error: errorBody(normalized.code, normalized.message,
      normalized.details, normalized.retryable) }, normalized.status as 400);
  });
  app.notFound(async (context) => {
    if (context.req.path.startsWith("/v1/") || context.req.path.startsWith("/internal/")
      || context.req.path.startsWith("/media/")) {
      return context.json({ apiVersion: "v1", error: errorBody("NOT_FOUND", "Route not found") }, 404);
    }
    return context.env.ASSETS.fetch(context.req.raw);
  });
  return app;
}

const app = createWorkerApp();
export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, execution: ExecutionContext) {
    execution.waitUntil(publishOutbox(env));
  }
} satisfies ExportedHandler<Env>;

async function publishOutbox(env: Env): Promise<number> {
  const outbox = new D1TransactionalOutbox(env.DB);
  const records = await outbox.claim(50);
  await Promise.all(records.map(async (record) => {
    try {
      const queue = record.envelope.kind === "render" ? env.RENDER_QUEUE
        : record.envelope.kind === "ingest" || record.envelope.kind === "delete"
          ? env.INGEST_QUEUE : env.ANALYSIS_QUEUE;
      await queue.send(record.envelope, { contentType: "json" });
      await outbox.markDelivered(record.outboxId, record.claimToken);
    } catch {
      await outbox.markFailed(record.outboxId, record.claimToken,
        new Date(Date.now() + Math.min(300_000, 1000 * 2 ** Math.min(record.attempt - 1, 8))));
    }
  }));
  return records.length;
}

function serviceFor(context: Context<Bindings>) {
  return new ApiService({
    projects: new D1ProjectRepository(context.env.DB), uploads: new D1UploadRepository(context.env.DB),
    usage: new D1UsageRepository(context.env.DB), entitlements: new D1EntitlementRepository(context.env.DB),
    storage: storageFor(context)
  });
}
function storageFor(context: Context<Bindings>) {
  return new R2ArtifactStorage(context.env.MEDIA, context.env.DB, context.env.PUBLIC_BASE_URL,
    context.env.MEDIA_TOKEN_SIGNING_SECRET);
}
function screenletterFor(context: Context<Bindings>) {
  return new ScreenletterService(new D1ScreenletterRepository(context.env.DB), storageFor(context), {
    editorBaseUrl: context.env.PUBLIC_BASE_URL, abuseHashSalt: context.env.SCREENLETTER_ABUSE_HASH_SALT
  });
}
function sessionMiddleware(): MiddlewareHandler<Bindings> {
  return async (context, next) => {
    const authorization = context.req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) throw new SaasError("AUTHENTICATION_REQUIRED", "A valid session is required");
    const token = authorization.slice(7);
    let auth: AuthenticatedContext | undefined;
    if (context.env.DEV_AUTH_TOKENS) {
      const tokens = JSON.parse(context.env.DEV_AUTH_TOKENS) as Record<string, unknown>;
      if (tokens[token]) auth = authenticatedContextSchema.parse(tokens[token]);
    }
    auth ??= await verifyClerk(context.env, token);
    context.set("auth", auth);
    await next();
  };
}
async function verifyClerk(env: Env, token: string): Promise<AuthenticatedContext> {
  try {
    const key = createRemoteJWKSet(new URL(`${env.CLERK_ISSUER.replace(/\/$/, "")}/.well-known/jwks.json`));
    const verified = await jwtVerify<JWTPayload & { sid?: string; azp?: string; org_id?: string;
      org_role?: string; fva?: [number, number]; o?: { id?: string; rol?: string } }>(token, key,
      { issuer: env.CLERK_ISSUER, audience: env.CLERK_AUDIENCE, algorithms: ["RS256"] });
    const claims = verified.payload;
    if (!claims.sub || !claims.sid || !claims.azp
      || !env.CLERK_AUTHORIZED_PARTIES.split(",").map((value) => value.trim()).includes(claims.azp)) throw new Error();
    const clerkOrg = claims.o?.id ?? claims.org_id;
    const claimedRole = (claims.o?.rol ?? claims.org_role)?.replace(/^org:/, "");
    const row = await env.DB.prepare(`SELECT u.id user_id,o.id organization_id,m.role FROM users u
      JOIN memberships m ON m.user_id=u.id AND m.state='active'
      JOIN organizations o ON o.id=m.organization_id AND o.state<>'deleting'
      WHERE u.clerk_user_id=? AND o.clerk_organization_id=?`).bind(claims.sub, clerkOrg).first<{
        user_id: string; organization_id: string; role: string }>();
    if (!row || row.role !== claimedRole) throw new Error();
    const factorAges = Array.isArray(claims.fva)
      ? claims.fva.filter((age) => Number.isFinite(age) && age >= 0) : [];
    return authenticatedContextSchema.parse({ userId: row.user_id, organizationId: row.organization_id,
      role: row.role, sessionId: claims.sid, ...(claims.iat && factorAges.length
        ? { authenticatedAt: new Date(claims.iat * 1000 - Math.min(...factorAges) * 60000).toISOString() }
        : {}) });
  } catch { throw new SaasError("AUTHENTICATION_REQUIRED", "The session is invalid or expired"); }
}
function internalMiddleware(): MiddlewareHandler<Bindings> {
  return async (context, next) => {
    if (context.req.header("authorization") !== `Bearer ${context.env.INTERNAL_WORKER_TOKEN}`)
      throw new SaasError("AUTHENTICATION_REQUIRED", "Worker authentication is required");
    await next();
  };
}
async function jsonBody(context: Context<Bindings>): Promise<unknown> {
  try { return await context.req.json(); }
  catch { throw new SaasError("VALIDATION_ERROR", "Invalid JSON body"); }
}
function envelope<T>(data: T) { return { apiVersion: "v1" as const, data }; }
function errorBody(code: string, message: string, details: unknown = null, retryable = false) {
  return { code, message, details, retryable };
}
function parseRange(value?: string): R2Range | "invalid" | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!match) return "invalid";
  const offset = Number(match[1]);
  const end = match[2] ? Number(match[2]) : undefined;
  if (!Number.isSafeInteger(offset) || (end !== undefined && (!Number.isSafeInteger(end) || end < offset))) return "invalid";
  return end === undefined ? { offset } : { offset, length: end - offset + 1 };
}

function requiredHeader(context: Context<Bindings>, name: string): string {
  const value = context.req.header(name);
  if (!value) throw new SaasError("AUTHENTICATION_REQUIRED", `Missing ${name} header`);
  return value;
}
async function verifySvix(secret: string, message: string, header: string): Promise<boolean> {
  try {
    const keyBytes = base64Bytes(secret.startsWith("whsec_") ? secret.slice(6) : secret);
    const key = await crypto.subtle.importKey("raw", new Uint8Array(keyBytes).buffer,
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
    return header.split(" ").some((item) => {
      const actual = base64Bytes(item.includes(",") ? item.slice(item.indexOf(",") + 1) : item);
      if (actual.length !== expected.length) return false;
      let difference = 0;
      for (let index = 0; index < actual.length; index++) difference |= actual[index]! ^ expected[index]!;
      return difference === 0;
    });
  } catch { return false; }
}
async function applyClerkWebhook(db: D1Database, eventId: string, type: string,
  data: Record<string, unknown>, payloadHash: string): Promise<"applied" | "duplicate" | "stale"> {
  const existing = await db.prepare("SELECT payload_hash,processed_at FROM webhook_events WHERE provider='clerk' AND event_id=?")
    .bind(eventId).first<{ payload_hash: string; processed_at: string | null }>();
  if (existing && existing.payload_hash !== payloadHash)
    throw new SaasError("VALIDATION_ERROR", "Webhook event ID was reused");
  if (existing?.processed_at) return "duplicate";
  const now = new Date().toISOString();
  const id = typeof data.id === "string" ? data.id : "";
  const statements: D1PreparedStatement[] = [db.prepare(`INSERT OR IGNORE INTO webhook_events
    (provider,event_id,event_type,payload_hash,received_at) VALUES ('clerk',?,?,?,?)`)
    .bind(eventId, type, payloadHash, now)];
  let applied = true;
  if (type === "user.created" || type === "user.updated") {
    const email = Array.isArray(data.email_addresses)
      ? (data.email_addresses[0] as { email_address?: unknown } | undefined)?.email_address : null;
    statements.push(db.prepare(`INSERT INTO users (id,clerk_user_id,primary_email,created_at,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(clerk_user_id) DO UPDATE SET
      primary_email=excluded.primary_email,updated_at=excluded.updated_at`)
      .bind(crypto.randomUUID(), id, typeof email === "string" ? email : null, now, now));
  } else if (type === "organization.created" || type === "organization.updated") {
    statements.push(db.prepare(`INSERT INTO organizations
      (id,clerk_organization_id,name,state,created_at,updated_at) VALUES (?,?,?,'active',?,?)
      ON CONFLICT(clerk_organization_id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`)
      .bind(crypto.randomUUID(), id, typeof data.name === "string" ? data.name : "SiftCut", now, now));
  } else if (type.startsWith("organizationMembership.")) {
    const organization = data.organization as { id?: unknown } | undefined;
    const publicUser = data.public_user_data as { user_id?: unknown } | undefined;
    const role = typeof data.role === "string" ? data.role.replace(/^org:/, "") : "viewer";
    statements.push(db.prepare(`INSERT INTO memberships
      (organization_id,user_id,clerk_membership_id,role,state,created_at,updated_at)
      SELECT o.id,u.id,?,?,?, ?,? FROM organizations o,users u
      WHERE o.clerk_organization_id=? AND u.clerk_user_id=?
      ON CONFLICT(organization_id,user_id) DO UPDATE SET
      role=excluded.role,state=excluded.state,updated_at=excluded.updated_at`)
      .bind(id, role, type.endsWith("deleted") ? "revoked" : "active", now, now,
        typeof organization?.id === "string" ? organization.id : "",
        typeof publicUser?.user_id === "string" ? publicUser.user_id : ""));
  } else applied = false;
  statements.push(db.prepare("UPDATE webhook_events SET processed_at=? WHERE provider='clerk' AND event_id=?")
    .bind(now, eventId));
  await db.batch(statements);
  return applied ? "applied" : "stale";
}
async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function base64Bytes(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function screenletterViewer(token: string): string {
  const literal = JSON.stringify(token).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Screenletter</title><style>body{margin:0;background:#0d0f12;color:#f5f6f8;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{width:min(960px,92vw)}video{width:100%;max-height:78vh;background:#000;border-radius:16px}p{color:#a9b0ba}</style></head><body><main class="card"><h1 id="title">Screenletter</h1><video id="video" controls playsinline></video><p id="status">Loading…</p></main><script>fetch("/v1/share/"+encodeURIComponent(${literal})).then(r=>r.ok?r.json():Promise.reject()).then(({data})=>{document.title=data.name+" · Screenletter";document.querySelector("#title").textContent=data.name;document.querySelector("#video").src=data.previewUrl;document.querySelector("#status").textContent="Shared privately with Screenletter";}).catch(()=>{document.querySelector("#status").textContent="This Screenletter is unavailable.";});</script></body></html>`;
}
