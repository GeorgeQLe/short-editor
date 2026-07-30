// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisArtifact,
  Candidate,
  CandidateContentPackage,
  ContentPackage,
  TranscriptRevision
} from "../src/shared/domain";
import { ApiClientError, api } from "../src/ui/api";
import { App } from "../src/ui/App";
import { CandidatesWorkspace } from "../src/ui/CandidatesWorkspace";
import { candidate, episode, segments } from "./factories";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const now = "2026-07-29T12:00:00.000Z";
const provenance = {
  provider: "fixture",
  providerClass: "local" as const,
  modelId: "fixture-v1",
  providerVersion: "1",
  optionsVersion: "1",
  createdAt: now
};

function transcript(revision = 1): TranscriptRevision {
  const rows = segments(2);
  rows[0]!.words = [{
    text: "word", startMs: 100, endMs: 400, confidence: .9, speaker: "host"
  }];
  return {
    id: randomUUID(),
    episodeId: randomUUID(),
    revision,
    language: "en",
    segments: rows,
    provenance,
    acceptedState: "accepted",
    createdAt: now,
    updatedAt: now
  };
}

function artifact(state: AnalysisArtifact["state"] = "accepted"): AnalysisArtifact {
  return {
    id: randomUUID(),
    entityId: randomUUID(),
    ownerType: "episode",
    kind: "episode_analysis",
    state,
    provenance,
    inputHash: randomUUID(),
    rawOutput: {},
    acceptedProjection: null,
    createdAt: now
  };
}

const copy: ContentPackage = {
  cleanedTranscript: "Immutable cleaned transcript",
  rewrite: "Proposed planning rewrite",
  hookVariants: ["Hook one"],
  titles: ["Proposed title"],
  description: "Proposed description",
  hashtags: ["#fixture"],
  thumbnailText: "FIXTURE"
};

function contentPackage(
  candidateId: string,
  candidateRevision = 1,
  accepted: ContentPackage | null = null
): CandidateContentPackage {
  return {
    candidateId,
    candidateRevision,
    proposalArtifactId: randomUUID(),
    proposed: copy,
    accepted,
    proposalProvenance: provenance,
    inputHash: randomUUID()
  };
}

function setupApi(options: {
  transcript?: TranscriptRevision | null;
  candidates?: Candidate[];
  artifacts?: AnalysisArtifact[];
} = {}) {
  const selectedTranscript = options.transcript === undefined ? transcript() : options.transcript;
  vi.spyOn(api, "transcript").mockImplementation(async () => {
    if (selectedTranscript) return selectedTranscript;
    throw new ApiClientError("NOT_FOUND", "No transcript", null, false, 404);
  });
  vi.spyOn(api, "analysisArtifacts").mockResolvedValue(options.artifacts ?? []);
  vi.spyOn(api, "candidates").mockResolvedValue(options.candidates ?? []);
  return {
    announce: vi.fn(),
    onChanged: vi.fn().mockResolvedValue(undefined)
  };
}

async function selectEpisode(user: ReturnType<typeof userEvent.setup>, props: {
  announce: ReturnType<typeof vi.fn>;
  onChanged: ReturnType<typeof vi.fn>;
}, selected = episode()) {
  render(<CandidatesWorkspace episodes={[selected]} {...props} />);
  await user.selectOptions(screen.getByLabelText("Episode"), selected.id);
  await waitFor(() => expect(api.transcript).toHaveBeenCalledWith(selected.id));
  return selected;
}

