import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("product brand", () => {
  it("uses the SiftCut display name without changing the LexCorp app identity", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      build?: {
        appId?: string;
        mac?: {
          icon?: string;
        };
        productName?: string;
      };
    };

    expect(packageJson.build?.productName).toBe("SiftCut");
    expect(packageJson.build?.appId).toBe("com.lexcorp.shorteditor");
    expect(packageJson.build?.mac?.icon).toBe(
      "resources/branding/siftcut-app-icon-1024.png",
    );
  });

  it("ships a valid 1024px PNG master for macOS packaging", () => {
    const iconPath = "resources/branding/siftcut-app-icon-1024.png";
    const vectorMasterPath =
      "resources/branding/siftcut-app-icon-master.svg";
    expect(existsSync(iconPath)).toBe(true);
    expect(existsSync(vectorMasterPath)).toBe(true);

    const vectorMaster = readFileSync(vectorMasterPath, "utf8");
    expect(vectorMaster).toContain("A vertical violet and orange film frame");
    expect(vectorMaster).toContain('transform="rotate(90 512 512)"');

    const icon = readFileSync(iconPath);
    expect(icon.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(icon.readUInt32BE(16)).toBe(1024);
    expect(icon.readUInt32BE(20)).toBe(1024);
    expect(icon[25]).toBe(6);
  });
});
