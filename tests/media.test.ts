import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/core/database";
import { MediaService } from "../src/core/media";
import { Repository } from "../src/core/repository";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

describe("media inventory", () => {
  it("deduplicates canonical paths and rejects unsupported files without mutating sources", () => {
    const directory = mkdtempSync(join(tmpdir(), "short-editor-test-"));
    const mp4 = join(directory, "episode.mp4");
    const text = join(directory, "notes.txt");
    writeFileSync(mp4, "fixture bytes");
    writeFileSync(text, "notes");
    const before = statSnapshot(mp4);
    const repository = new Repository(openDatabase(":memory:"));
    databases.push(repository.db);
    const service = new MediaService(repository, "missing-ffprobe");

    const first = service.importPaths([mp4, text]);
    const second = service.importPaths([mp4]);

    expect(first.imported).toHaveLength(1);
    expect(first.rejected).toEqual([{ path: text, reason: "Only MP4 is guaranteed in v1" }]);
    expect(second.duplicates).toHaveLength(1);
    expect(statSnapshot(mp4)).toEqual(before);
  });
});

function statSnapshot(path: string) {
  const stats = statSync(path);
  return { bytes: readFileSync(path).toString("hex"), size: stats.size, mtimeMs: stats.mtimeMs };
}
