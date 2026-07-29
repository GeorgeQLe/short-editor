import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  API_ROUTE_INVENTORY,
  serializeApiRouteInventory
} from "../src/core/api.js";
import {
  MCP_TOOL_INVENTORY,
  serializeMcpToolInventory
} from "../src/mcp/registry.js";
import {
  releaseInterfaceManifest,
  serializeReleaseInterfaceDocumentation,
  serializeReleaseInterfaceManifest
} from "../src/release/interface-docs.js";
import { filterDiagnosticExport } from "../src/shared/diagnostics.js";

describe("frozen v1 release interface", () => {
  it("matches every exact checked-in generated artifact", async () => {
    expect(await readFile("docs/api-v1-routes.json", "utf8"))
      .toBe(serializeApiRouteInventory());
    expect(await readFile("docs/mcp-v1-tools.json", "utf8"))
      .toBe(serializeMcpToolInventory());
    expect(await readFile("docs/release-interface-v1.json", "utf8"))
      .toBe(serializeReleaseInterfaceManifest());
    expect(await readFile("docs/release-interfaces-v1.md", "utf8"))
      .toBe(serializeReleaseInterfaceDocumentation());
  });

  it("maps every MCP tool to one exact HTTP route", () => {
    const routeByOperation = new Map(API_ROUTE_INVENTORY.map((route) => [route.operationId, route]));
    expect(releaseInterfaceManifest().mcpHttpMappings).toHaveLength(44);
    for (const tool of MCP_TOOL_INVENTORY) {
      const route = routeByOperation.get(tool.http.operationId);
      expect(route, tool.name).toBeDefined();
      expect(route?.method, tool.name).toBe(tool.http.method);
      expect(route?.path, tool.name).toBe(tool.http.path);
    }
  });
});

describe("diagnostic export policy", () => {
  const fixture = {
    status: "failed",
    credentialHandle: "opaque-handle",
    authorization: "Bearer private-token-value",
    apiKey: "field-name-must-be-removed",
    nested: {
      password: "not-for-export",
      transcriptText: "private spoken words",
      sourcePath: "/Users/person/private/source.mov",
      message: [
        "failed /Users/person/private/source.mov with sk-abcdefghijk",
        "ghp_abcdefghijklmnopqrstuvwxyz123456",
        "AKIAIOSFODNN7EXAMPLE",
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue"
      ].join(" ")
    }
  };

  it("always removes credentials and excludes sensitive detail by default", () => {
    const serialized = JSON.stringify(filterDiagnosticExport(fixture));
    expect(serialized).toContain('"status":"failed"');
    expect(serialized).not.toContain("opaque-handle");
    expect(serialized).not.toContain("private-token-value");
    expect(serialized).not.toContain("field-name-must-be-removed");
    expect(serialized).not.toContain("not-for-export");
    expect(serialized).not.toContain("private spoken words");
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("sk-abcdefghijk");
    expect(serialized).not.toContain("ghp_");
    expect(serialized).not.toContain("AKIA");
    expect(serialized).not.toContain("eyJ");
  });

  it("includes opted-in transcript/path fields while still removing credentials", () => {
    const filtered = filterDiagnosticExport(fixture, { includeSensitive: true }) as
      Record<string, unknown>;
    const serialized = JSON.stringify(filtered);
    expect(serialized).toContain("private spoken words");
    expect(serialized).toContain("/Users/person/private/source.mov");
    expect(serialized).not.toContain("opaque-handle");
    expect(serialized).not.toContain("private-token-value");
    expect(serialized).not.toContain("field-name-must-be-removed");
    expect(serialized).not.toContain("not-for-export");
    expect(serialized).not.toContain("sk-abcdefghijk");
    expect(serialized).not.toContain("ghp_");
    expect(serialized).not.toContain("AKIA");
    expect(serialized).not.toContain("eyJ");
  });

  it("is JSON-safe for circular diagnostic payloads", () => {
    const circular: Record<string, unknown> = { state: "failed" };
    circular.self = circular;
    expect(filterDiagnosticExport(circular)).toEqual({
      state: "failed",
      self: "[circular]"
    });
  });
});
