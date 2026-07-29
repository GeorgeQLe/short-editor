import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  API_ROUTE_INVENTORY,
  createApi,
  DEFAULT_API_HOST,
  serializeApiRouteInventory
} from "../src/core/api.js";
import type { CoreService } from "../src/core/service.js";

const servers: Array<ReturnType<ReturnType<typeof createApi>["listen"]>> = [];
const ids = Array.from({ length: 1_005 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
}));

async function start(service: Partial<CoreService>, desktopToken?: string) {
  const server = createApi(service as CoreService, desktopToken).listen(0, DEFAULT_API_HOST);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://${DEFAULT_API_HOST}:${port}`;
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  ));
});

describe("v1 HTTP contract inventory", () => {
  it("freezes all 60 classified routes and matches the generated JSON", async () => {
    expect(API_ROUTE_INVENTORY).toHaveLength(60);
    expect(new Set(API_ROUTE_INVENTORY.map((entry) => entry.operationId)).size).toBe(60);
    expect(new Set(API_ROUTE_INVENTORY.map((entry) => `${entry.method} ${entry.path}`)).size).toBe(60);
    expect(API_ROUTE_INVENTORY.filter((entry) => entry.access === "public")).toHaveLength(54);
    expect(API_ROUTE_INVENTORY.filter((entry) => entry.access === "desktop-token")).toHaveLength(6);
    expect(API_ROUTE_INVENTORY.every((entry) =>
      entry.operationId.length > 0
      && typeof entry.mutation === "boolean"
      && entry.destructive === false
      && typeof entry.longRunning === "boolean"
      && (typeof entry.revisionRequired === "boolean"
        || entry.revisionRequired === "after-initial-creation")
    )).toBe(true);
    expect(await readFile("docs/api-v1-routes.json", "utf8")).toBe(serializeApiRouteInventory());
  });

  it("contains no destructive durable-entity deletion operation", () => {
    const deletes = API_ROUTE_INVENTORY.filter((entry) => entry.method === "DELETE");
    expect(deletes.map((entry) => entry.operationId)).toEqual(["shorts.removeManualCropControl"]);
    expect(deletes[0]?.path).toContain("/crops/manual/");
    expect(deletes[0]?.destructive).toBe(false);
  });

  it("exports the production IPv4 loopback host", () => {
    expect(DEFAULT_API_HOST).toBe("127.0.0.1");
  });
});

describe("v1 pagination", () => {
  it.each([1, 100, 1_000])("applies the %i-item boundary and returns a cursor only when needed", async (limit) => {
    const base = await start({ listEpisodes: () => ids.slice(0, limit + 1) as never });
    const response = await fetch(`${base}/v1/library/episodes?limit=${limit}`);
    const payload = await json(response) as {
      apiVersion: string;
      data: { items: Array<{ id: string }>; nextCursor: string | null };
    };
    expect(response.status).toBe(200);
    expect(payload.apiVersion).toBe("v1");
    expect(payload.data.items).toHaveLength(limit);
    expect(payload.data.nextCursor).toEqual(expect.any(String));
  });

  it("traverses every page without duplication and terminates with a null cursor", async () => {
    const base = await start({ listEpisodes: () => ids as never });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const payload = await json(await fetch(`${base}/v1/library/episodes?limit=100${suffix}`)) as {
        data: { items: Array<{ id: string }>; nextCursor: string | null };
      };
      seen.push(...payload.data.items.map((item) => item.id));
      cursor = payload.data.nextCursor;
    } while (cursor);
    expect(seen).toEqual(ids.map((item) => item.id));
    expect(new Set(seen).size).toBe(ids.length);
  });

  it("rejects malformed, stale, cross-operation, and filter-mismatched cursors", async () => {
    let current = ids.slice(0, 2);
    const base = await start({
      listEpisodes: () => current as never,
      listJobs: () => ids.slice(0, 2) as never
    });
    const first = await json(await fetch(`${base}/v1/library/episodes?limit=1&search=one`)) as {
      data: { nextCursor: string };
    };
    const cursor = encodeURIComponent(first.data.nextCursor);
    const malformed = await fetch(`${base}/v1/library/episodes?cursor=not-a-cursor`);
    const wrongFilter = await fetch(`${base}/v1/library/episodes?search=two&cursor=${cursor}`);
    const wrongRoute = await fetch(`${base}/v1/jobs?cursor=${cursor}`);
    current = current.slice(1);
    const stale = await fetch(`${base}/v1/library/episodes?search=one&cursor=${cursor}`);
    for (const response of [malformed, wrongFilter, wrongRoute, stale]) {
      expect(response.status).toBe(422);
      expect(await json(response)).toMatchObject({
        apiVersion: "v1",
        error: { code: "VALIDATION_ERROR", retryable: false }
      });
    }
  });

  it("rejects invalid limits and unknown query fields", async () => {
    const base = await start({ listEpisodes: () => [] });
    for (const query of ["limit=0", "limit=1001", "limit=nope", "unknown=true"]) {
      const response = await fetch(`${base}/v1/library/episodes?${query}`);
      expect(response.status).toBe(422);
      expect(await json(response)).toMatchObject({
        apiVersion: "v1",
        error: { code: "VALIDATION_ERROR" }
      });
    }
  });

  it("rejects unknown query fields on queryless reads", async () => {
    const base = await start({});
    const paths = [
      "/v1/health",
      "/v1/library/episodes/00000000-0000-4000-8000-000000000001",
      "/v1/candidates/00000000-0000-4000-8000-000000000001/content-package",
      "/v1/shorts/00000000-0000-4000-8000-000000000001"
    ];
    for (const path of paths) {
      const response = await fetch(`${base}${path}?unknown=true`);
      expect(response.status).toBe(422);
      expect(await json(response)).toMatchObject({
        apiVersion: "v1",
        error: { code: "VALIDATION_ERROR" }
      });
    }
  });
});

