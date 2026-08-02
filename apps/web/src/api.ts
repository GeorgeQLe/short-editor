import type { ErrorEnvelope } from "@siftcut/saas-contracts";

export interface SessionSource {
  getToken(): Promise<string | null>;
}

export class CloudApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorEnvelope
  ) {
    super(body.error.message);
    this.name = "CloudApiError";
  }
}

export class CloudApi {
  constructor(
    private readonly session: SessionSource,
    private readonly baseUrl = requiredApiUrl()
  ) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.session.getToken();
    const response = await fetch(`${this.baseUrl}/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers
      }
    });
    if (response.status === 204) return undefined as T;
    const body = await response.json() as { apiVersion: "v1"; data: T } | ErrorEnvelope;
    if (!response.ok) throw new CloudApiError(response.status, body as ErrorEnvelope);
    return (body as { data: T }).data;
  }
}

function requiredApiUrl(): string {
  const value = import.meta.env.VITE_API_URL;
  if (!value) throw new Error("VITE_API_URL is required");
  return value.replace(/\/$/, "");
}
