import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { serializeMcpToolInventory } from "../src/mcp/registry.js";

const outputPath = resolve(process.cwd(), "docs/mcp-v1-tools.json");
await writeFile(outputPath, serializeMcpToolInventory(), "utf8");
console.log(`Wrote ${outputPath}`);
