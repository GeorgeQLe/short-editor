import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell } from "electron";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { ProtectedCredentialVault } from "../security/credential-vault.js";
import {
  openAiBridgeCancelSchema,
  openAiBridgeRequestSchema,
  type OpenAiBridgeEvent
} from "../shared/domain.js";
import { normalizeError } from "../shared/errors.js";
import { resolveCoreExecutable } from "./core-launch.js";
import { desktopListItems } from "./desktop-list.js";
import { OpenAiHttpAdapter } from "./openai-adapter.js";
import { createBrowserWindowOptions } from "./window-options.js";
import {
  buildDiagnosticPreview,
  inspectRuntime,
  ModelInstallManager,
  writeDiagnosticZip,
  type RuntimePaths
} from "./runtime-support.js";
import { resolveApplicationRuntimePaths } from "./runtime-paths.js";

const directory = fileURLToPath(new URL(".", import.meta.url));
let core: ChildProcess | undefined;
const desktopToken = randomBytes(32).toString("base64url");
const coreUrl = "http://127.0.0.1:43120/v1";
let credentialVault: ProtectedCredentialVault;
const openAiAdapter = new OpenAiHttpAdapter();
const openAiOperations = new Map<string, AbortController>();

protocol.registerSchemesAsPrivileged([{
  scheme: "short-editor-media",
  privileges: {
    standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true
  }
}]);

function createWindow() {
  const window = new BrowserWindow(createBrowserWindowOptions(directory));
  if (app.isPackaged) void window.loadFile(join(directory, "../ui/index.html"));
  else void window.loadURL("http://localhost:5173");
}

app.whenReady().then(async () => {
  const runtimePaths = applicationRuntimePaths();
  const modelInstaller = new ModelInstallManager(runtimePaths);
  await modelInstaller.initialize().catch((error) => {
    console.error(error instanceof Error ? error.message : "Model installer could not initialize");
  });
  credentialVault = new ProtectedCredentialVault(
    join(app.getPath("userData"), "protected-credentials.json"),
    {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      protect: (value) => safeStorage.encryptString(value),
      unprotect: (value) => safeStorage.decryptString(value)
    }
  );
  ipcMain.handle("dialog:select-media", selectMediaFiles);
  ipcMain.handle("dialog:select-watched-directory", selectWatchedDirectory);
  ipcMain.handle("dialog:select-relink-candidate", selectRelinkCandidate);
  ipcMain.handle("dialog:select-asset", selectAssetFile);
  protocol.handle("short-editor-media", serveInventoryMedia);
  ipcMain.handle("credentials:list", () => credentialVault.list());
  ipcMain.handle("credentials:save", async (_event, input) => {
    const credential = credentialVault.save(input);
    await synchronizeCredentialHandles();
    return credential;
  });
  ipcMain.handle("credentials:remove", async (_event, handle: string) => {
    await desktopRequest(`/desktop/credentials/${encodeURIComponent(handle)}/removed`, "POST");
    credentialVault.remove(handle);
    return { removed: true };
  });
  ipcMain.handle("cloud-authorizations:list", async (_event, scopeId?: string) =>
    desktopListItems(await desktopRequest(`/desktop/cloud-authorizations${
      scopeId ? `?scopeId=${encodeURIComponent(scopeId)}` : ""
    }`), "Cloud authorization list")
  );
  ipcMain.handle("cloud-authorizations:grant", (_event, input) =>
    desktopRequest("/desktop/cloud-authorizations", "POST", input)
  );
  ipcMain.handle("cloud-authorizations:revoke", (_event, id: string) =>
    desktopRequest(`/desktop/cloud-authorizations/${encodeURIComponent(id)}/revoke`, "POST")
  );
  ipcMain.handle("runtime:readiness", () => inspectRuntime(runtimePaths));
  ipcMain.handle("runtime:model-install-state", () => modelInstaller.snapshot());
  ipcMain.handle("runtime:model-install", () => modelInstaller.start());
  ipcMain.handle("runtime:model-install-cancel", () => modelInstaller.cancel());
  ipcMain.handle("runtime:open-models-folder", async () => {
    await mkdir(runtimePaths.models, { recursive: true });
    const error = await shell.openPath(runtimePaths.models);
    if (error) throw new Error(error);
  });
  ipcMain.handle("application:version", () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    supportedPlatform: process.platform === "darwin" && process.arch === "arm64"
  }));
  ipcMain.handle("diagnostics:preview", async (_event, options) =>
    diagnosticPreview(runtimePaths, options)
  );
  ipcMain.handle("diagnostics:export", async (_event, options) => {
    const preview = await diagnosticPreview(runtimePaths, options);
    const result = await dialog.showSaveDialog({
      title: "Export diagnostics",
      defaultPath: join(app.getPath("downloads"), preview.fileName),
      filters: [{ name: "ZIP archive", extensions: ["zip"] }]
    });
    if (result.canceled || !result.filePath) return { exported: false };
    await writeDiagnosticZip(result.filePath, preview);
    return { exported: true, path: result.filePath };
  });
  core = spawn(
    resolveCoreExecutable(app.isPackaged, process.execPath, process.env.npm_node_execpath),
    [join(directory, "../core/cli.js")],
    {
    env: coreEnvironment(),
    windowsHide: true,
    stdio: ["ignore", "inherit", "inherit", "ipc"]
    }
  );
  core.on("message", handleCoreMessage);
  void waitForCore()
    .then(synchronizeCredentialHandles)
    .catch((error) => console.error(
      error instanceof Error ? error.message : "Local core did not start"
    ));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => core?.kill());

