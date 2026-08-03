import type { ErrorEnvelope } from "@siftcut/saas-contracts";

export interface SessionSource {
  getToken(): Promise<string | null>;
}

export class CloudApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super(errorMessage(body));
    this.name = "CloudApiError";
  }
}

export class CloudApi {
  constructor(
    private readonly session: SessionSource,
    private readonly baseUrl = apiUrl()
  ) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetch(path, init);
    if (response.status === 204) return undefined as T;
    const body = await response.json() as { apiVersion: "v1"; data: T } | ErrorEnvelope;
    if (!response.ok) throw new CloudApiError(response.status, body);
    return (body as { data: T }).data;
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.session.getToken();
    const response = await fetch(`${this.baseUrl}/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers
      }
    });
    return response;
  }
}

export async function parseDeletionResponse(
  response: Response
): Promise<{ deleted: true } | unknown> {
  if (response.status === 204) return { deleted: true };
  const body: unknown = await response.json();
  if (response.ok) return body;
  if (isClerkReverificationPayload(body)) return body;
  throw new CloudApiError(response.status, body);
}

export function isClerkReverificationPayload(body: unknown): boolean {
  if (!body || typeof body !== "object" || !("clerk_error" in body)) return false;
  const clerkError = (body as { clerk_error?: unknown }).clerk_error;
  return Boolean(clerkError && typeof clerkError === "object"
    && (clerkError as { type?: unknown }).type === "forbidden"
    && (clerkError as { reason?: unknown }).reason === "reverification-error");
}

export async function completeOrganizationDeletion(
  action: (confirmation: string) => Promise<unknown>,
  confirmation: string,
  isCancellation: (reason: unknown) => boolean
): Promise<"deleted" | "cancelled"> {
  try {
    const result = await action(confirmation);
    if (!result || typeof result !== "object" || !("deleted" in result)) {
      throw new Error("Organization deletion did not complete");
    }
    return "deleted";
  } catch (reason) {
    if (isCancellation(reason)) return "cancelled";
    throw reason;
  }
}

function apiUrl(): string {
  const value = import.meta.env.VITE_API_URL;
  return value ? value.replace(/\/$/, "") : "";
}

function errorMessage(body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object" && "message" in error
      && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
  }
  return "The request failed. Please try again.";
}
