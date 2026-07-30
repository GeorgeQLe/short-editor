// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderCapability, WatchedFolder } from "../src/shared/domain";
import { api } from "../src/ui/api";
import { LibraryWorkspace } from "../src/ui/LibraryWorkspace";
import type { DesktopBridge } from "../src/ui/desktop";
import { episode } from "./factories";

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
