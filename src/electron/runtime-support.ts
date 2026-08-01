import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  open,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile
} from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGunzip } from "node:zlib";
import tar from "tar-stream";
import { filterDiagnosticExport } from "../shared/diagnostics.js";

const execute = promisify(execFile);

export type ReadinessState = "ready" | "optional" | "needs_attention";

export interface RuntimeCheck {
  id: "resources" | "ffmpeg" | "ffprobe" | "python" | "worker" | "model" | "ollama" | "storage";
  label: string;
  state: ReadinessState;
  detail: string;
  action: "none" | "install_model" | "open_setup";
  version?: string;
  architecture?: "x64" | "arm64" | "neutral";
  executionMode?: "native" | "emulated";
}

export interface RuntimeReadiness {
  checkedAt: string;
  localWorkflowReady: boolean;
  checks: RuntimeCheck[];
}

export interface RuntimePaths {
  ffmpeg: string;
  ffprobe: string;
  python: string;
  worker: string;
  modelManifest: string;
  models: string;
  data: string;
  runtimeManifest: string;
  packaged: boolean;
  targetOs?: "macos" | "windows";
  targetArchitecture?: "x64" | "arm64";
}

export interface RuntimeManifestResource {
  id: string;
  version: string;
  path: string;
  architecture: "x64" | "arm64" | "neutral";
  executionMode: "native" | "emulated";
  licenseEvidence: string;
  source: {
    url: string;
    sha256: string;
    revision?: string;
  };
  size: number;
  sha256: string;
}

export interface RuntimeManifestV3 {
  schemaVersion: 3;
  generatedBy: string;
  releasePlatform: {
    os: "macos" | "windows";
    minimumVersion: string;
    applicationArchitecture: "x64" | "arm64";
  };
  resources: RuntimeManifestResource[];
  models: Array<Record<string, unknown>>;
}

export interface ModelReleaseManifest {
  schemaVersion: 1;
  id: "small.en";
  version: string;
  repository: string;
  revision: string;
  license: "MIT";
  licenseUrl: string;
  privacy: {
    networkUse: string;
    localUse: string;
    telemetry: false;
  };
  archive: {
    name: string;
    size: number;
    sha256: string;
    url: string;
  };
  contents: Array<{ path: string; size: number; sha256: string }>;
}

export type ModelInstallPhase =
  "not_installed" | "downloading" | "paused" | "verifying" | "installing" | "ready" | "failed";

export interface ModelInstallState {
  phase: ModelInstallPhase;
  receivedBytes: number;
  totalBytes: number;
  message: string;
  canResume: boolean;
  canCancel: boolean;
}

export interface DiagnosticPreview {
  policyVersion: string;
  fileName: string;
  payload: unknown;
}

export async function inspectRuntime(paths: RuntimePaths): Promise<RuntimeReadiness> {
  const manifest = await readModelManifest(paths.modelManifest).catch(() => null);
  const runtimeManifest = paths.packaged
    ? await readRuntimeManifest(paths.runtimeManifest, paths).catch(() => null)
    : null;
  const resource = (id: string) => runtimeManifest?.resources.find((item) => item.id === id);
  const [resources, ffmpeg, ffprobe, python, worker, model, ollama, storage] = await Promise.all([
    paths.packaged
      ? runtimeManifestCheck(paths.runtimeManifest, runtimeManifest)
      : Promise.resolve<RuntimeCheck | null>(null),
    executableCheck("ffmpeg", "FFmpeg", paths.ffmpeg, ["-version"], resource("ffmpeg"),
      paths.packaged),
    executableCheck("ffprobe", "ffprobe", paths.ffprobe, ["-version"], resource("ffprobe"),
      paths.packaged),
    paths.packaged
      ? fileCheck("python", "Frozen worker runtime", paths.python, resource("python-worker"), true)
      : executableCheck("python", "Python worker runtime", paths.python, ["--version"]),
    fileCheck("worker", "Transcription worker", paths.worker, resource("python-worker"),
      paths.packaged),
    modelCheck(paths.models, manifest),
    ollamaCheck(),
    storageCheck(paths.data)
  ]);
  const checks = [resources, ffmpeg, ffprobe, python, worker, model, ollama, storage]
    .filter((check): check is RuntimeCheck => check !== null);
  return {
    checkedAt: new Date().toISOString(),
    localWorkflowReady: checks
      .filter((check) => check.id !== "ollama")
      .every((check) => check.state === "ready"),
    checks
  };
}

