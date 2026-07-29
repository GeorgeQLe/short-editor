import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { MCP_TOOL_INVENTORY } from "../src/mcp/registry.js";

const artifact = MCP_TOOL_INVENTORY
  .map((tool) => ({
    name: tool.name,
    description: tool.description,
    annotations: tool.annotations,
    http: tool.http,
    inputSchema: z.toJSONSchema(tool.inputSchema, {
      target: "draft-07",
      io: "input",
      unrepresentable: "any"
    }),
    outputSchema: z.toJSONSchema(tool.outputSchema, {
      target: "draft-07",
      io: "output",
      unrepresentable: "any"
    })
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

const outputPath = resolve(process.cwd(), "docs/mcp-v1-tools.json");
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
