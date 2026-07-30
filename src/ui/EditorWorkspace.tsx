import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import type {
  Asset,
  Candidate,
  Composition,
  Episode,
  ShortProject,
  Template
} from "../shared/domain";
import { ApiClientError, api } from "./api";
import {
  contentFromShort,
  createHistory,
  cropControlsPastDuration,
  dirtySections,
  effectiveCrop,
  historyContent,
  mapOutputToSource,
  mergeCanonicalSave,
  outputDuration,
  pushHistory,
  redoHistory,
  undoHistory,
  type EditorContent,
  type EditorHistory,
  type EditorSection
} from "./editor-state";
import { errorMessage } from "./utils";

interface Props {
  episodes: Episode[];
  announce(message: string): void;
  onChanged(): Promise<void>;
}

type EditorTab = "Timeline" | "Composition & Crops" | "Captions" | "Audio";

export function EditorWorkspace({ episodes, announce, onChanged }: Props) {
  const [shorts, setShorts] = useState<ShortProject[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [project, setProject] = useState<ShortProject | null>(null);
  const [baseline, setBaseline] = useState<EditorContent | null>(null);
  const [draft, setDraft] = useState<EditorContent | null>(null);
  const [history, setHistory] = useState<EditorHistory | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshLauncher = useCallback(async () => {
    try {
      const [shortRows, templateRows, assetRows, candidateGroups] = await Promise.all([
        api.shorts(),
        api.templates(),
        api.assets(),
        Promise.all(episodes.map((episode) => api.candidates(episode.id).catch(() => [])))
      ]);
      setShorts(shortRows);
      setTemplates(templateRows);
      setAssets(assetRows);
      setCandidates(candidateGroups.flat().filter((candidate) =>
        candidate.reviewStatus === "approved" && candidate.state === "active"
      ));
      setSelectedTemplate((current) => current || templateRows[0]?.id || "");
    } catch (error) {
      announce(errorMessage(error, "Editor projects unavailable"));
    }
  }, [announce, episodes]);

  useEffect(() => { void refreshLauncher(); }, [refreshLauncher]);

  const openProject = useCallback((next: ShortProject) => {
    if (draft && baseline && dirtySections(baseline, draft).size &&
      !window.confirm("Discard unsaved editor changes and switch projects?")) return;
    const content = contentFromShort(next);
    setProject(next);
    setBaseline(content);
    setDraft(content);
    setHistory(createHistory(content));
    setConflict(false);
    announce(`Opened “${next.title}” at revision ${next.revision}.`);
  }, [announce, baseline, draft]);

  const createProject = async (candidate: Candidate) => {
    if (!selectedTemplate) {
      announce("Select a template before creating a Short.");
      return;
    }
    const duplicate = shorts.some((short) => short.candidateId === candidate.id);
    if (duplicate && !window.confirm(
      "This Candidate already has a Short. Create an explicit duplicate project?"
    )) return;
    setBusy(true);
    try {
      const created = await api.createShort(candidate.id, selectedTemplate);
      await Promise.all([refreshLauncher(), onChanged()]);
      openProject(created);
    } catch (error) {
      announce(errorMessage(error, "Short creation failed"));
    } finally {
      setBusy(false);
    }
  };

  if (!project || !baseline || !draft || !history) {
    return <EditorLauncher
      shorts={shorts}
      candidates={candidates}
      templates={templates}
      episodes={episodes}
      selectedTemplate={selectedTemplate}
      setSelectedTemplate={setSelectedTemplate}
      openProject={openProject}
      createProject={createProject}
      cloneTemplate={async (template) => {
        const name = window.prompt("Name for the cloned template", `${template.name} copy`);
        if (!name?.trim()) return;
        try {
          const cloned = await api.cloneTemplate(template.id, name.trim(), template.description);
          await refreshLauncher();
          setSelectedTemplate(cloned.id);
          announce(`Cloned template “${cloned.name}”.`);
        } catch (error) {
          announce(errorMessage(error, "Template clone failed"));
        }
      }}
      editTemplate={async (template) => {
        if (template.builtIn) {
          announce("Built-in templates are immutable. Clone this template to edit it.");
          return;
        }
        const name = window.prompt("Template name", template.name);
        if (!name?.trim()) return;
        try {
          await api.updateTemplate(template.id, template.revision, { name: name.trim() });
          await refreshLauncher();
          announce("Template metadata updated.");
        } catch (error) {
          announce(errorMessage(error, "Template update failed"));
        }
      }}
      busy={busy}
    />;
  }

  return <ProjectEditor
    project={project}
    setProject={setProject}
    baseline={baseline}
    setBaseline={setBaseline}
    draft={draft}
    setDraft={setDraft}
    history={history}
    setHistory={setHistory}
    conflict={conflict}
    setConflict={setConflict}
    episodes={episodes}
    templates={templates}
    assets={assets}
    setAssets={setAssets}
    announce={announce}
    close={() => {
      if (dirtySections(baseline, draft).size &&
        !window.confirm("Discard unsaved editor changes and return to projects?")) return;
      setProject(null);
    }}
  />;
}

function EditorLauncher(props: {
  shorts: ShortProject[];
  candidates: Candidate[];
  templates: Template[];
  episodes: Episode[];
  selectedTemplate: string;
  setSelectedTemplate(value: string): void;
  openProject(short: ShortProject): void;
  createProject(candidate: Candidate): void;
  cloneTemplate(template: Template): void;
  editTemplate(template: Template): void;
  busy: boolean;
}) {
  const episodeName = (id: string) => fileName(props.episodes.find((row) => row.id === id)?.sourcePath);
  return <section className="panel editor-launcher">
    <div className="launcher-section">
      <h2>Open a Short project</h2>
      <p>Projects are durable and remain available after restarting the app.</p>
      {props.shorts.length ? <div className="project-grid">
        {props.shorts.map((short) => <article key={short.id}>
          <div><strong>{short.title}</strong><small>{episodeName(short.episodeId)}</small></div>
          <span className={`pill ${short.approved ? "ready" : ""}`}>
            {short.approved ? "approved" : `revision ${short.revision}`}
          </span>
          <button className="secondary" onClick={() => props.openProject(short)}>Open editor</button>
        </article>)}
      </div> : <div className="compact-empty">No Short projects yet.</div>}
    </div>
    <div className="launcher-section">
      <div className="launcher-heading">
        <div><h2>Create from an approved Candidate</h2>
          <p>A template is required. Existing Candidate projects are clearly marked.</p></div>
        <label>Template
          <select value={props.selectedTemplate}
            onChange={(event) => props.setSelectedTemplate(event.target.value)}>
            <option value="">Select template…</option>
            {props.templates.map((template) =>
              <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          <span className="template-actions">
            <button className="link-button" type="button" disabled={!props.selectedTemplate}
              onClick={() => {
                const template = props.templates.find((row) => row.id === props.selectedTemplate);
                if (template) props.cloneTemplate(template);
              }}>Clone</button>
            <button className="link-button" type="button" disabled={!props.selectedTemplate}
              onClick={() => {
                const template = props.templates.find((row) => row.id === props.selectedTemplate);
                if (template) props.editTemplate(template);
              }}>Edit</button>
          </span>
        </label>
      </div>
      <div className="candidate-create-list">
        {props.candidates.map((candidate) => {
          const count = props.shorts.filter((short) => short.candidateId === candidate.id).length;
          return <article key={candidate.id}>
            <div><strong>{candidate.topic}</strong>
              <small>{episodeName(candidate.episodeId)} · {formatMs(candidate.endMs - candidate.startMs)}</small>
              <p>{candidate.hook}</p></div>
            {count > 0 && <span className="notice">{count} existing</span>}
            <button className="primary" disabled={props.busy || !props.selectedTemplate}
              onClick={() => props.createProject(candidate)}>
              {count ? "Create duplicate…" : "Create Short"}
            </button>
          </article>;
        })}
        {!props.candidates.length && <div className="compact-empty">
          Approve an active Candidate to make it eligible.
        </div>}
      </div>
    </div>
  </section>;
}

function ProjectEditor(props: {
  project: ShortProject;
  setProject: Dispatch<SetStateAction<ShortProject | null>>;
  baseline: EditorContent;
  setBaseline: Dispatch<SetStateAction<EditorContent | null>>;
  draft: EditorContent;
  setDraft: Dispatch<SetStateAction<EditorContent | null>>;
  history: EditorHistory;
  setHistory: Dispatch<SetStateAction<EditorHistory | null>>;
  conflict: boolean;
  setConflict(value: boolean): void;
  episodes: Episode[];
  templates: Template[];
  assets: Asset[];
  setAssets: Dispatch<SetStateAction<Asset[]>>;
  announce(message: string): void;
  close(): void;
}) {
  const [tab, setTab] = useState<EditorTab>("Timeline");
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState<EditorSection | "reanalyze" | null>(null);
  const [sectionError, setSectionError] = useState<Partial<Record<EditorSection, string>>>({});
  const [forcedDirty, setForcedDirty] = useState<Set<EditorSection>>(new Set());
  const dirty = useMemo(
    () => new Set([...dirtySections(props.baseline, props.draft), ...forcedDirty]),
    [forcedDirty, props.baseline, props.draft]
  );
  const duration = outputDuration(props.draft.sourceRanges);
  const episode = props.episodes.find((row) => row.id === props.project.episodeId);
  const mediaUrl = window.desktop?.mediaUrl?.("episode", props.project.episodeId) ?? "";

  const commit = useCallback((
    transform: (content: EditorContent) => EditorContent,
    coalesce = false
  ) => {
    const next = transform(structuredClone(props.draft));
    props.setDraft(next);
    props.setHistory((current) => pushHistory(current ?? createHistory(next), next, coalesce));
  }, [props]);

  const undo = useCallback(() => {
    props.setHistory((current) => {
      if (!current) return current;
      const next = undoHistory(current);
      props.setDraft(historyContent(next));
      return next;
    });
  }, [props]);
  const redo = useCallback(() => {
    props.setHistory((current) => {
      if (!current) return current;
      const next = redoHistory(current);
      props.setDraft(historyContent(next));
      return next;
    });
  }, [props]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [redo, undo]);

  useEffect(() => {
    if (!playing) return;
    const startedAt = performance.now();
    const initial = playhead;
    const timer = window.setInterval(() => {
      const next = Math.min(duration, initial + performance.now() - startedAt);
      setPlayhead(next);
      if (next >= duration) setPlaying(false);
    }, 33);
    return () => clearInterval(timer);
  }, [duration, playing]);

  const save = async (section: EditorSection) => {
    if (props.conflict) return;
    if (section === "timeline") {
      const validation = timelineError(props.draft.sourceRanges, episode?.durationMs ?? null);
      if (validation) {
        setSectionError((old) => ({ ...old, timeline: validation }));
        return;
      }
      const staleCrops = cropControlsPastDuration(props.draft.composition, duration);
      if (staleCrops.length) {
        setSectionError((old) => ({
          ...old,
          timeline: `Trim ${staleCrops.length} manual crop control(s) beyond ${formatMs(duration)} before saving.`
        }));
        return;
      }
    }
    setSaving(section);
    setSectionError((old) => ({ ...old, [section]: undefined }));
    const dirtyBefore = new Set([
      ...dirtySections(props.baseline, props.draft),
      ...forcedDirty
    ]);
    try {
      const canonical = section === "timeline"
        ? await api.updateTimeline(props.project.id, props.project.revision, props.draft.sourceRanges)
        : section === "composition"
          ? await api.updateComposition(
            props.project.id, props.project.revision, props.draft.composition
          )
          : section === "captions"
            ? (await api.updateCaptions(props.project.id, props.project.revision, {
              enabled: props.draft.captions.enabled,
              cues: props.draft.captions.cues,
              style: props.draft.captions.style
            })).short
            : (await api.updateAudio(props.project.id, props.project.revision, {
              sourceGainDb: props.draft.audio.sourceGainDb,
              sourceMuted: props.draft.audio.sourceMuted,
              cutFadeMs: props.draft.audio.cutFadeMs,
              bedAssetId: props.draft.audio.bedAssetId,
              bedGainDb: props.draft.audio.bedGainDb
            })).short;
      const merged = mergeCanonicalSave(props.draft, canonical, section, dirtyBefore);
      props.setProject(canonical);
      props.setBaseline(merged.baseline);
      props.setDraft(merged.draft);
      props.setHistory((current) => pushHistory(current ?? createHistory(merged.draft), merged.draft));
      setForcedDirty((current) => {
        const next = new Set(current);
        next.delete(section);
        if (section === "timeline") next.add("captions");
        return next;
      });
      props.announce(
        `${label(section)} saved as revision ${canonical.revision}; approval and prior renders are invalidated.`
      );
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "REVISION_CONFLICT") {
        props.setConflict(true);
      }
      setSectionError((old) => ({ ...old, [section]: errorMessage(error, "Save failed") }));
    } finally {
      setSaving(null);
    }
  };

  const loadLatest = async (rebase: boolean) => {
    try {
      const latest = await api.short(props.project.id);
      const latestContent = contentFromShort(latest);
      let next = latestContent;
      if (rebase) {
        next = structuredClone(latestContent);
        for (const section of dirty) {
          if (section === "timeline") next.sourceRanges = structuredClone(props.draft.sourceRanges);
          else if (section === "composition") {
            next.composition = structuredClone(props.draft.composition);
          } else if (section === "captions") {
            next.captions = structuredClone(props.draft.captions);
          } else {
            next.audio = structuredClone(props.draft.audio);
          }
        }
      }
      props.setProject(latest);
      props.setBaseline(latestContent);
      props.setDraft(next);
      props.setHistory(createHistory(next));
      setForcedDirty(rebase ? new Set(forcedDirty) : new Set());
      props.setConflict(false);
      props.announce(rebase
        ? `Rebased local drafts onto revision ${latest.revision}.`
        : `Loaded revision ${latest.revision}; local drafts were discarded.`);
    } catch (error) {
      props.announce(errorMessage(error, "Latest revision unavailable"));
    }
  };

  const reanalyze = async (layerId: string) => {
    if (dirty.has("composition") || props.conflict) return;
    setSaving("reanalyze");
    try {
      const canonical = await api.reanalyzeCrops(
        props.project.id, props.project.revision, [layerId]
      );
      const dirtyBefore = new Set([
        ...dirtySections(props.baseline, props.draft),
        ...forcedDirty
      ]);
      const merged = mergeCanonicalSave(props.draft, canonical, "composition", dirtyBefore);
      props.setProject(canonical);
      props.setBaseline(merged.baseline);
      props.setDraft(merged.draft);
      props.setHistory((current) => pushHistory(
        current ?? createHistory(merged.draft), merged.draft
      ));
      setForcedDirty((current) => {
        const next = new Set(current);
        next.delete("composition");
        return next;
      });
      props.announce(`Crop analysis refreshed at revision ${canonical.revision}.`);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "REVISION_CONFLICT") {
        props.setConflict(true);
      }
      setSectionError((old) => ({ ...old, composition: errorMessage(error, "Reanalysis failed") }));
    } finally {
      setSaving(null);
    }
  };

  return <section className="editor-workspace">
    <div className="editor-toolbar">
      <button className="secondary" onClick={props.close}>← Projects</button>
      <div><strong>{props.project.title}</strong>
        <small>Revision {props.project.revision} · {dirty.size ? `${dirty.size} unsaved section(s)` : "Saved"}</small></div>
      <div className="history-actions">
        <button className="secondary" disabled={props.history.index === 0} onClick={undo}>Undo</button>
        <button className="secondary"
          disabled={props.history.index >= props.history.entries.length - 1} onClick={redo}>Redo</button>
      </div>
    </div>
    {props.conflict && <div className="conflict-box editor-conflict">
      <strong>A newer server revision exists. Your drafts are retained and saves are paused.</strong>
      <span>Load latest to discard drafts, or rebase every dirty section onto it.</span>
      <div><button className="secondary" onClick={() => void loadLatest(false)}>Load latest</button>
        <button className="primary" onClick={() => void loadLatest(true)}>Rebase drafts</button></div>
    </div>}
    <div className="editor-grid">
      <Preview
        project={props.project}
        draft={props.draft}
        mediaUrl={mediaUrl}
        playhead={playhead}
        setPlayhead={setPlayhead}
        playing={playing}
        setPlaying={setPlaying}
        assets={props.assets}
      />
      <div className="editor-inspector">
        <div className="tabs editor-tabs" role="tablist">
          {(["Timeline", "Composition & Crops", "Captions", "Audio"] as EditorTab[])
            .map((item) => <button key={item} role="tab" aria-selected={tab === item}
              onClick={() => setTab(item)}>{item}{dirty.has(sectionForTab(item)) ? " •" : ""}</button>)}
        </div>
        {tab === "Timeline" && <TimelineEditor
          ranges={props.draft.sourceRanges}
          episodeDuration={episode?.durationMs ?? null}
          error={sectionError.timeline}
          commit={commit}
          save={() => void save("timeline")}
          disabled={saving !== null || props.conflict}
        />}
        {tab === "Composition & Crops" && <CompositionEditor
          composition={props.draft.composition}
          assets={props.assets}
          templates={props.templates}
          playhead={playhead}
          error={sectionError.composition}
          commit={commit}
          save={() => void save("composition")}
          reanalyze={reanalyze}
          reanalysisDisabled={dirty.has("composition") || saving !== null || props.conflict}
          disabled={saving !== null || props.conflict}
          onAsset={(asset) => props.setAssets((old) => [...old, asset])}
          announce={props.announce}
        />}
        {tab === "Captions" && <CaptionsEditor
          captions={props.draft.captions}
          error={sectionError.captions}
          commit={commit}
          save={() => void save("captions")}
          disabled={saving !== null || props.conflict}
        />}
        {tab === "Audio" && <AudioEditor
          audio={props.draft.audio}
          assets={props.assets}
          error={sectionError.audio}
          commit={commit}
          save={() => void save("audio")}
          disabled={saving !== null || props.conflict}
        />}
      </div>
    </div>
    <div className="published-note">
      Editing creates a new Short revision. Already published schedule records remain immutable;
      draft schedule entries and successful renders are marked for refresh.
    </div>
  </section>;
}

function Preview(props: {
  project: ShortProject;
  draft: EditorContent;
  mediaUrl: string;
  playhead: number;
  setPlayhead(value: number): void;
  playing: boolean;
  setPlaying(value: boolean): void;
  assets: Asset[];
}) {
  const duration = outputDuration(props.draft.sourceRanges);
  const mapping = mapOutputToSource(props.draft.sourceRanges, props.playhead);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  useEffect(() => {
    for (const video of videoRefs.current) {
      if (!video || Math.abs(video.currentTime * 1000 - mapping.sourceAtMs) < 80) continue;
      video.currentTime = mapping.sourceAtMs / 1000;
    }
  }, [mapping.sourceAtMs]);
  useEffect(() => {
    for (const video of videoRefs.current) {
      if (!video) continue;
      if (props.playing) void video.play().catch(() => undefined);
      else video.pause();
    }
  }, [props.playing]);
  const captionsVisible = props.draft.composition.layers.some(
    (layer) => layer.visible && layer.type === "captions"
  );
  const activeCue = props.draft.captions.enabled && captionsVisible
    ? props.draft.captions.cues.find((cue) =>
      mapping.sourceAtMs >= cue.startMs && mapping.sourceAtMs < cue.endMs)
    : null;
  let videoIndex = 0;
  return <div className="preview-column">
    <div className="preview-label">Source/proxy preview · decisions target original media</div>
    <div className="portrait-preview" style={{ background: props.draft.composition.background }}>
      {props.draft.composition.layers.map((layer) => {
        if (!layer.visible) return null;
        const style = {
          left: `${layer.region.x * 100}%`,
          top: `${layer.region.y * 100}%`,
          width: `${layer.region.width * 100}%`,
          height: `${layer.region.height * 100}%`
        };
        if (layer.type === "video" && layer.source === "episode") {
          const index = videoIndex++;
          const crop = effectiveCrop(layer, props.playhead);
          return <div className="preview-layer" style={style} key={layer.id}>
            <video ref={(node) => { videoRefs.current[index] = node; }}
              src={props.mediaUrl} muted playsInline preload="metadata"
              style={crop ? {
                width: `${100 / crop.width}%`, height: `${100 / crop.height}%`,
                left: `${-crop.x / crop.width * 100}%`,
                top: `${-crop.y / crop.height * 100}%`
              } : undefined} />
          </div>;
        }
        if (layer.source === "asset" && layer.assetId) {
          const asset = props.assets.find((row) => row.id === layer.assetId);
          if (!asset) return <div className="preview-layer missing-asset" style={style}
            key={layer.id}>Missing asset</div>;
          const url = window.desktop?.mediaUrl?.("asset", asset.id) ?? "";
          return <div className="preview-layer" style={style} key={layer.id}>
            {asset.kind === "video"
              ? <video src={url} muted loop autoPlay playsInline />
              : <img src={url} alt="" />}
          </div>;
        }
        if (layer.type === "text") {
          const text = layer.content === null ? ""
            : typeof layer.content === "string" ? layer.content : props.project.title;
          return <div key={layer.id} className="preview-text" style={{
            ...style, color: layer.style.color, background: layer.style.backgroundColor,
            fontWeight: layer.style.fontWeight, textAlign: layer.style.align,
            fontSize: `${Math.max(8, layer.style.fontSizePx / 5)}px`
          }}>{layer.style.textTransform === "uppercase" ? text.toUpperCase() : text}</div>;
        }
        return null;
      })}
      {activeCue && <div className="preview-caption" style={{
        left: `${props.draft.captions.style.position.x * 100}%`,
        top: `${props.draft.captions.style.position.y * 100}%`,
        width: `${props.draft.captions.style.maxWidth * 100}%`,
        color: props.draft.captions.style.textColor,
        background: props.draft.captions.style.background.color,
        fontWeight: props.draft.captions.style.fontWeight,
        fontSize: `${Math.max(10, props.draft.captions.style.fontSizePx / 5)}px`
      }}>{props.draft.captions.style.textTransform === "uppercase"
          ? activeCue.text.toUpperCase() : activeCue.text}</div>}
      <div className="safe-area" style={{
        top: `${props.draft.composition.safeArea.top / 19.2}%`,
        right: `${props.draft.composition.safeArea.right / 10.8}%`,
        bottom: `${props.draft.composition.safeArea.bottom / 19.2}%`,
        left: `${props.draft.composition.safeArea.left / 10.8}%`
      }} />
    </div>
    <div className="transport">
      <button className="secondary" onClick={() => props.setPlaying(!props.playing)}>
        {props.playing ? "Pause" : "Play"}
      </button>
      <input aria-label="Short playhead" type="range" min="0" max={Math.max(1, duration)}
        value={Math.min(props.playhead, duration)}
        onChange={(event) => props.setPlayhead(Number(event.target.value))} />
      <output>{formatMs(props.playhead)} / {formatMs(duration)}</output>
    </div>
    <small className="source-time">Range {mapping.rangeIndex + 1} · source {formatMs(mapping.sourceAtMs)}</small>
  </div>;
}

function TimelineEditor(props: {
  ranges: ShortProject["sourceRanges"];
  episodeDuration: number | null;
  error?: string;
  commit(transform: (content: EditorContent) => EditorContent, coalesce?: boolean): void;
  save(): void;
  disabled: boolean;
}) {
  const update = (index: number, field: "startMs" | "endMs", value: number, coalesce = false) =>
    props.commit((draft) => {
      draft.sourceRanges[index] = { ...draft.sourceRanges[index]!, [field]: Math.round(value) };
      return draft;
    }, coalesce);
  return <Section title="Timeline" dirtyText={`${formatMs(outputDuration(props.ranges))} output`}
    error={props.error} save={props.save} disabled={props.disabled}>
    <p>Drag handles or enter exact integer milliseconds. Ranges stay in output order.</p>
    {props.ranges.map((range, index) => <article className="range-card" key={index}>
      <div className="range-heading"><strong>Range {index + 1}</strong>
        {props.ranges.length > 1 && <button className="link-button"
          onClick={() => props.commit((draft) => {
            draft.sourceRanges.splice(index, 1); return draft;
          })}>Remove</button>}</div>
      {props.episodeDuration !== null && <div className="dual-range">
        <input aria-label={`Range ${index + 1} start handle`} type="range" min="0"
          max={props.episodeDuration} value={range.startMs}
          onChange={(event) => update(index, "startMs", Number(event.target.value), true)} />
        <input aria-label={`Range ${index + 1} end handle`} type="range" min="0"
          max={props.episodeDuration} value={range.endMs}
          onChange={(event) => update(index, "endMs", Number(event.target.value), true)} />
      </div>}
      <div className="field-grid two">
        <NumberField label="Start (ms)" value={range.startMs}
          onChange={(value) => update(index, "startMs", value)} />
        <NumberField label="End (ms)" value={range.endMs}
          onChange={(value) => update(index, "endMs", value)} />
      </div>
      <small>{formatMs(range.endMs - range.startMs)}</small>
    </article>)}
    <button className="secondary" onClick={() => props.commit((draft) => {
      const last = draft.sourceRanges[draft.sourceRanges.length - 1]!;
      const max = props.episodeDuration ?? last.endMs + 5_000;
      draft.sourceRanges.push({ startMs: last.endMs, endMs: Math.min(max, last.endMs + 5_000) });
      return draft;
    })}>＋ Add range</button>
  </Section>;
}

function CompositionEditor(props: {
  composition: Composition;
  assets: Asset[];
  templates: Template[];
  playhead: number;
  error?: string;
  commit(transform: (content: EditorContent) => EditorContent, coalesce?: boolean): void;
  save(): void;
  reanalyze(layerId: string): void;
  reanalysisDisabled: boolean;
  disabled: boolean;
  onAsset(asset: Asset): void;
  announce(message: string): void;
}) {
  const [selected, setSelected] = useState(props.composition.layers[0]?.id ?? "");
  const [importPath, setImportPath] = useState("");
  const [provenance, setProvenance] = useState("");
  const [reusable, setReusable] = useState(true);
  const [importing, setImporting] = useState(false);
  const regionGesture = useRef<"move" | "resize" | null>(null);
  const layer = props.composition.layers.find((row) => row.id === selected);
  const updateLayer = (patch: Partial<Composition["layers"][number]>, coalesce = false) =>
    props.commit((draft) => {
      draft.composition.layers = draft.composition.layers.map((row) =>
        row.id === selected ? { ...row, ...patch } as typeof row : row);
      return draft;
    }, coalesce);
  const importAsset = async () => {
    if (!importPath || !provenance.trim()) {
      props.announce("Choose a file and enter a rights/provenance note before importing.");
      return;
    }
    setImporting(true);
    try {
      const asset = await api.importAsset(importPath, provenance, reusable);
      props.onAsset(asset);
      setImportPath(""); setProvenance("");
      props.announce("Asset imported and available to this editor.");
    } catch (error) {
      props.announce(errorMessage(error, "Asset import failed"));
    } finally {
      setImporting(false);
    }
  };
  return <Section title="Composition & Crops" error={props.error}
    save={props.save} disabled={props.disabled}>
    <div className="field-grid two">
      <label>Background<input type="color" value={normalizeColor(props.composition.background)}
        onChange={(event) => props.commit((draft) => {
          draft.composition.background = event.target.value; return draft;
        }, true)} /></label>
      <span className="muted">1080 × 1920 normalized canvas</span>
    </div>
    <details><summary>Safe area</summary>
      <div className="field-grid four">{(["top", "right", "bottom", "left"] as const).map((side) =>
        <NumberField key={side} label={side} value={props.composition.safeArea[side]}
          onChange={(value) => props.commit((draft) => {
            draft.composition.safeArea[side] = Math.max(0, value); return draft;
          })} />)}</div>
    </details>
    <div className="layer-list">
      {props.composition.layers.map((row, index) => <button key={row.id}
        className={row.id === selected ? "selected" : ""} onClick={() => setSelected(row.id)}>
        <span>{row.visible ? "◉" : "○"} {row.id}</span><small>{row.type} · {index + 1}</small>
      </button>)}
    </div>
    {layer && <div className="layer-editor">
      <div className="region-canvas" aria-label="Layer position and size control"
        onPointerDown={(event) => {
          regionGesture.current = (event.target as HTMLElement).dataset.resize === "true"
            ? "resize" : "move";
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          regionGesture.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 1 || regionGesture.current === null) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
          const y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
          const resize = regionGesture.current === "resize";
          updateLayer({
            region: resize
              ? {
                ...layer.region,
                width: clamp(x - layer.region.x, 0.02, 1 - layer.region.x),
                height: clamp(y - layer.region.y, 0.02, 1 - layer.region.y)
              }
              : {
                ...layer.region,
                x: clamp(x - layer.region.width / 2, 0, 1 - layer.region.width),
                y: clamp(y - layer.region.height / 2, 0, 1 - layer.region.height)
              }
          }, true);
        }}>
        <div className="region-box" style={{
          left: `${layer.region.x * 100}%`, top: `${layer.region.y * 100}%`,
          width: `${layer.region.width * 100}%`, height: `${layer.region.height * 100}%`
        }}>
          <span>{layer.id}</span><i data-resize="true" aria-hidden="true" />
        </div>
      </div>
      <div className="field-grid two">
        <label className="check"><input type="checkbox" checked={layer.visible}
          onChange={(event) => updateLayer({ visible: event.target.checked })} />Visible</label>
        <label>Fit<select value={layer.fit}
          onChange={(event) => updateLayer({ fit: event.target.value as "fit" | "fill" })}>
          <option value="fill">Fill</option><option value="fit">Fit</option>
        </select></label>
      </div>
      <div className="field-grid four">{(["x", "y", "width", "height"] as const).map((field) =>
        <NumberField key={field} label={field} value={layer.region[field]} step={0.01}
          onChange={(value) => updateLayer({
            region: { ...layer.region, [field]: clamp(value, 0, 1) }
          }, true)} />)}</div>
      <div className="order-actions">
        <button className="secondary" onClick={() => props.commit((draft) => {
          moveLayer(draft.composition.layers, selected, -1); return draft;
        })}>Move down</button>
        <button className="secondary" onClick={() => props.commit((draft) => {
          moveLayer(draft.composition.layers, selected, 1); return draft;
        })}>Move up</button>
      </div>
      {layer.source === "asset" && <label>Bound asset<select value={layer.assetId ?? ""}
        onChange={(event) => updateLayer({ assetId: event.target.value || null })}>
        <option value="">No asset</option>
        {props.assets.filter((asset) => assetMatchesLayer(asset, layer.type))
          .map((asset) => <option key={asset.id} value={asset.id}>
            {fileName(asset.sourcePath)} · {asset.kind}</option>)}
      </select></label>}
      {layer.type === "text" && <>
        <label>Text<textarea value={typeof layer.content === "string" ? layer.content : ""}
          placeholder={typeof layer.content === "object" ? "Bound to Short title" : ""}
          onChange={(event) => updateLayer({ content: event.target.value }, true)} /></label>
        <div className="field-grid two">
          <NumberField label="Font size" value={layer.style.fontSizePx}
            onChange={(value) => updateLayer({ style: { ...layer.style, fontSizePx: value } })} />
          <label>Color<input type="color" value={normalizeColor(layer.style.color)}
            onChange={(event) => updateLayer({ style: { ...layer.style, color: event.target.value } })} /></label>
        </div>
      </>}
      {layer.type === "video" && <CropEditor layer={layer} playhead={props.playhead}
        commit={props.commit} reanalyze={() => props.reanalyze(layer.id)}
        disabled={props.reanalysisDisabled} />}
    </div>}
    <details className="asset-import"><summary>Import an asset</summary>
      <p>Imports reference the selected file in place and are not part of Undo/Redo.</p>
      <div className="input-action"><input value={importPath} readOnly placeholder="Choose a supported file" />
        <button className="secondary" onClick={async () =>
          setImportPath(await window.desktop?.selectAsset?.() ?? "")}>Choose…</button></div>
      <label>Rights / provenance note<textarea value={provenance}
        onChange={(event) => setProvenance(event.target.value)}
        placeholder="Licensed from…, created by…, public domain…" /></label>
      <label className="check"><input type="checkbox" checked={reusable}
        onChange={(event) => setReusable(event.target.checked)} />Reusable across Shorts</label>
      <button className="primary" disabled={importing || !provenance.trim() || !importPath}
        onClick={() => void importAsset()}>Import asset</button>
    </details>
  </Section>;
}

