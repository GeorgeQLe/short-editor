import type { BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";

export function createBrowserWindowOptions(
  electronDirectory: string
): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#0b0e14",
    webPreferences: {
      preload: join(electronDirectory, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  };
}