describe("Candidates workspace", () => {
  it("replaces the Candidates ComingSoon route in the desktop shell", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "episodes").mockResolvedValue([episode()]);
    vi.spyOn(api, "watchedFolders").mockResolvedValue([]);
    vi.spyOn(api, "jobs").mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Candidates" }));
    expect(await screen.findByText("Episode workspace")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Candidates workspace" })).not.toBeInTheDocument();
  });

  it("requires Episode selection and gives missing-transcript recovery guidance", async () => {
    const user = userEvent.setup();
    const props = setupApi({ transcript: null });
    render(<CandidatesWorkspace episodes={[episode()]} {...props} />);
    expect(screen.getByText("Select an Episode")).toBeInTheDocument();
    expect(api.transcript).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Episode"),
      (screen.getByLabelText("Episode") as HTMLSelectElement).options[1]!.value);
    expect(await screen.findByText("No accepted transcript")).toBeInTheDocument();
    expect(screen.getByText(/Library → Providers/)).toBeInTheDocument();
  });

  it("saves text, timing, and speaker as a complete snapshot while preserving words", async () => {
    const user = userEvent.setup();
    const original = transcript();
    const props = setupApi({ transcript: original });
    const saved = { ...original, revision: 2, provenance: { ...provenance, provider: "manual" } };
    const update = vi.spyOn(api, "updateTranscript").mockResolvedValue(saved);
    await selectEpisode(user, props);

    fireEvent.change(await screen.findByLabelText("Segment 1 text"), {
      target: { value: "Locally corrected transcript." }
    });
    fireEvent.change(screen.getByLabelText("Segment 1 start milliseconds"), {
      target: { value: "50" }
    });
    fireEvent.change(screen.getByLabelText("Segment 1 speaker"), {
      target: { value: "narrator" }
    });
    await user.click(screen.getByRole("button", { name: "Save accepted transcript" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const input = update.mock.calls[0]![1];
    expect(input).toMatchObject({ expectedRevision: 1, language: "en" });
    expect(input.segments[0]).toMatchObject({
      text: "Locally corrected transcript.",
      startMs: 50,
      speaker: "narrator",
      words: original.segments[0]!.words
    });
    expect(input.segments).toHaveLength(2);
    expect(input.segments[0]!.words).toEqual(original.segments[0]!.words);
  });

  it("shows validation paths and preserves a conflicted transcript draft until explicit reload", async () => {
    const user = userEvent.setup();
    const original = transcript(2);
    const latest = transcript(3);
    const props = setupApi({ transcript: original });
    const transcriptRead = vi.mocked(api.transcript);
    vi.spyOn(api, "updateTranscript")
      .mockRejectedValueOnce(new ApiClientError("VALIDATION_ERROR", "Invalid request", [{
        path: ["segments", 0, "endMs"], message: "End must be after start"
      }], false, 422))
      .mockRejectedValueOnce(new ApiClientError("REVISION_CONFLICT", "Conflict", {
        expectedRevision: 2, actualRevision: 3
      }, false, 409));
    await selectEpisode(user, props);
    const textArea = await screen.findByLabelText("Segment 1 text");
    fireEvent.change(textArea, { target: { value: "Draft that must survive." } });

    await user.click(screen.getByRole("button", { name: "Save accepted transcript" }));
    expect(await screen.findByText("segments.0.endMs: End must be after start")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save accepted transcript" }));
    expect(await screen.findByText("Revision conflict: expected 2, actual 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Segment 1 text")).toHaveValue("Draft that must survive.");
    expect(screen.getByRole("button", { name: "Save accepted transcript" })).toBeDisabled();

    transcriptRead.mockResolvedValue(latest);
    await user.click(screen.getByRole("button", { name: "Reload latest" }));
    await waitFor(() => expect(screen.getByLabelText("Segment 1 text"))
      .toHaveValue(latest.segments[0]!.text));
    expect(screen.getByRole("button", { name: "Save accepted transcript" })).toBeEnabled();
  });

  it("supports both generation modes, strategies, accepted-artifact filtering, and diagnostics", async () => {
    const user = userEvent.setup();
    const accepted = artifact("accepted");
    const proposed = artifact("proposed");
    const props = setupApi({ artifacts: [accepted, proposed] });
    const generate = vi.spyOn(api, "generateCandidates").mockResolvedValue({
      candidates: [],
      diagnostic: {
        sufficient: false,
        code: "INSUFFICIENT_MATERIAL",
        requestedCount: 5,
        generatedCount: 0,
        minimumCandidateCount: 5,
        eligibleWindowCount: 1,
        rejectionCounts: { duration: 2, quality: 3, overlap: 0, semanticDuplication: 0 }
      },
      run: {} as never
    });
    await selectEpisode(user, props);
    await user.click(screen.getByRole("tab", { name: "Candidates" }));

    await user.selectOptions(screen.getByLabelText("Candidate count"), "5");
    await user.selectOptions(screen.getByLabelText("Pending strategy"), "replace_pending");
    await user.click(screen.getByRole("button", { name: "Generate Candidates" }));
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: "heuristic", count: 5, strategy: "replace_pending"
    }));
    expect(await screen.findByText("INSUFFICIENT_MATERIAL")).toBeInTheDocument();
    expect(screen.getByText(/rejected for duration: 2/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Generation mode"), "analysis");
    const artifactSelect = screen.getByLabelText("Accepted analysis artifact");
    expect(within(artifactSelect).getAllByRole("option")).toHaveLength(2);
    expect(within(artifactSelect).queryByText(new RegExp(proposed.id.slice(0, 8)))).not.toBeInTheDocument();
    await user.selectOptions(artifactSelect, accepted.id);
    await user.selectOptions(screen.getByLabelText("Pending strategy"), "append_pending");
    await user.click(screen.getByRole("button", { name: "Generate Candidates" }));
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: "analysis",
      analysisArtifactId: accepted.id,
      strategy: "append_pending"
    }));
    expect(api.candidates).toHaveBeenCalledTimes(3);
  });

  it("reviews Candidates and preserves edited accepted copy across a stale save", async () => {
    const user = userEvent.setup();
    const selectedEpisode = episode();
    const row = candidate(selectedEpisode.id, { reviewStatus: "pending", score: .812345 });
    const props = setupApi({ candidates: [row] });
    const packageRead = vi.spyOn(api, "candidateContentPackage")
      .mockResolvedValueOnce(contentPackage(row.id, 1))
      .mockResolvedValueOnce(contentPackage(row.id, 2))
      .mockResolvedValueOnce(contentPackage(row.id, 3, {
        ...copy, titles: ["Server title"]
      }));
    vi.spyOn(api, "reviewCandidate").mockResolvedValue({
      ...row, reviewStatus: "approved", revision: 2
    });
    const accept = vi.spyOn(api, "acceptCandidateContentPackage")
      .mockRejectedValueOnce(new ApiClientError("REVISION_CONFLICT", "Conflict", {
        expectedRevision: 2, actualRevision: 3
      }, false, 409));
    await selectEpisode(user, props, selectedEpisode);
    await user.click(screen.getByRole("tab", { name: "Candidates" }));
    expect(screen.getByText("0.812")).toBeInTheDocument();
    expect(screen.getByText("Hook 0.900")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /practical lesson/i }));
    expect(await screen.findByText("Immutable proposed copy")).toBeInTheDocument();
    expect(screen.getAllByText("Proposed planning rewrite")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByText(/Candidate revision 2/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Titles (one per line)"), {
      target: { value: "User title one\nUser title two" }
    });
    await user.click(screen.getByRole("button", { name: "Accept edited copy" }));
    expect(await screen.findByText("Stale copy: expected 2, actual 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Titles (one per line)")).toHaveValue(
      "User title one\nUser title two"
    );
    expect(screen.getByRole("button", { name: "Accept edited copy" })).toBeDisabled();
    expect(accept).toHaveBeenCalledWith(row.id, 2, expect.objectContaining({
      titles: ["User title one", "User title two"]
    }));

    await user.click(screen.getByRole("button", { name: "Reload latest copy" }));
    await waitFor(() => expect(packageRead).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText("Titles (one per line)")).toHaveValue("Server title");
    expect(screen.getByRole("button", { name: "Accept edited copy" })).toBeEnabled();
  });
});