async function runtimeManifestCheck(
  manifestPath: string,
  manifest: RuntimeManifestV3 | null
): Promise<RuntimeCheck> {
  if (!manifest) {
    return {
      id: "resources", label: "Bundled runtime manifest", state: "needs_attention",
      detail: "The runtime manifest is missing, invalid, or targets another architecture.",
      action: "open_setup"
    };
  }
  try {
    const root = dirname(manifestPath);
    for (const resource of manifest.resources) {
      await verifyRuntimeResource(join(root, resource.path), resource);
      const evidence = await stat(join(root, resource.licenseEvidence));
      if (!evidence.isFile() || evidence.size === 0) throw new Error(
        `${resource.id} license evidence is missing`
      );
    }
    return {
      id: "resources", label: "Bundled runtime manifest", state: "ready",
      detail: "Every packaged runtime resource and license matches its pinned manifest.",
      action: "none"
    };
  } catch (error) {
    return {
      id: "resources", label: "Bundled runtime manifest", state: "needs_attention",
      detail: `Packaged runtime validation failed${
        error instanceof Error ? ` (${error.message})` : ""
      }`,
      action: "open_setup"
    };
  }
}

async function executableCheck(
  id: RuntimeCheck["id"],
  label: string,
  path: string,
  args: string[],
  resource?: RuntimeManifestResource,
  requireManifest = false
): Promise<RuntimeCheck> {
  try {
    if (requireManifest && !resource) throw new Error("resource is absent from the runtime manifest");
    if (path.includes("/") || path.includes("\\")) await access(path, constants.X_OK);
    if (resource) await verifyRuntimeResource(path, resource);
    const result = await execute(path, args, { timeout: 5_000 });
    const version = `${result.stdout || result.stderr}`.split(/\r?\n/, 1)[0]?.trim();
    return {
      id, label, state: "ready", detail: basename(path), action: "none", version,
      architecture: resource?.architecture, executionMode: resource?.executionMode
    };
  } catch (error) {
    return {
      id, label, state: "needs_attention", action: "open_setup",
      detail: `Required application resource is unavailable: ${basename(path)}${
        error instanceof Error ? ` (${error.message})` : ""
      }`,
      architecture: resource?.architecture, executionMode: resource?.executionMode
    };
  }
}

async function fileCheck(
  id: RuntimeCheck["id"],
  label: string,
  path: string,
  resource?: RuntimeManifestResource,
  requireManifest = false
): Promise<RuntimeCheck> {
  try {
    if (requireManifest && !resource) throw new Error("resource is absent from the runtime manifest");
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) throw new Error("invalid");
    if (resource) await verifyRuntimeResource(path, resource);
    return {
      id, label, state: "ready", detail: `${basename(path)} is available`, action: "none",
      version: resource?.version, architecture: resource?.architecture,
      executionMode: resource?.executionMode
    };
  } catch (error) {
    return {
      id, label, state: "needs_attention",
      detail: `Bundled worker is unavailable${
        error instanceof Error ? ` (${error.message})` : ""
      }`,
      action: "open_setup", architecture: resource?.architecture,
      executionMode: resource?.executionMode
    };
  }
}

export function parsePeArchitecture(bytes: Buffer): "x64" | "arm64" {
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d) {
    throw new Error("not a PE executable");
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset + 6 > bytes.length || bytes.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error("invalid PE signature");
  }
  const machine = bytes.readUInt16LE(peOffset + 4);
  if (machine === 0x8664) return "x64";
  if (machine === 0xaa64) return "arm64";
  throw new Error(`unsupported PE machine type 0x${machine.toString(16)}`);
}

