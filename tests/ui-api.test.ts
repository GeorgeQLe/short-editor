import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, api } from "../src/ui/api";

const ok = (data: unknown) => new Response(JSON.stringify({ apiVersion: "v1", data }), {
  status: 200,
  headers: { "Content-Type": "application/json" }
});

afterEach(() => vi.unstubAllGlobals());

describe("UI v1 API client", () => {
  it("traverses all inventory and watched-folder pages", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ items: [{ id: "episode-1" }], nextCursor: "next episode" }))
      .mockResolvedValueOnce(ok({ items: [{ id: "episode-2" }], nextCursor: null }))
      .mockResolvedValueOnce(ok({ items: [{ id: "folder-1" }], nextCursor: "next folder" }))
      .mockResolvedValueOnce(ok({ items: [{ id: "folder-2" }], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.episodes("search term")).resolves.toEqual([
      { id: "episode-1" }, { id: "episode-2" }
    ]);
    await expect(api.watchedFolders()).resolves.toEqual([
      { id: "folder-1" }, { id: "folder-2" }
    ]);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("cursor=next%20episode");
    expect(fetchMock.mock.calls[3]?.[0]).toContain("cursor=next%20folder");
  });

  it("preserves structured API failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      apiVersion: "v1",
      error: {
        code: "SOURCE_IDENTITY_MISMATCH",
        message: "Identity did not match",
        details: { fields: ["contentHash"] },
        retryable: false
      }
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    const error = await api.relinkSource("episode-id", "/candidate.mp4").catch((value) => value);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "SOURCE_IDENTITY_MISMATCH",
      message: "Identity did not match",
      details: { fields: ["contentHash"] },
      retryable: false,
      status: 409
    });
  });

  it("sends exact provider operation bodies without forged authorization", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(ok({ id: "job" })));
    vi.stubGlobal("fetch", fetchMock);

    await api.startTranscription({
      episodeId: "episode",
      provider: "local",
      modelId: "small.en",
      wordTimestamps: true
    });
    await api.startTranscription({
      episodeId: "episode",
      provider: "openai",
      modelId: "gpt-4o-transcribe-diarize",
      speechMode: "diarization",
      wordTimestamps: false
    });
    await api.startOllamaAnalysis({
      episodeId: "episode",
      baseUrl: "http://192.168.1.20:11434",
      modelId: "gemma3:12b",
      networkDisclosed: true
    });
    await api.startOpenAiAnalysis("episode", "gpt-4.1-mini");

    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>);
    expect(bodies).toEqual([
      { episodeId: "episode", provider: "local", modelId: "small.en", wordTimestamps: true },
      {
        episodeId: "episode",
        provider: "openai",
        modelId: "gpt-4o-transcribe-diarize",
        wordTimestamps: false,
        speechMode: "diarization"
      },
      {
        episodeId: "episode",
        baseUrl: "http://192.168.1.20:11434",
        modelId: "gemma3:12b",
        networkDisclosed: true
      },
      { episodeId: "episode", modelId: "gpt-4.1-mini" }
    ]);
    expect(JSON.stringify(bodies)).not.toContain("cloudAuthorized");
  });
});
