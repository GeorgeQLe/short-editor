import { describe, expect, it } from "vitest";
import { desktopListItems } from "../src/electron/desktop-list";

describe("Electron desktop list bridge", () => {
  it("unwraps the core's live paginated authorization response shape", () => {
    const authorization = {
      id: "authorization-id",
      provider: "openai",
      operationClasses: ["transcription"]
    };

    expect(desktopListItems({
      items: [authorization],
      nextCursor: null
    }, "Cloud authorization list")).toEqual([authorization]);
  });

  it("rejects a response without an items array", () => {
    expect(() => desktopListItems({
      data: [],
      nextCursor: null
    }, "Cloud authorization list")).toThrow("Cloud authorization list response is invalid");
  });
});
