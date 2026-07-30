// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderCapability, WatchedFolder } from "../src/shared/domain";
import type {
  Job,
  Render,
  RenderPreflightResult,
  ShortProject,
  Template
} from "../src/shared/domain";
import { starterTemplates } from "../src/shared/templates";
import { ApiClientError, api } from "../src/ui/api";
import { EditorWorkspace } from "../src/ui/EditorWorkspace";
import { LibraryWorkspace } from "../src/ui/LibraryWorkspace";
import type { DesktopBridge } from "../src/ui/desktop";
import { captionState, episode } from "./factories";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.desktop;
});

const baseProps = () => ({
  tab: "episodes" as const,
  onTabChange: vi.fn(),
  episodes: [episode()],
  folders: [] as WatchedFolder[],
  jobs: [],
  capabilities: [] as ProviderCapability[],
  search: "",
  onSearch: vi.fn(),
  importResult: null,
  onImport: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  announce: vi.fn(),
  openCloudAccess: vi.fn()
});

function desktop(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    selectMedia: vi.fn().mockResolvedValue([]),
    selectWatchedDirectory: vi.fn().mockResolvedValue(null),
    selectRelinkCandidate: vi.fn().mockResolvedValue(null),
    credentials: {
      list: vi.fn().mockResolvedValue([]),
      save: vi.fn(),
      remove: vi.fn()
    },
    cloudAuthorizations: {
      list: vi.fn().mockResolvedValue([]),
      grant: vi.fn(),
      revoke: vi.fn()
    },
    ...overrides
  };
}

function shortProject(template: Template, episodeId: string): ShortProject {
  const now = "2026-07-30T16:00:00.000Z";
  return {
    id: randomUUID(),
    episodeId,
    candidateId: randomUUID(),
    title: "UI fixture Short",
    sourceRanges: [{ startMs: 0, endMs: 30_000 }],
    templateId: template.id,
    templateLineage: {
      templateId: template.id,
      templateVersion: template.version,
      parentTemplateId: template.parentTemplateId
    },
    composition: structuredClone(template.composition),
    captions: captionState(),
    audio: {
      sourceGainDb: 0,
      sourceMuted: false,
      cutFadeMs: 25,
      bedAssetId: null,
      bedGainDb: null,
      warnings: []
    },
    copy: {
      cleanedTranscript: "",
      rewrite: "",
      hookVariants: [],
      titles: [],
      description: "",
      hashtags: [],
      thumbnailText: ""
    },
    copyState: "accepted",
    copySource: "user_accepted",
    approved: false,
    revision: 6,
    createdAt: now,
    updatedAt: now
  };
}

function mockEditorLauncher(shorts: ShortProject[] = []) {
  vi.spyOn(api, "shorts").mockResolvedValue(shorts);
  vi.spyOn(api, "templates").mockResolvedValue(starterTemplates);
  vi.spyOn(api, "assets").mockResolvedValue([]);
  vi.spyOn(api, "candidates").mockResolvedValue([]);
}