function CropEditor(props: {
  layer: Extract<Composition["layers"][number], { type: "video" }>;
  playhead: number;
  commit(transform: (content: EditorContent) => EditorContent, coalesce?: boolean): void;
  reanalyze(): void;
  disabled: boolean;
}) {
  const crop = effectiveCrop(props.layer, props.playhead);
  const add = (mode: "crop" | "automatic") => props.commit((draft) => {
    const target = draft.composition.layers.find((row) => row.id === props.layer.id);
    if (target?.type !== "video") return draft;
    const atMs = Math.round(props.playhead);
    target.manualCropTrack = target.manualCropTrack.filter((control) => control.atMs !== atMs);
    target.manualCropTrack.push(mode === "automatic"
      ? { id: crypto.randomUUID(), mode, atMs }
      : { id: crypto.randomUUID(), mode, atMs, ...(crop ?? { x: 0, y: 0, width: 1, height: 1 }) });
    target.manualCropTrack.sort((left, right) => left.atMs - right.atMs);
    return draft;
  });
  return <div className="crop-editor">
    <div className="crop-status">
      <strong>Effective crop at {formatMs(props.playhead)}</strong>
      <small>{props.layer.automaticCropTrack.provenance
        ? `Automatic · ${props.layer.automaticCropTrack.provenance.generatorVersion}`
        : `Fallback · ${props.layer.automaticCropTrack.fallback.reason}`}</small>
    </div>
    {crop && <div className="field-grid four">{(["x", "y", "width", "height"] as const).map((key) =>
      <output key={key}>{key}: {crop[key].toFixed(3)}</output>)}</div>}
    <div className="order-actions">
      <button className="secondary" onClick={() => add("crop")}>＋ Manual crop here</button>
      <button className="secondary" onClick={() => add("automatic")}>Resume automatic</button>
      <button className="secondary" disabled={props.disabled} onClick={props.reanalyze}>
        Reanalyze crop
      </button>
    </div>
    {props.layer.manualCropTrack.map((control) => <article className="crop-control" key={control.id}>
      <strong>{control.mode === "crop" ? "Manual" : "Automatic resume"}</strong>
      <NumberField label="At (ms)" value={control.atMs} onChange={(value) =>
        props.commit((draft) => {
          const target = draft.composition.layers.find((row) => row.id === props.layer.id);
          if (target?.type !== "video") return draft;
          const item = target.manualCropTrack.find((row) => row.id === control.id);
          if (item) item.atMs = Math.max(0, Math.round(value));
          target.manualCropTrack.sort((a, b) => a.atMs - b.atMs);
          return draft;
        })} />
      {control.mode === "crop" && <div className="field-grid four">
        {(["x", "y", "width", "height"] as const).map((field) =>
          <NumberField key={field} label={field} value={control[field]} step={0.01}
            onChange={(value) => props.commit((draft) => {
              const target = draft.composition.layers.find((row) => row.id === props.layer.id);
              if (target?.type !== "video") return draft;
              const item = target.manualCropTrack.find((row) => row.id === control.id);
              if (item?.mode === "crop") item[field] = clamp(value, 0.01, 1);
              return draft;
            }, true)} />)}
      </div>}
      <button className="link-button danger" onClick={() => props.commit((draft) => {
        const target = draft.composition.layers.find((row) => row.id === props.layer.id);
        if (target?.type === "video") {
          target.manualCropTrack = target.manualCropTrack.filter((row) => row.id !== control.id);
        }
        return draft;
      })}>Remove</button>
    </article>)}
  </div>;
}

