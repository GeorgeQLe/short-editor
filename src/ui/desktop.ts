export interface CredentialSummary {
  handle: string;
  provider: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudAuthorization {
  id: string;
  scopeType: "project" | "batch";
  scopeId: string;
  provider: "openai" | "ollama";
  operationClasses: string[];
  credentialHandle: string | null;
  grantedAt: string;
  revokedAt: string | null;
}

export interface DesktopBridge {
  selectMedia(): Promise<string[]>;
  selectWatchedDirectory(): Promise<string | null>;
  selectRelinkCandidate(): Promise<string | null>;
  selectAsset?(): Promise<string | null>;
  mediaUrl?(kind: "episode" | "asset", id: string): string;
  credentials: {
    list(): Promise<CredentialSummary[]>;
    save(input: {
      handle?: string;
      provider: string;
      label: string;
      secret: string;
    }): Promise<CredentialSummary>;
    remove(handle: string): Promise<void>;
  };
  cloudAuthorizations: {
    list(scopeId?: string): Promise<CloudAuthorization[]>;
    grant(input: {
      scopeType: "project" | "batch";
      scopeId: string;
      provider: "openai" | "ollama";
      operationClasses: string[];
      credentialHandle: string | null;
      dataDescription: string;
      networkUseConfirmed: boolean;
      costsConfirmed: boolean;
    }): Promise<CloudAuthorization>;
    revoke(id: string): Promise<void>;
  };
  runtime?: {
    readiness(): Promise<RuntimeReadiness>;
    modelInstallState(): Promise<ModelInstallState>;
    installModel(): Promise<ModelInstallState>;
    cancelModelInstall(): Promise<ModelInstallState>;
    openModelsFolder(): Promise<void>;
  };
  diagnostics?: {
    preview(options: DiagnosticConsent): Promise<DiagnosticPreview>;
    export(options: DiagnosticConsent): Promise<{ exported: boolean; path?: string }>;
  };
  applicationVersion?(): Promise<{
    version: string;
    platform: string;
    arch: string;
    supportedPlatform: boolean;
  }>;
}

export interface RuntimeCheck {
  id: "ffmpeg" | "ffprobe" | "python" | "worker" | "model" | "ollama" | "storage";
  label: string;
  state: "ready" | "optional" | "needs_attention";
  detail: string;
  action: "none" | "install_model" | "open_setup";
  version?: string;
}

export interface RuntimeReadiness {
  checkedAt: string;
  localWorkflowReady: boolean;
  checks: RuntimeCheck[];
}

export interface ModelInstallState {
  phase: "not_installed" | "downloading" | "paused" | "verifying" | "installing" | "ready" | "failed";
  receivedBytes: number;
  totalBytes: number;
  message: string;
  canResume: boolean;
  canCancel: boolean;
}

export interface DiagnosticConsent {
  includeTranscripts: boolean;
  includePaths: boolean;
}

export interface DiagnosticPreview {
  policyVersion: string;
  fileName: string;
  payload: unknown;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export {};