export async function selectMediaFiles(): Promise<string[]> {
  const result = await dialog.showOpenDialog({
    title: "Import episodes", properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Video media", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "mpeg", "mpg"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
}

export async function selectWatchedDirectory(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Choose watched folder",
    properties: ["openDirectory", "createDirectory"]
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

export async function selectRelinkCandidate(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Choose replacement source",
    properties: ["openFile"],
    filters: [
      { name: "Video media", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "mpeg", "mpg"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

export async function selectAssetFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Choose composition asset",
    properties: ["openFile"],
    filters: [
      {
        name: "Supported assets",
        extensions: [
          "png", "jpg", "jpeg", "webp", "gif", "svg",
          "mp4", "mov", "mkv", "webm", "m4v",
          "mp3", "wav", "m4a", "aac", "flac", "ogg"
        ]
      },
      { name: "Images and logos", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] },
      { name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "m4v"] },
      { name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg"] }
    ]
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

async function serveInventoryMedia(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const kind = url.hostname;
    const id = decodeURIComponent(url.pathname.slice(1));
    if (
      (kind !== "episode" && kind !== "asset") ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ) return new Response("Not found", { status: 404 });
    const path = await resolveInventoryPath(kind, id);
    if (!path) return new Response("Not found", { status: 404 });
    const info = await stat(path);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    const range = parseByteRange(request.headers.get("range"), info.size);
    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}`, "Accept-Ranges": "bytes" }
      });
    }
    const bytes = await readFile(path);
    const body = range ? bytes.subarray(range.start, range.end + 1) : bytes;
    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(body.byteLength),
        "Content-Type": mediaContentType(path),
        ...(range
          ? { "Content-Range": `bytes ${range.start}-${range.end}/${info.size}` }
          : {})
      }
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function resolveInventoryPath(
  kind: "episode" | "asset",
  id: string
): Promise<string | null> {
  if (kind === "episode") {
    const episode = await publicCoreRequest(`/library/episodes/${encodeURIComponent(id)}`) as {
      sourcePath?: unknown;
      missing?: unknown;
    };
    return episode.missing === true || typeof episode.sourcePath !== "string"
      ? null
      : episode.sourcePath;
  }
  let cursor: string | null = null;
  do {
    const page = await publicCoreRequest(`/assets?limit=1000${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    }`) as {
      items?: Array<{ id?: unknown; sourcePath?: unknown; ownedArtifactPath?: unknown }>;
      nextCursor?: unknown;
    };
    const asset = page.items?.find((item) => item.id === id);
    if (asset) return typeof asset.sourcePath === "string" ? asset.sourcePath : null;
    cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
  } while (cursor);
  return null;
}

async function publicCoreRequest(path: string): Promise<unknown> {
  const response = await fetch(`${coreUrl}${path}`);
  if (!response.ok) return null;
  const payload = await response.json() as { data?: unknown };
  return payload.data;
}

function parseByteRange(
  header: string | null,
  size: number
): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return "invalid";
  const startText = match[1]!;
  const endText = match[2]!;
  if (!startText && !endText) return "invalid";
  let start: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isInteger(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) {
    return "invalid";
  }
  return { start, end: Math.min(end, size - 1) };
}

function mediaContentType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
    flac: "audio/flac", ogg: "audio/ogg", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml"
  } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

async function synchronizeCredentialHandles(): Promise<void> {
  await desktopRequest("/desktop/credentials/synchronize", "POST", {
    handles: credentialVault.list().map((credential) => credential.handle)
  });
}

async function desktopRequest(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const response = await fetch(`${coreUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-short-editor-desktop-token": desktopToken
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json() as {
    data?: unknown;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message ?? "Desktop security operation failed");
  return payload.data;
}

async function handleCoreMessage(message: unknown): Promise<void> {
  if (!message || typeof message !== "object") return;
  const envelope = message as { channel?: unknown; payload?: unknown };
  if (envelope.channel !== "short-editor:openai") return;
  const cancellation = openAiBridgeCancelSchema.safeParse(envelope.payload);
  if (cancellation.success) {
    openAiOperations.get(cancellation.data.jobId)?.abort();
    return;
  }
  const request = openAiBridgeRequestSchema.safeParse(envelope.payload);
  if (!request.success) return;
  const controller = new AbortController();
  openAiOperations.set(request.data.jobId, controller);
  const send = (payload: OpenAiBridgeEvent) => {
    if (core?.connected) core.send({ channel: "short-editor:openai", payload });
  };
  const authorize = async () => {
    const result = await desktopRequest("/desktop/cloud-authorizations/validate", "POST", {
      scopeType: request.data.authorization.scopeType,
      scopeId: request.data.authorization.scopeId,
      provider: "openai",
      operationClass: request.data.authorization.operationClass,
      credentialHandle: request.data.credentialHandle
    }) as { authorized?: unknown };
    return result.authorized === true && credentialVault.has(request.data.credentialHandle);
  };
  try {
    const summary = credentialVault.list().find(
      (item) => item.handle === request.data.credentialHandle
    );
    if (!summary || summary.provider !== "openai") {
      throw new Error("Protected OpenAI credential is unavailable");
    }
    const apiKey = credentialVault.resolve(request.data.credentialHandle);
    const onProgress = (progress: number, stage: string) => send({
      type: "progress",
      requestId: request.data.requestId,
      jobId: request.data.jobId,
      progress,
      stage
    });
    const result = request.data.operation === "speech"
      ? await openAiAdapter.speech({
        apiKey,
        inputPath: request.data.inputPath,
        options: request.data.options,
        signal: controller.signal,
        authorize,
        onProgress
      })
      : await openAiAdapter.analyze({
        apiKey,
        inputPaths: request.data.inputPaths,
        options: request.data.options,
        signal: controller.signal,
        authorize,
        onProgress
      });
    send({
      type: "result",
      requestId: request.data.requestId,
      jobId: request.data.jobId,
      result
    });
  } catch (error) {
    const normalized = normalizeError(error);
    send({
      type: "error",
      requestId: request.data.requestId,
      jobId: request.data.jobId,
      code: bridgeErrorCode(normalized.code),
      message: normalized.message,
      retryable: normalized.retryable
    });
  } finally {
    openAiOperations.delete(request.data.jobId);
  }
}

function bridgeErrorCode(code: string): "DEPENDENCY_UNAVAILABLE" | "PROVIDER_UNAVAILABLE" |
  "PROVIDER_OUTPUT_INVALID" | "CLOUD_NOT_AUTHORIZED" | "JOB_CANCELLED" | "INTERNAL_ERROR" {
  if (
    code === "DEPENDENCY_UNAVAILABLE" ||
    code === "PROVIDER_UNAVAILABLE" ||
    code === "PROVIDER_OUTPUT_INVALID" ||
    code === "CLOUD_NOT_AUTHORIZED" ||
    code === "JOB_CANCELLED"
  ) return code;
  return "INTERNAL_ERROR";
}

function coreEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of [
    "OPENAI_API_KEY",
    "OPENAI_API_TOKEN",
    "OPENAI_ORG_ID",
    "OPENAI_PROJECT_ID"
  ]) delete environment[name];
  environment.ELECTRON_RUN_AS_NODE = "1";
  environment.SHORT_EDITOR_DESKTOP_TOKEN = desktopToken;
  const runtimePaths = applicationRuntimePaths();
  environment.SHORT_EDITOR_DATA_DIR = runtimePaths.data;
  environment.SHORT_EDITOR_FFMPEG = runtimePaths.ffmpeg;
  environment.SHORT_EDITOR_FFMPEG_PATH = runtimePaths.ffmpeg;
  environment.SHORT_EDITOR_FFPROBE = runtimePaths.ffprobe;
  environment.SHORT_EDITOR_WHISPER_MODEL_DIR = runtimePaths.models;
  environment.SHORT_EDITOR_WHISPER_MODEL_IDS = "small.en";
  environment.SHORT_EDITOR_WHISPER_MODEL = "small.en";
  if (app.isPackaged) environment.SHORT_EDITOR_WORKER_EXECUTABLE = runtimePaths.worker;
  return environment;
}

function applicationRuntimePaths(): RuntimePaths {
  const resources = app.isPackaged ? process.resourcesPath : join(directory, "../../resources");
  return resolveApplicationRuntimePaths({
    packaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: resources,
    userDataPath: app.getPath("userData")
  });
}

async function diagnosticPreview(runtimePaths: RuntimePaths, options: unknown) {
  const consent = options && typeof options === "object"
    ? options as { includeTranscripts?: unknown; includePaths?: unknown }
    : {};
  const [jobs, renders, coreHealth] = await Promise.all([
    publicCoreRequest("/jobs?limit=1000"),
    publicCoreRequest("/renders?limit=1000"),
    publicCoreRequest("/health")
  ]);
  return buildDiagnosticPreview({
    appVersion: app.getVersion(),
    readiness: await inspectRuntime(runtimePaths),
    jobs,
    renders,
    coreHealth,
    includeTranscripts: consent.includeTranscripts === true,
    includePaths: consent.includePaths === true
  });
}

async function waitForCore(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${coreUrl}/health`);
      if (response.ok) return;
    } catch {
      // The packaged core is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local core did not start");
}
