import { authenticatedContextSchema, type AuthenticatedContext } from "@siftcut/saas-contracts";
import { z } from "zod";
import type { ClerkConfig } from "./clerk.js";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  DEV_AUTH_TOKENS: z.string().default("{}"),
  CLERK_ISSUER: z.string().url().optional(),
  CLERK_AUDIENCE: z.string().min(1).optional(),
  CLERK_AUTHORIZED_PARTIES: z.string().default(""),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  CLERK_JWT_KEY: z.string().min(1).optional(),
  CLERK_JWKS_URL: z.string().url().optional(),
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
  clerk?: ClerkConfig;
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
  const clerkFields = [
    parsed.data.CLERK_ISSUER,
    parsed.data.CLERK_AUDIENCE,
    parsed.data.CLERK_WEBHOOK_SIGNING_SECRET,
    parsed.data.CLERK_SECRET_KEY
  ];
  const hasClerk = clerkFields.some(Boolean);
  if (hasClerk && clerkFields.some((value) => !value)) {
    throw new Error(
      "Invalid runtime configuration: CLERK_ISSUER, CLERK_AUDIENCE, CLERK_WEBHOOK_SIGNING_SECRET, CLERK_SECRET_KEY"
    );
  }
  const authorizedParties = parsed.data.CLERK_AUTHORIZED_PARTIES
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (hasClerk && authorizedParties.length === 0) {
    throw new Error("Invalid runtime configuration: CLERK_AUTHORIZED_PARTIES");
  }
  if (parsed.data.NODE_ENV === "production" && !hasClerk) {
    throw new Error("Production Clerk authentication is required");
  }
  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    bodyLimit: parsed.data.BODY_LIMIT,
    shutdownTimeoutMs: parsed.data.SHUTDOWN_TIMEOUT_MS,
    developmentTokens: new Map(Object.entries(record.data)),
    ...(hasClerk ? {
      clerk: {
        issuer: parsed.data.CLERK_ISSUER!,
        audience: parsed.data.CLERK_AUDIENCE!,
        authorizedParties,
        webhookSigningSecret: parsed.data.CLERK_WEBHOOK_SIGNING_SECRET!,
        secretKey: parsed.data.CLERK_SECRET_KEY!,
        jwtKey: parsed.data.CLERK_JWT_KEY,
        jwksUrl: parsed.data.CLERK_JWKS_URL
      }
    } : {})
  };
}
