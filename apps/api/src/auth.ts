import type { RequestHandler } from "express";
import {
  authenticatedContextSchema,
  type AuthenticatedContext
} from "@siftcut/saas-contracts";
import { SaasError } from "./errors.js";

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthenticatedContext;
    }
  }
}

export interface SessionVerifier {
  verifyAuthorizationHeader(header: string): Promise<AuthenticatedContext>;
}

export function requireSession(verifier: SessionVerifier): RequestHandler {
  return async (request, _response, next) => {
    try {
      const header = request.header("authorization");
      if (!header?.startsWith("Bearer ")) {
        throw new SaasError("AUTHENTICATION_REQUIRED", "A valid session is required");
      }
      // The verifier is the only boundary allowed to derive tenant and role.
      request.authContext = authenticatedContextSchema.parse(
        await verifier.verifyAuthorizationHeader(header)
      );
      next();
    } catch (error) {
      next(error instanceof SaasError
        ? error
        : new SaasError("AUTHENTICATION_REQUIRED", "The session is invalid or expired"));
    }
  };
}

export function contextOf(request: Express.Request): AuthenticatedContext {
  if (!request.authContext) {
    throw new SaasError("AUTHENTICATION_REQUIRED", "A valid session is required");
  }
  return request.authContext;
}

export function requireRole(
  context: AuthenticatedContext,
  allowed: ReadonlyArray<AuthenticatedContext["role"]>
): void {
  if (!allowed.includes(context.role)) {
    throw new SaasError("FORBIDDEN_ROLE", "This organization role cannot perform that action");
  }
}
