import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Episode,
  Job,
  OllamaEndpointStatus,
  ProviderCapability,
  ProviderStatus,
  WatchedFolder
} from "../shared/domain";
import { ApiClientError, api, type ImportBatchResult } from "./api";
import type { CloudAccessTarget } from "./CloudAccess";
import { errorMessage, fileName } from "./utils";

export type LibraryTab = "episodes" | "folders" | "providers";

export function LibraryWorkspace(props: {
  tab: LibraryTab;
  onTabChange(tab: LibraryTab): void;
  episodes: Episode[];
  folders: WatchedFolder[];
  jobs: Job[];
  capabilities: ProviderCapability[];
  search: string;
  onSearch(value: string): void;
  importResult: ImportBatchResult | null;
  onImport(): void;
  refresh(): Promise<void>;
  announce(message: string): void;
  openCloudAccess(target: CloudAccessTarget): void;
}) {
  return <section className="panel library-panel">
    <div className="tabs" role="tablist" aria-label="Library workspaces">
      {([
        ["episodes", "Episodes"],
        ["folders", "Watched Folders"],
        ["providers", "Providers"]
      ] as const).map(([id, label]) => <button key={id} role="tab"
        aria-selected={props.tab === id} aria-controls={`library-${id}`}
        onClick={() => props.onTabChange(id)}>{label}</button>)}
    </div>
    <div role="tabpanel" id={`library-${props.tab}`}>
      {props.tab === "episodes" ? <EpisodesPanel {...props} /> :
        props.tab === "folders" ? <FoldersPanel {...props} /> :
          <ProvidersPanel {...props} />}
    </div>
  </section>;
}

function EpisodesPanel({
  episodes, search, onSearch, importResult, onImport, refresh, announce
}: Parameters<typeof LibraryWorkspace>[0]) {
  const [relink, setRelink] = useState<{
    episode: Episode;
    token?: string;
    expiresAt?: string;
    error?: string;
  } | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const beginRelink = async (episode: Episode) => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    const candidatePath = await window.desktop?.selectRelinkCandidate();
    if (!candidatePath) return;
    setRelink({ episode });
    announce(`Checking replacement source for ${fileName(episode.sourcePath)}…`);
    try {
      const result = await api.relinkSource(episode.id, candidatePath);
      if (result.status === "relinked") {
        announce("Source relinked. Episode identity was verified by content hash.");
        setRelink(null);
        await refresh();
        restoreFocus.current?.focus();
      } else {
        setRelink({
          episode,
          token: result.confirmationToken,
          expiresAt: result.expiresAt
        });
        announce("Relink requires explicit identity confirmation.");
      }
    } catch (error) {
      const text = errorMessage(error, "Relink failed");
      setRelink({ episode, error: text });
      announce(text);
    }
  };

  const closeRelink = () => {
    setRelink(null);
    window.setTimeout(() => restoreFocus.current?.focus(), 0);
  };

  return <>
    <div className="toolbar">
      <div><h2>Episode inventory</h2><p>Sources stay in place. Missing sources can be safely relinked.</p></div>
      <label className="search"><span className="sr-only">Search episodes</span>
        <input value={search} onChange={(event) => onSearch(event.target.value)}
          placeholder="Search episodes" /></label>
    </div>
    {importResult && <ImportResults result={importResult} />}
    {episodes.length ? <div className="table-wrap"><table>
      <thead><tr><th>Episode</th><th>Status</th><th>Format</th><th>Candidates</th>
        <th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{[...episodes].sort((a, b) => Number(b.missing) - Number(a.missing)).map((episode) =>
        <tr key={episode.id} className={episode.missing ? "missing-row" : undefined}>
          <td><strong>{fileName(episode.sourcePath)}</strong><small>{episode.sourcePath}</small></td>
          <td><span className={`pill ${episode.status}`}>{episode.status.replace("_", " ")}</span></td>
          <td>{episode.width ? `${episode.width}×${episode.height}` : "Pending probe"}</td>
          <td>{episode.candidateCount}</td>
          <td>{episode.missing
            ? <button className="primary compact" onClick={() => void beginRelink(episode)}>Relink</button>
            : <span className="muted">Source available</span>}</td>
        </tr>)}
      </tbody>
    </table></div> : <EmptyLibrary onImport={onImport} />}
    {relink && <RelinkDialog state={relink} onClose={closeRelink} onConfirm={async () => {
      if (!relink.token) return;
      try {
        await api.confirmRelink(relink.episode.id, relink.token);
        announce("Replacement source confirmed and relinked.");
        setRelink(null);
        await refresh();
        restoreFocus.current?.focus();
      } catch (error) {
        const text = errorMessage(error, "Could not confirm relink");
        setRelink((current) => current ? { ...current, error: text } : current);
        announce(text);
      }
    }} />}
  </>;
}

