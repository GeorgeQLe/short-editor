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

  it.each([
    ["apps/web/public/favicon-32.png", 32, 32],
    ["apps/web/public/app-web-icon-512.png", 512, 512],
    ["apps/web/public/social-card-1200x630.png", 1200, 630]
  ])("ships deterministic web derivative %s", (path, width, height) => {
    const icon = readFileSync(path);
    expect(icon.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(icon.readUInt32BE(16)).toBe(width);
    expect(icon.readUInt32BE(20)).toBe(height);
  });

  it("documents approved product names, lines, and provider-neutral positioning", () => {
    const brand = readFileSync("docs/saas/BRAND.md", "utf8");
    for (const text of ["SiftCut Desktop", "SiftCut Cloud", "SiftCut Mobile",
      "Long-form context. Short-form clarity.", "Find the short hiding inside the long story.",
      "AI-assisted, human-approved"]) expect(brand).toContain(text);
    expect(brand).toContain("provider-neutral");
    expect(readFileSync("apps/web/src/marketing.tsx", "utf8")).not.toMatch(/powered by OpenAI|OpenAI reseller|API wrapper/i);
    const entry = readFileSync("apps/web/src/main.tsx", "utf8");
    const vite = readFileSync("apps/web/vite.config.ts", "utf8");
    expect(entry).toContain('import.meta.env.DEV && import.meta.env.VITE_MARKETING_ONLY === "true"');
    expect(vite).toContain('VITE_MARKETING_ONLY is development-only');
    expect(vite).toContain('VITE_CLERK_PUBLISHABLE_KEY is required for web builds');
    expect(vite).toContain('VITE_TURNSTILE_SITE_KEY is required for web builds');
  });
});
