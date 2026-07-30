import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import { randomBytes } from "node:crypto";
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
import { OpenAiHttpAdapter } from "./openai-adapter.js";

const directory = fileURLToPath(new URL(".", import.meta.url));
let core: ChildProcess | undefined;
const desktopToken = randomBytes(32).toString("base64url");
const coreUrl = "http://127.0.0.1:43120/v1";
let credentialVault: ProtectedCredentialVault;
const openAiAdapter = new OpenAiHttpAdapter();
const openAiOperations = new Map<string, AbortController>();

function createWindow() {
  const window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 650,
    backgroundColor: "#0b0e14",
    webPreferences: { preload: join(directory, "preload.js"), contextIsolation: true, nodeIntegration: false }
  });
  if (app.isPackaged) void window.loadFile(join(directory, "../ui/index.html"));
  else void window.loadURL("http://localhost:5173");
}

app.whenReady().then(() => {
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
  ipcMain.handle("cloud-authorizations:list", (_event, scopeId?: string) =>
    desktopRequest(`/desktop/cloud-authorizations${
      scopeId ? `?scopeId=${encodeURIComponent(scopeId)}` : ""
    }`)
  );
  ipcMain.handle("cloud-authorizations:grant", (_event, input) =>
    desktopRequest("/desktop/cloud-authorizations", "POST", input)
  );
  ipcMain.handle("cloud-authorizations:revoke", (_event, id: string) =>
    desktopRequest(`/desktop/cloud-authorizations/${encodeURIComponent(id)}/revoke`, "POST")
  );
  core = spawn(process.execPath, [join(directory, "../core/cli.js")], {
    env: coreEnvironment(),
    windowsHide: true,
    stdio: ["ignore", "inherit", "inherit", "ipc"]
  });
  core.on("message", handleCoreMessage);
  void waitForCore().then(synchronizeCredentialHandles);
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
  return environment;
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
