import { describe, expect, it } from "vitest";
import { resolveDataDirectory } from "../src/core/bootstrap";

describe("data directory resolution", () => {
  it.each(["win32", "darwin", "linux"] as const)(
    "prefers SHORT_EDITOR_DATA_DIR on %s",
    (platform) => {
      expect(resolveDataDirectory(
        platform,
        {
          SHORT_EDITOR_DATA_DIR: "/custom path/Short Editor data",
          LOCALAPPDATA: "C:\\Users\\Editor\\AppData\\Local",
          XDG_DATA_HOME: "/home/editor/.data"
        },
        "/home/editor"
      )).toBe("/custom path/Short Editor data");
    }
  );

  it("uses LOCALAPPDATA on Windows", () => {
    expect(resolveDataDirectory(
      "win32",
      { LOCALAPPDATA: "C:\\Users\\Video Editor\\AppData\\Local" },
      "C:\\Users\\Video Editor"
    )).toBe("C:\\Users\\Video Editor\\AppData\\Local\\ShortEditor");
  });

  it("falls back to the conventional local AppData directory on Windows", () => {
    expect(resolveDataDirectory(
      "win32",
      {},
      "C:\\Users\\Video Editor"
    )).toBe("C:\\Users\\Video Editor\\AppData\\Local\\ShortEditor");
  });

  it("uses Application Support on macOS", () => {
    expect(resolveDataDirectory(
      "darwin",
      {},
      "/Users/Video Editor"
    )).toBe("/Users/Video Editor/Library/Application Support/ShortEditor");
  });

  it("uses XDG_DATA_HOME on Linux", () => {
    expect(resolveDataDirectory(
      "linux",
      { XDG_DATA_HOME: "/home/video editor/custom data" },
      "/home/video editor"
    )).toBe("/home/video editor/custom data/ShortEditor");
  });

  it("falls back to the conventional local share directory on Linux", () => {
    expect(resolveDataDirectory(
      "linux",
      {},
      "/home/video editor"
    )).toBe("/home/video editor/.local/share/ShortEditor");
  });
});