describe("v1 envelopes, strictness, and security", () => {
  it("wraps success, unknown routes, unsupported methods, and malformed JSON", async () => {
    const base = await start({});
    const health = await fetch(`${base}/v1/health`);
    expect(await json(health)).toEqual({ apiVersion: "v1", data: { status: "ok" } });

    const unknown = await fetch(`${base}/v1/does-not-exist`);
    const method = await fetch(`${base}/v1/health`, { method: "POST" });
    const malformed = await fetch(`${base}/v1/library/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{privatePath:"
    });
    expect(unknown.status).toBe(404);
    expect(method.status).toBe(404);
    expect(malformed.status).toBe(422);
    expect(await json(unknown)).toMatchObject({ apiVersion: "v1", error: { code: "NOT_FOUND" } });
    expect(await json(method)).toMatchObject({ apiVersion: "v1", error: { code: "NOT_FOUND" } });
    expect(JSON.stringify(await json(malformed))).not.toContain("privatePath");
  });

  it("strictly rejects unknown mutation fields, including empty-body actions", async () => {
    const base = await start({});
    const response = await fetch(
      `${base}/v1/jobs/00000000-0000-4000-8000-000000000001/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorization: true })
      }
    );
    expect(response.status).toBe(422);
    expect(await json(response)).toMatchObject({
      apiVersion: "v1",
      error: { code: "VALIDATION_ERROR" }
    });
  });

  it("redacts unexpected failures", async () => {
    const privateValue = "/private/fixture/token-secret";
    const base = await start({
      getEpisode: () => {
        throw new Error(`stack and credential ${privateValue}`);
      }
    });
    const response = await fetch(
      `${base}/v1/library/episodes/00000000-0000-4000-8000-000000000001`
    );
    const serialized = JSON.stringify(await json(response));
    expect(response.status).toBe(500);
    expect(serialized).toContain("Unexpected internal error");
    expect(serialized).not.toContain(privateValue);
    expect(serialized).not.toContain("stack and credential");
  });

  it("rejects missing, incorrect, and absent configured desktop tokens", async () => {
    const configured = await start({ listCloudAuthorizations: () => [] }, "desktop-secret");
    const absent = await start({ listCloudAuthorizations: () => [] });
    const requests = [
      fetch(`${configured}/v1/desktop/cloud-authorizations`),
      fetch(`${configured}/v1/desktop/cloud-authorizations`, {
        headers: { "x-short-editor-desktop-token": "wrong" }
      }),
      fetch(`${absent}/v1/desktop/cloud-authorizations`, {
        headers: { "x-short-editor-desktop-token": "desktop-secret" }
      })
    ];
    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(403);
      expect(await json(response)).toMatchObject({
        apiVersion: "v1",
        error: { code: "CLOUD_NOT_AUTHORIZED" }
      });
    }
  });
});
