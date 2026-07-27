import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";

const directory = fileURLToPath(new URL(".", import.meta.url));
let core: ChildProcess | undefined;

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
  ipcMain.handle("dialog:select-media", selectMediaFiles);
  if (app.isPackaged) {
    core = spawn(process.execPath, [join(directory, "../core/cli.js")], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true
    });
  }
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