export function validateRuntimeManifestV3(
  input: unknown,
  expected?: { os?: "macos" | "windows"; architecture?: "x64" | "arm64" }
): RuntimeManifestV3 {
  if (!input || typeof input !== "object") throw new Error("runtime manifest is not an object");
  const manifest = input as Partial<RuntimeManifestV3>;
  if (manifest.schemaVersion !== 3) throw new Error("runtime manifest schema must be version 3");
  if (
    !manifest.releasePlatform ||
    !["macos", "windows"].includes(manifest.releasePlatform.os) ||
    !["x64", "arm64"].includes(manifest.releasePlatform.applicationArchitecture)
  ) throw new Error("runtime manifest target is invalid");
  if (expected?.os && manifest.releasePlatform.os !== expected.os) {
    throw new Error(`runtime manifest targets ${manifest.releasePlatform.os}, expected ${expected.os}`);
  }
  if (
    expected?.architecture &&
    manifest.releasePlatform.applicationArchitecture !== expected.architecture
  ) throw new Error(
    `runtime manifest targets ${manifest.releasePlatform.applicationArchitecture}, ` +
    `expected ${expected.architecture}`
  );
  if (!Array.isArray(manifest.resources) || !Array.isArray(manifest.models)) {
    throw new Error("runtime manifest resource and model lists are required");
  }
  const ids = new Set<string>();
  for (const resource of manifest.resources) {
    if (!resource || typeof resource !== "object" || typeof resource.id !== "string") {
      throw new Error("runtime manifest resource is invalid");
    }
    if (ids.has(resource.id)) throw new Error(`duplicate runtime resource ${resource.id}`);
    ids.add(resource.id);
    if (!["x64", "arm64", "neutral"].includes(resource.architecture)) {
      throw new Error(`${resource.id}: resource architecture is invalid`);
    }
    if (!["native", "emulated"].includes(resource.executionMode)) {
      throw new Error(`${resource.id}: execution mode is invalid`);
    }
    const appArch = manifest.releasePlatform.applicationArchitecture;
    if (resource.executionMode === "native" &&
      resource.architecture !== "neutral" && resource.architecture !== appArch) {
      throw new Error(`${resource.id}: native resource architecture does not match the application`);
    }
    if (resource.executionMode === "emulated" &&
      !(manifest.releasePlatform.os === "windows" && appArch === "arm64" &&
        resource.architecture === "x64")) {
      throw new Error(`${resource.id}: unsupported emulation declaration`);
    }
    if (
      typeof resource.path !== "string" || resource.path.includes("..") ||
      !Number.isSafeInteger(resource.size) || resource.size < 0 ||
      !/^[a-f0-9]{64}$/.test(resource.sha256 ?? "") ||
      typeof resource.version !== "string" || resource.version.length < 2 ||
      typeof resource.licenseEvidence !== "string" ||
      !resource.source || typeof resource.source.url !== "string" ||
      resource.source.url.length === 0 ||
      !/^[a-f0-9]{64}$/.test(resource.source.sha256 ?? "")
    ) throw new Error(`${resource.id}: pinned resource metadata is incomplete`);
  }
  if (manifest.releasePlatform.os === "windows") {
    const ids = new Set(manifest.resources.map((resource) => resource.id));
    for (const id of ["ffmpeg", "ffprobe", "python-worker", "inter-regular", "inter-bold"]) {
      if (!ids.has(id)) throw new Error(`${id}: required Windows resource is missing`);
    }
  }
  return manifest as RuntimeManifestV3;
}

async function readRuntimeManifest(
  path: string,
  paths: RuntimePaths
): Promise<RuntimeManifestV3> {
  const input = JSON.parse(await readFile(path, "utf8"));
  return validateRuntimeManifestV3(input, {
    os: paths.targetOs,
    architecture: paths.targetArchitecture
  });
}

async function verifyRuntimeResource(
  path: string,
  resource: RuntimeManifestResource
): Promise<void> {
  const bytes = await readFile(path);
  if (bytes.length !== resource.size) throw new Error("size does not match the runtime manifest");
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== resource.sha256) throw new Error("checksum does not match the runtime manifest");
  if (path.toLowerCase().endsWith(".exe")) {
    const actual = parsePeArchitecture(bytes);
    if (resource.architecture !== actual) {
      throw new Error(`PE architecture is ${actual}, expected ${resource.architecture}`);
    }
  }
}

