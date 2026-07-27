import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";
import { AppError } from "../shared/errors.js";

export interface ProtectedStorage {
  isAvailable(): boolean;
  protect(value: string): Buffer;
  unprotect(value: Buffer): string;
}

export interface CredentialSummary {
  handle: string;
  provider: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredCredential extends CredentialSummary {
  protectedValue: string;
}

interface VaultDocument {
  version: 1;
  credentials: StoredCredential[];
}

/**
 * Persists only opaque handles, metadata, and OS-protected ciphertext. The
 * plaintext value exists only for the duration of a desktop-main-process call.
 */
export class ProtectedCredentialVault {
  constructor(
    private readonly path: string,
    private readonly storage: ProtectedStorage
  ) {}

  list(): CredentialSummary[] {
    return this.read().credentials.map(withoutProtectedValue);
  }

  has(handle: string): boolean {
    return this.read().credentials.some((credential) => credential.handle === handle);
  }

  save(input: {
    handle?: string;
    provider: string;
    label: string;
    secret: string;
  }): CredentialSummary {
    this.assertAvailable();
    const provider = requiredText(input.provider, "Provider");
    const label = requiredText(input.label, "Credential label");
    if (!input.secret) {
      throw new AppError("VALIDATION_ERROR", "Credential value is required", 422);
    }
    const document = this.read();
    const now = new Date().toISOString();
    const existing = input.handle
      ? document.credentials.find((credential) => credential.handle === input.handle)
      : undefined;
    if (input.handle && !existing) {
      throw new AppError("NOT_FOUND", "Credential handle not found", 404);
    }
    const credential: StoredCredential = {
      handle: existing?.handle ?? `credential:${randomUUID()}`,
      provider,
      label,
      protectedValue: this.storage.protect(input.secret).toString("base64"),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    document.credentials = existing
      ? document.credentials.map((item) => item.handle === existing.handle ? credential : item)
      : [...document.credentials, credential];
    this.write(document);
    return withoutProtectedValue(credential);
  }

  resolve(handle: string): string {
    this.assertAvailable();
    const credential = this.read().credentials.find((item) => item.handle === handle);
    if (!credential) throw new AppError("NOT_FOUND", "Credential handle not found", 404);
    try {
      return this.storage.unprotect(Buffer.from(credential.protectedValue, "base64"));
    } catch {
      throw new AppError(
        "DEPENDENCY_UNAVAILABLE",
        "Protected credential storage is locked or unavailable",
        503
      );
    }
  }

  remove(handle: string): void {
    const document = this.read();
    const next = document.credentials.filter((credential) => credential.handle !== handle);
    if (next.length === document.credentials.length) {
      throw new AppError("NOT_FOUND", "Credential handle not found", 404);
    }
    document.credentials = next;
    this.write(document);
  }

  private assertAvailable(): void {
    if (!this.storage.isAvailable()) {
      throw new AppError(
        "DEPENDENCY_UNAVAILABLE",
        "Windows-protected credential storage is locked or unavailable",
        503
      );
    }
  }

  private read(): VaultDocument {
    if (!existsSync(this.path)) return { version: 1, credentials: [] };
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as Partial<VaultDocument>;
      if (value.version !== 1 || !Array.isArray(value.credentials)) throw new Error();
      return { version: 1, credentials: value.credentials as StoredCredential[] };
    } catch {
      throw new AppError("INVALID_STATE", "Protected credential store is unreadable", 409);
    }
  }

  private write(document: VaultDocument): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(document), { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, this.path);
    try { chmodSync(this.path, 0o600); } catch {
      // Windows ACLs and DPAPI protect the value; POSIX mode is defense in depth.
    }
  }
}

function withoutProtectedValue(credential: StoredCredential): CredentialSummary {
  const { protectedValue: _protectedValue, ...summary } = credential;
  return summary;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new AppError("VALIDATION_ERROR", `${field} is required`, 422);
  return normalized;
}
