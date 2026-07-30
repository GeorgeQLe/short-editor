import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AnalysisArtifact,
  Candidate,
  CandidateContentPackage,
  CandidateGenerationDiagnostic,
  CandidateGenerationInput,
  ContentPackage,
  Episode,
  TranscriptRevision
} from "../shared/domain";
import { ApiClientError, api } from "./api";
import { errorMessage, fileName } from "./utils";

type WorkspaceTab = "transcript" | "candidates";
type GenerationMode = "heuristic" | "analysis";
type GenerationStrategy = "append_pending" | "replace_pending";
type Conflict = { expectedRevision: number; actualRevision: number };

export function CandidatesWorkspace({
  episodes,
  announce,
  onChanged
}: {
  episodes: Episode[];
  announce(message: string): void;
  onChanged(): Promise<void>;
}) {
  const [episodeId, setEpisodeId] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("transcript");
  const [transcript, setTranscript] = useState<TranscriptRevision | null>(null);
  const [transcriptDraft, setTranscriptDraft] = useState<TranscriptRevision | null>(null);
  const [artifacts, setArtifacts] = useState<AnalysisArtifact[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [contentPackage, setContentPackage] = useState<CandidateContentPackage | null>(null);
  const [copyDraft, setCopyDraft] = useState<ContentPackage | null>(null);
  const [transcriptConflict, setTranscriptConflict] = useState<Conflict | null>(null);
  const [copyConflict, setCopyConflict] = useState<Conflict | null>(null);
  const [validation, setValidation] = useState<string[]>([]);
  const [diagnostic, setDiagnostic] = useState<CandidateGenerationDiagnostic | null>(null);
  const [loading, setLoading] = useState(false);

  const acceptedArtifacts = useMemo(() => artifacts.filter((artifact) =>
    artifact.ownerType === "episode"
    && artifact.kind === "episode_analysis"
    && artifact.state === "accepted"
  ), [artifacts]);

  const loadEpisode = useCallback(async (selectedId: string) => {
    setLoading(true);
    setValidation([]);
    setTranscriptConflict(null);
    setCopyConflict(null);
    setDiagnostic(null);
    setSelectedCandidateId("");
    setContentPackage(null);
    setCopyDraft(null);
    try {
      const [loadedTranscript, loadedArtifacts, loadedCandidates] = await Promise.all([
        api.transcript(selectedId).catch((error) => {
          if (error instanceof ApiClientError && error.code === "NOT_FOUND") return null;
          throw error;
        }),
        api.analysisArtifacts(selectedId),
        api.candidates(selectedId)
      ]);
      setTranscript(loadedTranscript);
      setTranscriptDraft(loadedTranscript ? cloneTranscript(loadedTranscript) : null);
      setArtifacts(loadedArtifacts);
      setCandidates(loadedCandidates);
      announce(loadedTranscript
        ? `Loaded accepted transcript revision ${loadedTranscript.revision} and ${loadedCandidates.length} active Candidates.`
        : "This Episode has no accepted transcript. Create one from Library → Providers first.");
    } catch (error) {
      announce(errorMessage(error, "Candidate workspace could not be loaded"));
    } finally {
      setLoading(false);
    }
  }, [announce]);

  useEffect(() => {
    if (episodeId) void loadEpisode(episodeId);
    else {
      setTranscript(null);
      setTranscriptDraft(null);
      setArtifacts([]);
      setCandidates([]);
      setSelectedCandidateId("");
      setContentPackage(null);
      setCopyDraft(null);
    }
  }, [episodeId, loadEpisode]);

  const loadCandidatePackage = useCallback(async (candidateId: string) => {
    setCopyConflict(null);
    setContentPackage(null);
    setCopyDraft(null);
    try {
      const value = await api.candidateContentPackage(candidateId);
      setContentPackage(value);
      setCopyDraft(clonePackage(value.accepted ?? value.proposed));
    } catch (error) {
      announce(errorMessage(error, "Content package could not be loaded"));
    }
  }, [announce]);

  const selectCandidate = (candidateId: string) => {
    setSelectedCandidateId(candidateId);
    if (candidateId) void loadCandidatePackage(candidateId);
  };

  const saveTranscript = async () => {
    if (!episodeId || !transcriptDraft || transcriptConflict) return;
    setValidation([]);
    try {
      const saved = await api.updateTranscript(episodeId, {
        expectedRevision: transcriptDraft.revision,
        language: transcriptDraft.language,
        segments: transcriptDraft.segments
      });
      setTranscript(saved);
      setTranscriptDraft(cloneTranscript(saved));
      await Promise.all([onChanged(), refreshCandidates(episodeId, setCandidates)]);
      announce(`Accepted transcript revision ${saved.revision} saved. Dependent work was invalidated safely.`);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "REVISION_CONFLICT") {
        setTranscriptConflict(conflictDetails(error, transcriptDraft.revision));
        announce("Transcript revision conflict. Your local draft is preserved until you reload latest.");
      } else if (error instanceof ApiClientError && error.code === "VALIDATION_ERROR") {
        const fields = validationDetails(error.details);
        setValidation(fields);
        announce("Transcript validation failed. Review the highlighted field details.");
      } else {
        announce(errorMessage(error, "Transcript save failed"));
      }
    }
  };

  const reloadTranscript = async () => {
    if (!episodeId) return;
    try {
      const latest = await api.transcript(episodeId);
      setTranscript(latest);
      setTranscriptDraft(cloneTranscript(latest));
      setTranscriptConflict(null);
      setValidation([]);
      announce(`Reloaded accepted transcript revision ${latest.revision}.`);
    } catch (error) {
      announce(errorMessage(error, "Latest transcript could not be loaded"));
    }
  };

  const refreshAfterGeneration = async () => {
    if (!episodeId) return;
    const active = await api.candidates(episodeId);
    setCandidates(active);
    if (selectedCandidateId) {
      const retained = active.find((candidate) => candidate.id === selectedCandidateId);
      if (retained) await loadCandidatePackage(retained.id);
      else selectCandidate("");
    }
    await onChanged();
  };

  const review = async (candidate: Candidate, status: "approved" | "rejected") => {
    try {
      const saved = await api.reviewCandidate(candidate.id, candidate.revision, status);
      setCandidates((current) => current.map((item) => item.id === saved.id ? saved : item));
      if (selectedCandidateId === saved.id) await loadCandidatePackage(saved.id);
      await onChanged();
      announce(`${status === "approved" ? "Approved" : "Rejected"} Candidate rank ${rankOf(candidates, saved.id)}.`);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "REVISION_CONFLICT") {
        announce("Candidate revision changed. The active list was reloaded; review again if still appropriate.");
        await refreshCandidates(episodeId, setCandidates);
      } else {
        announce(errorMessage(error, "Candidate review failed"));
      }
    }
  };

  const acceptCopy = async () => {
    if (!contentPackage || !copyDraft || copyConflict) return;
    try {
      const saved = await api.acceptCandidateContentPackage(
        contentPackage.candidateId,
        contentPackage.candidateRevision,
        copyDraft
      );
      setContentPackage(saved);
      setCopyDraft(clonePackage(saved.accepted ?? saved.proposed));
      setCandidates((current) => current.map((candidate) =>
        candidate.id === saved.candidateId
          ? { ...candidate, revision: saved.candidateRevision }
          : candidate
      ));
      await onChanged();
      announce(`Accepted copy saved at Candidate revision ${saved.candidateRevision}.`);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "REVISION_CONFLICT") {
        setCopyConflict(conflictDetails(error, contentPackage.candidateRevision));
        announce("Copy revision conflict. Your edited draft is preserved; reload latest before retrying.");
      } else if (error instanceof ApiClientError && error.code === "VALIDATION_ERROR") {
        setValidation(validationDetails(error.details));
        announce("Copy validation failed. Review the field details.");
      } else {
        announce(errorMessage(error, "Accepted copy save failed"));
      }
    }
  };

  return <section className="panel candidates-workspace">
    <div className="candidate-toolbar">
      <div>
        <h2>Episode workspace</h2>
        <p>Edit the accepted transcript, generate proposals, and finalize Candidate copy.</p>
      </div>
      <label className="episode-select">Episode
        <select value={episodeId} onChange={(event) => setEpisodeId(event.target.value)}>
          <option value="">Select an Episode…</option>
          {episodes.map((episode) => <option value={episode.id} key={episode.id}>
            {fileName(episode.sourcePath)}
          </option>)}
        </select>
      </label>
    </div>
    <div className="tabs" role="tablist" aria-label="Candidate workspaces">
      <button role="tab" aria-selected={tab === "transcript"} onClick={() => setTab("transcript")}>
        Transcript
      </button>
      <button role="tab" aria-selected={tab === "candidates"} onClick={() => setTab("candidates")}>
        Candidates
      </button>
    </div>
    {!episodeId ? <WorkspaceEmpty
      title="Select an Episode"
      copy="Choose an Episode to load its accepted transcript and active Candidate decisions."
    /> : loading ? <WorkspaceEmpty title="Loading Episode…" copy="Reading the complete local workspace." /> :
      tab === "transcript" ? (
        transcriptDraft && transcript ? <TranscriptEditor
          accepted={transcript}
          draft={transcriptDraft}
          setDraft={setTranscriptDraft}
          conflict={transcriptConflict}
          validation={validation}
          onSave={() => void saveTranscript()}
          onReload={() => void reloadTranscript()}
        /> : <WorkspaceEmpty
          title="No accepted transcript"
          copy="Open Library → Providers and run transcription for this Episode. Return here after a transcript is accepted."
        />
      ) : (
        transcript ? <CandidatePanel
          episodeId={episodeId}
          candidates={candidates}
          artifacts={acceptedArtifacts}
          diagnostic={diagnostic}
          selectedCandidateId={selectedCandidateId}
          contentPackage={contentPackage}
          copyDraft={copyDraft}
          copyConflict={copyConflict}
          validation={validation}
          onGenerate={async (input) => {
            try {
              const result = await api.generateCandidates(input);
              setDiagnostic(result.diagnostic);
              await refreshAfterGeneration();
              announce(result.diagnostic.sufficient
                ? `Generated ${result.diagnostic.generatedCount} Candidates and refreshed the complete active list.`
                : `${result.diagnostic.code}: generated ${result.diagnostic.generatedCount} of ${result.diagnostic.requestedCount}.`);
            } catch (error) {
              announce(errorMessage(error, "Candidate generation failed"));
            }
          }}
          onSelect={selectCandidate}
          onReview={(candidate, status) => void review(candidate, status)}
          onCopyChange={setCopyDraft}
          onAcceptCopy={() => void acceptCopy()}
          onReloadCopy={() => selectedCandidateId && void loadCandidatePackage(selectedCandidateId)}
        /> : <WorkspaceEmpty
          title="Transcript required"
          copy="Create an accepted transcript in Library → Providers before generating Candidates."
        />
      )}
  </section>;
}

