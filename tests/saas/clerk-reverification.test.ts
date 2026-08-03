import { afterEach, describe, expect, it, vi } from "vitest";
import { clerkErrorResponse } from "../../apps/api/src/app.js";
import {
  ClerkReverificationRequiredError,
  STRICT_REVERIFICATION_PAYLOAD
} from "../../apps/api/src/clerk.js";
import {
  CloudApi,
  CloudApiError,
  completeOrganizationDeletion,
  parseDeletionResponse
} from "../../apps/web/src/api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Clerk organization deletion reverification", () => {
  it("maps stale authentication to Clerk's exact strict 403 envelope", () => {
    expect(clerkErrorResponse(new ClerkReverificationRequiredError())).toEqual({
      status: 403,
      body: STRICT_REVERIFICATION_PAYLOAD
    });
  });

  it("preserves the Clerk hint for automatic retry and handles the retried 204", async () => {
    const getToken = vi.fn(async () => "jwt");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(STRICT_REVERIFICATION_PAYLOAD), {
        status: 403,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new CloudApi({ getToken }, "https://staging.example");
    const fetcher = async () => parseDeletionResponse(await api.fetch("/organization", {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "Acme" })
    }));

    await expect(fetcher()).resolves.toEqual(STRICT_REVERIFICATION_PAYLOAD);
    await expect(fetcher()).resolves.toEqual({ deleted: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenCalledWith();
  });

  it("treats modal cancellation as cancellation instead of a generic failure", async () => {
    const cancellation = { code: "reverification_cancelled" };
    const action = vi.fn(async () => { throw cancellation; });
    await expect(completeOrganizationDeletion(
      action,
      "Acme",
      (reason) => (reason as { code?: string }).code === "reverification_cancelled"
    )).resolves.toBe("cancelled");
    expect(cancellation).not.toBeInstanceOf(CloudApiError);
  });
});
