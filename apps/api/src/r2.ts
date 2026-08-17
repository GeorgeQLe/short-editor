import type { ArtifactStorage } from "@siftcut/infrastructure";

const encoder = new TextEncoder();

export class R2ArtifactStorage implements ArtifactStorage {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly db: D1Database,
    private readonly baseUrl: string,
    private readonly signingSecret: string,
    private readonly now = () => Date.now()
  ) {}

  async createMultipartUpload(objectKey: string): Promise<string> {
    return (await this.bucket.createMultipartUpload(objectKey)).uploadId;
  }

  signUploadPart(objectKey: string, uploadId: string, partNumber: number,
    expiresInSeconds: number): Promise<string> {
    return this.sign("upload", { objectKey, uploadId, partNumber }, expiresInSeconds);
  }

  async completeMultipartUpload(objectKey: string, uploadId: string,
    parts: ReadonlyArray<{ partNumber: number; etag: string }>): Promise<{
      byteLength: number; checksumSha256: string;
    }> {
    const upload = this.bucket.resumeMultipartUpload(objectKey, uploadId);
    await upload.complete(parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
    // R2 completion proves that the declared parts exist. The ingest worker is
    // responsible for the authoritative one-pass byte count and full SHA-256.
    const evidence = await this.db.prepare(`SELECT expected_bytes,checksum_sha256 FROM upload_sessions
      WHERE object_key=? AND multipart_upload_id=?`).bind(objectKey, uploadId)
      .first<{ expected_bytes: number; checksum_sha256: string }>();
    if (!evidence) throw new Error("Upload evidence is unavailable");
    return { byteLength: Number(evidence.expected_bytes), checksumSha256: evidence.checksum_sha256 };
  }

  abortMultipartUpload(objectKey: string, uploadId: string): Promise<void> {
    return this.bucket.resumeMultipartUpload(objectKey, uploadId).abort();
  }
  signRead(objectKey: string, expiresInSeconds: number): Promise<string> {
    return this.sign("read", { objectKey }, expiresInSeconds);
  }
  async promote(temporaryKey: string, finalKey: string): Promise<void> {
    const source = await this.bucket.get(temporaryKey);
    if (!source) throw new Error("Temporary object is unavailable");
    await this.bucket.put(finalKey, source.body, { httpMetadata: source.httpMetadata,
      customMetadata: source.customMetadata });
    await this.bucket.delete(temporaryKey);
  }
  async deletePrefix(prefix: string): Promise<void> {
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, cursor, limit: 1000 });
      if (page.objects.length) await this.bucket.delete(page.objects.map(({ key }) => key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }

  async verify(token: string, operation: "upload" | "read"): Promise<MediaToken | null> {
    const [body, signature] = token.split(".");
    if (!body || !signature) return null;
    const expected = await hmac(this.signingSecret, body);
    if (!constantTimeEqual(signature, expected)) return null;
    try {
      const parsed = JSON.parse(decodeBase64Url(body)) as MediaToken;
      if (parsed.operation !== operation || !parsed.objectKey || parsed.expiresAt < this.now()) return null;
      return parsed;
    } catch { return null; }
  }

  private async sign(operation: "upload" | "read", value: Omit<MediaToken, "operation" | "expiresAt">,
    seconds: number): Promise<string> {
    const body = encodeBase64Url(JSON.stringify({ ...value, operation,
      expiresAt: this.now() + seconds * 1000 }));
    return `${this.baseUrl}/media/${operation}/${body}.${await hmac(this.signingSecret, body)}`;
  }
}

export interface MediaToken {
  operation: "upload" | "read";
  objectKey: string;
  uploadId?: string;
  partNumber?: number;
  expiresAt: number;
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function encodeBase64Url(value: string): string {
  return bytesToBase64Url(encoder.encode(value));
}
function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