function ImportResults({ result }: { result: ImportBatchResult }) {
  const rows = [
    ...result.imported.map((episode) => ({ path: episode.sourcePath, result: "Imported", detail: "New Episode" })),
    ...result.duplicates.map((episode) => ({ path: episode.sourcePath, result: "Duplicate", detail: "Existing identity retained" })),
    ...result.relinked.map((episode) => ({ path: episode.sourcePath, result: "Relinked", detail: "Missing source restored" })),
    ...result.rejected.map((item) => ({ path: item.path, result: "Rejected", detail: `${item.code}: ${item.reason}` }))
  ];
  return <details className="batch-results" open>
    <summary>Latest import · {rows.length} input result{rows.length === 1 ? "" : "s"}</summary>
    <ul>{rows.map((row, index) => <li key={`${row.path}:${index}`}>
      <span className={`result-marker ${row.result.toLowerCase()}`}>{row.result}</span>
      <strong>{fileName(row.path)}</strong><small>{row.detail}</small>
    </li>)}</ul>
  </details>;
}

function RelinkDialog({
  state, onClose, onConfirm
}: {
  state: { episode: Episode; token?: string; expiresAt?: string; error?: string };
  onClose(): void;
  onConfirm(): void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="relink-title"
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <h2 id="relink-title">{state.token ? "Confirm replacement source" : "Relink source"}</h2>
      {state.token ? <>
        <p>Size, fingerprint, and media metadata match this Episode, but the content hash requires your confirmation. The Episode will not change until you confirm.</p>
        <p className="notice">This one-time token is held only in memory and expires {formatExpiry(state.expiresAt)}.</p>
      </> : <p>The selected source could not be applied. The Episode remains source-missing and you can choose another file.</p>}
      {state.error && <p className="error-box" role="alert">{state.error}</p>}
      <div className="dialog-actions">
        <button ref={cancel} className="secondary" onClick={onClose}>
          {state.token ? "Cancel" : "Close"}
        </button>
        {state.token && <button className="primary" onClick={onConfirm}>Confirm relink</button>}
      </div>
    </section>
  </div>;
}

function FoldersPanel({
  folders, jobs, refresh, announce
}: Parameters<typeof LibraryWorkspace>[0]) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [recursive, setRecursive] = useState(true);
  const [patterns, setPatterns] = useState("**/*.mp4\n**/*.mov");

  const reset = () => {
    setEditingId(null);
    setPath("");
    setEnabled(true);
    setRecursive(true);
    setPatterns("**/*.mp4\n**/*.mov");
  };
  const edit = (folder: WatchedFolder) => {
    setEditingId(folder.id);
    setPath(folder.canonicalPath);
    setEnabled(folder.enabled);
    setRecursive(folder.recursive);
    setPatterns(folder.includePatterns.join("\n"));
  };
  const save = async () => {
    try {
      const includePatterns = patterns.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      await api.configureWatchedFolder(editingId ? {
        action: "update", folderId: editingId, path, enabled, recursive, includePatterns
      } : {
        action: "create", path, enabled, recursive, includePatterns
      });
      announce(editingId ? "Watched folder updated." : "Watched folder added.");
      reset();
      await refresh();
    } catch (error) {
      announce(errorMessage(error, "Could not save watched folder"));
    }
  };

  return <div className="split-workspace">
    <section className="workspace-list">
      <div className="toolbar"><div><h2>Watched folders</h2>
        <p>Patterns are root-relative. Changes are applied on the next scan.</p></div></div>
      {folders.length ? <ul className="folder-list">{folders.map((folder) => {
        const scanJob = jobs.find((job) => job.entityId === folder.id &&
          job.type === "watched_folder_scan" && (job.state === "queued" || job.state === "running"));
        return <li key={folder.id}>
          <div><strong>{folder.canonicalPath}</strong>
            <small>{folder.enabled ? "Enabled" : "Disabled"} · {folder.recursive ? "Recursive" : "Top level"} · {folder.includePatterns.join(", ") || "all media"}</small>
            <span className={`scan-status ${folder.lastScanStatus}`}>
              {scanJob ? `${scanJob.stage} · ${Math.round(scanJob.progress * 100)}%` :
                `${folder.lastScanStatus.replace("_", " ")}${folder.lastScannedAt ? ` · ${new Date(folder.lastScannedAt).toLocaleString()}` : ""}`}
            </span>
            {folder.lastScanError && <span className="folder-error" role="alert">
              {folder.lastScanError} Check folder permissions, then rescan.
            </span>}
          </div>
          <div className="actions">
            <button className="secondary" onClick={() => edit(folder)}>Edit</button>
            <button className="secondary" disabled={Boolean(scanJob)} onClick={async () => {
              try {
                await api.rescanWatchedFolder(folder.id);
                announce("Watched-folder rescan queued.");
                await refresh();
              } catch (error) {
                announce(errorMessage(error, "Could not rescan watched folder"));
              }
            }}>Rescan</button>
          </div>
        </li>;
      })}</ul> : <div className="empty compact-empty"><h2>No watched folders</h2>
        <p>Add a directory to discover new Episodes without moving the original files.</p></div>}
    </section>
    <form className="workspace-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h2>{editingId ? "Edit watched folder" : "Add watched folder"}</h2>
      <label>Directory<div className="input-action"><input required value={path}
        onChange={(event) => setPath(event.target.value)} />
        <button type="button" className="secondary" onClick={async () => {
          const selected = await window.desktop?.selectWatchedDirectory();
          if (selected) setPath(selected);
        }}>Choose…</button></div></label>
      <label>Root-relative include patterns<textarea value={patterns}
        onChange={(event) => setPatterns(event.target.value)}
        placeholder={"**/*.mp4\nrecordings/*.mov"} /></label>
      <label className="check"><input type="checkbox" checked={enabled}
        onChange={(event) => setEnabled(event.target.checked)} />Enabled</label>
      <label className="check"><input type="checkbox" checked={recursive}
        onChange={(event) => setRecursive(event.target.checked)} />Scan subfolders recursively</label>
      <div className="actions"><button className="primary" type="submit">Save folder</button>
        {editingId && <button type="button" className="secondary" onClick={reset}>Cancel</button>}</div>
    </form>
  </div>;
}

