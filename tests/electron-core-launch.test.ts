import { describe, expect, it } from "vitest";
import { resolveCoreExecutable } from "../src/electron/core-launch";

describe("Electron core launch", () => {
  it("uses npm's host Node in development so native modules retain their installed ABI", () => {
    expect(resolveCoreExecutable(false, "/Electron", "/node")).toBe("/node");
  });

  it("uses Electron for packaged launches and as the development fallback", () => {
    expect(resolveCoreExecutable(true, "/Electron", "/node")).toBe("/Electron");
    expect(resolveCoreExecutable(false, "/Electron", undefined)).toBe("/Electron");
  });
});
