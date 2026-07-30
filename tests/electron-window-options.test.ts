import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBrowserWindowOptions } from "../src/electron/window-options";

describe("Electron BrowserWindow options", () => {
  it("resolves the compiled CommonJS preload artifact", () => {
    expect(createBrowserWindowOptions("/compiled/electron").webPreferences?.preload)
      .toBe(join("/compiled/electron", "preload.cjs"));
  });

  it("retains the sandboxed, isolated renderer security boundary", () => {
    expect(createBrowserWindowOptions("/compiled/electron").webPreferences)
      .toMatchObject({
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      });
  });
});
