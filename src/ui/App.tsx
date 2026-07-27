import { useCallback, useEffect, useMemo, useState } from "react";
import type { Episode, Job } from "../shared/domain";
import { api } from "./api";

type View = "Library" | "Candidates" | "Editor" | "Calendar";
declare global {
  interface Window {
    desktop?: { selectMedia(): Promise<string[]> };
  }
}

export function App() {
  const [view, setView] = useState<View>("Library");
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Connecting to local core…");

  const refresh = useCallback(async () => {
    try {
      const [episodeRows, jobRows] = await Promise.all([api.episodes(search), api.jobs()]);
      setEpisodes(episodeRows);
      setJobs(jobRows);
      setMessage(episodeRows.length ? `${episodeRows.length} episode${episodeRows.length === 1 ? "" : "s"} ready to manage` : "Import an episode to begin");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Core service unavailable");
    } finally { setLoading(false); }
  }, [search]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!jobs.some((job) => job.state === "queued" || job.state === "running")) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [jobs, refresh]);

  const importMedia = async () => {
    const selected = await window.desktop?.selectMedia() ?? [];
    if (!selected.length) return;
    setMessage("Importing media…");
    try {
      const result = await api.importPaths(selected);
      setMessage(
        `Imported ${result.imported.length}; found ${result.duplicates.length} duplicate${
          result.duplicates.length === 1 ? "" : "s"
        }; rejected ${result.rejected.length}`
      );
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed"); }
  };

  const totals = useMemo(() => ({
    candidates: episodes.reduce((sum, episode) => sum + episode.candidateCount, 0),
    rendered: episodes.reduce((sum, episode) => sum + episode.renderedShortCount, 0),
    scheduled: episodes.reduce((sum, episode) => sum + episode.scheduledCount, 0)
  }), [episodes]);

  return (
    <div className="shell">
      <aside aria-label="Primary navigation">
        <div className="brand"><span aria-hidden="true">S</span><strong>Short Editor</strong></div>
        <nav>
          {(["Library", "Candidates", "Editor", "Calendar"] as View[]).map((item) => (
            <button key={item} aria-current={view === item ? "page" : undefined} onClick={() => setView(item)}>
              <span aria-hidden="true">{icons[item]}</span>{item}
            </button>
          ))}
        </nav>
        <div className="privacy"><span className="dot" />Local mode<br /><small>No cloud requests</small></div>
      </aside>
      <main>
        <header>
          <div><p className="eyebrow">Production workspace</p><h1>{view}</h1></div>
          <button className="primary" onClick={importMedia} aria-label="Import video episodes">＋ Import episodes</button>
        </header>
        <div className="status" role="status" aria-live="polite">{loading ? "Loading…" : message}</div>
        {view === "Library" ? (
          <>
            <section className="metrics" aria-label="Library summary">
              <Metric label="Episodes" value={episodes.length} />
              <Metric label="Candidates" value={totals.candidates} />
              <Metric label="Rendered" value={totals.rendered} />
              <Metric label="Scheduled" value={totals.scheduled} />
            </section>
            <section className="panel">
              <div className="toolbar">
                <div><h2>Episode inventory</h2><p>Sources stay in place. Your originals are never modified.</p></div>
                <label className="search"><span className="sr-only">Search episodes</span>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search episodes" />
                </label>
              </div>
              {episodes.length ? <EpisodeTable episodes={episodes} onAnalyze={async (episode) => {
                setMessage(`Queued local analysis for ${fileName(episode.sourcePath)}`);
                await api.startAnalysis(episode.id);
                await refresh();
              }} /> : <EmptyLibrary onImport={importMedia} />}
            </section>
          </>
        ) : <ComingSoon view={view} />}
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}

function EpisodeTable({ episodes, onAnalyze }: { episodes: Episode[]; onAnalyze(episode: Episode): void }) {
  return <div className="table-wrap"><table>
    <thead><tr><th>Episode</th><th>Status</th><th>Format</th><th>Candidates</th><th><span className="sr-only">Actions</span></th></tr></thead>
    <tbody>{episodes.map((episode) => <tr key={episode.id}>
      <td><strong>{fileName(episode.sourcePath)}</strong><small>{episode.sourcePath}</small></td>
      <td><span className={`pill ${episode.status}`}>{episode.status.replace("_", " ")}</span></td>
      <td>{episode.width ? `${episode.width}×${episode.height}` : "Pending probe"}</td>
      <td>{episode.candidateCount}</td>
      <td><button className="secondary" onClick={() => onAnalyze(episode)} disabled={episode.missing}
        aria-label={`Analyze ${fileName(episode.sourcePath)}`}>Analyze</button></td>
    </tr>)}</tbody>
  </table></div>;
}

function EmptyLibrary({ onImport }: { onImport(): void }) {
  return <div className="empty">
    <div className="empty-icon" aria-hidden="true">▶</div>
    <h2>Turn long episodes into focused Shorts</h2>
    <p>Import readable video media to create a local proxy, transcript, highlight candidates, and tracked vertical crops.</p>
    <button className="primary" onClick={onImport}>Choose video files</button>
    <small>MP4 with H.264/AAC is guaranteed; other readable video formats are best effort.</small>
  </div>;
}

function ComingSoon({ view }: { view: View }) {
  const copy = {
    Candidates: "Generate and review sentence-aligned highlight proposals after an episode has a transcript.",
    Editor: "Approved candidates open in the normalized 1080×1920 composition editor.",
    Calendar: "Approved, validated renders can be assigned to deterministic legal publishing slots.",
    Library: ""
  }[view];
  return <section className="panel empty"><div className="empty-icon" aria-hidden="true">◇</div><h2>{view} workspace</h2><p>{copy}</p></section>;
}

const icons: Record<View, string> = { Library: "▦", Candidates: "✦", Editor: "◫", Calendar: "□" };
const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;
