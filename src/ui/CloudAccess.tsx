import { useCallback, useEffect, useState } from "react";
import type { Episode } from "../shared/domain";
import type { CloudAuthorization, CredentialSummary } from "./desktop";
import { errorMessage, fileName } from "./utils";

export interface CloudAccessTarget {
  episodeId: string;
  provider: "openai" | "ollama";
  operation: "transcription" | "analysis";
}

export function CloudAccess({
  episodes,
  target,
  announce,
  onChanged
}: {
  episodes: Episode[];
  target?: CloudAccessTarget;
  announce(message: string): void;
  onChanged(): Promise<void>;
}) {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [authorizations, setAuthorizations] = useState<CloudAuthorization[]>([]);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [episodeId, setEpisodeId] = useState(target?.episodeId ?? "");
  const [provider, setProvider] = useState<"openai" | "ollama">(target?.provider ?? "openai");
  const [operation, setOperation] = useState<"transcription" | "analysis" | "both">(
    target?.operation ?? "both"
  );
  const [credentialHandle, setCredentialHandle] = useState("");
  const [networkConfirmed, setNetworkConfirmed] = useState(false);
  const [costsConfirmed, setCostsConfirmed] = useState(false);

  const refresh = useCallback(async () => {
    if (!window.desktop) return;
    const [credentialRows, authorizationRows] = await Promise.all([
      window.desktop.credentials.list(),
      window.desktop.cloudAuthorizations.list()
    ]);
    setCredentials(credentialRows);
    setAuthorizations(authorizationRows);
    setCredentialHandle((current) =>
      credentialRows.some((credential) => credential.handle === current)
        ? current
        : credentialRows[0]?.handle ?? ""
    );
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!target) return;
    setEpisodeId(target.episodeId);
    setProvider(target.provider);
    setOperation(target.operation);
  }, [target]);

  const saveCredential = async () => {
    if (!window.desktop) return;
    try {
      await window.desktop.credentials.save({ provider: "openai", label, secret });
      setLabel("");
      setSecret("");
      announce("Protected credential saved. Its value is not stored in the project database.");
      await refresh();
      await onChanged();
    } catch (error) {
      announce(errorMessage(error, "Could not save protected credential"));
    }
  };

  const grant = async () => {
    if (!window.desktop || !episodeId) return;
    const operationClasses = operation === "both"
      ? ["transcription", "analysis"]
      : [operation];
    try {
      await window.desktop.cloudAuthorizations.grant({
        scopeType: "project",
        scopeId: episodeId,
        provider,
        operationClasses,
        credentialHandle: provider === "openai" ? credentialHandle : null,
        dataDescription: operationClasses.includes("transcription")
          ? "Episode audio and transcript-derived analysis inputs"
          : "Accepted transcript and sampled Episode frames",
        networkUseConfirmed: networkConfirmed,
        costsConfirmed
      });
      announce(`${provider === "openai" ? "OpenAI" : "Public Ollama"} authorization granted.`);
      setNetworkConfirmed(false);
      setCostsConfirmed(false);
      await refresh();
      await onChanged();
    } catch (error) {
      announce(errorMessage(error, "Could not grant cloud authorization"));
    }
  };

  return <section className="cloud-grid" aria-label="Cloud access security gates">
    <article className="panel security-card">
      <h2>Protected OpenAI credentials</h2>
      <p>Credential values are protected by the operating system and never enter SQLite, logs, API payloads, or UI output.</p>
      <label>Label<input value={label} onChange={(event) => setLabel(event.target.value)}
        placeholder="OpenAI production key" /></label>
      <label>Credential value<input type="password" autoComplete="off" value={secret}
        onChange={(event) => setSecret(event.target.value)} /></label>
      <button className="primary" disabled={!label.trim() || !secret} onClick={saveCredential}>
        Save protected credential
      </button>
      <ul className="security-list">{credentials.map((credential) =>
        <li key={credential.handle}><span><strong>{credential.label}</strong>
          <small>{credential.provider} · saved {formatDate(credential.updatedAt)}</small>
        </span><button className="secondary danger" onClick={async () => {
          try {
            await window.desktop?.credentials.remove(credential.handle);
            announce("Credential removed and its authorizations revoked.");
            await refresh();
            await onChanged();
          } catch (error) {
            announce(errorMessage(error, "Could not remove credential"));
          }
        }}>Remove</button></li>)}
      </ul>
    </article>
    <article className="panel security-card">
      <h2>Persisted authorization grants</h2>
      <p>Grant only the provider and operation this Episode needs. Public Ollama grants do not use a credential.</p>
      <label>Episode<select value={episodeId} onChange={(event) => setEpisodeId(event.target.value)}>
        <option value="">Select an Episode</option>
        {episodes.map((episode) => <option key={episode.id} value={episode.id}>
          {fileName(episode.sourcePath)}
        </option>)}
      </select></label>
      <label>Provider<select value={provider} onChange={(event) => {
        const next = event.target.value as "openai" | "ollama";
        setProvider(next);
        if (next === "ollama") setOperation("analysis");
      }}>
        <option value="openai">OpenAI</option>
        <option value="ollama">Public Ollama</option>
      </select></label>
      <label>Operations<select value={operation}
        onChange={(event) => setOperation(event.target.value as typeof operation)}>
        {provider === "openai" && <option value="transcription">Transcription</option>}
        <option value="analysis">Analysis</option>
        {provider === "openai" && <option value="both">Transcription and analysis</option>}
      </select></label>
      {provider === "openai" && <label>Protected credential<select value={credentialHandle}
        onChange={(event) => setCredentialHandle(event.target.value)}>
        <option value="">Select a credential</option>
        {credentials.map((credential) => <option key={credential.handle} value={credential.handle}>
          {credential.label}
        </option>)}
      </select></label>}
      <label className="check"><input type="checkbox" checked={networkConfirmed}
        onChange={(event) => setNetworkConfirmed(event.target.checked)} />
        I understand the described Episode data will leave this workstation over a public network.</label>
      <label className="check"><input type="checkbox" checked={costsConfirmed}
        onChange={(event) => setCostsConfirmed(event.target.checked)} />
        I understand provider or network usage may incur costs.</label>
      <button className="primary" disabled={
        !episodeId || (provider === "openai" && !credentialHandle) ||
        !networkConfirmed || !costsConfirmed
      } onClick={grant}>Authorize selected operation</button>
      <ul className="security-list">{authorizations.filter((item) => !item.revokedAt).map((item) =>
        <li key={item.id}><span><strong>{item.provider} · {item.operationClasses.join(", ")}</strong>
          <small>{fileName(episodes.find((episode) => episode.id === item.scopeId)?.sourcePath ?? item.scopeId)}</small>
        </span><button className="secondary danger" onClick={async () => {
          try {
            await window.desktop?.cloudAuthorizations.revoke(item.id);
            announce("Cloud authorization revoked.");
            await refresh();
            await onChanged();
          } catch (error) {
            announce(errorMessage(error, "Could not revoke cloud authorization"));
          }
        }}>Revoke</button></li>)}
      </ul>
    </article>
  </section>;
}

const formatDate = (value: string) => new Date(value).toLocaleString();