function TranscriptEditor({
  accepted, draft, setDraft, conflict, validation, onSave, onReload
}: {
  accepted: TranscriptRevision;
  draft: TranscriptRevision;
  setDraft(value: TranscriptRevision): void;
  conflict: Conflict | null;
  validation: string[];
  onSave(): void;
  onReload(): void;
}) {
  const editSegment = (index: number, update: Record<string, string | number | null>) => {
    setDraft({
      ...draft,
      segments: draft.segments.map((segment, segmentIndex) =>
        segmentIndex === index ? { ...segment, ...update } : segment
      )
    });
  };
  return <div className="transcript-editor">
    <div className="revision-banner">
      <div><strong>Accepted revision {accepted.revision}</strong>
        <span> · {accepted.provenance.provider === "manual" ? "Manual edit" : accepted.provenance.provider}
          {" / "}{accepted.provenance.modelId}</span></div>
      <p>Saving creates a manual-edit revision and invalidates dependent analysis, Candidate approval,
        Short approval, completed renders, and draft schedules. Published schedule records remain unchanged.</p>
    </div>
    {conflict && <div className="conflict-box" role="alert">
      <strong>Revision conflict: expected {conflict.expectedRevision}, actual {conflict.actualRevision}</strong>
      <span>Your local draft is preserved. Reloading replaces it with the latest accepted snapshot.</span>
      <button className="secondary" onClick={onReload}>Reload latest</button>
    </div>}
    {!!validation.length && <ValidationList items={validation} />}
    <div className="transcript-actions">
      <label>Language
        <input value={draft.language} onChange={(event) =>
          setDraft({ ...draft, language: event.target.value })} />
      </label>
      <button className="primary" disabled={!!conflict} onClick={onSave}>Save accepted transcript</button>
    </div>
    <div className="segment-list">
      {draft.segments.map((segment, index) => <article className="segment-card" key={segment.id}>
        <div className="segment-heading">
          <strong>Segment {index + 1}</strong>
          <small>{segment.words.length} preserved word timestamp{segment.words.length === 1 ? "" : "s"}</small>
        </div>
        <label>Text
          <textarea aria-label={`Segment ${index + 1} text`} value={segment.text}
            onChange={(event) => editSegment(index, { text: event.target.value })} />
        </label>
        <div className="segment-fields">
          <label>Start milliseconds
            <input aria-label={`Segment ${index + 1} start milliseconds`} type="number"
              value={segment.startMs}
              onChange={(event) => editSegment(index, { startMs: Number(event.target.value) })} />
          </label>
          <label>End milliseconds
            <input aria-label={`Segment ${index + 1} end milliseconds`} type="number"
              value={segment.endMs}
              onChange={(event) => editSegment(index, { endMs: Number(event.target.value) })} />
          </label>
          <label>Speaker
            <input aria-label={`Segment ${index + 1} speaker`} value={segment.speaker ?? ""}
              onChange={(event) => editSegment(index, {
                speaker: event.target.value.trim() ? event.target.value : null
              })} />
          </label>
        </div>
      </article>)}
    </div>
  </div>;
}

