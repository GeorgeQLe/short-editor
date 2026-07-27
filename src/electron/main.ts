import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { ProtectedCredentialVault } from "../security/credential-vault.js";

const directory = fileURLToPath(new URL(".", import.meta.url));
let core: ChildProcess | undefined;
const desktopToken = randomBytes(32).toString("base64url");
const coreUrl = "http://127.0.0.1:43120/v1";
let credentialVault: ProtectedCredentialVault;

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
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      SHORT_EDITOR_DESKTOP_TOKEN: desktopToken
    },
    windowsHide: true
  });
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
