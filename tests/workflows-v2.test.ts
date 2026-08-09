import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  MCP_TOOL_NAMES,
  MCP_V2_TOOL_INVENTORY,
  MCP_V2_TOOL_NAMES,
  serializeMcpV2ToolInventory
} from "../src/mcp/registry";
import { createShortWorkflowInputSchema } from "../src/shared/domain";
import { motionGraphicLayerSchema } from "../src/shared/workflow-contracts";
import { openDatabase } from "../src/core/database";
import { Repository } from "../src/core/repository";
import { JobQueue } from "../src/core/jobs";
import { CoreService } from "../src/core/service";
import { episode, segments } from "./factories";

describe("MCP v2 workflow contract", () => {
  it("keeps v1 frozen and publishes five strict additive tools", () => {
    expect(MCP_TOOL_NAMES).toHaveLength(45);
    expect(MCP_V2_TOOL_NAMES).toEqual([
      "workflows.create_short_from_mp4", "workflows.get", "workflows.resume",
      "workflows.cancel", "renders.export"
    ]);
    for (const tool of MCP_V2_TOOL_INVENTORY) {
      const input = z.toJSONSchema(tool.inputSchema, { io: "input", unrepresentable: "any" }) as {
        additionalProperties?: boolean;
      };
      expect(input.additionalProperties, tool.name).toBe(false);
    }
  });

  it("keeps the generated v2 artifact drift-free", async () => {
    expect(await readFile("docs/mcp-v2-tools.json", "utf8")).toBe(serializeMcpV2ToolInventory());
  });

  it("defaults to review, local-friendly captions, bounded duration, and fixed graphics", () => {
    const input = createShortWorkflowInputSchema.parse({ sourcePath: "/media/source.mp4" });
    expect(input).toMatchObject({
      targetDurationMs: 45_000,
      reviewMode: "review_required",
      captionsEnabled: true,
      graphics: { enabled: true, presets: ["hook", "lower_third", "end_card"] }
    });
    expect(createShortWorkflowInputSchema.safeParse({
      sourcePath: "/media/source.mp4", targetDurationMs: 180_001
    }).success).toBe(false);
  });

  it("accepts bounded typed presets and rejects caller-authored filter fields", () => {
    const layer = {
      id: "hook", visible: true, type: "motion_graphic", source: "none", assetId: null,
      region: { x: .05, y: .1, width: .9, height: .2 }, fit: "fit",
      preset: "hook", startMs: 0, endMs: 2_000, primaryText: "A deterministic hook",
      secondaryText: "", theme: "accent"
    };
    expect(motionGraphicLayerSchema.safeParse(layer).success).toBe(true);
    expect(motionGraphicLayerSchema.safeParse({ ...layer, ffmpegExpression: "evil()" }).success)
      .toBe(false);
    expect(motionGraphicLayerSchema.safeParse({ ...layer, endMs: 0 }).success).toBe(false);
  });

  it("persists a review-required proposal without modifying the source entity", async () => {
    const directory = mkdtempSync(join(tmpdir(), "short-workflow-v2-"));
    const databasePath = join(directory, "workflow.db");
    const repository = new Repository(openDatabase(databasePath));
    const source = episode({
      id: randomUUID(), sourcePath: "/fixtures/original.mp4",
      canonicalPath: "/fixtures/original.mp4", durationMs: 300_000,
      contentHash: "a".repeat(64)
    });
    const { candidateCount: _c, renderedShortCount: _r, scheduledCount: _s, ...storedSource } = source;
    repository.insertEpisode(storedSource);
    repository.replaceTranscript(source.id, segments(60));
    const media = {
      importPaths: async () => ({ imported: [], duplicates: [source], relinked: [], rejected: [] })
    };
    const service = new CoreService(repository, media as never, new JobQueue(repository));
    try {
      const workflow = await service.createShortFromMp4({ sourcePath: source.sourcePath });
      expect(workflow.state).toBe("awaiting_review");
      expect(workflow.candidate).not.toBeNull();
      expect(workflow.short).toMatchObject({ approved: false });
      expect(workflow.graphicsProposal.map(({ preset }) => preset)).toEqual([
        "hook", "lower_third", "end_card"
      ]);
      expect(repository.getEpisode(source.id).sourcePath).toBe("/fixtures/original.mp4");
      await service.stop();

      const reopened = new Repository(openDatabase(databasePath));
      const recovered = new CoreService(reopened, media as never, new JobQueue(reopened));
      try {
        await expect(recovered.getShortWorkflow(workflow.id)).resolves.toMatchObject({
          id: workflow.id, state: "awaiting_review", shortId: workflow.shortId
        });
      } finally { await recovered.stop(); }
    } finally {
      if (repository.db.open) await service.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
