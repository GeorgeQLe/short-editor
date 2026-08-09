import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { serializeMcpV2ToolInventory } from "../src/mcp/registry.js";

const outputPath = resolve(process.cwd(), "docs/mcp-v2-tools.json");
await writeFile(outputPath, serializeMcpV2ToolInventory(), "utf8");
console.log(`Wrote ${outputPath}`);
