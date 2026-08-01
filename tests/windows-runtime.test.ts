import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectRuntime,
  parsePeArchitecture,
  validateRuntimeManifestV3,
  type RuntimeManifestV3
} from "../src/electron/runtime-support";
import {
  resolveApplicationRuntimePaths,
  runtimeExecutableName
} from "../src/electron/runtime-paths";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("Windows runtime resources", () => {
  it("uses Windows executable names and never resolves packaged tools through PATH", () => {
    expect(runtimeExecutableName("ffmpeg", "win32")).toBe("ffmpeg.exe");
    expect(runtimeExecutableName("ffprobe", "win32")).toBe("ffprobe.exe");
    const paths = resolveApplicationRuntimePaths({
      packaged: true,
      platform: "win32",
      applicationArchitecture: "arm64",
      resourcesPath: "C:\\Program Files\\SiftCut\\resources",
      userDataPath: "C:\\Users\\creator\\AppData\\Roaming\\SiftCut",
      environment: {
        PATH: "C:\\untrusted",
        SHORT_EDITOR_FFMPEG: "C:\\untrusted\\ffmpeg.exe",
        SHORT_EDITOR_PYTHON: "C:\\untrusted\\python.exe"
      }
    });
    expect(paths.ffmpeg).toMatch(/resources[\\/]bin[\\/]ffmpeg\.exe$/);
    expect(paths.ffprobe).toMatch(/resources[\\/]bin[\\/]ffprobe\.exe$/);
    expect(paths.worker).toMatch(/resources[\\/]worker[\\/]short-editor-worker\.exe$/);
    expect(paths.ffmpeg).not.toContain("untrusted");
    expect(paths.python).toBe(paths.worker);
    expect(paths.targetArchitecture).toBe("arm64");
  });

  it("keeps development overrides intact", () => {
    const paths = resolveApplicationRuntimePaths({
      packaged: false,
      platform: "win32",
      resourcesPath: "D:\\source\\resources",
      userDataPath: "D:\\data",
      environment: {
        SHORT_EDITOR_FFMPEG: "D:\\dev\\ffmpeg.exe",
        SHORT_EDITOR_FFPROBE: "D:\\dev\\ffprobe.exe",
        SHORT_EDITOR_PYTHON: "D:\\dev\\python.exe"
      }
    });
    expect(paths).toMatchObject({
      ffmpeg: "D:\\dev\\ffmpeg.exe",
      ffprobe: "D:\\dev\\ffprobe.exe",
      python: "D:\\dev\\python.exe",
      packaged: false
    });
  });

  it("parses x64 and ARM64 PE machine types and rejects malformed executables", () => {
    expect(parsePeArchitecture(peFixture(0x8664))).toBe("x64");
    expect(parsePeArchitecture(peFixture(0xaa64))).toBe("arm64");
    expect(() => parsePeArchitecture(peFixture(0x014c))).toThrow("unsupported PE machine");
    expect(() => parsePeArchitecture(Buffer.from("not PE"))).toThrow("not a PE");
  });

  it("accepts the intentional ARM64 mixed manifest and rejects invalid execution modes", () => {
    const manifest = windowsManifest("arm64");
    expect(validateRuntimeManifestV3(manifest, {
      os: "windows", architecture: "arm64"
    })).toBe(manifest);
    expect(() => validateRuntimeManifestV3({
      ...manifest,
      resources: manifest.resources.map((resource) =>
        resource.id === "ffmpeg" ? { ...resource, executionMode: "native" } : resource
      )
    })).toThrow("does not match");
    expect(() => validateRuntimeManifestV3(manifest, {
      os: "windows", architecture: "x64"
    })).toThrow("expected x64");
  });

  it("keeps local workflow readiness false for corrupt packaged resources", async () => {
    const root = mkdtempSync(join(tmpdir(), "siftcut-runtime-corrupt-"));
    roots.push(root);
    for (const directory of ["bin", "worker", "models", "data"]) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    const executableExtension = process.platform === "win32" ? ".exe" : "";
    const executable = join(root, "bin", `ffmpeg${executableExtension}`);
    const ffprobe = join(root, "bin", `ffprobe${executableExtension}`);
    const worker = join(root, "worker", "short-editor-worker");
    for (const path of [executable, ffprobe]) {
      copyFileSync(process.execPath, path);
      chmodSync(path, 0o755);
    }
    writeFileSync(worker, "worker fixture");
    const resources = [
      resource("ffmpeg", `bin/ffmpeg${executableExtension}`, executable),
      resource("ffprobe", `bin/ffprobe${executableExtension}`, ffprobe),
      resource("python-worker", "worker/short-editor-worker", worker)
    ];
    const manifest: RuntimeManifestV3 = {
      schemaVersion: 3,
      generatedBy: "test",
      releasePlatform: {
        os: "macos", minimumVersion: "14", applicationArchitecture: "x64"
      },
      resources,
      models: []
    };
    writeFileSync(join(root, "runtime-manifest.json"), JSON.stringify(manifest));
    writeFileSync(executable, "corrupt");
    const readiness = await inspectRuntime({
      ffmpeg: executable,
      ffprobe,
      python: worker,
      worker,
      runtimeManifest: join(root, "runtime-manifest.json"),
      modelManifest: join(root, "models/missing.json"),
      models: join(root, "models"),
      data: join(root, "data"),
      packaged: true,
      targetOs: "macos",
      targetArchitecture: "x64"
    });
    expect(readiness.localWorkflowReady).toBe(false);
    expect(readiness.checks.find((check) => check.id === "ffmpeg")).toMatchObject({
      state: "needs_attention",
      architecture: "x64",
      executionMode: "native"
    });
    expect(readiness.checks.find((check) => check.id === "ffprobe")).toMatchObject({
      architecture: "x64"
    });
    rmSync(ffprobe);
    const missingReadiness = await inspectRuntime({
      ffmpeg: executable,
      ffprobe,
      python: worker,
      worker,
      runtimeManifest: join(root, "runtime-manifest.json"),
      modelManifest: join(root, "models/missing.json"),
      models: join(root, "models"),
      data: join(root, "data"),
      packaged: true,
      targetOs: "macos",
      targetArchitecture: "x64"
    });
    expect(missingReadiness.localWorkflowReady).toBe(false);
    expect(missingReadiness.checks.find((check) => check.id === "ffprobe")?.detail)
      .toContain("unavailable");
  });
});

