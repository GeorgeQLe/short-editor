#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parsePeArchitecture } from "./runtime-manifest-lib.mjs";

const execute = promisify(execFile);
const root = resolve(process.argv[2] ?? "");
if (!root) throw new Error("Usage: inspect-windows-dependencies.mjs <worker-directory>");
const files = await walk(root);
const binaries = files.filter((path) => /\.(?:exe|dll|pyd)$/i.test(path));
const localNames = new Set(binaries.map((path) => basename(path).toLowerCase()));
const failures = [];
for (const path of binaries) {
  try {
    if (parsePeArchitecture(await readFile(path)) !== "x64") {
      failures.push(`${path}: worker bundle binary is not x64`);
    }
  } catch (error) {
    failures.push(`${path}: ${error.message}`);
  }
}

if (process.platform === "win32") {
  const dumpbin = await findDumpbin();
  if (!dumpbin) failures.push("dumpbin.exe is required to audit worker DLL dependencies");
  else for (const path of binaries) {
    const result = await execute(dumpbin, ["/DEPENDENTS", path], { maxBuffer: 4 * 1024 * 1024 });
    for (const dependency of parseDependencies(result.stdout)) {
      if (!localNames.has(dependency.toLowerCase()) && !systemDll(dependency)) {
        failures.push(`${basename(path)}: undeclared non-system dependency ${dependency}`);
      }
    }
  }
}

if (failures.length) {
  process.stderr.write(`${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Verified ${binaries.length} x64 PE files and their declared DLL imports.\n`);

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

async function findDumpbin() {
  try {
    const where = await execute("where.exe", ["dumpbin.exe"]);
    return where.stdout.split(/\r?\n/).find(Boolean);
  } catch {
    const programFiles = process.env["ProgramFiles(x86)"];
    if (!programFiles) return null;
    const vswhere = join(programFiles, "Microsoft Visual Studio", "Installer", "vswhere.exe");
    try {
      const result = await execute(vswhere, [
        "-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-find", "VC\\Tools\\MSVC\\*\\bin\\Hostx64\\x64\\dumpbin.exe"
      ]);
      return result.stdout.split(/\r?\n/).find(Boolean);
    } catch {
      return null;
    }
  }
}

function parseDependencies(output) {
  return [...output.matchAll(/^\s+([A-Za-z0-9_.-]+\.dll)\s*$/gmi)].map((match) => match[1]);
}

function systemDll(name) {
  const lower = name.toLowerCase();
  return /^(?:api-ms-win-|ext-ms-win-)/.test(lower) || new Set([
    "advapi32.dll", "bcrypt.dll", "cfgmgr32.dll", "combase.dll", "crypt32.dll",
    "cryptbase.dll", "dbghelp.dll", "dnsapi.dll", "dwmapi.dll", "gdi32.dll",
    "imm32.dll", "iphlpapi.dll", "kernel32.dll", "mpr.dll", "ncrypt.dll",
    "netapi32.dll", "normaliz.dll", "ntdll.dll", "ole32.dll", "oleacc.dll",
    "oleaut32.dll", "powrprof.dll", "psapi.dll", "rpcrt4.dll", "secur32.dll",
    "setupapi.dll", "shcore.dll", "shell32.dll", "shlwapi.dll", "ucrtbase.dll",
    "user32.dll", "userenv.dll", "uxtheme.dll", "version.dll", "winhttp.dll",
    "winmm.dll", "winspool.drv", "wintrust.dll", "ws2_32.dll", "wtsapi32.dll"
  ]).has(lower);
}