function CandidatePanel(props: {
  episodeId: string;
  candidates: Candidate[];
  artifacts: AnalysisArtifact[];
  diagnostic: CandidateGenerationDiagnostic | null;
  selectedCandidateId: string;
  contentPackage: CandidateContentPackage | null;
  copyDraft: ContentPackage | null;
  copyConflict: Conflict | null;
  validation: string[];
  onGenerate(input: CandidateGenerationInput): Promise<void>;
  onSelect(candidateId: string): void;
  onReview(candidate: Candidate, status: "approved" | "rejected"): void;
  onCopyChange(value: ContentPackage): void;
  onAcceptCopy(): void;
  onReloadCopy(): void;
}) {
  const [mode, setMode] = useState<GenerationMode>("heuristic");
  const [strategy, setStrategy] = useState<GenerationStrategy>("append_pending");
  const [count, setCount] = useState(8);
  const [artifactId, setArtifactId] = useState("");
  const [generating, setGenerating] = useState(false);
  const selected = props.candidates.find((candidate) => candidate.id === props.selectedCandidateId);
  const generate = async () => {
    setGenerating(true);
    try {
      await props.onGenerate(mode === "analysis"
        ? {
          episodeId: props.episodeId, mode: "analysis", strategy, count,
          analysisArtifactId: artifactId
        }
        : { episodeId: props.episodeId, mode: "heuristic", strategy, count });
    } finally {
      setGenerating(false);
    }
  };
  return <>
    <div className="generation-form">
      <label>Generation mode
        <select value={mode} onChange={(event) => setMode(event.target.value as GenerationMode)}>
          <option value="heuristic">Deterministic heuristic</option>
          <option value="analysis">Accepted analysis</option>
        </select>
      </label>
      {mode === "analysis" && <label>Accepted analysis artifact
        <select value={artifactId} onChange={(event) => setArtifactId(event.target.value)}>
          <option value="">Select accepted analysis…</option>
          {props.artifacts.map((artifact) => <option key={artifact.id} value={artifact.id}>
            {artifact.provenance.provider} / {artifact.provenance.modelId} · {shortId(artifact.id)}
          </option>)}
        </select>
      </label>}
      <label>Candidate count
        <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
          {[5, 6, 7, 8, 9, 10].map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      <label>Pending strategy
        <select value={strategy} onChange={(event) =>
          setStrategy(event.target.value as GenerationStrategy)}>
          <option value="append_pending">Append pending</option>
          <option value="replace_pending">Replace pending</option>
        </select>
      </label>
      <button className="primary" disabled={generating || (mode === "analysis" && !artifactId)}
        onClick={() => void generate()}>
        {generating ? "Generating…" : "Generate Candidates"}
      </button>
    </div>
    {mode === "analysis" && !props.artifacts.length && <p className="notice">
      No accepted episode-analysis artifacts are available. Run and accept analysis in Library → Providers,
      or use deterministic heuristic generation.
    </p>}
    {props.diagnostic && !props.diagnostic.sufficient &&
      <InsufficientDiagnostic diagnostic={props.diagnostic} />}
    <div className="candidate-split">
      <div className="candidate-list">
        <div className="candidate-list-heading"><h2>Active Candidates</h2>
          <span>{props.candidates.length} total · reviewed decisions retained on regeneration</span></div>
        {props.candidates.length ? props.candidates.map((candidate, index) =>
          <CandidateCard key={candidate.id} candidate={candidate} rank={index + 1}
            selected={candidate.id === props.selectedCandidateId}
            onSelect={() => props.onSelect(candidate.id)}
            onReview={props.onReview} />
        ) : <WorkspaceEmpty title="No Candidates yet"
          copy="Choose a generation mode and create 5–10 deterministic proposals." />}
      </div>
      <div className="candidate-detail">
        {selected && props.contentPackage && props.copyDraft ? <ContentPackageEditor
          candidate={selected}
          value={props.contentPackage}
          draft={props.copyDraft}
          conflict={props.copyConflict}
          validation={props.validation}
          onChange={props.onCopyChange}
          onAccept={props.onAcceptCopy}
          onReload={props.onReloadCopy}
        /> : <WorkspaceEmpty title="Select a Candidate"
          copy="Inspect immutable proposed copy beside the editable accepted draft." />}
      </div>
    </div>
  </>;
}

function CandidateCard({
  candidate, rank, selected, onSelect, onReview
}: {
  candidate: Candidate;
  rank: number;
  selected: boolean;
  onSelect(): void;
  onReview(candidate: Candidate, status: "approved" | "rejected"): void;
}) {
  const provider = candidate.generationProvenance.provider;
  return <article className={`candidate-card${selected ? " selected" : ""}`}>
    <button className="candidate-summary" onClick={onSelect}>
      <span className="candidate-rank">#{rank}</span>
      <span><strong>{candidate.topic}</strong><small>
        {formatMs(candidate.startMs)}–{formatMs(candidate.endMs)} · transcript r
        {candidate.generationProvenance.transcriptRevision}
      </small></span>
      <span className={`review-pill ${candidate.reviewStatus}`}>{candidate.reviewStatus}</span>
    </button>
    <p>{candidate.hook}</p>
    <div className="candidate-meta">
      <span>Score <strong>{score(candidate.score)}</strong></span>
      {Object.entries(candidate.scores).map(([name, value]) =>
        <span key={name}>{humanize(name)} {score(value)}</span>)}
      <span>Provider {provider ? `${provider.provider} / ${provider.modelId}` : "local heuristic"}</span>
      <span>Duplicate group {candidate.duplicateGroup ?? "none"}</span>
      <span>Candidate r{candidate.revision}</span>
    </div>
    <p className="candidate-reason">{candidate.reason}</p>
    <div className="candidate-review-actions">
      <button className="secondary" disabled={candidate.reviewStatus === "approved"}
        onClick={() => onReview(candidate, "approved")}>Approve</button>
      <button className="secondary danger" disabled={candidate.reviewStatus === "rejected"}
        onClick={() => onReview(candidate, "rejected")}>Reject</button>
    </div>
  </article>;
}

function ContentPackageEditor({
  candidate, value, draft, conflict, validation, onChange, onAccept, onReload
}: {
  candidate: Candidate;
  value: CandidateContentPackage;
  draft: ContentPackage;
  conflict: Conflict | null;
  validation: string[];
  onChange(value: ContentPackage): void;
  onAccept(): void;
  onReload(): void;
}) {
  const textField = (field: keyof ContentPackage, next: string) =>
    onChange({ ...draft, [field]: next });
  const arrayField = (field: "hookVariants" | "titles" | "hashtags", next: string) =>
    onChange({ ...draft, [field]: lines(next) });
  return <div className="copy-editor">
    <div className="copy-heading"><div><h2>Candidate copy</h2>
      <span>{candidate.reviewStatus} · Candidate revision {value.candidateRevision}</span></div>
      <span className={`copy-state ${value.accepted ? "accepted" : "proposed"}`}>
        {value.accepted ? "Accepted copy" : "Proposed draft"}
      </span>
    </div>
    {conflict && <div className="conflict-box" role="alert">
      <strong>Stale copy: expected {conflict.expectedRevision}, actual {conflict.actualRevision}</strong>
      <span>Your unsaved copy remains below. Reload latest before retrying.</span>
      <button className="secondary" onClick={onReload}>Reload latest copy</button>
    </div>}
    {!!validation.length && <ValidationList items={validation} />}
    <details className="proposed-copy" open>
      <summary>Immutable proposed copy</summary>
      <PackagePreview value={value.proposed} />
    </details>
    <h3>Editable accepted draft</h3>
    <p className="planning-note">Rewrites are planning aids; they do not replace source media or transcript timing.</p>
    <CopyField label="Cleaned transcript" value={draft.cleanedTranscript}
      onChange={(next) => textField("cleanedTranscript", next)} />
    <CopyField label="Rewrite (planning aid)" value={draft.rewrite}
      onChange={(next) => textField("rewrite", next)} />
    <CopyField label="Hooks (one per line)" value={draft.hookVariants.join("\n")}
      onChange={(next) => arrayField("hookVariants", next)} />
    <CopyField label="Titles (one per line)" value={draft.titles.join("\n")}
      onChange={(next) => arrayField("titles", next)} />
    <CopyField label="Description" value={draft.description}
      onChange={(next) => textField("description", next)} />
    <CopyField label="Hashtags (one per line)" value={draft.hashtags.join("\n")}
      onChange={(next) => arrayField("hashtags", next)} />
    <CopyField label="Thumbnail text" value={draft.thumbnailText}
      onChange={(next) => textField("thumbnailText", next)} />
    <button className="primary accept-copy" disabled={!!conflict} onClick={onAccept}>
      Accept edited copy
    </button>
  </div>;
}

function CopyField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  return <label>{label}
    <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
  </label>;
}