function CaptionsEditor(props: {
  captions: ShortProject["captions"];
  error?: string;
  commit(transform: (content: EditorContent) => EditorContent, coalesce?: boolean): void;
  save(): void;
  disabled: boolean;
}) {
  const style = props.captions.style;
  const patchStyle = (patch: Partial<typeof style>) => props.commit((draft) => {
    draft.captions.style = { ...draft.captions.style, ...patch };
    return draft;
  });
  return <Section title="Captions" error={props.error} save={props.save} disabled={props.disabled}>
    <label className="check"><input type="checkbox" checked={props.captions.enabled}
      onChange={(event) => props.commit((draft) => {
        draft.captions.enabled = event.target.checked; return draft;
      })} />Enable captions</label>
    <details open><summary>Style</summary>
      <div className="field-grid two">
        <label>Weight<select value={style.fontWeight}
          onChange={(event) => patchStyle({ fontWeight: Number(event.target.value) as 400 | 700 })}>
          <option value="400">Inter Regular</option><option value="700">Inter Bold</option>
        </select></label>
        <NumberField label="Size (px)" value={style.fontSizePx}
          onChange={(value) => patchStyle({ fontSizePx: value })} />
        <NumberField label="Position X" value={style.position.x} step={0.01}
          onChange={(value) => patchStyle({ position: { ...style.position, x: clamp(value, 0, 1) } })} />
        <NumberField label="Position Y" value={style.position.y} step={0.01}
          onChange={(value) => patchStyle({ position: { ...style.position, y: clamp(value, 0, 1) } })} />
        <NumberField label="Max width" value={style.maxWidth} step={0.01}
          onChange={(value) => patchStyle({ maxWidth: clamp(value, 0.1, 1) })} />
        <label>Transform<select value={style.textTransform}
          onChange={(event) => patchStyle({ textTransform: event.target.value as "none" | "uppercase" })}>
          <option value="none">None</option><option value="uppercase">Uppercase</option>
        </select></label>
        <ColorField label="Text" value={style.textColor}
          onChange={(textColor) => patchStyle({ textColor })} />
        <ColorField label="Highlight" value={style.highlightColor}
          onChange={(highlightColor) => patchStyle({ highlightColor })} />
        <ColorField label="Outline" value={style.outline.color}
          onChange={(color) => patchStyle({ outline: { ...style.outline, color } })} />
        <NumberField label="Outline width" value={style.outline.widthPx}
          onChange={(widthPx) => patchStyle({ outline: { ...style.outline, widthPx } })} />
        <ColorField label="Background" value={style.background.color}
          onChange={(color) => patchStyle({ background: { ...style.background, color } })} />
        <NumberField label="Background padding" value={style.background.paddingPx}
          onChange={(paddingPx) => patchStyle({ background: { ...style.background, paddingPx } })} />
        <NumberField label="Corner radius" value={style.background.cornerRadiusPx}
          onChange={(cornerRadiusPx) => patchStyle({
            background: { ...style.background, cornerRadiusPx }
          })} />
      </div>
    </details>
    {props.captions.warnings.length > 0 && <div className="warning-list">
      {props.captions.warnings.map((warning, index) =>
        <div key={`${warning.code}-${index}`}><strong>{warning.code}</strong>
          <span>{warning.cueId}: {warning.message}</span></div>)}
    </div>}
    <div className="cue-list">
      {props.captions.cues.map((cue, index) => <article className="cue-card" key={cue.id}>
        <textarea aria-label={`Caption cue ${index + 1} text`} value={cue.text}
          onChange={(event) => props.commit((draft) => {
            draft.captions.cues[index]!.text = event.target.value; return draft;
          }, true)} />
        <div className="field-grid two">
          <NumberField label="Start (ms)" value={cue.startMs}
            onChange={(value) => props.commit((draft) => {
              draft.captions.cues[index]!.startMs = Math.round(value); return draft;
            })} />
          <NumberField label="End (ms)" value={cue.endMs}
            onChange={(value) => props.commit((draft) => {
              draft.captions.cues[index]!.endMs = Math.round(value); return draft;
            })} />
        </div>
        <details><summary>{cue.words.length} word timing(s)</summary>
          {cue.words.map((word, wordIndex) => <div className="word-row" key={wordIndex}>
            <input value={word.text} onChange={(event) => props.commit((draft) => {
              draft.captions.cues[index]!.words[wordIndex]!.text = event.target.value; return draft;
            }, true)} />
            <input type="number" value={word.startMs} onChange={(event) => props.commit((draft) => {
              draft.captions.cues[index]!.words[wordIndex]!.startMs = Number(event.target.value);
              return draft;
            })} />
            <input type="number" value={word.endMs} onChange={(event) => props.commit((draft) => {
              draft.captions.cues[index]!.words[wordIndex]!.endMs = Number(event.target.value);
              return draft;
            })} />
          </div>)}
        </details>
      </article>)}
    </div>
  </Section>;
}