function ProvidersPanel({
  episodes, jobs, capabilities, refresh, announce, openCloudAccess
}: Parameters<typeof LibraryWorkspace>[0]) {
  const [episodeId, setEpisodeId] = useState("");
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [hasTranscript, setHasTranscript] = useState(false);
  const [transcriptionProvider, setTranscriptionProvider] = useState<"local" | "openai">("local");
  const [transcriptionModel, setTranscriptionModel] = useState("");
  const [speechMode, setSpeechMode] = useState<"transcription" | "diarization">("transcription");
  const [wordTimestamps, setWordTimestamps] = useState(true);
  const [analysisProvider, setAnalysisProvider] = useState<"ollama" | "openai">("ollama");
  const [analysisModel, setAnalysisModel] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [endpointStatus, setEndpointStatus] = useState<OllamaEndpointStatus | null>(null);
  const [networkDisclosed, setNetworkDisclosed] = useState(false);
  const initializedDefaults = useRef({ transcription: false, analysis: false });

  const defaults = useMemo(() => Object.fromEntries(capabilities.map((capability) =>
    [capability.provider, capability.defaultModels])), [capabilities]);
  useEffect(() => {
    if (!initializedDefaults.current.transcription && defaults[transcriptionProvider]) {
      initializedDefaults.current.transcription = true;
      setTranscriptionModel(defaults[transcriptionProvider]?.[
        speechMode === "diarization" ? "diarization" : "transcription"
      ] ?? "");
    }
  }, [defaults, speechMode, transcriptionModel, transcriptionProvider]);
  useEffect(() => {
    if (!initializedDefaults.current.analysis && defaults[analysisProvider]) {
      initializedDefaults.current.analysis = true;
      setAnalysisModel(defaults[analysisProvider]?.analysis ?? "");
    }
  }, [analysisProvider, defaults]);
  useEffect(() => {
    if (!episodeId) {
      setStatuses([]);
      setHasTranscript(false);
      return;
    }
    void Promise.all([
      api.providerStatus(episodeId),
      api.transcript(episodeId).then(() => true).catch((error) => {
        if (error instanceof ApiClientError && error.code === "NOT_FOUND") return false;
        throw error;
      })
    ]).then(([nextStatuses, transcript]) => {
      setStatuses(nextStatuses);
      setHasTranscript(transcript);
    }).catch((error) => announce(errorMessage(error, "Could not load provider status")));
  }, [announce, episodeId]);
  useEffect(() => {
    if (analysisProvider !== "ollama" || !ollamaUrl) {
      setEndpointStatus(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void api.ollamaStatus(ollamaUrl).then((status) => {
        setEndpointStatus(status);
        setNetworkDisclosed(false);
      }).catch((error) => {
        setEndpointStatus(null);
        announce(errorMessage(error, "Invalid Ollama endpoint"));
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [analysisProvider, announce, ollamaUrl]);

  const selectedEpisode = episodes.find((episode) => episode.id === episodeId);
  const openAi = statuses.find((status) => status.provider === "openai");
  const activeJobs = jobs.filter((job) => job.entityId === episodeId && job.type === "analyze");

  const run = async (operation: "transcription" | "analysis") => {
    if (!episodeId) return;
    try {
      if (operation === "transcription") {
        await api.startTranscription({
          episodeId,
          provider: transcriptionProvider,
          modelId: transcriptionModel,
          speechMode,
          wordTimestamps: speechMode === "diarization" ? false : wordTimestamps
        });
      } else if (analysisProvider === "ollama") {
        await api.startOllamaAnalysis({
          episodeId,
          baseUrl: ollamaUrl,
          modelId: analysisModel,
          ...(endpointStatus?.providerClass === "network" ? { networkDisclosed } : {})
        });
      } else {
        await api.startOpenAiAnalysis(episodeId, analysisModel);
      }
      announce(`${operation === "transcription" ? "Transcription" : "Analysis"} queued with the exact selected provider and model.`);
      await refresh();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "CLOUD_NOT_AUTHORIZED") {
        const provider = operation === "transcription" ? "openai" : analysisProvider;
        announce(`${error.message} Open Cloud Access to authorize this operation.`);
        openCloudAccess({ episodeId, provider: provider as "openai" | "ollama", operation });
        return;
      }
      announce(errorMessage(error, `Could not start ${operation}`));
    }
  };

  return <>
    <div className="toolbar"><div><h2>Provider operations</h2>
      <p>Status is Episode-scoped. Viewing this page never sends Episode data to a provider.</p></div>
      <label className="episode-select">Episode<select value={episodeId}
        onChange={(event) => setEpisodeId(event.target.value)}>
        <option value="">Select an Episode</option>
        {episodes.map((episode) => <option key={episode.id} value={episode.id}
          disabled={episode.missing}>{fileName(episode.sourcePath)}{episode.missing ? " · source missing" : ""}</option>)}
      </select></label>
    </div>
    {!episodeId ? <div className="empty compact-empty"><h2>Select an Episode</h2>
      <p>Provider readiness and transcript-dependent actions will appear here.</p></div> :
      <div className="provider-layout">
        <section className="provider-status-grid" aria-label="Provider readiness">
          {statuses.map((status) => <article key={status.provider}>
            <h3>{status.provider}</h3>
            <span className={`ready-state ${status.configured ? "ready" : "blocked"}`}>
              {status.configured ? "Configured" : "Unavailable"}
            </span>
            <small>Transcription: {status.transcriptionReady ? "ready" : "not ready"} · Analysis: {status.analysisReady ? "ready" : "not ready"}</small>
            {status.detail && <p>{status.detail}</p>}
          </article>)}
        </section>
        <div className="operation-grid">
          <form className="operation-card" onSubmit={(event) => {
            event.preventDefault(); void run("transcription");
          }}>
            <h2>Transcribe</h2>
            <label>Provider<select value={transcriptionProvider} onChange={(event) => {
              const next = event.target.value as "local" | "openai";
              setTranscriptionProvider(next);
              setSpeechMode("transcription");
              setTranscriptionModel(defaults[next]?.transcription ?? "");
            }}><option value="local">Local faster-whisper</option><option value="openai">OpenAI</option></select></label>
            {transcriptionProvider === "openai" && <label>Speech mode<select value={speechMode}
              onChange={(event) => {
                const next = event.target.value as typeof speechMode;
                setSpeechMode(next);
                setTranscriptionModel(defaults.openai?.[
                  next === "diarization" ? "diarization" : "transcription"
                ] ?? "");
                if (next === "diarization") setWordTimestamps(false);
              }}><option value="transcription">Transcription</option>
              <option value="diarization">Speaker diarization</option></select></label>}
            <label>Exact model<input required value={transcriptionModel}
              onChange={(event) => setTranscriptionModel(event.target.value)} /></label>
            <label className="check"><input type="checkbox" checked={wordTimestamps}
              disabled={speechMode === "diarization"}
              onChange={(event) => setWordTimestamps(event.target.checked)} />
              Word timestamps{speechMode === "diarization" ? " are incompatible with diarization" : ""}</label>
            {transcriptionProvider === "openai" && !openAi?.authorization.transcription &&
              <button type="button" className="link-button" onClick={() =>
                openCloudAccess({ episodeId, provider: "openai", operation: "transcription" })
              }>Authorize OpenAI transcription in Cloud Access</button>}
            <button className="primary" disabled={!selectedEpisode || !transcriptionModel}>
              Queue transcription
            </button>
          </form>
          <form className="operation-card" onSubmit={(event) => {
            event.preventDefault(); void run("analysis");
          }}>
            <h2>Analyze accepted transcript</h2>
            {!hasTranscript && <p className="notice">Accept a transcript before analysis becomes available.</p>}
            <label>Provider<select value={analysisProvider} onChange={(event) => {
              const next = event.target.value as "ollama" | "openai";
              setAnalysisProvider(next);
              setAnalysisModel(defaults[next]?.analysis ?? "");
            }}><option value="ollama">Ollama</option><option value="openai">OpenAI</option></select></label>
            {analysisProvider === "ollama" && <label>Endpoint<input required type="url"
              value={ollamaUrl} onChange={(event) => setOllamaUrl(event.target.value)} /></label>}
            <label>Exact model<input required value={analysisModel}
              onChange={(event) => setAnalysisModel(event.target.value)} /></label>
            {endpointStatus && analysisProvider === "ollama" && <div className="endpoint-status">
              <strong>{endpointStatus.providerClass === "local" ? "Local endpoint" :
                endpointStatus.providerClass === "network" ? "Private-network endpoint" : "Public endpoint"}</strong>
              <small>{endpointStatus.baseUrl}</small>
              {endpointStatus.requiresNetworkDisclosure && <label className="check">
                <input type="checkbox" checked={networkDisclosed}
                  onChange={(event) => setNetworkDisclosed(event.target.checked)} />
                For this operation, send the accepted transcript and sampled frames to this private endpoint.
              </label>}
              {endpointStatus.requiresCloudAuthorization && <button type="button" className="link-button"
                onClick={() => openCloudAccess({ episodeId, provider: "ollama", operation: "analysis" })}>
                Authorize public Ollama in Cloud Access
              </button>}
            </div>}
            {analysisProvider === "openai" && !openAi?.authorization.analysis &&
              <button type="button" className="link-button" onClick={() =>
                openCloudAccess({ episodeId, provider: "openai", operation: "analysis" })
              }>Authorize OpenAI analysis in Cloud Access</button>}
            <button className="primary" disabled={!hasTranscript || !analysisModel ||
              (endpointStatus?.requiresNetworkDisclosure === true && !networkDisclosed)}>
              Queue analysis
            </button>
          </form>
        </div>
        <JobList jobs={activeJobs} refresh={refresh} announce={announce} />
      </div>}
  </>;
}

function JobList({ jobs, refresh, announce }: {
  jobs: Job[];
  refresh(): Promise<void>;
  announce(message: string): void;
}) {
  if (!jobs.length) return null;
  return <section className="job-list"><h2>Recent provider jobs</h2>
    <ul>{jobs.map((job) => <li key={job.id}>
      <div><strong>{job.provider ?? "local"} · {job.stage}</strong>
        <small>{job.state} · {Math.round(job.progress * 100)}% · attempt {job.attempts}</small>
        {job.errorMessage && <span className="folder-error">{job.errorMessage} {
          job.errorCode === "PROVIDER_UNAVAILABLE" || job.errorCode === "DEPENDENCY_UNAVAILABLE"
            ? "Check the provider and retry with the same model." : ""
        }</span>}</div>
      {(job.state === "queued" || job.state === "running") &&
        <button className="secondary danger" onClick={async () => {
          try {
            await api.cancelJob(job.id);
            announce("Job cancellation requested.");
            await refresh();
          } catch (error) {
            announce(errorMessage(error, "Could not cancel job"));
          }
        }}>{job.cancelRequested ? "Cancelling…" : "Cancel"}</button>}
    </li>)}</ul>
  </section>;
}

function EmptyLibrary({ onImport }: { onImport(): void }) {
  return <div className="empty"><div className="empty-icon" aria-hidden="true">▶</div>
    <h2>Turn long episodes into focused Shorts</h2>
    <p>Import readable video media to create a local proxy, transcript, highlight candidates, and tracked vertical crops.</p>
    <button className="primary" onClick={onImport}>Choose video files</button>
    <small>MP4 with H.264/AAC is guaranteed; other readable video formats are best effort.</small>
  </div>;
}

const formatExpiry = (value?: string) => value
  ? `at ${new Date(value).toLocaleTimeString()}`
  : "soon";
