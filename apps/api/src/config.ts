import { authenticatedContextSchema, type AuthenticatedContext } from "@siftcut/saas-contracts";
import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  DEV_AUTH_TOKENS: z.string().default("{}"),
  BODY_LIMIT: z.string().regex(/^\d+(kb|mb)$/i).default("1mb"),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000)
});

export interface RuntimeConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  bodyLimit: string;
  shutdownTimeoutMs: number;
  developmentTokens: ReadonlyMap<string, AuthenticatedContext>;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "environment"))];
    throw new Error(`Invalid runtime configuration: ${names.join(", ")}`);
  }
  let rawTokens: unknown;
  try { rawTokens = JSON.parse(parsed.data.DEV_AUTH_TOKENS); }
  catch { throw new Error("Invalid runtime configuration: DEV_AUTH_TOKENS"); }
  const record = z.record(z.string().min(1), authenticatedContextSchema).safeParse(rawTokens);
  if (!record.success) throw new Error("Invalid runtime configuration: DEV_AUTH_TOKENS");
  if (parsed.data.NODE_ENV === "production" && Object.keys(record.data).length) {
    throw new Error("Development authentication is forbidden in production");
  }
  if (parsed.data.NODE_ENV === "production") {
    throw new Error("Production authentication is not configured; Clerk is deferred to M2");
  }
  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    bodyLimit: parsed.data.BODY_LIMIT,
    shutdownTimeoutMs: parsed.data.SHUTDOWN_TIMEOUT_MS,
    developmentTokens: new Map(Object.entries(record.data))
  };
}
