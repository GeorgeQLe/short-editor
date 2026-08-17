import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpV2Server } from "./registry.js";
import { createApi, DEFAULT_API_HOST } from "../core/api.js";
import { createCore } from "../core/bootstrap.js";
import type { CoreService } from "../core/service.js";
import type { Server } from "node:http";

export {
  createMcpServer,
  executeMcpHttpTool,
  MCP_TOOL_INVENTORY,
  MCP_TOOL_NAMES
} from "./registry.js";

const configuredCoreUrl = (process.env.SHORT_EDITOR_CORE_URL ?? "http://127.0.0.1:43120/v1")
  .replace(/\/$/, "");
const rootUrl = configuredCoreUrl.replace(/\/(?:v1|v2)$/, "");
let ownedCore: CoreService | undefined;
let ownedHttp: Server | undefined;

async function coreAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${rootUrl}/v1/health`, { signal: AbortSignal.timeout(750) });
    if (!response.ok) return false;
    const payload = await response.json() as { apiVersion?: unknown; data?: { status?: unknown } };
    return payload.apiVersion === "v1" && payload.data?.status === "ok";
  } catch { return false; }
}

async function ensureCore(): Promise<void> {
  if (await coreAvailable()) return;
  const url = new URL(rootUrl);
  const host = url.hostname || DEFAULT_API_HOST;
  const port = Number(url.port || 43120);
  const service = createCore();
  try {
    const server = createApi(service, process.env.SHORT_EDITOR_DESKTOP_TOKEN).listen(port, host);
    await new Promise<void>((resolvePromise, reject) => {
      server.once("listening", resolvePromise);
      server.once("error", reject);
    });
    ownedCore = service;
    ownedHttp = server;
  } catch (error) {
    await service.stop();
    if (await coreAvailable()) return;
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(code === "EADDRINUSE"
      ? `SiftCut MCP cannot start its headless core: ${host}:${port} is occupied by a non-core process.`
      : `SiftCut MCP cannot acquire its core port or data store: ${String(code ?? "startup failed")}`);
  }
}

await ensureCore();
const mcp = createMcpV2Server({ coreUrl: configuredCoreUrl });
await mcp.connect(new StdioServerTransport());

const shutdown = () => {
  void (async () => {
    await mcp.close();
    if (ownedHttp) await new Promise<void>((resolvePromise) => ownedHttp!.close(() => resolvePromise()));
    await ownedCore?.stop();
  })();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