function AudioEditor(props: {
  audio: ShortProject["audio"];
  assets: Asset[];
  error?: string;
  commit(transform: (content: EditorContent) => EditorContent, coalesce?: boolean): void;
  save(): void;
  disabled: boolean;
}) {
  const update = (patch: Partial<ShortProject["audio"]>) => props.commit((draft) => {
    draft.audio = { ...draft.audio, ...patch }; return draft;
  });
  return <Section title="Audio" error={props.error} save={props.save} disabled={props.disabled}>
    <label className="check"><input type="checkbox" checked={props.audio.sourceMuted}
      onChange={(event) => update({ sourceMuted: event.target.checked })} />Mute Episode audio</label>
    <div className="field-grid two">
      <NumberField label="Source gain (dB)" value={props.audio.sourceGainDb} step={0.5}
        onChange={(sourceGainDb) => update({ sourceGainDb })} />
      <NumberField label="Cut fade (ms)" value={props.audio.cutFadeMs}
        onChange={(cutFadeMs) => update({ cutFadeMs: Math.round(cutFadeMs) })} />
    </div>
    <label>Audio bed<select value={props.audio.bedAssetId ?? ""}
      onChange={(event) => update({
        bedAssetId: event.target.value || null,
        bedGainDb: event.target.value ? (props.audio.bedGainDb ?? -18) : null
      })}>
      <option value="">None</option>
      {props.assets.filter((asset) => asset.kind === "audio").map((asset) =>
        <option value={asset.id} key={asset.id}>{fileName(asset.sourcePath)}</option>)}
    </select></label>
    {props.audio.bedAssetId && <NumberField label="Bed gain (dB)"
      value={props.audio.bedGainDb ?? -18} step={0.5}
      onChange={(bedGainDb) => update({ bedGainDb })} />}
    {props.audio.warnings.map((warning) => <div className="validation-box" key={warning.code}>
      <strong>{warning.code}</strong> {warning.message}
    </div>)}
  </Section>;
}

