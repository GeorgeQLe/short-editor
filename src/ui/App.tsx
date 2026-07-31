import { useCallback, useEffect, useMemo, useState } from "react";
import type { Episode, Job, ProviderCapability, WatchedFolder } from "../shared/domain";
import { api, type ImportBatchResult } from "./api";
import { CloudAccess, type CloudAccessTarget } from "./CloudAccess";
import { CandidatesWorkspace } from "./CandidatesWorkspace";
import { LibraryWorkspace, type LibraryTab } from "./LibraryWorkspace";
import { EditorWorkspace } from "./EditorWorkspace";
import { CalendarWorkspace } from "./CalendarWorkspace";
import { SupportCenter } from "./SupportCenter";
import "./desktop";
import { errorMessage } from "./utils";

type View = "Library" | "Candidates" | "Editor" | "Calendar" | "Cloud Access" |
  "Setup" | "Recovery" | "About";

const siftCutLogoUrl = new URL(
  "../../resources/branding/siftcut-app-icon-master.svg",
  import.meta.url,
).href;

export function App() {
  const [view, setView] = useState<View>("Library");
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("episodes");
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [folders, setFolders] = useState<WatchedFolder[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [capabilities, setCapabilities] = useState<ProviderCapability[] | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Connecting to local core…");
  const [importResult, setImportResult] = useState<ImportBatchResult | null>(null);
  const [cloudTarget, setCloudTarget] = useState<CloudAccessTarget | undefined>();

  const refresh = useCallback(async () => {
    try {
      const [episodeRows, folderRows, jobRows] = await Promise.all([
        api.episodes(search), api.watchedFolders(), api.jobs()
      ]);
      setEpisodes(episodeRows);
      setFolders(folderRows);
      setJobs(jobRows);
      setMessage(episodeRows.length
        ? `${episodeRows.length} episode${episodeRows.length === 1 ? "" : "s"} ready to manage`
        : "Import an episode or add a watched folder to begin");
    } catch (error) {
      setMessage(errorMessage(error, "Core service unavailable"));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!jobs.some((job) => job.state === "queued" || job.state === "running")) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [jobs, refresh]);
  useEffect(() => {
    if (libraryTab !== "providers" || capabilities) return;
    void api.providerCapabilities()
      .then(setCapabilities)
      .catch((error) => setMessage(errorMessage(error, "Provider capabilities unavailable")));
  }, [capabilities, libraryTab]);

  const importMedia = async () => {
    const selected = await window.desktop?.selectMedia() ?? [];
    if (!selected.length) return;
    setMessage("Importing media…");
    try {
      const result = await api.importPaths(selected);
      setImportResult(result);
      setMessage(
        `Import finished: ${result.imported.length} imported, ${result.duplicates.length} duplicate, ` +
        `${result.relinked.length} relinked, ${result.rejected.length} rejected.`
      );
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error, "Import failed"));
    }
  };

  const totals = useMemo(() => ({
    candidates: episodes.reduce((sum, episode) => sum + episode.candidateCount, 0),
    rendered: episodes.reduce((sum, episode) => sum + episode.renderedShortCount, 0),
    scheduled: episodes.reduce((sum, episode) => sum + episode.scheduledCount, 0)
  }), [episodes]);

  const openCloudAccess = (target: CloudAccessTarget) => {
    setCloudTarget(target);
    setView("Cloud Access");
  };

  return (
    <div className="shell">
      <aside aria-label="Primary navigation">
        <div className="brand">
          <img src={siftCutLogoUrl} alt="" aria-hidden="true" />
          <strong>SiftCut</strong>
        </div>
        <nav>
          {(["Library", "Candidates", "Editor", "Calendar", "Cloud Access", "Setup",
            "Recovery", "About"] as View[]).map((item) => (
            <button key={item} aria-current={view === item ? "page" : undefined}
              onClick={() => setView(item)}>
              <span aria-hidden="true">{icons[item]}</span>{item}
            </button>
          ))}
        </nav>
        <div className="privacy"><span className="dot" />Local mode<br /><small>Cloud use requires consent</small></div>
      </aside>
      <main>
        <header>
          <div><p className="eyebrow">Production workspace</p><h1>{view}</h1></div>
          {view === "Library" && <button className="primary" onClick={importMedia}
            aria-label="Import video episodes">＋ Import episodes</button>}
        </header>
        <div className="status" role="status" aria-live="polite">
          {loading ? "Loading…" : message}
        </div>
        {view === "Library" ? (
          <>
            <section className="metrics" aria-label="Library summary">
              <Metric label="Episodes" value={episodes.length} />
              <Metric label="Candidates" value={totals.candidates} />
              <Metric label="Rendered" value={totals.rendered} />
              <Metric label="Scheduled" value={totals.scheduled} />
            </section>
            <LibraryWorkspace
              tab={libraryTab}
              onTabChange={setLibraryTab}
              episodes={episodes}
              folders={folders}
              jobs={jobs}
              capabilities={capabilities ?? []}
              search={search}
              onSearch={setSearch}
              importResult={importResult}
              onImport={importMedia}
              refresh={refresh}
              announce={setMessage}
              openCloudAccess={openCloudAccess}
            />
          </>
        ) : view === "Candidates" ? (
          <CandidatesWorkspace episodes={episodes} announce={setMessage} onChanged={refresh} />
        ) : view === "Editor" ? (
          <EditorWorkspace episodes={episodes} announce={setMessage} onChanged={refresh}
            onOpenLibrary={() => {
              setLibraryTab("episodes");
              setView("Library");
            }} />
        ) : view === "Calendar" ? (
          <CalendarWorkspace announce={setMessage} onChanged={refresh} />
        ) : view === "Cloud Access" ? (
          <CloudAccess
            episodes={episodes}
            target={cloudTarget}
            announce={setMessage}
            onChanged={refresh}
          />
        ) : view === "Setup" || view === "Recovery" || view === "About" ? (
          <SupportCenter section={view} jobs={jobs} announce={setMessage}
            onRefresh={refresh} onOpenLibrary={() => {
              setLibraryTab("episodes");
              setView("Library");
            }} />
        ) : null}
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}

const icons: Record<View, string> = {
  Library: "▦", Candidates: "✦", Editor: "◫", Calendar: "□", "Cloud Access": "⌁",
  Setup: "✓", Recovery: "↻", About: "ⓘ"
};
