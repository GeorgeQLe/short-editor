import { z } from "zod";
import { SaasError } from "./errors.js";

export const TEAM_SIZES = ["solo", "2-5", "6-10", "11-25", "26+"] as const;
export const CONTENT_TYPES = ["podcast", "youtube", "studio", "other"] as const;
export const MONTHLY_HOURS = ["under-10", "10-25", "26-50", "51-100", "100+"] as const;

const requestSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  teamName: z.string().trim().max(160).optional(),
  teamSize: z.enum(TEAM_SIZES),
  contentType: z.enum(CONTENT_TYPES),
  monthlyHours: z.enum(MONTHLY_HOURS),
  notes: z.string().trim().max(1000).optional(),
  consent: z.literal(true),
  turnstileToken: z.string().trim().min(1).max(2048)
}).strict();

export type BetaAccessRequest = z.infer<typeof requestSchema>;

export function parseBetaAccessRequest(raw: unknown): BetaAccessRequest {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SaasError("VALIDATION_ERROR", "Beta access request is invalid", {
      fields: [...new Set(parsed.error.issues.map((issue) => issue.path[0] ?? "body"))]
    });
  }
  return parsed.data;
}

export async function verifyTurnstile(options: {
  token: string;
  secret?: string;
  environment: string;
  testBypassToken?: string;
  fetcher?: typeof fetch;
}): Promise<void> {
  if (options.environment !== "production" && options.testBypassToken
    && options.token === options.testBypassToken) return;
  if (!options.secret) {
    if (options.environment === "production") {
      throw new SaasError("VALIDATION_ERROR", "Request verification is unavailable");
    }
    throw new SaasError("VALIDATION_ERROR", "Request verification failed");
  }
  let success = false;
  try {
    const body = new URLSearchParams({ secret: options.secret, response: options.token });
    const response = await (options.fetcher ?? fetch)(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body }
    );
    const result = await response.json() as { success?: unknown };
    success = response.ok && result.success === true;
  } catch {
    success = false;
  }
  if (!success) throw new SaasError("VALIDATION_ERROR", "Request verification failed");
}

export async function storeBetaAccessRequest(
  db: D1Database,
  request: BetaAccessRequest,
  now = new Date()
): Promise<void> {
  const timestamp = now.toISOString();
  await db.prepare(`INSERT INTO beta_access_requests
    (id,email,name,team_name,team_size,content_type,monthly_hours,notes,
     consented_at,status,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'pending','landing_page',?,?)
    ON CONFLICT(email) DO NOTHING`)
    .bind(crypto.randomUUID(), request.email, request.name, request.teamName || null,
      request.teamSize, request.contentType, request.monthlyHours, request.notes || null,
      timestamp, timestamp, timestamp)
    .run();
}
