import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createMcpServer,
  executeMcpHttpTool,
  MCP_TOOL_INVENTORY,
  MCP_TOOL_NAMES
} from "../src/mcp/registry.js";
import { episode } from "./factories.js";

const expectedNames = [
  "library.list_episodes", "library.get_episode", "library.import_paths",
  "analysis.start", "jobs.list", "jobs.cancel", "candidates.list",
  "candidates.generate", "candidates.review", "shorts.create", "shorts.get",
  "shorts.update_composition", "shorts.update_copy", "renders.start",
  "renders.validate", "renders.list", "schedule.get", "schedule.draft",
  "schedule.move", "schedule.mark_published", "templates.list", "assets.list",
  "assets.import", "library.list_watched_folders",
  "library.configure_watched_folder", "library.relink_source",
  "analysis.get_transcript", "analysis.update_transcript",
  "providers.list_capabilities", "providers.get_status",
  "shorts.update_timeline", "shorts.reanalyze_crops", "shorts.add_manual_crop",
  "shorts.move_manual_crop", "shorts.remove_manual_crop",
  "shorts.update_captions", "shorts.update_audio", "shorts.approve",
  "schedule.get_rules", "schedule.update_rules", "templates.clone",
  "templates.update", "renders.preflight", "renders.retry"
].sort();

describe("authoritative MCP registry", () => {
  it("freezes exactly the 44 SPEC tools with concrete strict schemas and safe annotations", () => {
    expect([...MCP_TOOL_NAMES].sort()).toEqual(expectedNames);
    expect(new Set(MCP_TOOL_NAMES).size).toBe(44);
    for (const tool of MCP_TOOL_INVENTORY) {
      const input = z.toJSONSchema(tool.inputSchema, {
        io: "input",
        unrepresentable: "any"
      }) as { type?: string; additionalProperties?: boolean };
      const output = z.toJSONSchema(tool.outputSchema, {
        io: "output",
        unrepresentable: "any"
      }) as {
        type?: string;
        additionalProperties?: boolean;
        properties?: Record<string, unknown>;
      };
      expect(input.type, tool.name).toBe("object");
      expect(input.additionalProperties, tool.name).toBe(false);
      expect(output.type, tool.name).toBe("object");
      expect(output.additionalProperties, tool.name).toBe(false);
      expect(output.properties, tool.name).toHaveProperty("apiVersion");
      expect(output.properties, tool.name).toHaveProperty("data");
      expect(tool.annotations.destructiveHint, tool.name).toBe(false);
      expect(tool.http.path, tool.name).toMatch(/^\/v1\//);
    }
  });

  it("discovers the same registry with annotations and output schemas", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    const client = new Client({ name: "mcp-contract-test", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const discovery = await client.listTools();
      expect(discovery.tools.map((tool) => tool.name).sort()).toEqual(expectedNames);
      expect(discovery.tools.every((tool) =>
        tool.outputSchema !== undefined
        && tool.inputSchema.additionalProperties === false
        && tool.annotations?.destructiveHint === false
      )).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("keeps the checked-in generated discovery artifact stable and sorted", async () => {
    const artifact = JSON.parse(await readFile("docs/mcp-v1-tools.json", "utf8")) as
      Array<{ name: string }>;
    expect(artifact).toHaveLength(44);
    expect(artifact.map(({ name }) => name)).toEqual(expectedNames);
  });
});

describe("MCP HTTP envelope translation", () => {
  const getEpisode = MCP_TOOL_INVENTORY.find((tool) =>
    tool.name === "library.get_episode")!;
  const id = "00000000-0000-4000-8000-000000000001";

  it("returns the validated HTTP success envelope unchanged", async () => {
    const envelope = { apiVersion: "v1" as const, data: episode({ id }) };
    const fetchMock: typeof fetch = async (url, init) => {
      expect(String(url)).toBe(`http://core.test/v1/library/episodes/${id}`);
      expect(init?.method).toBe("GET");
      return new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };
    const result = await executeMcpHttpTool(
      getEpisode,
      { episodeId: id },
      { coreUrl: "http://core.test/v1", fetch: fetchMock }
    );
    expect(result).toEqual({ ok: true, envelope });
  });

  it("preserves complete registered errors and redacts malformed or unreachable cores", async () => {
    const error = {
      apiVersion: "v1" as const,
      error: {
        code: "REVISION_CONFLICT" as const,
        message: "Stale revision",
        details: { expectedRevision: 1, actualRevision: 2 },
        retryable: false
      }
    };
    const registered = await executeMcpHttpTool(getEpisode, { episodeId: id }, {
      fetch: async () => new Response(JSON.stringify(error), { status: 409 })
    });
    expect(registered).toEqual({ ok: false, envelope: error });

    const malformed = await executeMcpHttpTool(getEpisode, { episodeId: id }, {
      fetch: async () => new Response("private response body", { status: 500 })
    });
    expect(JSON.stringify(malformed)).not.toContain("private response body");
    expect(malformed).toMatchObject({
      ok: false,
      envelope: { error: { code: "INTERNAL_ERROR", retryable: false } }
    });

    const unavailable = await executeMcpHttpTool(getEpisode, { episodeId: id }, {
      fetch: async () => { throw new Error("/private/token"); }
    });
    expect(JSON.stringify(unavailable)).not.toContain("/private/token");
    expect(unavailable).toMatchObject({
      ok: false,
      envelope: { error: { code: "DEPENDENCY_UNAVAILABLE", retryable: true } }
    });
  });

  it("passes one opaque cursor page and every list filter through without traversal", async () => {
    const listNames = [
      "library.list_episodes", "library.list_watched_folders", "jobs.list",
      "candidates.list", "renders.list", "schedule.get", "templates.list", "assets.list"
    ];
    for (const name of listNames) {
      const tool = MCP_TOOL_INVENTORY.find((candidate) => candidate.name === name)!;
      const input: Record<string, unknown> = { limit: 7, cursor: "opaque+/=" };
      if (name === "library.list_episodes") input.search = "one & two";
      if (name === "candidates.list") input.episodeId = id;
      if (name === "renders.list") input.shortId = id;
      const request = tool.request(input);
      expect(request.method, name).toBe("GET");
      expect(request.path, name).toContain("limit=7");
      expect(request.path, name).toContain("cursor=opaque%2B%2F%3D");
      if (input.search) expect(request.path, name).toContain("search=one+%26+two");
      if (input.episodeId) expect(request.path, name).toContain(`episodeId=${id}`);
      if (input.shortId) expect(request.path, name).toContain(`shortId=${id}`);
    }
  });

  it("rejects forged authorization fields, unknown fields, and loose compositions", () => {
    const analysis = MCP_TOOL_INVENTORY.find((tool) => tool.name === "analysis.start")!;
    expect(analysis.inputSchema.safeParse({ episodeId: id, authorization: true }).success)
      .toBe(false);
    const composition = MCP_TOOL_INVENTORY.find((tool) =>
      tool.name === "shorts.update_composition")!;
    expect(composition.inputSchema.safeParse({
      shortId: id,
      expectedRevision: 1,
      composition: { arbitrary: true }
    }).success).toBe(false);
  });
});