function PackagePreview({ value }: { value: ContentPackage }) {
  return <dl>
    <dt>Cleaned transcript</dt><dd>{value.cleanedTranscript || "—"}</dd>
    <dt>Rewrite (planning aid)</dt><dd>{value.rewrite || "—"}</dd>
    <dt>Hooks</dt><dd>{value.hookVariants.join(" · ") || "—"}</dd>
    <dt>Titles</dt><dd>{value.titles.join(" · ") || "—"}</dd>
    <dt>Description</dt><dd>{value.description || "—"}</dd>
    <dt>Hashtags</dt><dd>{value.hashtags.join(" ") || "—"}</dd>
    <dt>Thumbnail text</dt><dd>{value.thumbnailText || "—"}</dd>
  </dl>;
}

function InsufficientDiagnostic({ diagnostic }: {
  diagnostic: Extract<CandidateGenerationDiagnostic, { sufficient: false }>;
}) {
  return <div className="insufficient-box" role="status">
    <strong>{diagnostic.code}</strong>
    <p>Only {diagnostic.generatedCount} of {diagnostic.requestedCount} requested Candidates were novel
      and eligible; at least {diagnostic.minimumCandidateCount} are required for a sufficient run.</p>
    <span>Eligible windows: {diagnostic.eligibleWindowCount} · rejected for duration: {
      diagnostic.rejectionCounts.duration} · quality: {diagnostic.rejectionCounts.quality} · overlap: {
      diagnostic.rejectionCounts.overlap} · semantic duplication: {
      diagnostic.rejectionCounts.semanticDuplication}</span>
    <small>Use a longer accepted transcript, improve segment timing/text, reduce overlap with retained
      decisions, or choose replace-pending before regenerating.</small>
  </div>;
}

