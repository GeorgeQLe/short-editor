import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./registry.js";

export {
  createMcpServer,
  executeMcpHttpTool,
  MCP_TOOL_INVENTORY,
  MCP_TOOL_NAMES
} from "./registry.js";

await createMcpServer().connect(new StdioServerTransport());
