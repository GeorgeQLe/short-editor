import {
  createHash,
  createHmac,
  timingSafeEqual
} from "node:crypto";
import {
  createRemoteJWKSet,
  importSPKI,
  jwtVerify,
  type JWTPayload
} from "jose";
import type { Pool, PoolClient } from "pg";
import type { RequestHandler } from "express";
import { z } from "zod";
import {
  authenticatedContextSchema,
  type AuthenticatedContext,
  type OrganizationRole
} from "@siftcut/saas-contracts";
import type { SessionVerifier } from "./auth.js";
import { SaasError } from "./errors.js";

export interface ClerkConfig {
  issuer: string;
  audience: string;
  authorizedParties: readonly string[];
  webhookSigningSecret: string;
  secretKey: string;
  jwtKey?: string;
  jwksUrl?: string;
}

interface ClerkClaims extends JWTPayload {
  sid?: string;
  azp?: string;
  sts?: string;
  fva?: [number, number];
  org_id?: string;
  org_role?: string;
  o?: {
    id?: string;
    rol?: string;
  };
}

export const STRICT_REVERIFICATION_PAYLOAD = {
  clerk_error: {
    type: "forbidden",
    reason: "reverification-error",
    metadata: {
      reverification: "strict"
    }
  }
} as const;

export class ClerkReverificationRequiredError extends Error {
  readonly status = 403;
  readonly body = STRICT_REVERIFICATION_PAYLOAD;

  constructor() {
    super("Recent authentication is required");
    this.name = "ClerkReverificationRequiredError";
  }
}

export interface ClerkWebhookEvent {
  data: Record<string, unknown>;
  object?: string;
  type: string;
  timestamp?: number;
}

export class ClerkIdentityRepository {
  constructor(private readonly pool: Pool) {}

