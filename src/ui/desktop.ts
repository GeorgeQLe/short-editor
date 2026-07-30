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
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export {};
