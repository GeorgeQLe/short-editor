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

  it("uses exact approval and render workflow contracts, including pagination", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ revision: 8, approved: true }))
      .mockResolvedValueOnce(ok({
        items: [{ id: "render-1" }],
        nextCursor: "render cursor/2"
      }))
      .mockResolvedValueOnce(ok({ items: [{ id: "render-2" }], nextCursor: null }))
      .mockResolvedValueOnce(ok({ id: "preflight-1", status: "passed" }))
      .mockResolvedValueOnce(ok({ render: { id: "render-3" }, job: { id: "job-3" } }))
      .mockResolvedValueOnce(ok({ render: { id: "render-4" }, job: { id: "job-4" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.approveShort("short/id", 7);
    await expect(api.renders("short/id")).resolves.toEqual([
      { id: "render-1" }, { id: "render-2" }
    ]);
    await api.preflightRender("short/id", 8);
    await api.startRender("short/id", 8, "preflight/id", "webvtt");
    await api.retryRender("render/id");

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://127.0.0.1:43120/v1/shorts/short%2Fid/approve",
      "http://127.0.0.1:43120/v1/renders?shortId=short%2Fid",
      "http://127.0.0.1:43120/v1/renders?shortId=short%2Fid&cursor=render%20cursor%2F2",
      "http://127.0.0.1:43120/v1/renders/preflight",
      "http://127.0.0.1:43120/v1/renders/start",
      "http://127.0.0.1:43120/v1/renders/render%2Fid/retry"
    ]);
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.body))
      .toEqual([
        JSON.stringify({ expectedRevision: 7 }),
        undefined,
        undefined,
        JSON.stringify({ shortId: "short/id", expectedRevision: 8 }),
        JSON.stringify({
          shortId: "short/id",
          expectedRevision: 8,
          preflightId: "preflight/id",
          sidecarFormat: "webvtt"
        }),
        "{}"
      ]);
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

  it("uses exact transcript, artifact, Candidate, review, and content-package contracts", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ items: [{ id: "artifact-1" }], nextCursor: "artifact next" }))
      .mockResolvedValueOnce(ok({ items: [{ id: "artifact-2" }], nextCursor: null }))
      .mockResolvedValueOnce(ok({ revision: 2 }))
      .mockResolvedValueOnce(ok({ items: [{ id: "candidate-1" }], nextCursor: "candidate next" }))
      .mockResolvedValueOnce(ok({ items: [{ id: "candidate-2" }], nextCursor: null }))
      .mockResolvedValueOnce(ok({ candidates: [], diagnostic: {}, run: {} }))
      .mockResolvedValueOnce(ok({ revision: 4 }))
      .mockResolvedValueOnce(ok({ candidateId: "candidate/1" }))
      .mockResolvedValueOnce(ok({ candidateId: "candidate/1", candidateRevision: 5 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.analysisArtifacts("episode/1");
    await api.updateTranscript("episode/1", {
      expectedRevision: 1,
      language: "en",
      segments: [{
        id: "segment-1", startMs: 0, endMs: 1_000, text: "Edited.",
        words: [], speaker: "host", confidence: null
      }]
    });
    await api.candidates("episode/1");
    await api.generateCandidates({
      episodeId: "episode/1",
      mode: "analysis",
      analysisArtifactId: "artifact-1",
      count: 6,
      strategy: "replace_pending"
    });
    await api.reviewCandidate("candidate/1", 3, "rejected");
    await api.candidateContentPackage("candidate/1");
    await api.acceptCandidateContentPackage("candidate/1", 4, {
      cleanedTranscript: "Clean",
      rewrite: "Planning",
      hookVariants: ["Hook"],
      titles: ["Title"],
      description: "Description",
      hashtags: ["#tag"],
      thumbnailText: "Thumb"
    });

    expect(fetchMock.mock.calls.map((call) =>
      String(call[0]).replace("http://127.0.0.1:43120/v1", ""))).toEqual([
      "/analysis/episode%2F1/artifacts",
      "/analysis/episode%2F1/artifacts?cursor=artifact%20next",
      "/analysis/episode%2F1/transcript",
      "/candidates?episodeId=episode%2F1",
      "/candidates?episodeId=episode%2F1&cursor=candidate%20next",
      "/candidates/generate",
      "/candidates/candidate%2F1/review",
      "/candidates/candidate%2F1/content-package",
      "/candidates/candidate%2F1/content-package"
    ]);
    expect(fetchMock.mock.calls.slice(2).map((call) => (call[1] as RequestInit | undefined)?.method))
      .toEqual(["PUT", undefined, undefined, "POST", "POST", undefined, "PUT"]);
    expect(JSON.parse(String((fetchMock.mock.calls[5]?.[1] as RequestInit).body))).toEqual({
      episodeId: "episode/1",
      mode: "analysis",
      analysisArtifactId: "artifact-1",
      count: 6,
      strategy: "replace_pending"
    });
    expect(JSON.parse(String((fetchMock.mock.calls[6]?.[1] as RequestInit).body))).toEqual({
      expectedRevision: 3,
      status: "rejected"
    });
    expect(JSON.parse(String((fetchMock.mock.calls[8]?.[1] as RequestInit).body)))
      .toMatchObject({ expectedRevision: 4, contentPackage: { titles: ["Title"] } });
  });

  it("propagates exact revision-conflict details for transcript mutations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      apiVersion: "v1",
      error: {
        code: "REVISION_CONFLICT",
        message: "Revision conflict",
        details: { expectedRevision: 2, actualRevision: 3 },
        retryable: false
      }
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    const error = await api.updateTranscript("episode", {
      expectedRevision: 2, language: "en", segments: []
    }).catch((value) => value);
    expect(error).toMatchObject({
      code: "REVISION_CONFLICT",
      details: { expectedRevision: 2, actualRevision: 3 },
      status: 409
    });
  });
});
