import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { createBrowserWindowOptions } from "./window-options.js";

const directory = fileURLToPath(new URL(".", import.meta.url));
const expectedFunctions = [
  "selectMedia",
  "selectWatchedDirectory",
  "selectRelinkCandidate",
  "selectAsset",
  "mediaUrl",
  "credentials.list",
  "credentials.save",
  "credentials.remove",
  "cloudAuthorizations.list",
  "cloudAuthorizations.grant",
  "cloudAuthorizations.revoke"
] as const;

async function run(): Promise<void> {
  await app.whenReady();
  const window = new BrowserWindow({
    ...createBrowserWindowOptions(directory),
    show: false
  });
  let preloadFailure: Error | undefined;
  window.webContents.once("preload-error", (_event, preloadPath, error) => {
    preloadFailure = new Error(`Preload failed at ${preloadPath}: ${error.message}`);
  });

  try {
    await window.loadURL("data:text/html,<title>Short Editor preload smoke</title>");
    if (preloadFailure) throw preloadFailure;
    const missing = await window.webContents.executeJavaScript(`
      (() => {
        const paths = ${JSON.stringify(expectedFunctions)};
        return paths.filter((path) => {
          const value = path.split(".").reduce((current, segment) =>
            current == null ? undefined : current[segment], window.desktop);
          return typeof value !== "function";
        });
      })()
    `) as string[];
    if (missing.length > 0) {
      throw new Error(`Missing window.desktop functions: ${missing.join(", ")}`);
    }
    console.log(`Electron preload smoke passed (${expectedFunctions.length} functions)`);
  } finally {
    window.destroy();
  }
}

void run().then(
  () => app.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    app.exit(1);
  }
);