function peFixture(machine: number): Buffer {
  const bytes = Buffer.alloc(0x90);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.writeUInt32LE(0x00004550, 0x80);
  bytes.writeUInt16LE(machine, 0x84);
  return bytes;
}

function windowsManifest(architecture: "x64" | "arm64"): RuntimeManifestV3 {
  const source = { url: "https://example.invalid/resource", sha256: "a".repeat(64) };
  const make = (
    id: string,
    resourceArchitecture: "x64" | "arm64" | "neutral",
    executionMode: "native" | "emulated"
  ) => ({
    id, version: "1.0", path: `${id}.bin`, architecture: resourceArchitecture,
    executionMode, licenseEvidence: "LICENSE", source, size: 1, sha256: "b".repeat(64)
  });
  const computeMode = architecture === "arm64" ? "emulated" : "native";
  return {
    schemaVersion: 3,
    generatedBy: "test",
    releasePlatform: {
      os: "windows", minimumVersion: "11", applicationArchitecture: architecture
    },
    resources: [
      make("ffmpeg", "x64", computeMode),
      make("ffprobe", "x64", computeMode),
      make("python-worker", "x64", computeMode),
      make("inter-regular", "neutral", "native"),
      make("inter-bold", "neutral", "native")
    ],
    models: []
  };
}

function resource(id: string, path: string, absolutePath: string) {
  const bytes = readFileSync(absolutePath);
  return {
    id, version: "8.1.2", path, architecture: "x64" as const,
    executionMode: "native" as const, licenseEvidence: path,
    source: { url: "test", sha256: createHash("sha256").update(bytes).digest("hex") },
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}
