import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { serializeApiRouteInventory } from "../src/core/api.js";

const outputPath = resolve(process.cwd(), "docs/api-v1-routes.json");
await writeFile(outputPath, serializeApiRouteInventory(), "utf8");
console.log(`Wrote ${outputPath}`);
