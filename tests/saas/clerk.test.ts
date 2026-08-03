import { createHmac } from "node:crypto";
import {
  exportSPKI,
  generateKeyPair,
  SignJWT
} from "jose";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedContext } from "../../packages/saas-contracts/src/index.js";
import {
  ClerkReverificationRequiredError,
  ClerkOrganizationService,
  ClerkSessionVerifier,
  STRICT_REVERIFICATION_PAYLOAD,
  type ClerkConfig,
  type ClerkIdentityRepository,
  verifyStandardWebhook
} from "../../apps/api/src/clerk.js";
import { loadConfig } from "../../apps/api/src/config.js";

const INTERNAL: AuthenticatedContext = {
  userId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  role: "owner",
  sessionId: ""
};

describe("Clerk session verification", () => {
  it("accepts v1 organization claims and checks every token boundary", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const config: ClerkConfig = {
      issuer: "https://clerk.example.test",
      audience: "siftcut-api",
      authorizedParties: ["https://app.example.test"],
      webhookSigningSecret: `whsec_${Buffer.alloc(32, 7).toString("base64")}`,
      secretKey: "sk_test",
      jwtKey: await exportSPKI(publicKey)
    };
    const identities = {
      resolveSession: vi.fn(async () => INTERNAL)
    } as unknown as ClerkIdentityRepository;
    const verifier = new ClerkSessionVerifier(config, identities);
    const valid = await token(privateKey, config);

    await expect(verifier.verifyAuthorizationHeader(`Bearer ${valid}`)).resolves.toEqual({
      ...INTERNAL,
      sessionId: "sess_1"
    });
    expect(identities.resolveSession).toHaveBeenCalledWith("user_1", "org_1", "owner");

    await expect(verifier.verifyAuthorizationHeader(`Bearer ${await token(privateKey, config, {
      audience: "another-api"
    })}`)).rejects.toThrow();
    await expect(verifier.verifyAuthorizationHeader(`Bearer ${await token(privateKey, config, {
      expiresAt: Math.floor(Date.now() / 1000) - 60
    })}`)).rejects.toThrow();
    await expect(verifier.verifyAuthorizationHeader(`Bearer ${await token(privateKey, config, {
      azp: "https://evil.example"
    })}`)).rejects.toThrow("authorized party");
    await expect(verifier.verifyAuthorizationHeader(`Bearer ${await token(privateKey, config, {
      azp: null
    })}`)).rejects.toThrow("authorized party");
    await expect(verifier.verifyAuthorizationHeader(`Bearer ${await token(privateKey, config, {
      orgId: undefined
    })}`)).rejects.toThrow("active organization");
  });

  it.each([
    ["org:admin", "owner"],
    ["admin", "owner"],
    ["org:editor", "editor"],
    ["editor", "editor"],
    ["org:viewer", "viewer"]
  ] as const)("accepts Clerk v2 organization claims and normalizes %s", async (
    claimedRole,
    normalizedRole
  ) => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const config = await clerkConfig(publicKey);
    const identities = {
      resolveSession: vi.fn(async () => ({ ...INTERNAL, role: normalizedRole }))
    } as unknown as ClerkIdentityRepository;
    const verifier = new ClerkSessionVerifier(config, identities);

    await expect(verifier.verifyAuthorizationHeader(
      `Bearer ${await token(privateKey, config, {
        claimVersion: 2,
        organizationRole: claimedRole
      })}`
    )).resolves.toMatchObject({ role: normalizedRole, sessionId: "sess_1" });
    expect(identities.resolveSession).toHaveBeenCalledWith(
      "user_1", "org_1", normalizedRole
    );
  });

  it("uses the freshest verified factor after strict reverification", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const config = await clerkConfig(publicKey);
    const identities = {
      resolveSession: vi.fn(async () => INTERNAL)
    } as unknown as ClerkIdentityRepository;
    const verifier = new ClerkSessionVerifier(config, identities);

    await expect(verifier.verifyAuthorizationHeader(
      `Bearer ${await token(privateKey, config, {
        claimVersion: 2,
        factorAges: [9, 0],
        issuedAt: 1_785_686_400
      })}`
    )).resolves.toMatchObject({
      authenticatedAt: "2026-08-02T16:00:00.000Z"
    });
  });

  it("rejects a valid Clerk claim after local membership revocation or role drift", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const config: ClerkConfig = {
      issuer: "https://clerk.example.test",
      audience: "siftcut-api",
      authorizedParties: ["https://app.example.test"],
      webhookSigningSecret: `whsec_${Buffer.alloc(32, 7).toString("base64")}`,
      secretKey: "sk_test",
      jwtKey: await exportSPKI(publicKey)
    };
    const identities = {
      resolveSession: vi.fn(async () => null)
    } as unknown as ClerkIdentityRepository;
    const verifier = new ClerkSessionVerifier(config, identities);
    await expect(verifier.verifyAuthorizationHeader(
      `Bearer ${await token(privateKey, config)}`
    )).rejects.toThrow("membership is not active");
  });
});

