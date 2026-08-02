import http from "node:http";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { PostgresEventRepository, PostgresProjectRepository } from "@siftcut/infrastructure";
import type { SessionVerifier } from "./auth.js";
import { createApp } from "./app.js";
import {
  ClerkIdentityRepository,
  ClerkOrganizationService,
  ClerkSessionVerifier,
  clerkWebhookHandler
} from "./clerk.js";
import { loadConfig, type RuntimeConfig } from "./config.js";
import { createJsonLogger, type StructuredLogger } from "./logging.js";
import { migrationReadiness } from "./migrations.js";
import { ProjectApiService } from "./project-service.js";
import type { OutboxPublisher } from "./publisher.js";

export interface RunningServer {
  server: http.Server;
  pool: Pool;
  shutdown(signal?: string): Promise<void>;
}

export async function startServer(options: {
  config?: RuntimeConfig;
  verifier?: SessionVerifier;
  logger?: StructuredLogger;
  publisher?: OutboxPublisher;
} = {}): Promise<RunningServer> {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createJsonLogger(undefined, [config.databaseUrl]);
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000
  });
  pool.on("error", () => logger.error("postgres_pool_error"));
  const identities = config.clerk ? new ClerkIdentityRepository(pool) : undefined;
  const organizations = config.clerk && identities
    ? new ClerkOrganizationService(config.clerk, identities)
    : undefined;
  const verifier = options.verifier
    ?? (config.clerk && identities
      ? new ClerkSessionVerifier(config.clerk, identities)
      : developmentVerifier(config));
  const projects = new PostgresProjectRepository(pool);
  const events = new PostgresEventRepository(pool);
  const sseControllers = new Set<AbortController>();
  const app = createApp(new ProjectApiService(projects), verifier, {
    events,
    readiness: () => migrationReadiness(pool),
    logger,
    sseControllers,
    bodyLimit: config.bodyLimit,
    ...(config.clerk && identities
      ? {
        clerkWebhook: clerkWebhookHandler(config.clerk, identities, Date.now, organizations),
        deleteOrganization: organizations!.deleteOrganization.bind(organizations)
      }
      : {})
  });
  const server = http.createServer(app);
  let activeRequests = 0;
  server.on("request", (_request, response) => {
    activeRequests += 1;
    response.once("close", () => { activeRequests -= 1; });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, () => {
      server.off("error", reject);
      resolve();
    });
  });
  options.publisher?.start();
  logger.info("api_started", { port: config.port, environment: config.nodeEnv });

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (signal = "manual") => shutdownPromise ??= (async () => {
    logger.info("api_shutdown_started", { signal, activeRequests });
    const closePromise = new Promise<void>((resolve) => server.close(() => resolve()));
    for (const controller of sseControllers) controller.abort();
    await options.publisher?.stop().catch(() => logger.error("publisher_shutdown_failed"));
    const timeout = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), config.shutdownTimeoutMs).unref();
    });
    const result = await Promise.race([closePromise.then(() => "closed" as const), timeout]);
    if (result === "timeout") {
      server.closeAllConnections();
      logger.error("api_shutdown_timeout", { activeRequests });
    }
    await pool.end();
    logger.info("api_stopped");
  })();

  return { server, pool, shutdown };
}

function developmentVerifier(config: RuntimeConfig): SessionVerifier {
  return {
    async verifyAuthorizationHeader(header) {
      const token = header.slice("Bearer ".length);
      const context = config.developmentTokens.get(token);
      if (!context) throw new Error("Invalid development token");
      return context;
    }
  };
}

async function main() {
  const running = await startServer();
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    void running.shutdown(signal).then(() => process.exit(0), () => process.exit(1));
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    const logger = createJsonLogger();
    logger.error("api_start_failed", {
      message: error instanceof Error ? error.message : "Unknown startup error"
    });
    process.exitCode = 1;
  });
}
