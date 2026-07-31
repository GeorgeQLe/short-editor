import { createHash } from "node:crypto";
import {
  API_ROUTE_INVENTORY,
  serializeApiRouteInventory
} from "../core/api.js";
import {
  MCP_TOOL_INVENTORY,
  serializeMcpToolInventory
} from "../mcp/registry.js";
import { DIAGNOSTIC_EXPORT_POLICY_VERSION } from "../shared/diagnostics.js";

export const RELEASE_INTERFACE_CONTRACT_VERSION = "v1";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function releaseInterfaceManifest() {
  const apiArtifact = serializeApiRouteInventory();
  const mcpArtifact = serializeMcpToolInventory();
  const routeByOperation = new Map(API_ROUTE_INVENTORY.map((route) => [route.operationId, route]));
  const mappings = MCP_TOOL_INVENTORY.map((tool) => {
    const route = routeByOperation.get(tool.http.operationId);
    if (!route || route.method !== tool.http.method || route.path !== tool.http.path) {
      throw new Error(`MCP mapping does not match HTTP route: ${tool.name}`);
    }
    return {
      tool: tool.name,
      operationId: route.operationId,
      method: route.method,
      path: route.path
    };
  }).sort((left, right) => left.tool.localeCompare(right.tool));

  return {
    contractVersion: RELEASE_INTERFACE_CONTRACT_VERSION,
    compatibility: {
      policy: "additive-only-within-v1",
      breakingChange: "requires-a-new-major-interface-version",
      unknownMutationFields: "rejected",
      responseEnvelope: "{apiVersion,data|error}"
    },
    pagination: {
      shape: "{items,nextCursor}",
      defaultLimit: 100,
      minimumLimit: 1,
      maximumLimit: 1_000,
      cursor: "opaque-operation-and-filter-bound-stable-id-continuation"
    },
    diagnostics: {
      policyVersion: DIAGNOSTIC_EXPORT_POLICY_VERSION,
      credentials: "always-removed",
      transcriptAndPaths: "excluded-unless-explicitly-opted-in"
    },
    artifacts: {
      http: {
        path: "docs/api-v1-routes.json",
        operationCount: API_ROUTE_INVENTORY.length,
        sha256: sha256(apiArtifact)
      },
      mcp: {
        path: "docs/mcp-v1-tools.json",
        toolCount: MCP_TOOL_INVENTORY.length,
        sha256: sha256(mcpArtifact)
      }
    },
    mcpHttpMappings: mappings
  };
}

export function serializeReleaseInterfaceManifest(): string {
  return `${JSON.stringify(releaseInterfaceManifest(), null, 2)}\n`;
}

export function serializeReleaseInterfaceDocumentation(): string {
  const manifest = releaseInterfaceManifest();
  const publicCount = API_ROUTE_INVENTORY.filter((route) => route.access === "public").length;
  const desktopCount = API_ROUTE_INVENTORY.length - publicCount;
  const listRoutes = API_ROUTE_INVENTORY.filter((route) =>
    route.method === "GET" && (
      route.path === "/v1/library/episodes"
      || route.path === "/v1/library/watched-folders"
      || route.path === "/v1/jobs"
      || route.path === "/v1/analysis/:episodeId/artifacts"
      || route.path === "/v1/candidates"
      || route.path === "/v1/templates"
      || route.path === "/v1/assets"
      || route.path === "/v1/renders"
      || route.path === "/v1/schedule"
      || route.path === "/v1/desktop/cloud-authorizations"
    )
  );
  const pagedMcpTools = MCP_TOOL_INVENTORY.filter((tool) =>
    "shape" in tool.inputSchema
    && typeof tool.inputSchema.shape === "object"
    && tool.inputSchema.shape !== null
    && "limit" in tool.inputSchema.shape
  );
  const routeRows = [...API_ROUTE_INVENTORY]
    .sort((left, right) => left.operationId.localeCompare(right.operationId))
    .map((route) =>
      `| \`${route.operationId}\` | ${route.method} | \`${route.path}\` | ${route.access} | ${route.revisionRequired} | ${route.longRunning} |`
    ).join("\n");
  const toolRows = [...MCP_TOOL_INVENTORY]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((tool) =>
      `| \`${tool.name}\` | \`${tool.http.operationId}\` | ${tool.http.method} | ${tool.annotations.readOnlyHint ? "read" : "write"} |`
    ).join("\n");

  return `# SiftCut v1 release interfaces

This document is generated. The checked-in JSON artifacts are the exact
machine-readable compatibility boundary:

- [HTTP route inventory](api-v1-routes.json) — ${manifest.artifacts.http.operationCount} operations, SHA-256 \`${manifest.artifacts.http.sha256}\`
- [MCP tool schemas](mcp-v1-tools.json) — ${manifest.artifacts.mcp.toolCount} tools with Draft-07 input/output schemas, SHA-256 \`${manifest.artifacts.mcp.sha256}\`
- [Compatibility manifest](release-interface-v1.json) — policy, artifact digests, and exact MCP-to-HTTP mappings

## Compatibility policy

The v1 interface is additive-only. Removing or renaming an operation, tool,
field, enum value, or changing its meaning requires a new major interface
version. Mutation bodies and query strings are strict: unknown fields are
rejected. Successes use \`{apiVersion:"v1",data}\`; failures use
\`{apiVersion:"v1",error:{code,message,details,retryable}}\`.

All ${listRoutes.length} unbounded HTTP collections return
\`{items,nextCursor}\`; ${pagedMcpTools.length} of them are exposed through MCP
with the same page contract. The default limit is 100 and the accepted range is
1–1,000. Cursors are opaque, bound to the operation and active filters, and
continue after a stable item ID. Invalid, stale, cross-operation, and
cross-filter cursors return \`VALIDATION_ERROR\`.

Diagnostic exports follow \`${DIAGNOSTIC_EXPORT_POLICY_VERSION}\`. Credential
fields and recognizable credential strings are always removed. Transcript,
source, and path fields are excluded by default and appear only after explicit
sensitive-detail opt-in.

## HTTP v1

The core binds to \`127.0.0.1\` by default. ${publicCount} operations are public
to the loopback client and ${desktopCount} credential/cloud-security operations
also require the per-launch desktop token. No durable-entity deletion operation
is exposed.

| Operation ID | Method | Path | Access | Revision required | Long-running |
| --- | --- | --- | --- | --- | --- |
${routeRows}

## MCP v1

Every MCP tool calls its mapped HTTP operation and returns the same versioned
domain envelope. The complete concrete request and response JSON Schemas live
in [mcp-v1-tools.json](mcp-v1-tools.json). Security grants and credential
management intentionally remain desktop-only.

| Tool | HTTP operation | Method | Kind |
| --- | --- | --- | --- |
${toolRows}
`;
}