function Section(props: {
  title: string;
  dirtyText?: string;
  error?: string;
  save(): void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return <div className="editor-section">
    <div className="section-heading"><div><h2>{props.title}</h2>
      {props.dirtyText && <small>{props.dirtyText}</small>}</div>
      <button className="primary" disabled={props.disabled} onClick={props.save}>Save {props.title}</button>
    </div>
    {props.error && <div className="validation-box">{props.error}</div>}
    {props.children}
  </div>;
}

function NumberField(props: {
  label: string;
  value: number;
  step?: number;
  onChange(value: number): void;
}) {
  return <label>{props.label}<input type="number" step={props.step ?? 1} value={props.value}
    onChange={(event) => props.onChange(Number(event.target.value))} /></label>;
}

function ColorField(props: { label: string; value: string; onChange(value: string): void }) {
  return <label>{props.label}<input type="text" value={props.value}
    pattern="^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$"
    onChange={(event) => props.onChange(event.target.value)} /></label>;
}

function sectionForTab(tab: EditorTab): EditorSection {
  if (tab === "Timeline") return "timeline";
  if (tab === "Composition & Crops") return "composition";
  return tab.toLowerCase() as EditorSection;
}

function label(section: EditorSection) {
  return section[0]!.toUpperCase() + section.slice(1);
}

function timelineError(ranges: ShortProject["sourceRanges"], duration: number | null): string | null {
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index]!;
    if (!Number.isInteger(range.startMs) || !Number.isInteger(range.endMs)) {
      return `Range ${index + 1} must use integer milliseconds.`;
    }
    if (range.startMs < 0 || range.endMs <= range.startMs) {
      return `Range ${index + 1} must have an end after its non-negative start.`;
    }
    if (duration !== null && range.endMs > duration) {
      return `Range ${index + 1} exceeds the Episode duration.`;
    }
    if (index > 0 && range.startMs < ranges[index - 1]!.endMs) {
      return `Range ${index + 1} overlaps or is out of order.`;
    }
  }
  return null;
}

function moveLayer(layers: Composition["layers"], id: string, direction: number) {
  const index = layers.findIndex((layer) => layer.id === id);
  const target = clamp(index + direction, 0, layers.length - 1);
  if (index < 0 || index === target) return;
  const [layer] = layers.splice(index, 1);
  layers.splice(target, 0, layer!);
}

function assetMatchesLayer(asset: Asset, type: Composition["layers"][number]["type"]) {
  if (type === "media") return asset.kind === "image" || asset.kind === "video";
  if (type === "logo") return asset.kind === "logo" || asset.kind === "image";
  return asset.kind === type;
}

function normalizeColor(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#000000";
}

function formatMs(value: number) {
  const milliseconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor(milliseconds % 60_000 / 1_000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milliseconds % 1_000).padStart(3, "0")}`;
}

function fileName(path?: string | null) {
  return path?.split(/[\\/]/).pop() || "Unknown media";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