describe("Clerk webhook authentication and runtime configuration", () => {
  it("accepts only the exact Standard Webhooks signature", () => {
    const key = Buffer.alloc(32, 9);
    const secret = `whsec_${key.toString("base64")}`;
    const body = Buffer.from('{"type":"user.created"}');
    const eventId = "evt_1";
    const timestamp = "1785700000";
    const signature = createHmac("sha256", key)
      .update(`${eventId}.${timestamp}.`)
      .update(body)
      .digest("base64");
    expect(() => verifyStandardWebhook(
      secret, eventId, timestamp, body, `v1,${signature}`
    )).not.toThrow();
    expect(() => verifyStandardWebhook(
      secret, eventId, timestamp, Buffer.from("{}"), `v1,${signature}`
    )).toThrow("signature is invalid");
  });

  it("requires complete Clerk settings in production and never enables dev tokens", () => {
    expect(loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://db",
      CLERK_ISSUER: "https://clerk.example.test",
      CLERK_AUDIENCE: "siftcut-api",
      CLERK_AUTHORIZED_PARTIES: "https://app.example.test",
      CLERK_WEBHOOK_SIGNING_SECRET: "whsec_secret",
      CLERK_SECRET_KEY: "sk_test"
    })).toMatchObject({
      nodeEnv: "production",
      clerk: {
        audience: "siftcut-api",
        authorizedParties: ["https://app.example.test"]
      }
    });
    expect(() => loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://db"
    })).toThrow("Production Clerk authentication is required");
  });
});