async function modelCheck(
  modelsDirectory: string,
  manifest: ModelReleaseManifest | null
): Promise<RuntimeCheck> {
  try {
    if (!manifest) throw new Error("manifest unavailable");
    await validateInstalledModel(join(modelsDirectory, manifest.id), manifest);
    return {
      id: "model", label: "English transcription model", state: "ready",
      detail: `${manifest.id} ${manifest.version} is verified locally`, action: "none",
      version: manifest.revision
    };
  } catch {
    return {
      id: "model", label: "English transcription model", state: "needs_attention",
      detail: "Not installed. Download starts only after you review and confirm the disclosure.",
      action: "install_model"
    };
  }
}

async function ollamaCheck(): Promise<RuntimeCheck> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/version", {
      signal: AbortSignal.timeout(1_000)
    });
    if (!response.ok) throw new Error("unavailable");
    const body = await response.json() as { version?: unknown };
    return {
      id: "ollama", label: "Ollama analysis (optional)", state: "ready",
      detail: "Local Ollama service is available", action: "none",
      version: typeof body.version === "string" ? body.version : undefined
    };
  } catch {
    return {
      id: "ollama", label: "Ollama analysis (optional)", state: "optional",
      detail: "Not running. Transcription, editing, and rendering remain available.",
      action: "none"
    };
  }
}

async function storageCheck(dataDirectory: string): Promise<RuntimeCheck> {
  try {
    await mkdir(dataDirectory, { recursive: true });
    await access(dataDirectory, constants.R_OK | constants.W_OK);
    const volume = await statfs(dataDirectory);
    const available = Number(volume.bavail) * Number(volume.bsize);
    return {
      id: "storage", label: "Application storage", state: available >= 5_000_000_000
        ? "ready" : "needs_attention",
      detail: `${formatBytes(available)} available`,
      action: available >= 5_000_000_000 ? "none" : "open_setup"
    };
  } catch {
    return {
      id: "storage", label: "Application storage", state: "needs_attention",
      detail: "Application data directory is not writable", action: "open_setup"
    };
  }
}

export async function buildDiagnosticPreview(input: {
  appVersion: string;
  readiness: RuntimeReadiness;
  jobs: unknown;
  renders?: unknown;
  coreHealth?: unknown;
  platform?: NodeJS.Platform;
  arch?: string;
  includeTranscripts?: boolean;
  includePaths?: boolean;
}): Promise<DiagnosticPreview> {
  const raw = {
    generatedAt: new Date().toISOString(),
    application: { name: "SiftCut", version: input.appVersion },
    platform: { os: input.platform ?? process.platform, arch: input.arch ?? process.arch },
    health: input.readiness,
    core: input.coreHealth ?? { status: "unavailable" },
    migrations: {
      status: input.coreHealth ? "core_started" : "unknown",
      detail: "Database migrations are transactional and complete before core health is reported."
    },
    jobs: input.jobs,
    renders: input.renders ?? { items: [] }
  };
  // Path and transcript consent are deliberately independent. The shared
  // policy's broader opt-in runs only after disallowed fields are removed.
  const consentFiltered = removeUnconsented(raw, {
    paths: input.includePaths === true,
    transcripts: input.includeTranscripts === true
  });
  return {
    policyVersion: "diagnostic-export-v1",
    fileName: `siftcut-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`,
    payload: filterDiagnosticExport(consentFiltered, {
      includeSensitive: input.includePaths === true || input.includeTranscripts === true
    })
  };
}

export async function writeDiagnosticZip(path: string, preview: DiagnosticPreview): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(preview, null, 2));
  const archive = singleFileZip("diagnostics.json", bytes);
  const partial = `${path}.partial`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(partial, archive, { mode: 0o600 });
  await rename(partial, path);
}

function removeUnconsented(
  value: unknown,
  consent: { paths: boolean; transcripts: boolean }
): unknown {
  if (Array.isArray(value)) return value.map((item) => removeUnconsented(item, consent));
  if (typeof value === "string" && !consent.paths) {
    return value.replace(
      /(?:[A-Za-z]:\\[^\s"']+|\/(?:Users|home|private|var|tmp)\/[^\s"']+)/g,
      "[path redacted]"
    );
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (!consent.paths && /(?:path|source)/i.test(key)) return [];
    if (!consent.transcripts && /transcript/i.test(key)) return [];
    return [[key, removeUnconsented(item, consent)]];
  }));
}

