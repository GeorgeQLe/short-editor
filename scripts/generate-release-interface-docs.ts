import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  serializeReleaseInterfaceDocumentation,
  serializeReleaseInterfaceManifest
} from "../src/release/interface-docs.js";

const manifestPath = resolve(process.cwd(), "docs/release-interface-v1.json");
const documentationPath = resolve(process.cwd(), "docs/release-interfaces-v1.md");
await Promise.all([
  writeFile(manifestPath, serializeReleaseInterfaceManifest(), "utf8"),
  writeFile(documentationPath, serializeReleaseInterfaceDocumentation(), "utf8")
]);
console.log(`Wrote ${manifestPath}`);
console.log(`Wrote ${documentationPath}`);
