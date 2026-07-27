import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProtectedCredentialVault,
  type ProtectedStorage
} from "../src/security/credential-vault";

const temporaryDirectories: string[] = [];
const storage = (available = true): ProtectedStorage => ({
  isAvailable: () => available,
  protect: (value) => Buffer.from([...value].reverse().join(""), "utf8"),
  unprotect: (value) => [...value.toString("utf8")].reverse().join("")
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("protected credential vault", () => {
  it("persists protected bytes and returns only opaque metadata", () => {
    const directory = mkdtempSync(join(tmpdir(), "short-editor-vault-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "credentials.json");
    const vault = new ProtectedCredentialVault(path, storage());
    const secret = "sk-plaintext-must-not-persist";

    const saved = vault.save({ provider: "openai", label: "Production", secret });

    expect(saved.handle).toMatch(/^credential:/);
    expect(saved).not.toHaveProperty("protectedValue");
    expect(vault.list()).toEqual([saved]);
    expect(vault.resolve(saved.handle)).toBe(secret);
    expect(readFileSync(path, "utf8")).not.toContain(secret);
  });

  it("fails closed while OS protection is unavailable", () => {
    const directory = mkdtempSync(join(tmpdir(), "short-editor-vault-"));
    temporaryDirectories.push(directory);
    const vault = new ProtectedCredentialVault(join(directory, "credentials.json"), storage(false));

    expect(() => vault.save({
      provider: "openai",
      label: "Locked",
      secret: "never-written"
    })).toThrow(expect.objectContaining({ code: "DEPENDENCY_UNAVAILABLE" }));
  });

  it("updates in place and removes the protected record", () => {
    const directory = mkdtempSync(join(tmpdir(), "short-editor-vault-"));
    temporaryDirectories.push(directory);
    const vault = new ProtectedCredentialVault(join(directory, "credentials.json"), storage());
    const first = vault.save({ provider: "openai", label: "First", secret: "one" });
    const updated = vault.save({
      handle: first.handle,
      provider: "openai",
      label: "Updated",
      secret: "two"
    });

    expect(updated.handle).toBe(first.handle);
    expect(vault.resolve(first.handle)).toBe("two");
    vault.remove(first.handle);
    expect(vault.list()).toEqual([]);
  });
});