function singleFileZip(name: string, content: Buffer): Buffer {
  const nameBytes = Buffer.from(name);
  const crc = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(local.length + nameBytes.length + content.length, 16);
  return Buffer.concat([local, nameBytes, content, central, nameBytes, end]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function formatBytes(value: number): string {
  if (value < 1_000_000_000) return `${Math.floor(value / 1_000_000)} MB`;
  return `${(value / 1_000_000_000).toFixed(1)} GB`;
}

export async function verifyFileChecksum(path: string, expectedSha256: string): Promise<boolean> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex") === expectedSha256.toLowerCase();
}

export async function downloadVerifiedFile(input: {
  url: string;
  destination: string;
  expectedSha256: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
}): Promise<void> {
  const partial = `${input.destination}.partial`;
  await mkdir(dirname(input.destination), { recursive: true });
  if (await verifyFileChecksum(input.destination, input.expectedSha256).catch(() => false)) return;
  if (await verifyFileChecksum(partial, input.expectedSha256).catch(() => false)) {
    await rename(partial, input.destination);
    return;
  }
  const existingBytes = await stat(partial).then((info) => info.size).catch(() => 0);
  const response = await (input.fetcher ?? fetch)(input.url, {
    headers: existingBytes ? { Range: `bytes=${existingBytes}-` } : undefined,
    signal: input.signal
  });
  if (!response.ok || (existingBytes > 0 && response.status !== 200 && response.status !== 206)) {
    throw new Error(`Model transfer failed with HTTP ${response.status}`);
  }
  const resumed = existingBytes > 0 && response.status === 206;
  const handle = await open(partial, resumed ? "a" : "w", 0o600);
  let received = resumed ? existingBytes : 0;
  const contentLength = Number(response.headers.get("content-length"));
  const total = Number.isFinite(contentLength)
    ? received + contentLength
    : null;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Model transfer returned no body");
    for (;;) {
      input.signal?.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      await handle.write(chunk.value);
      received += chunk.value.byteLength;
      input.onProgress?.(received, total);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (!await verifyFileChecksum(partial, input.expectedSha256)) {
    await rm(partial, { force: true });
    throw new Error("Downloaded model failed checksum verification");
  }
  await rename(partial, input.destination);
}

export async function readModelManifest(path: string): Promise<ModelReleaseManifest> {
  const value = JSON.parse(await readFile(path, "utf8")) as Partial<ModelReleaseManifest>;
  if (
    value.schemaVersion !== 1 ||
    value.id !== "small.en" ||
    typeof value.version !== "string" ||
    typeof value.revision !== "string" ||
    value.license !== "MIT" ||
    typeof value.archive?.name !== "string" ||
    typeof value.archive.url !== "string" ||
    !value.archive.url.startsWith("https://github.com/GeorgeQLe/short-editor/releases/download/") ||
    !Number.isSafeInteger(value.archive.size) ||
    !validSha256(value.archive.sha256) ||
    !Array.isArray(value.contents) ||
    value.contents.length === 0 ||
    value.contents.some((member) =>
      typeof member.path !== "string" ||
      !member.path.startsWith("small.en/") ||
      !Number.isSafeInteger(member.size) ||
      member.size < 0 ||
      !validSha256(member.sha256)
    )
  ) throw new Error("Model release manifest is invalid");
  return value as ModelReleaseManifest;
}

export async function validateInstalledModel(
  modelDirectory: string,
  manifest: ModelReleaseManifest
): Promise<void> {
  const expected = manifest.contents.map((member) => ({
    ...member,
    relativePath: member.path.slice(`${manifest.id}/`.length)
  }));
  for (const member of expected) {
    if (!safeRelativePath(member.relativePath)) throw new Error("Unsafe model manifest member");
    const path = join(modelDirectory, member.relativePath);
    const info = await stat(path);
    if (!info.isFile() || info.size !== member.size) {
      throw new Error(`Invalid installed model member: ${member.relativePath}`);
    }
    if (!await verifyFileChecksum(path, member.sha256)) {
      throw new Error(`Installed model checksum mismatch: ${member.relativePath}`);
    }
  }
}

export async function extractVerifiedModelArchive(input: {
  archivePath: string;
  stagingDirectory: string;
  manifest: ModelReleaseManifest;
  signal?: AbortSignal;
}): Promise<void> {
  await rm(input.stagingDirectory, { recursive: true, force: true });
  await mkdir(input.stagingDirectory, { recursive: true });
  const expected = new Map(input.manifest.contents.map((member) => [member.path, member]));
  const seen = new Set<string>();
  const extractor = tar.extract();
  extractor.on("entry", (header, stream, next) => {
    const handle = async () => {
      if (
        header.type !== "file" ||
        !safeRelativePath(header.name) ||
        !expected.has(header.name) ||
        seen.has(header.name)
      ) throw new Error(`Unexpected or unsafe model archive member: ${header.name}`);
      const member = expected.get(header.name)!;
      if (header.size !== member.size) throw new Error(`Model member size mismatch: ${header.name}`);
      const destination = confinedJoin(input.stagingDirectory, header.name);
      await mkdir(dirname(destination), { recursive: true });
      const hash = createHash("sha256");
      stream.on("data", (chunk: Buffer) => hash.update(chunk));
      await pipeline(
        stream,
        createWriteStream(destination, { mode: 0o600, flags: "wx" }),
        { signal: input.signal }
      );
      if (hash.digest("hex") !== member.sha256) {
        throw new Error(`Model member checksum mismatch: ${header.name}`);
      }
      seen.add(header.name);
    };
    void handle().then(() => next(), (error) => extractor.destroy(error as Error));
  });
  try {
    await pipeline(
      createReadStream(input.archivePath),
      createGunzip(),
      extractor,
      { signal: input.signal }
    );
    const missing = [...expected.keys()].filter((path) => !seen.has(path));
    if (missing.length) throw new Error(`Model archive is incomplete: ${missing.join(", ")}`);
    await validateInstalledModel(join(input.stagingDirectory, input.manifest.id), input.manifest);
  } catch (error) {
    await rm(input.stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function atomicInstallModel(input: {
  extractedModelDirectory: string;
  targetModelDirectory: string;
}): Promise<void> {
  const backup = `${input.targetModelDirectory}.previous`;
  await rm(backup, { recursive: true, force: true });
  const hadPrevious = await stat(input.targetModelDirectory).then(() => true).catch(() => false);
  if (hadPrevious) await rename(input.targetModelDirectory, backup);
  try {
    await rename(input.extractedModelDirectory, input.targetModelDirectory);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (hadPrevious) {
      await rm(input.targetModelDirectory, { recursive: true, force: true });
      await rename(backup, input.targetModelDirectory);
    }
    throw error;
  }
}

export class ModelInstallManager {
  private state: ModelInstallState = {
    phase: "not_installed",
    receivedBytes: 0,
    totalBytes: 0,
    message: "The model is not installed.",
    canResume: false,
    canCancel: false
  };
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly paths: Pick<RuntimePaths, "models" | "modelManifest">
  ) {}

  async initialize(): Promise<ModelInstallState> {
    const manifest = await readModelManifest(this.paths.modelManifest);
    const target = join(this.paths.models, manifest.id);
    if (await validateInstalledModel(target, manifest).then(() => true).catch(() => false)) {
      return this.update({
        phase: "ready", receivedBytes: manifest.archive.size, totalBytes: manifest.archive.size,
        message: `${manifest.id} is installed and verified.`, canResume: false, canCancel: false
      });
    }
    const partial = join(this.paths.models, "downloads", `${manifest.archive.name}.partial`);
    const receivedBytes = await stat(partial).then((info) => info.size).catch(() => 0);
    return this.update({
      phase: receivedBytes ? "paused" : "not_installed",
      receivedBytes,
      totalBytes: manifest.archive.size,
      message: receivedBytes ? "A partial transfer can be resumed." : "The model is not installed.",
      canResume: true,
      canCancel: false
    });
  }

  snapshot(): ModelInstallState {
    return { ...this.state };
  }

  async start(): Promise<ModelInstallState> {
    if (this.running) return this.snapshot();
    const manifest = await readModelManifest(this.paths.modelManifest);
    this.controller = new AbortController();
    this.running = this.install(manifest, this.controller.signal)
      .catch(async (error: unknown) => {
        const cancelled = error instanceof Error && error.name === "AbortError";
        const partial = join(this.paths.models, "downloads", `${manifest.archive.name}.partial`);
        const receivedBytes = await stat(partial).then((info) => info.size).catch(() => 0);
        await this.update({
          phase: cancelled ? "paused" : "failed",
          receivedBytes,
          totalBytes: manifest.archive.size,
          message: cancelled
            ? "Download paused. Resume keeps the verified partial bytes."
            : error instanceof Error ? error.message : "Model installation failed.",
          canResume: true,
          canCancel: false
        });
      })
      .finally(() => {
        this.running = null;
        this.controller = null;
      });
    return this.snapshot();
  }

  async cancel(): Promise<ModelInstallState> {
    this.controller?.abort();
    await this.running;
    return this.snapshot();
  }

  private async install(manifest: ModelReleaseManifest, signal: AbortSignal): Promise<void> {
    await mkdir(this.paths.models, { recursive: true });
    const volume = await statfs(this.paths.models);
    const available = Number(volume.bavail) * Number(volume.bsize);
    const extractedSize = manifest.contents.reduce((sum, member) => sum + member.size, 0);
    const required = manifest.archive.size + extractedSize + 512_000_000;
    if (available < required) {
      throw new Error(`Insufficient disk space: ${formatBytes(required)} is required.`);
    }
    const archive = join(this.paths.models, "downloads", manifest.archive.name);
    let lastPersisted = 0;
    await this.update({
      phase: "downloading", receivedBytes: this.state.receivedBytes,
      totalBytes: manifest.archive.size, message: "Downloading the immutable model archive…",
      canResume: false, canCancel: true
    });
    await downloadVerifiedFile({
      url: manifest.archive.url,
      destination: archive,
      expectedSha256: manifest.archive.sha256,
      signal,
      onProgress: (receivedBytes) => {
        this.state = { ...this.state, receivedBytes };
        const now = Date.now();
        if (now - lastPersisted > 500) {
          lastPersisted = now;
          void this.persist();
        }
      }
    });
    signal.throwIfAborted();
    await this.update({
      ...this.state, phase: "verifying", receivedBytes: manifest.archive.size,
      message: "Archive verified. Validating every model member…", canCancel: true
    });
    const staging = join(this.paths.models, `.${manifest.id}.staging`);
    await extractVerifiedModelArchive({
      archivePath: archive,
      stagingDirectory: staging,
      manifest,
      signal
    });
    signal.throwIfAborted();
    await this.update({
      ...this.state, phase: "installing",
      message: "Activating the verified model…", canCancel: false
    });
    await atomicInstallModel({
      extractedModelDirectory: join(staging, manifest.id),
      targetModelDirectory: join(this.paths.models, manifest.id)
    });
    await rm(staging, { recursive: true, force: true });
    await rm(archive, { force: true });
    await this.update({
      phase: "ready", receivedBytes: manifest.archive.size, totalBytes: manifest.archive.size,
      message: `${manifest.id} is installed and verified.`, canResume: false, canCancel: false
    });
  }

  private async update(state: ModelInstallState): Promise<ModelInstallState> {
    this.state = state;
    await this.persist();
    return this.snapshot();
  }

  private async persist(): Promise<void> {
    await mkdir(this.paths.models, { recursive: true });
    const statePath = join(this.paths.models, ".small.en.install-state.json");
    const partial = `${statePath}.partial`;
    await writeFile(partial, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    await rename(partial, statePath);
  }
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function safeRelativePath(path: string): boolean {
  return path.length > 0 &&
    !path.includes("\0") &&
    !path.includes("\\") &&
    !posix.isAbsolute(path) &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..");
}

function confinedJoin(root: string, path: string): string {
  const destination = resolve(root, ...path.split("/"));
  const fromRoot = relative(resolve(root), destination);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || resolve(fromRoot) === fromRoot) {
    throw new Error(`Archive member escapes staging: ${path}`);
  }
  return destination;
}
