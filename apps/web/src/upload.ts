import type { UploadSession } from "@siftcut/saas-contracts";
import type { CloudApi } from "./api.js";

const MAX_PARALLEL_PARTS = 4;

export interface UploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  state: "uploading" | "paused" | "completing" | "complete";
}

export class ResumableUpload {
  private paused = false;
  private readonly completed = new Map<
    number,
    { partNumber: number; etag: string; checksumSha256: string }
  >();
  constructor(
    private readonly api: CloudApi,
    readonly session: UploadSession,
    private readonly file: File,
    private readonly onProgress: (progress: UploadProgress) => void
  ) {}

  pause(): void { this.paused = true; }
  resume(): Promise<void> { this.paused = false; return this.run(); }

  async run(): Promise<void> {
    const partCount = Math.ceil(this.file.size / this.session.partSizeBytes);
    const pending = Array.from({ length: partCount }, (_, index) => index + 1)
      .filter((partNumber) => !this.completed.has(partNumber));
    while (pending.length > 0 && !this.paused) {
      const batch = pending.splice(0, MAX_PARALLEL_PARTS);
      const signed = await this.api.request<Array<{
        partNumber: number; url: string; expiresAt: string;
      }>>(`/uploads/${this.session.id}/parts`, {
        method: "POST",
        body: JSON.stringify({ partNumbers: batch })
      });
      await Promise.all(signed.map(async ({ partNumber, url }) => {
        const start = (partNumber - 1) * this.session.partSizeBytes;
        const blob = this.file.slice(start, Math.min(start + this.session.partSizeBytes, this.file.size));
        const checksum = await sha256Base64(blob);
        const response = await fetch(url, {
          method: "PUT",
          body: blob,
          headers: { "x-amz-checksum-sha256": checksum }
        });
        if (!response.ok) throw new Error(`Upload part ${partNumber} failed`);
        this.completed.set(partNumber, {
          partNumber,
          etag: response.headers.get("etag") ?? "",
          checksumSha256: checksum
        });
        this.onProgress({
          uploadedBytes: [...this.completed.keys()].reduce((total, number) => {
            const offset = (number - 1) * this.session.partSizeBytes;
            return total + Math.min(this.session.partSizeBytes, this.file.size - offset);
          }, 0),
          totalBytes: this.file.size,
          state: "uploading"
        });
      }));
    }
    if (this.paused) {
      const uploadedBytes = [...this.completed.keys()].reduce((total, number) => {
        const offset = (number - 1) * this.session.partSizeBytes;
        return total + Math.min(this.session.partSizeBytes, this.file.size - offset);
      }, 0);
      this.onProgress({ uploadedBytes, totalBytes: this.file.size, state: "paused" });
      return;
    }
    this.onProgress({ uploadedBytes: this.file.size, totalBytes: this.file.size, state: "completing" });
    await this.api.request(`/uploads/${this.session.id}/complete`, {
      method: "POST",
      body: JSON.stringify({
        parts: [...this.completed.values()].sort((a, b) => a.partNumber - b.partNumber)
      })
    });
    this.onProgress({ uploadedBytes: this.file.size, totalBytes: this.file.size, state: "complete" });
  }
}

async function sha256Base64(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const bytes = new Uint8Array(digest);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}
