import { useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "../shared/domain";
import type {
  DiagnosticConsent,
  DiagnosticPreview,
  ModelInstallState,
  RuntimeReadiness
} from "./desktop";
import { api } from "./api";
import { errorMessage } from "./utils";

interface SupportCenterProps {
  section: "Setup" | "Recovery" | "About";
  jobs: Job[];
  announce(message: string): void;
  onRefresh(): Promise<void>;
  onOpenLibrary(): void;
}

export function SupportCenter(props: SupportCenterProps) {
  if (props.section === "Setup") return <SetupCenter announce={props.announce} />;
  if (props.section === "Recovery") return <RecoveryCenter {...props} />;
  return <AboutCenter />;
}

function SetupCenter({ announce }: Pick<SupportCenterProps, "announce">) {
  const [readiness, setReadiness] = useState<RuntimeReadiness | null>(null);
  const [install, setInstall] = useState<ModelInstallState | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try {
      const [result, installState] = await Promise.all([
        window.desktop?.runtime?.readiness(),
        window.desktop?.runtime?.modelInstallState()
      ]);
      if (!result) throw new Error("Setup Center is available in the desktop application");
      setReadiness(result);
      if (installState) setInstall(installState);
      announce(result.localWorkflowReady
        ? "Local transcription, editing, and rendering are ready."
        : "Setup needs attention before the fully local workflow is ready.");
    } catch (error) {
      announce(errorMessage(error, "Could not check application resources"));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!install || !["downloading", "verifying", "installing"].includes(install.phase)) return;
    const timer = window.setInterval(() => {
      void window.desktop?.runtime?.modelInstallState().then((state) => {
        if (!state) return;
        setInstall(state);
        if (state.phase === "ready") {
          announce("The English transcription model is installed and verified.");
          void refresh();
        }
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [install?.phase]);
  const installModel = async () => {
    try {
      const state = await window.desktop?.runtime?.installModel();
      if (!state) throw new Error("Model installation is available in the desktop application");
      setInstall(state);
      announce(state.phase === "downloading" ? "Model download started." : state.message);
    } catch (error) {
      announce(errorMessage(error, "Model installation could not start"));
    }
  };
  const cancelInstall = async () => {
    const state = await window.desktop?.runtime?.cancelModelInstall();
    if (state) setInstall(state);
    announce("Model download paused. Resume will keep completed bytes.");
  };
  const progress = install && install.totalBytes > 0
    ? Math.min(100, Math.round(install.receivedBytes / install.totalBytes * 100))
    : 0;
  return (
    <section className="panel support-panel" aria-labelledby="setup-title">
      <div className="support-heading">
        <div><h2 id="setup-title">Local workflow readiness</h2>
          <p>Checks application-managed resources. No download begins automatically.</p></div>
        <button className="secondary" disabled={busy} onClick={() => void refresh()}>
          {busy ? "Checking…" : "Check again"}
        </button>
      </div>
      {!readiness ? <p className="support-loading">Checking bundled resources…</p> :
        <ul className="readiness-list">
          {readiness.checks.map((check) => <li key={check.id}>
            <span className={`state-marker ${check.state}`} aria-hidden="true" />
            <div><strong>{check.label}</strong><p>{check.detail}</p>
              {(check.version || check.architecture) && <small>{[
                check.version,
                check.architecture && `${check.architecture}${
                  check.executionMode === "emulated" ? " · emulated" : " · native"
                }`
              ].filter(Boolean).join(" · ")}</small>}</div>
            <span className={`pill ${check.state}`}>{stateLabel(check.state)}</span>
            {check.id === "model" && check.state !== "ready" &&
              <button className="secondary" onClick={() =>
                void window.desktop?.runtime?.openModelsFolder()}>
                Open model folder
              </button>}
          </li>)}
        </ul>}
      <div className="disclosure-card">
        <strong>English transcription model</strong>
        <p>Systran/faster-whisper-small.en revision e0e3c0a is MIT licensed. The immutable
          445.2 MB archive is downloaded from the SiftCut GitHub Release only after
          confirmation. Every archive member is verified before an atomic install.</p>
        <small>Local files remain on this computer. Ollama and OpenAI are optional and do not block the
          transcription → edit → render workflow.</small>
        {install && <div className="model-install-status">
          <div><span>{install.message}</span><span>{progress}%</span></div>
          <progress max="100" value={progress} aria-label="Model installation progress" />
          <small>{formatTransfer(install.receivedBytes)} of {formatTransfer(install.totalBytes)}</small>
        </div>}
        {install?.phase !== "ready" && <>
          <label className="check"><input type="checkbox" checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)} />
            I approve this network download and local model storage.</label>
          <div className="actions">
            {install?.canCancel
              ? <button className="secondary" onClick={() => void cancelInstall()}>Cancel</button>
              : <button className="primary" disabled={!confirmed}
                onClick={() => void installModel()}>
                {install?.phase === "paused" ? "Resume download" :
                  install?.phase === "failed" ? "Retry installation" : "Install model"}
              </button>}
            <button className="secondary" onClick={() =>
              void window.desktop?.runtime?.openModelsFolder()}>Open model folder</button>
          </div>
        </>}
      </div>
    </section>
  );
}

function RecoveryCenter(props: SupportCenterProps) {
  const failed = useMemo(() => props.jobs.filter((job) =>
    job.state === "failed" || job.stage === "recovery_required"
  ), [props.jobs]);
  const [working, setWorking] = useState<string | null>(null);
  const retry = async (job: Job) => {
    const renderId = job.type === "render" && job.payloadReference?.startsWith("render:")
      ? job.payloadReference.slice("render:".length)
      : null;
    if (!renderId) {
      props.announce("This job requires returning to its workflow before retrying.");
      return;
    }
    setWorking(job.id);
    try {
      await api.retryRender(renderId);
      props.announce("A bounded render retry was queued; prior attempts remain available.");
      await props.onRefresh();
    } catch (error) {
      props.announce(errorMessage(error, "Retry could not be queued"));
    } finally {
      setWorking(null);
    }
  };
  return (
    <section className="panel support-panel" aria-labelledby="recovery-title">
      <div className="support-heading"><div><h2 id="recovery-title">Interrupted work</h2>
        <p>Accepted edits and earlier successful renders are preserved during recovery.</p></div>
        <button className="secondary" onClick={() => void props.onRefresh()}>Refresh</button>
      </div>
      {!failed.length ? <div className="support-empty"><strong>No recovery actions needed</strong>
        <p>Interrupted retry-safe work is reconciled automatically at startup.</p></div> :
        <ul className="recovery-list">
          {failed.map((job) => <li key={job.id}>
            <div><strong>{job.type} · {job.stage.replaceAll("_", " ")}</strong>
              <p>{job.errorMessage ?? "The operation did not finish."}</p>
              <small>Attempt {job.attempts} · {new Date(job.updatedAt).toLocaleString()}</small></div>
            <div className="actions">
              {job.type === "render" &&
                <button className="secondary" disabled={working === job.id}
                  onClick={() => void retry(job)}>Retry render</button>}
              <button className="secondary" onClick={props.onOpenLibrary}>Return to workflow</button>
            </div>
          </li>)}
        </ul>}
      <Diagnostics />
    </section>
  );
}

function Diagnostics() {
  const [consent, setConsent] = useState<DiagnosticConsent>({
    includeTranscripts: false, includePaths: false
  });
  const [preview, setPreview] = useState<DiagnosticPreview | null>(null);
  const [message, setMessage] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLButtonElement>(null);
  const closePreview = () => {
    setPreview(null);
    window.setTimeout(() => previewRef.current?.focus(), 0);
  };
  const showPreview = async () => {
    try {
      const value = await window.desktop?.diagnostics?.preview(consent);
      if (!value) throw new Error("Diagnostic export is available in the desktop application");
      setPreview(value);
    } catch (error) {
      setMessage(errorMessage(error, "Diagnostic preview failed"));
    }
  };
  useEffect(() => { if (preview) closeRef.current?.focus(); }, [preview]);
  const exportArchive = async () => {
    const result = await window.desktop?.diagnostics?.export(consent);
    setMessage(result?.exported ? "Diagnostic ZIP exported locally." : "Export cancelled.");
  };
  return <div className="diagnostic-card">
    <h3>Export diagnostics</h3>
    <p>Preview a redacted local support bundle before saving it. Nothing is uploaded.</p>
    <label className="check"><input type="checkbox" checked={consent.includePaths}
      onChange={(event) => setConsent({ ...consent, includePaths: event.target.checked })} />
      Include absolute paths and source locations</label>
    <label className="check"><input type="checkbox" checked={consent.includeTranscripts}
      onChange={(event) => setConsent({ ...consent, includeTranscripts: event.target.checked })} />
      Include transcript content</label>
    <div className="actions"><button ref={previewRef} className="secondary"
      onClick={() => void showPreview()}>
      Preview contents</button>
      <button className="primary" onClick={() => void exportArchive()}>Export ZIP…</button></div>
    {message && <p role="status">{message}</p>}
    {preview && <div className="dialog-backdrop" role="presentation">
      <section className="dialog diagnostic-preview" role="dialog" aria-modal="true"
        aria-labelledby="diagnostic-preview-title"
        onKeyDown={(event) => { if (event.key === "Escape") closePreview(); }}>
        <h2 id="diagnostic-preview-title">Diagnostic preview</h2>
        <p>{preview.fileName} · {preview.policyVersion}</p>
        <pre>{JSON.stringify(preview.payload, null, 2)}</pre>
        <div className="dialog-actions"><button ref={closeRef} className="secondary"
          onClick={closePreview}>Close preview</button></div>
      </section>
    </div>}
  </div>;
}

function AboutCenter() {
  const [info, setInfo] = useState({ version: "development", platform: "unknown", arch: "unknown",
    supportedPlatform: false });
  useEffect(() => { void window.desktop?.applicationVersion?.().then(setInfo); }, []);
  return <section className="panel support-panel about-card" aria-labelledby="about-title">
    <div className="brand-mark" aria-hidden="true">S</div>
    <h2 id="about-title">SiftCut</h2>
    <p>Version {info.version} · {info.platform} {info.arch}</p>
    <span className={`pill ${info.supportedPlatform ? "ready" : "optional"}`}>
      {info.supportedPlatform ? "Supported beta platform" : "Development platform"}
    </span>
    <p>{info.platform === "win32"
      ? `Windows 11 · ${info.arch} · Development preview`
      : "macOS 14+ · Apple Silicon · Public beta"}</p>
    <p>Updates are manually downloaded signed releases. This application does not include an
      automatic updater, telemetry, or automatic diagnostic uploads.</p>
  </section>;
}

function stateLabel(state: "ready" | "optional" | "needs_attention") {
  return state === "ready" ? "Ready" : state === "optional" ? "Optional" : "Needs attention";
}

function formatTransfer(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
