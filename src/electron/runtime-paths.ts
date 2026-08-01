import { join } from "node:path";
import type { RuntimePaths } from "./runtime-support.js";

export interface RuntimePathOptions {
  packaged: boolean;
  platform: NodeJS.Platform;
  resourcesPath: string;
  userDataPath: string;
  environment?: NodeJS.ProcessEnv;
  applicationArchitecture?: NodeJS.Architecture;
}

export function runtimeExecutableName(
  name: "ffmpeg" | "ffprobe",
  platform: NodeJS.Platform
): string {
  return platform === "win32" ? `${name}.exe` : name;
}

export function resolveApplicationRuntimePaths(options: RuntimePathOptions): RuntimePaths {
  const environment = options.environment ?? process.env;
  const applicationArchitecture = options.applicationArchitecture ?? process.arch;
  const executable = (name: "ffmpeg" | "ffprobe") =>
    join(options.resourcesPath, "bin", runtimeExecutableName(name, options.platform));
  const workerName = options.platform === "win32"
    ? "short-editor-worker.exe"
    : "short-editor-worker";
  const packagedWorker = join(options.resourcesPath, "worker", workerName);
  return {
    ffmpeg: options.packaged
      ? executable("ffmpeg")
      : (environment.SHORT_EDITOR_FFMPEG ?? "ffmpeg"),
    ffprobe: options.packaged
      ? executable("ffprobe")
      : (environment.SHORT_EDITOR_FFPROBE ?? "ffprobe"),
    python: options.packaged
      ? packagedWorker
      : (environment.SHORT_EDITOR_PYTHON ?? (options.platform === "win32" ? "python" : "python3")),
    worker: options.packaged
      ? packagedWorker
      : join(options.resourcesPath, "worker", "worker.py"),
    runtimeManifest: join(options.resourcesPath, "runtime-manifest.json"),
    modelManifest: join(
      options.resourcesPath,
      "models",
      "faster-whisper-small.en-e0e3c0a.manifest.json"
    ),
    models: join(options.userDataPath, "models"),
    data: options.userDataPath,
    packaged: options.packaged,
    targetOs: options.platform === "win32" ? "windows" :
      options.platform === "darwin" ? "macos" : undefined,
    targetArchitecture:
      applicationArchitecture === "x64" || applicationArchitecture === "arm64"
      ? applicationArchitecture
      : undefined
  };
}
