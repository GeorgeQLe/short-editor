import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBrowserWindowOptions } from "./window-options.js";

const directory = fileURLToPath(new URL(".", import.meta.url));
const rendererPath = join(directory, "../ui/index.html");
const timeoutMilliseconds = 15_000;

type RendererSnapshot = {
  rootHtml: string;
  rootText: string;
  absoluteAssets: string[];
};

async function run(): Promise<void> {
  await app.whenReady();
  const window = new BrowserWindow({
    ...createBrowserWindowOptions(directory),
    show: false
  });
  const resourceFailures: string[] = [];
  let rejectFatal: (error: Error) => void = () => undefined;
  const fatalFailure = new Promise<never>((_resolve, reject) => {
    rejectFatal = reject;
  });

  window.webContents.once("preload-error", (_event, preloadPath, error) => {
    rejectFatal(new Error(`Preload failed at ${preloadPath}: ${error.message}`));
  });
  window.webContents.once("render-process-gone", (_event, details) => {
    rejectFatal(new Error(
      `Renderer process exited (${details.reason}, exit code ${details.exitCode})`
    ));
  });
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      rejectFatal(new Error(
        `${isMainFrame ? "Main document" : "Frame"} failed to load ` +
        `${validatedUrl} (${errorCode}: ${errorDescription})`
      ));
    }
  );
  window.webContents.session.webRequest.onErrorOccurred(
    { urls: ["file://*/*"] },
    (details) => {
      resourceFailures.push(
        `${details.resourceType} ${details.url} (${details.error})`
      );
    }
  );

  let timeout: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Renderer smoke timed out after ${timeoutMilliseconds}ms`));
    }, timeoutMilliseconds);
  });

  try {
    const snapshot = await Promise.race([
      loadAndInspect(window),
      fatalFailure,
      timedOut
    ]);
    if (resourceFailures.length > 0) {
      throw new Error(`Local renderer resources failed to load:\n${resourceFailures.join("\n")}`);
    }
    if (!snapshot.rootHtml.trim()) throw new Error("React root is empty");
    if (!snapshot.rootText.includes("SiftCut")) {
      throw new Error("React root is missing SiftCut branding");
    }
    if (snapshot.absoluteAssets.length > 0) {
      throw new Error(
        `Renderer uses absolute local script or stylesheet paths: ` +
        snapshot.absoluteAssets.join(", ")
      );
    }
    console.log("Electron renderer smoke passed (UI rendered with relative local assets)");
  } finally {
    if (timeout) clearTimeout(timeout);
    window.destroy();
  }
}

async function loadAndInspect(window: BrowserWindow): Promise<RendererSnapshot> {
  await window.loadFile(rendererPath);
  return window.webContents.executeJavaScript(`
    (() => {
      const root = document.querySelector("#root");
      const localAssets = [
        ...document.querySelectorAll("script[src]"),
        ...document.querySelectorAll('link[rel~="stylesheet"][href]')
      ];
      const absoluteAssets = localAssets
        .map((element) => element.getAttribute(element.tagName === "SCRIPT" ? "src" : "href"))
        .filter((value) =>
          typeof value === "string" &&
          (value.startsWith("/") || value.startsWith("file:") || /^[A-Za-z]:[\\\\/]/.test(value))
        );
      return {
        rootHtml: root?.innerHTML ?? "",
        rootText: root?.textContent ?? "",
        absoluteAssets
      };
    })()
  `) as Promise<RendererSnapshot>;
}

void run().then(
  () => app.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    app.exit(1);
  }
);