describe("organization deletion", () => {
  it("creates a deterministic personal Screenletter organization idempotently", async () => {
    const identities = {} as ClerkIdentityRepository;
    const request = vi.fn(async () => new Response(
      JSON.stringify({ id: "org_personal" }),
      { status: 201, headers: { "content-type": "application/json" } }
    ));
    const service = new ClerkOrganizationService({
      issuer: "https://clerk.example.test",
      audience: "siftcut-api",
      authorizedParties: ["https://app.example.test"],
      webhookSigningSecret: "whsec_secret",
      secretKey: "sk_test"
    }, identities, () => new Date(), request);
    const event = {
      type: "user.created",
      data: { id: "user_123", first_name: "George", last_name: "Le" }
    };
    await expect(service.ensurePersonalOrganization(event)).resolves.toBeUndefined();
    const firstBody = JSON.parse(request.mock.calls[0]![1]!.body as string);
    expect(firstBody).toMatchObject({
      name: "George Le's Screenletter",
      created_by: "user_123",
      public_metadata: { product: "screenletter", personal: true }
    });
    expect(firstBody.slug).toMatch(/^screenletter-[a-f0-9]{20}$/);

    request.mockResolvedValueOnce(new Response(null, { status: 422 }));
    await expect(service.ensurePersonalOrganization(event)).resolves.toBeUndefined();
  });

  it("requires owner role, exact typed confirmation, and authentication within five minutes", async () => {
    const identities = {
      organizationForContext: vi.fn(async () => ({
        clerkOrganizationId: "org_1",
        name: "Acme"
      })),
      markOrganizationDeleting: vi.fn(async () => undefined)
    } as unknown as ClerkIdentityRepository;
    const request = vi.fn(async () => new Response(null, { status: 200 }));
    const now = new Date("2026-08-02T12:00:00.000Z");
    const service = new ClerkOrganizationService({
      issuer: "https://clerk.example.test",
      audience: "siftcut-api",
      authorizedParties: ["https://app.example.test"],
      webhookSigningSecret: "whsec_secret",
      secretKey: "sk_test"
    }, identities, () => now, request);

    await expect(service.deleteOrganization({
      ...INTERNAL,
      role: "editor",
      authenticatedAt: "2026-08-02T11:59:00.000Z"
    }, { confirmation: "Acme" })).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });
    await expect(service.deleteOrganization({
      ...INTERNAL,
      authenticatedAt: "2026-08-02T11:54:59.000Z"
    }, { confirmation: "Acme" })).rejects.toEqual(
      expect.objectContaining({
        status: 403,
        body: STRICT_REVERIFICATION_PAYLOAD
      })
    );
    await expect(service.deleteOrganization({
      ...INTERNAL,
      authenticatedAt: "2026-08-02T11:54:59.000Z"
    }, { confirmation: "Acme" })).rejects.toBeInstanceOf(ClerkReverificationRequiredError);
    await expect(service.deleteOrganization({
      ...INTERNAL,
      authenticatedAt: "2026-08-02T11:59:00.000Z"
    }, { confirmation: "Wrong" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(service.deleteOrganization({
      ...INTERNAL,
      authenticatedAt: "2026-08-02T11:59:00.000Z"
    }, { confirmation: "Acme" })).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      "https://api.clerk.com/v1/organizations/org_1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(identities.markOrganizationDeleting).toHaveBeenCalledWith(
      INTERNAL.organizationId,
      now
    );
  });
});

async function token(
  privateKey: CryptoKey,
  config: ClerkConfig,
  override: {
    audience?: string;
    expiresAt?: string | number;
    azp?: string | null;
    orgId?: string | undefined;
    claimVersion?: 1 | 2;
    organizationRole?: string;
    factorAges?: [number, number];
    issuedAt?: number;
  } = {}
) {
  const claims: Record<string, unknown> = { sid: "sess_1" };
  if (override.azp !== null) {
    claims.azp = override.azp ?? "https://app.example.test";
  }
  if (!("orgId" in override) || override.orgId !== undefined) {
    if (override.claimVersion === 2) {
      Object.assign(claims, {
        o: {
          id: override.orgId ?? "org_1",
          rol: override.organizationRole ?? "org:admin"
        }
      });
    } else {
      claims.org_id = override.orgId ?? "org_1";
      claims.org_role = override.organizationRole ?? "org:admin";
    }
  }
  if (override.factorAges) claims.fva = override.factorAges;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setSubject("user_1")
    .setIssuer(config.issuer)
    .setAudience(override.audience ?? config.audience)
    .setIssuedAt(override.issuedAt)
    .setExpirationTime(override.expiresAt ?? "5 minutes")
    .sign(privateKey);
}

async function clerkConfig(publicKey: CryptoKey): Promise<ClerkConfig> {
  return {
    issuer: "https://clerk.example.test",
    audience: "siftcut-api",
    authorizedParties: ["https://app.example.test"],
    webhookSigningSecret: `whsec_${Buffer.alloc(32, 7).toString("base64")}`,
    secretKey: "sk_test",
    jwtKey: await exportSPKI(publicKey)
  };
}