function WorkspaceEmpty({ title, copy }: { title: string; copy: string }) {
  return <div className="candidate-empty"><div aria-hidden="true">✦</div><h2>{title}</h2><p>{copy}</p></div>;
}

function ValidationList({ items }: { items: string[] }) {
  return <div className="validation-box" role="alert"><strong>Field validation</strong>
    <ul>{items.map((item, index) => <li key={`${item}:${index}`}>{item}</li>)}</ul>
  </div>;
}

function cloneTranscript(value: TranscriptRevision): TranscriptRevision {
  return {
    ...value,
    segments: value.segments.map((segment) => ({
      ...segment,
      words: segment.words.map((word) => ({ ...word }))
    }))
  };
}

function clonePackage(value: ContentPackage): ContentPackage {
  return {
    ...value,
    hookVariants: [...value.hookVariants],
    titles: [...value.titles],
    hashtags: [...value.hashtags]
  };
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function conflictDetails(error: ApiClientError, fallback: number): Conflict {
  const details = error.details && typeof error.details === "object"
    ? error.details as Record<string, unknown>
    : {};
  return {
    expectedRevision: typeof details.expectedRevision === "number"
      ? details.expectedRevision : fallback,
    actualRevision: typeof details.actualRevision === "number"
      ? details.actualRevision : fallback
  };
}

function validationDetails(details: unknown): string[] {
  if (!Array.isArray(details)) return ["The submitted snapshot did not pass validation."];
  const items = details.map((item) => {
    if (!item || typeof item !== "object") return "Invalid field";
    const issue = item as { path?: unknown; message?: unknown };
    const path = Array.isArray(issue.path) ? issue.path.join(".") : "request";
    return `${path || "request"}: ${String(issue.message ?? "Invalid value")}`;
  });
  return items.length ? items : ["The submitted snapshot did not pass validation."];
}

async function refreshCandidates(
  episodeId: string,
  apply: (candidates: Candidate[]) => void
): Promise<void> {
  apply(await api.candidates(episodeId));
}

function rankOf(candidates: Candidate[], id: string): number {
  const index = candidates.findIndex((candidate) => candidate.id === id);
  return index < 0 ? 0 : index + 1;
}

function score(value: number): string {
  return value.toFixed(3);
}

function humanize(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) =>
    letter.toUpperCase());
}

function formatMs(value: number): string {
  const seconds = Math.floor(value / 1_000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}.${String(value % 1_000).padStart(3, "0")}`;
}

function shortId(value: string): string {
  return value.slice(0, 8);
}