function renderAttempt(
  project: ShortProject,
  overrides: Partial<Render> = {}
): Render {
  const now = "2026-07-30T16:05:00.000Z";
  const id = randomUUID();
  return {
    id,
    shortId: project.id,
    projectRevision: project.revision,
    lineageId: id,
    previousRenderId: null,
    attempt: 1,
    preflightId: randomUUID(),
    encoder: {
      ffmpegVersion: "ffmpeg 7.1",
      videoCodec: "libx264",
      audioCodec: "aac",
      settings: {}
    },
    outputPath: null,
    sidecarPath: null,
    validation: null,
    determinism: null,
    state: "queued",
    error: null,
    contentHash: null,
    decisionHash: `sha256:${"a".repeat(64)}`,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function renderJob(render: Render, overrides: Partial<Job> = {}): Job {
  const now = "2026-07-30T16:05:00.000Z";
  return {
    id: randomUUID(),
    type: "render",
    entityId: render.shortId,
    provider: "local",
    state: "queued",
    progress: 0,
    stage: "queued",
    attempts: 0,
    cancelRequested: false,
    errorCode: null,
    errorMessage: null,
    payloadReference: `render:${render.id}`,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function passingPreflight(project: ShortProject): RenderPreflightResult {
  return {
    id: randomUUID(),
    shortId: project.id,
    revision: project.revision,
    snapshotHash: `sha256:${"b".repeat(64)}`,
    status: "passed",
    findings: [{
      code: "CAPTION_SAFE_AREA",
      severity: "warning",
      category: "caption",
      message: "A caption crosses the safe area.",
      remediation: "Move the caption inside the safe area."
    }],
    dependencyVersions: { ffmpeg: "ffmpeg 7.1", ffprobe: "ffprobe 7.1" },
    createdAt: "2026-07-30T16:04:00.000Z"
  };
}

describe("Library workflow", () => {
  it("shows every per-input import outcome and prioritizes missing Episodes", () => {
    const missing = episode({ sourcePath: "/missing.mp4", missing: true, status: "source_missing" });
    const available = episode({ sourcePath: "/available.mp4" });
    const props = baseProps();
    render(<LibraryWorkspace {...props} episodes={[available, missing]} importResult={{
      imported: [available],
      duplicates: [available],
      relinked: [missing],
      rejected: [{ path: "/bad.mov", code: "VALIDATION_ERROR", reason: "Unreadable" }]
    }} />);

    expect(screen.getByText("Imported")).toBeInTheDocument();
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
    expect(screen.getByText("Relinked")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("missing.mp4");
    expect(screen.getByRole("button", { name: "Relink" })).toBeInTheDocument();
  });

  it("requires explicit confirmation and keeps the token out of visible output", async () => {
    const user = userEvent.setup();
    const missing = episode({ missing: true, status: "source_missing" });
    window.desktop = desktop({
      selectRelinkCandidate: vi.fn().mockResolvedValue("/replacement.mp4")
    });
    vi.spyOn(api, "relinkSource").mockResolvedValue({
      status: "confirmation_required",
      confirmationToken: "memory-only-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    const confirm = vi.spyOn(api, "confirmRelink").mockResolvedValue(
      episode({ id: missing.id })
    );
    const props = baseProps();
    render(<LibraryWorkspace {...props} episodes={[missing]} />);

    await user.click(screen.getByRole("button", { name: "Relink" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Size, fingerprint, and media metadata match"
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent("memory-only-token");
    expect(confirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm relink" }));
    expect(confirm).toHaveBeenCalledWith(missing.id, "memory-only-token");
  });

  it("creates and edits watched folders with root-relative patterns", async () => {
    const user = userEvent.setup();
    window.desktop = desktop({
      selectWatchedDirectory: vi.fn().mockResolvedValue("/media/shows")
    });
    const configure = vi.spyOn(api, "configureWatchedFolder").mockResolvedValue({} as WatchedFolder);
    const props = baseProps();
    render(<LibraryWorkspace {...props} tab="folders" />);

    await user.click(screen.getByRole("button", { name: "Choose…" }));
    fireEvent.change(screen.getByLabelText("Root-relative include patterns"), {
      target: { value: "season-{1,2}/**/*.mp4" }
    });
    await user.click(screen.getByRole("button", { name: "Save folder" }));

    expect(configure).toHaveBeenCalledWith({
      action: "create",
      path: "/media/shows",
      enabled: true,
      recursive: true,
      includePatterns: ["season-{1,2}/**/*.mp4"]
    });
  });

  it("does not start or query a provider before an Episode is selected", () => {
    const providerStatus = vi.spyOn(api, "providerStatus");
    const transcript = vi.spyOn(api, "transcript");
    const startTranscription = vi.spyOn(api, "startTranscription");
    const startOllama = vi.spyOn(api, "startOllamaAnalysis");
    render(<LibraryWorkspace {...baseProps()} tab="providers" />);
    expect(providerStatus).not.toHaveBeenCalled();
    expect(transcript).not.toHaveBeenCalled();
    expect(startTranscription).not.toHaveBeenCalled();
    expect(startOllama).not.toHaveBeenCalled();
  });

  it("classifies private Ollama and sends disclosure only after acknowledgement", async () => {
    const user = userEvent.setup();
    const selected = episode({ id: randomUUID() });
    vi.spyOn(api, "providerStatus").mockResolvedValue([]);
    vi.spyOn(api, "transcript").mockResolvedValue({} as never);
    vi.spyOn(api, "ollamaStatus").mockResolvedValue({
      provider: "ollama",
      providerClass: "network",
      baseUrl: "http://192.168.1.2:11434",
      requiresNetworkDisclosure: true,
      requiresCloudAuthorization: false
    });
    const start = vi.spyOn(api, "startOllamaAnalysis").mockResolvedValue({} as never);
    const capabilities: ProviderCapability[] = [{
      provider: "ollama",
      providerClass: "local",
      operations: ["analysis"],
      features: [],
      defaultModels: { analysis: "gemma3" }
    }];
    render(<LibraryWorkspace {...baseProps()} tab="providers" episodes={[selected]}
      capabilities={capabilities} />);

    await user.selectOptions(screen.getByLabelText("Episode"), selected.id);
    await user.clear(await screen.findByLabelText("Endpoint"));
    await user.type(screen.getByLabelText("Endpoint"), "http://192.168.1.2:11434");
    expect(await screen.findByText("Private-network endpoint")).toBeInTheDocument();
    const queue = screen.getByRole("button", { name: "Queue analysis" });
    expect(queue).toBeDisabled();
    await user.click(screen.getByLabelText(/For this operation/));
    await user.click(queue);
    await waitFor(() => expect(start).toHaveBeenCalledWith({
      episodeId: selected.id,
      baseUrl: "http://192.168.1.2:11434",
      modelId: "gemma3",
      networkDisclosed: true
    }));
  });
});

describe("Editor desktop workflow", () => {
  it("uses an in-app form to clone a built-in template", async () => {
    const user = userEvent.setup();
    const prompt = vi.spyOn(window, "prompt");
    const cloned = {
      ...starterTemplates[0]!,
      id: randomUUID(),
      name: "Desktop clone",
      builtIn: false,
      parentTemplateId: starterTemplates[0]!.id
    };
    let resolveClone!: (value: Template) => void;
    const cloneResult = new Promise<Template>((resolve) => { resolveClone = resolve; });
    mockEditorLauncher();
    const clone = vi.spyOn(api, "cloneTemplate").mockReturnValue(cloneResult);
    render(<EditorWorkspace episodes={[]} announce={vi.fn()} onChanged={vi.fn()} />);

    await screen.findByRole("heading", { name: "Create from an approved Candidate" });
    await user.click(screen.getByRole("button", { name: "Clone" }));
    const name = screen.getByLabelText("Clone name");
    await user.clear(name);
    await user.type(name, "Desktop clone");
    const form = name.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    await waitFor(() => expect(clone).toHaveBeenCalledWith(
      starterTemplates[0]!.id,
      "Desktop clone",
      starterTemplates[0]!.description
    ));
    expect(clone).toHaveBeenCalledTimes(1);
    resolveClone(cloned);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Create clone" })).not.toBeInTheDocument()
    );
    expect(prompt).not.toHaveBeenCalled();
  });

  it("shows exact conflict revisions and retains the dirty audio draft", async () => {
    const user = userEvent.setup();
    window.desktop = desktop({ mediaUrl: () => "data:video/mp4;base64," });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const selectedEpisode = episode();
    const project = shortProject(starterTemplates[0]!, selectedEpisode.id);
    mockEditorLauncher([project]);
    vi.spyOn(api, "updateAudio").mockRejectedValue(new ApiClientError(
      "REVISION_CONFLICT",
      "Short was edited by another client",
      { expectedRevision: 6, actualRevision: 7 },
      false,
      409
    ));
    render(<EditorWorkspace episodes={[selectedEpisode]} announce={vi.fn()} onChanged={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Open editor" }));
    await user.click(screen.getByRole("tab", { name: "Audio" }));
    const gain = screen.getByLabelText("Source gain (dB)");
    fireEvent.change(gain, { target: { value: "-2" } });
    await user.click(screen.getByRole("button", { name: "Save Audio" }));

    expect(await screen.findByText(
      "Revision conflict: expected 6, actual 7. Local draft retained."
    )).toBeInTheDocument();
    expect(screen.getByLabelText("Source gain (dB)")).toHaveValue(-2);
    expect(screen.getByText(/A newer server revision exists/)).toBeInTheDocument();
  });

  it("approves and starts only the exact passing snapshot with SRT by default", async () => {
    const user = userEvent.setup();
    window.desktop = desktop({ mediaUrl: () => "data:video/mp4;base64," });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const selectedEpisode = episode();
    const project = shortProject(starterTemplates[0]!, selectedEpisode.id);
    const approved = { ...project, approved: true, revision: 7 };
    const preflight = passingPreflight(approved);
    const queued = renderAttempt(approved, { preflightId: preflight.id });
    const job = renderJob(queued);
    mockEditorLauncher([project]);
    vi.spyOn(api, "renders").mockResolvedValue([]);
    vi.spyOn(api, "jobs").mockResolvedValue([]);
    const approve = vi.spyOn(api, "approveShort").mockResolvedValue(approved);
    const preflightCall = vi.spyOn(api, "preflightRender").mockResolvedValue(preflight);
    const start = vi.spyOn(api, "startRender").mockResolvedValue({ render: queued, job });
    render(<EditorWorkspace episodes={[selectedEpisode]} announce={vi.fn()} onChanged={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Open editor" }));
    await user.click(screen.getByRole("tab", { name: "Render" }));
    await user.click(screen.getByRole("button", { name: "Approve revision" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith(project.id, 6));
    await user.click(screen.getByRole("button", { name: "Run preflight" }));
    await waitFor(() => expect(preflightCall).toHaveBeenCalledWith(project.id, 7));
    expect(await screen.findByText("warning: CAPTION_SAFE_AREA")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start render" }));

    await waitFor(() => expect(start).toHaveBeenCalledWith(
      project.id, 7, preflight.id, "srt"
    ));
  });

  it("blocks approval and preflight while any editor section is unsaved", async () => {
    const user = userEvent.setup();
    window.desktop = desktop({ mediaUrl: () => "data:video/mp4;base64," });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const selectedEpisode = episode();
    const project = shortProject(starterTemplates[0]!, selectedEpisode.id);
    mockEditorLauncher([project]);
    vi.spyOn(api, "renders").mockResolvedValue([]);
    vi.spyOn(api, "jobs").mockResolvedValue([]);
    render(<EditorWorkspace episodes={[selectedEpisode]} announce={vi.fn()} onChanged={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Open editor" }));
    await user.click(screen.getByRole("tab", { name: "Audio" }));
    fireEvent.change(screen.getByLabelText("Source gain (dB)"), { target: { value: "-3" } });
    await user.click(screen.getByRole("tab", { name: "Render" }));

    expect(screen.getByText(/Save every editor section/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve revision" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run preflight" })).toBeDisabled();
  });

  it("shows persisted render progress and requests cancellation once", async () => {
    const user = userEvent.setup();
    window.desktop = desktop({ mediaUrl: () => "data:video/mp4;base64," });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const selectedEpisode = episode();
    const project = {
      ...shortProject(starterTemplates[0]!, selectedEpisode.id),
      approved: true
    };
    const activeRender = renderAttempt(project, { state: "running" });
    const activeJob = renderJob(activeRender, {
      state: "running",
      progress: 0.42,
      stage: "encoding"
    });
    mockEditorLauncher([project]);
    vi.spyOn(api, "renders").mockResolvedValue([activeRender]);
    vi.spyOn(api, "jobs").mockResolvedValue([activeJob]);
    const cancel = vi.spyOn(api, "cancelJob").mockResolvedValue({
      ...activeJob,
      cancelRequested: true
    });
    render(<EditorWorkspace episodes={[selectedEpisode]} announce={vi.fn()} onChanged={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Open editor" }));
    await user.click(screen.getByRole("tab", { name: "Render" }));
    expect(await screen.findByText("42% · encoding")).toBeInTheDocument();
    expect(screen.getByLabelText("Render attempt 1 progress")).toHaveValue(0.42);
    const cancelButton = screen.getByRole("button", { name: "Cancel render" });
    await user.dblClick(cancelButton);

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(cancel).toHaveBeenCalledWith(activeJob.id);
    expect(screen.getByRole("button", { name: "Cancellation requested" })).toBeDisabled();
  });

  it("restores durable lineage history, keeps successful output, and retries only newest failure", async () => {
    const user = userEvent.setup();
    window.desktop = desktop({ mediaUrl: () => "data:video/mp4;base64," });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const selectedEpisode = episode();
    const project = {
      ...shortProject(starterTemplates[0]!, selectedEpisode.id),
      approved: true
    };
    const succeeded = renderAttempt(project, {
      state: "succeeded",
      outputPath: "/renders/first.mp4",
      sidecarPath: "/renders/first.srt",
      validation: {
        valid: true,
        findings: [],
        width: 1080,
        height: 1920,
        durationMs: 30_000,
        videoCodec: "h264",
        audioCodec: "aac",
        validatedAt: "2026-07-30T16:06:00.000Z"
      }
    });
    const failed = renderAttempt(project, {
      lineageId: succeeded.lineageId,
      previousRenderId: succeeded.id,
      attempt: 2,
      state: "failed",
      error: { code: "INTERNAL_ERROR", message: "Encoder stopped" }
    });
    const retryAttempt = renderAttempt(project, {
      lineageId: succeeded.lineageId,
      previousRenderId: failed.id,
      attempt: 3
    });
    const retryJob = renderJob(retryAttempt);
    mockEditorLauncher([project]);
    vi.spyOn(api, "renders").mockResolvedValue([succeeded, failed]);
    vi.spyOn(api, "jobs").mockResolvedValue([]);
    const retry = vi.spyOn(api, "retryRender")
      .mockResolvedValue({ render: retryAttempt, job: retryJob });
    render(<EditorWorkspace episodes={[selectedEpisode]} announce={vi.fn()} onChanged={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Open editor" }));
    await user.click(screen.getByRole("tab", { name: "Render" }));
    expect(await screen.findByText("/renders/first.mp4")).toBeInTheDocument();
    expect(screen.getByText("passed · 1080×1920 · h264/aac")).toBeInTheDocument();
    const retryButtons = screen.getAllByRole("button", { name: "Retry attempt" });
    expect(retryButtons).toHaveLength(1);
    await user.click(retryButtons[0]!);
    await waitFor(() => expect(retry).toHaveBeenCalledWith(failed.id));
    expect(screen.getByText("/renders/first.mp4")).toBeInTheDocument();
  });
});