  async resolveSession(
    clerkUserId: string,
    clerkOrganizationId: string,
    claimedRole: OrganizationRole
  ): Promise<AuthenticatedContext | null> {
    const organization = await this.pool.query(`
      SELECT id FROM organizations
      WHERE clerk_organization_id = $1 AND state <> 'deleting'
    `, [clerkOrganizationId]);
    if (!organization.rowCount) return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await setOrganization(client, organization.rows[0].id);
      const result = await client.query(`
        SELECT u.id AS user_id, m.role
        FROM users u JOIN memberships m ON m.user_id = u.id
        WHERE u.clerk_user_id = $1 AND m.organization_id = $2 AND m.state = 'active'
      `, [clerkUserId, organization.rows[0].id]);
      await client.query("COMMIT");
      if (!result.rowCount || result.rows[0].role !== claimedRole) return null;
      return {
        userId: result.rows[0].user_id,
        organizationId: organization.rows[0].id,
        role: result.rows[0].role,
        sessionId: ""
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async organizationForContext(context: AuthenticatedContext): Promise<{
    clerkOrganizationId: string;
    name: string;
  } | null> {
    const result = await this.pool.query(`
      SELECT clerk_organization_id, name FROM organizations
      WHERE id = $1 AND state <> 'deleting'
    `, [context.organizationId]);
    if (!result.rowCount) return null;
    return {
      clerkOrganizationId: result.rows[0].clerk_organization_id,
      name: result.rows[0].name
    };
  }

  async markOrganizationDeleting(organizationId: string, requestedAt: Date): Promise<void> {
    await this.pool.query(`
      UPDATE organizations
      SET state = 'deleting', deletion_requested_at = $2,
          purge_after = $2::timestamptz + interval '24 hours', updated_at = $2
      WHERE id = $1 AND state <> 'deleting'
    `, [organizationId, requestedAt.toISOString()]);
  }

  async applyWebhook(
    eventId: string,
    event: ClerkWebhookEvent,
    payloadHash: string
  ): Promise<"applied" | "duplicate" | "stale"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(`
        SELECT payload_hash, processed_at FROM webhook_events
        WHERE provider = 'clerk' AND event_id = $1 FOR UPDATE
      `, [eventId]);
      if (existing.rowCount) {
        if (existing.rows[0].payload_hash !== payloadHash) {
          throw new SaasError("VALIDATION_ERROR", "Webhook event ID was reused");
        }
        if (existing.rows[0].processed_at) {
          await client.query("COMMIT");
          return "duplicate";
        }
      } else {
        await client.query(`
          INSERT INTO webhook_events (provider, event_id, event_type, payload_hash)
          VALUES ('clerk', $1, $2, $3)
        `, [eventId, event.type, payloadHash]);
      }
      const applied = await applyClerkEvent(client, event);
      await client.query(`
        UPDATE webhook_events SET processed_at = now()
        WHERE provider = 'clerk' AND event_id = $1
      `, [eventId]);
      await client.query("COMMIT");
      return applied ? "applied" : "stale";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export class ClerkSessionVerifier implements SessionVerifier {
  private readonly key: Promise<CryptoKey> | ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly config: ClerkConfig,
    private readonly identities: ClerkIdentityRepository
  ) {
    this.key = config.jwtKey
      ? importSPKI(normalizePem(config.jwtKey), "RS256")
      : createRemoteJWKSet(new URL(
        config.jwksUrl ?? `${config.issuer.replace(/\/$/, "")}/.well-known/jwks.json`
      ));
  }

  async verifyAuthorizationHeader(header: string): Promise<AuthenticatedContext> {
    const token = header.slice("Bearer ".length);
    const key = this.key instanceof Promise ? await this.key : this.key;
    const verified = await jwtVerify<ClerkClaims>(token, key, {
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: ["RS256"],
      clockTolerance: 5
    });
    const claims = verified.payload;
    if (claims.sts === "pending") throw new Error("Organization enrollment is incomplete");
    if (!claims.azp || !this.config.authorizedParties.includes(claims.azp)) {
      throw new Error("The token authorized party is not allowed");
    }
    const organizationId = claims.o?.id ?? claims.org_id;
    const organizationRole = claims.o?.rol ?? claims.org_role;
    if (!claims.sub || !claims.sid || !organizationId || !organizationRole) {
      throw new Error("The session has no active organization");
    }
    const role = clerkRole(organizationRole);
    const synchronized = await this.identities.resolveSession(claims.sub, organizationId, role);
    if (!synchronized) throw new Error("The organization membership is not active");
    const factorAgeMinutes = Array.isArray(claims.fva)
      ? claims.fva.filter((age) => Number.isFinite(age) && age >= 0)
      : [];
    return authenticatedContextSchema.parse({
      ...synchronized,
      sessionId: claims.sid,
      ...(claims.iat && factorAgeMinutes.length
        ? {
          authenticatedAt: new Date(
            claims.iat * 1000 - Math.min(...factorAgeMinutes) * 60 * 1000
          ).toISOString()
        }
        : {})
    });
  }
}

const deleteOrganizationInputSchema = z.strictObject({
  confirmation: z.string().min(1)
});

export class ClerkOrganizationService {
  constructor(
    private readonly config: ClerkConfig,
    private readonly identities: ClerkIdentityRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly request: typeof fetch = fetch
  ) {}

  async ensurePersonalOrganization(event: ClerkWebhookEvent): Promise<void> {
    if (event.type !== "user.created") return;
    const clerkUserId = text(event.data.id);
    const givenName = [
      optionalText(event.data.first_name),
      optionalText(event.data.last_name)
    ].filter(Boolean).join(" ").trim();
    const name = givenName ? `${givenName}'s Screenletter` : "My Screenletter";
    const slug = `screenletter-${createHash("sha256")
      .update(clerkUserId)
      .digest("hex")
      .slice(0, 20)}`;
    const response = await this.request("https://api.clerk.com/v1/organizations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name,
        slug,
        created_by: clerkUserId,
        public_metadata: { product: "screenletter", personal: true }
      })
    });
    // A deterministic slug makes webhook redelivery idempotent even if the
    // first response was lost after Clerk committed the organization.
    if (response.ok || response.status === 422) return;
    throw new SaasError(
      "INTERNAL_ERROR",
      "The identity provider could not create the personal organization",
      null,
      response.status >= 500
    );
  }

  async deleteOrganization(context: AuthenticatedContext, raw: unknown): Promise<void> {
    if (context.role !== "owner") {
      throw new SaasError("FORBIDDEN_ROLE", "Only an owner can delete the organization");
    }
    const authenticatedAt = context.authenticatedAt
      ? new Date(context.authenticatedAt).getTime()
      : 0;
    const now = this.now();
    if (authenticatedAt > now.getTime()
      || now.getTime() - authenticatedAt > 5 * 60 * 1000) {
      throw new ClerkReverificationRequiredError();
    }
    const organization = await this.identities.organizationForContext(context);
    if (!organization) throw new SaasError("NOT_FOUND", "Organization not found");
    const input = deleteOrganizationInputSchema.parse(raw);
    if (input.confirmation !== organization.name) {
      throw new SaasError("VALIDATION_ERROR", "Organization name confirmation does not match");
    }
    const response = await this.request(
      `https://api.clerk.com/v1/organizations/${encodeURIComponent(
        organization.clerkOrganizationId
      )}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          "Content-Type": "application/json"
        }
      }
    );
    if (!response.ok) {
      throw new SaasError(
        "INTERNAL_ERROR",
        "The identity provider could not delete the organization",
        null,
        response.status >= 500
      );
    }
    await this.identities.markOrganizationDeleting(context.organizationId, now);
  }
}

export function clerkWebhookHandler(
  config: ClerkConfig,
  identities: ClerkIdentityRepository,
  now: () => number = Date.now,
  organizations?: ClerkOrganizationService
): RequestHandler {
  return async (request, response, next) => {
    try {
      if (!Buffer.isBuffer(request.body)) {
        throw new SaasError("VALIDATION_ERROR", "Webhook body must be raw");
      }
      const eventId = requiredHeader(request.header("svix-id"));
      const timestamp = requiredHeader(request.header("svix-timestamp"));
      const signatures = requiredHeader(request.header("svix-signature"));
      const timestampSeconds = Number(timestamp);
      if (!Number.isSafeInteger(timestampSeconds)
        || Math.abs(now() - timestampSeconds * 1000) > 5 * 60 * 1000) {
        throw new SaasError("AUTHENTICATION_REQUIRED", "Webhook timestamp is invalid");
      }
      verifyStandardWebhook(
        config.webhookSigningSecret,
        eventId,
        timestamp,
        request.body,
        signatures
      );
      const payload = request.body.toString("utf8");
      const event = JSON.parse(payload) as ClerkWebhookEvent;
      if (!event || typeof event.type !== "string" || !isRecord(event.data)) {
        throw new SaasError("VALIDATION_ERROR", "Webhook payload is invalid");
      }
      const result = await identities.applyWebhook(
        eventId,
        event,
        createHash("sha256").update(request.body).digest("hex")
      );
      await organizations?.ensurePersonalOrganization(event);
      response.status(200).json({ received: true, result });
    } catch (error) {
      next(error);
    }
  };
}

export function verifyStandardWebhook(
  secret: string,
  eventId: string,
  timestamp: string,
  body: Buffer,
  signatureHeader: string
): void {
  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try { key = Buffer.from(encodedSecret, "base64"); }
  catch { throw new SaasError("AUTHENTICATION_REQUIRED", "Webhook signature is invalid"); }
  if (key.length < 16) {
    throw new SaasError("AUTHENTICATION_REQUIRED", "Webhook signature is invalid");
  }
  const expected = createHmac("sha256", key)
    .update(`${eventId}.${timestamp}.`)
    .update(body)
    .digest();
  const candidates = signatureHeader.split(/\s+/)
    .map((item) => item.split(",", 2))
    .filter(([version, value]) => version === "v1" && value)
    .map(([, value]) => Buffer.from(value!, "base64"));
  if (!candidates.some((candidate) =>
    candidate.length === expected.length && timingSafeEqual(candidate, expected))) {
    throw new SaasError("AUTHENTICATION_REQUIRED", "Webhook signature is invalid");
  }
}

async function applyClerkEvent(
  client: PoolClient,
  event: ClerkWebhookEvent
): Promise<boolean> {
  const data = event.data;
  const sequence = eventSequence(event);
  switch (event.type) {
    case "user.created":
    case "user.updated":
      return upsertUser(client, data, sequence);
    case "user.deleted":
      return revokeUser(client, data, sequence);
    case "organization.created":
    case "organization.updated":
      return upsertOrganization(client, data, sequence);
    case "organization.deleted":
      return deleteOrganization(client, data, sequence);
    case "organizationMembership.created":
    case "organizationMembership.updated":
      return upsertMembership(client, data, sequence);
    case "organizationMembership.deleted":
      return revokeMembership(client, data, sequence);
    case "organizationInvitation.created":
    case "organizationInvitation.updated":
    case "organizationInvitation.accepted":
    case "organizationInvitation.revoked":
      return upsertInvitation(client, data, sequence, event.type);
    default:
      return false;
  }
}

async function upsertUser(client: PoolClient, data: Record<string, unknown>, sequence: number) {
  const clerkId = text(data.id);
  const emails = Array.isArray(data.email_addresses) ? data.email_addresses : [];
  const primaryId = optionalText(data.primary_email_address_id);
  const primary = emails.find((item) => isRecord(item) && item.id === primaryId);
  const email = isRecord(primary) ? optionalText(primary.email_address) : null;
  const result = await client.query(`
    INSERT INTO users (clerk_user_id, primary_email, clerk_updated_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (clerk_user_id) DO UPDATE
      SET primary_email = EXCLUDED.primary_email,
          clerk_updated_at = EXCLUDED.clerk_updated_at,
          updated_at = now()
      WHERE users.clerk_updated_at <= EXCLUDED.clerk_updated_at
    RETURNING id
  `, [clerkId, email, sequence]);
  return Boolean(result.rowCount);
}

async function revokeUser(client: PoolClient, data: Record<string, unknown>, sequence: number) {
  const clerkId = text(data.id);
  // Memberships are FORCE RLS protected, so discover the public organization
  // IDs first and enter each tenant scope before attempting revocation.
  const organizations = await client.query("SELECT id AS organization_id FROM organizations");
  let changed = false;
  for (const row of organizations.rows) {
    await setOrganization(client, row.organization_id);
    const result = await client.query(`
      UPDATE memberships SET state = 'revoked', clerk_updated_at = $2, updated_at = now()
      WHERE user_id = (SELECT id FROM users WHERE clerk_user_id = $1)
        AND clerk_updated_at <= $2
    `, [clerkId, sequence]);
    changed ||= Boolean(result.rowCount);
  }
  return changed;
}

async function upsertOrganization(
  client: PoolClient,
  data: Record<string, unknown>,
  sequence: number
) {
  const result = await client.query(`
    INSERT INTO organizations (clerk_organization_id, name, clerk_updated_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (clerk_organization_id) DO UPDATE
      SET name = EXCLUDED.name, clerk_updated_at = EXCLUDED.clerk_updated_at,
          updated_at = now()
      WHERE organizations.clerk_updated_at <= EXCLUDED.clerk_updated_at
    RETURNING id
  `, [text(data.id), text(data.name), sequence]);
  if (result.rowCount) {
    await client.query(`
      INSERT INTO subscriptions
        (organization_id, state, trial_ends_at, member_limit,
         source_minute_limit, storage_byte_limit)
      VALUES ($1, 'trialing', now() + interval '14 days', 5, 120, 26843545600)
      ON CONFLICT (organization_id) DO NOTHING
    `, [result.rows[0].id]);
  }
  return Boolean(result.rowCount);
}

async function deleteOrganization(
  client: PoolClient,
  data: Record<string, unknown>,
  sequence: number
) {
  const result = await client.query(`
    UPDATE organizations
    SET state = 'deleting', deletion_requested_at = now(),
        purge_after = now() + interval '24 hours',
        clerk_updated_at = $2, updated_at = now()
    WHERE clerk_organization_id = $1 AND clerk_updated_at <= $2
    RETURNING id
  `, [text(data.id), sequence]);
  return Boolean(result.rowCount);
}

async function upsertMembership(
  client: PoolClient,
  data: Record<string, unknown>,
  sequence: number
) {
  const organization = nested(data, "organization");
  const publicUser = nested(data, "public_user_data");
  const organizationId = await internalOrganizationId(client, text(organization.id));
  const userId = await internalUserId(client, text(publicUser.user_id));
  await setOrganization(client, organizationId);
  const previous = await client.query(`
    SELECT clerk_updated_at FROM memberships WHERE clerk_membership_id = $1
  `, [text(data.id)]);
  if (previous.rowCount && Number(previous.rows[0].clerk_updated_at) > sequence) return false;
  await assertSeatAvailable(client, organizationId, optionalText(data.id));
  const result = await client.query(`
    INSERT INTO memberships
      (organization_id, user_id, clerk_membership_id, role, state, clerk_updated_at)
    VALUES ($1, $2, $3, $4, 'active', $5)
    ON CONFLICT (organization_id, user_id) DO UPDATE
      SET clerk_membership_id = EXCLUDED.clerk_membership_id,
          role = EXCLUDED.role, state = 'active',
          clerk_updated_at = EXCLUDED.clerk_updated_at, updated_at = now()
      WHERE memberships.clerk_updated_at <= EXCLUDED.clerk_updated_at
    RETURNING user_id
  `, [organizationId, userId, text(data.id), clerkRole(text(data.role)), sequence]);
  return Boolean(result.rowCount);
}

async function revokeMembership(
  client: PoolClient,
  data: Record<string, unknown>,
  sequence: number
) {
  const membershipId = text(data.id);
  const organization = isRecord(data.organization) ? data.organization : undefined;
  const organizationId = organization
    ? await internalOrganizationId(client, text(organization.id))
    : (await client.query(
      "SELECT organization_id FROM memberships WHERE clerk_membership_id = $1",
      [membershipId]
    )).rows[0]?.organization_id;
  if (!organizationId) return false;
  await setOrganization(client, organizationId);
  const publicUser = isRecord(data.public_user_data) ? data.public_user_data : undefined;
  if (publicUser?.user_id && data.role) {
    const userId = await internalUserId(client, text(publicUser.user_id));
    const result = await client.query(`
      INSERT INTO memberships
        (organization_id, user_id, clerk_membership_id, role, state, clerk_updated_at)
      VALUES ($1, $2, $3, $4, 'revoked', $5)
      ON CONFLICT (organization_id, user_id) DO UPDATE
        SET clerk_membership_id = EXCLUDED.clerk_membership_id,
            role = EXCLUDED.role, state = 'revoked',
            clerk_updated_at = EXCLUDED.clerk_updated_at,
            updated_at = now()
        WHERE memberships.clerk_updated_at <= EXCLUDED.clerk_updated_at
      RETURNING user_id
    `, [organizationId, userId, membershipId, clerkRole(text(data.role)), sequence]);
    return Boolean(result.rowCount);
  }
  const result = await client.query(`
    UPDATE memberships SET state = 'revoked', clerk_updated_at = $2, updated_at = now()
    WHERE clerk_membership_id = $1 AND clerk_updated_at <= $2
    RETURNING user_id
  `, [membershipId, sequence]);
  return Boolean(result.rowCount);
}

async function upsertInvitation(
  client: PoolClient,
  data: Record<string, unknown>,
  sequence: number,
  eventType: string
) {
  const clerkOrganizationId = optionalText(data.organization_id)
    ?? optionalText(isRecord(data.organization) ? data.organization.id : undefined);
  if (!clerkOrganizationId) throw new SaasError("VALIDATION_ERROR", "Invitation has no organization");
  const organizationId = await internalOrganizationId(client, clerkOrganizationId);
  await setOrganization(client, organizationId);
  const state = invitationState(data, eventType);
  const previous = await client.query(`
    SELECT clerk_updated_at FROM organization_invitations
    WHERE clerk_invitation_id = $1
  `, [text(data.id)]);
  if (previous.rowCount && Number(previous.rows[0].clerk_updated_at) > sequence) return false;
  if (state === "pending") await assertInvitationSeatAvailable(client, organizationId, text(data.id));
  const result = await client.query(`
    INSERT INTO organization_invitations
      (organization_id, clerk_invitation_id, email_address, role, state, clerk_updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (clerk_invitation_id) DO UPDATE
      SET role = EXCLUDED.role, state = EXCLUDED.state,
          clerk_updated_at = EXCLUDED.clerk_updated_at, updated_at = now()
      WHERE organization_invitations.clerk_updated_at <= EXCLUDED.clerk_updated_at
    RETURNING id
  `, [organizationId, text(data.id), text(data.email_address),
    clerkRole(text(data.role)), state, sequence]);
  return Boolean(result.rowCount);
}

async function assertSeatAvailable(
  client: PoolClient,
  organizationId: string,
  clerkMembershipId: string | null
) {
  await client.query("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [organizationId]);
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM memberships
       WHERE organization_id = $1 AND state = 'active'
         AND ($2::text IS NULL OR clerk_membership_id <> $2)) AS active,
      (SELECT member_limit FROM subscriptions WHERE organization_id = $1) AS member_limit
  `, [organizationId, clerkMembershipId]);
  const active = Number(result.rows[0]?.active ?? 0);
  const limit = Number(result.rows[0]?.member_limit ?? 5);
  if (active >= limit) {
    throw new SaasError("SEAT_LIMIT", "The organization active-member limit has been reached", {
      memberLimit: limit
    });
  }
}

async function assertInvitationSeatAvailable(
  client: PoolClient,
  organizationId: string,
  clerkInvitationId: string
) {
  await client.query("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [organizationId]);
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM memberships
       WHERE organization_id = $1 AND state = 'active') AS active,
      (SELECT count(*)::int FROM organization_invitations
       WHERE organization_id = $1 AND state = 'pending'
         AND clerk_invitation_id <> $2) AS pending,
      (SELECT member_limit FROM subscriptions WHERE organization_id = $1) AS member_limit
  `, [organizationId, clerkInvitationId]);
  const occupied = Number(result.rows[0]?.active ?? 0) + Number(result.rows[0]?.pending ?? 0);
  const limit = Number(result.rows[0]?.member_limit ?? 5);
  if (occupied >= limit) {
    throw new SaasError("SEAT_LIMIT", "The organization member limit has been reached", {
      memberLimit: limit
    });
  }
}

function eventSequence(event: ClerkWebhookEvent): number {
  const value = event.data.updated_at ?? event.data.created_at
    ?? (event.timestamp === undefined ? Date.now() : event.timestamp);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new SaasError("VALIDATION_ERROR", "Event timestamp is invalid");
  return numeric < 10_000_000_000 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
}

function invitationState(
  data: Record<string, unknown>,
  eventType: string
): "pending" | "accepted" | "revoked" {
  if (eventType.endsWith(".accepted") || data.status === "accepted") return "accepted";
  if (eventType.endsWith(".revoked") || data.status === "revoked") return "revoked";
  return "pending";
}

function clerkRole(value: string): OrganizationRole {
  const normalized = value.startsWith("org:") ? value.slice(4) : value;
  if (normalized === "admin" || normalized === "owner") return "owner";
  if (normalized === "editor") return "editor";
  if (normalized === "member" || normalized === "viewer") return "viewer";
  throw new SaasError("AUTHENTICATION_REQUIRED", "The organization role is unsupported");
}

async function internalOrganizationId(client: PoolClient, clerkId: string): Promise<string> {
  const result = await client.query(
    "SELECT id FROM organizations WHERE clerk_organization_id = $1",
    [clerkId]
  );
  if (!result.rowCount) throw new SaasError("VALIDATION_ERROR", "Organization is not synchronized");
  return result.rows[0].id;
}

async function internalUserId(client: PoolClient, clerkId: string): Promise<string> {
  const result = await client.query("SELECT id FROM users WHERE clerk_user_id = $1", [clerkId]);
  if (!result.rowCount) throw new SaasError("VALIDATION_ERROR", "User is not synchronized");
  return result.rows[0].id;
}

async function setOrganization(client: PoolClient, organizationId: string) {
  await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
}

function normalizePem(value: string) {
  return value.replace(/\\n/g, "\n");
}

function requiredHeader(value: string | undefined): string {
  if (!value) throw new SaasError("AUTHENTICATION_REQUIRED", "Webhook signature is missing");
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new SaasError("VALIDATION_ERROR", "Webhook payload is invalid");
  }
  return value;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function nested(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) throw new SaasError("VALIDATION_ERROR", "Webhook payload is invalid");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
