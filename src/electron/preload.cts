import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  selectMedia: (): Promise<string[]> => ipcRenderer.invoke("dialog:select-media"),
  selectWatchedDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:select-watched-directory"),
  selectRelinkCandidate: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:select-relink-candidate"),
  selectAsset: (): Promise<string | null> => ipcRenderer.invoke("dialog:select-asset"),
  mediaUrl: (kind: "episode" | "asset", id: string): string => {
    if (kind !== "episode" && kind !== "asset") throw new Error("Unsupported media kind");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error("Media ID must be a UUID");
    }
    return `short-editor-media://${kind}/${id}`;
  },
  credentials: {
    list: () => ipcRenderer.invoke("credentials:list"),
    save: (input: unknown) => ipcRenderer.invoke("credentials:save", input),
    remove: (handle: string) => ipcRenderer.invoke("credentials:remove", handle)
  },
  cloudAuthorizations: {
    list: (scopeId?: string) => ipcRenderer.invoke("cloud-authorizations:list", scopeId),
    grant: (input: unknown) => ipcRenderer.invoke("cloud-authorizations:grant", input),
    revoke: (id: string) => ipcRenderer.invoke("cloud-authorizations:revoke", id)
  },
  runtime: {
    readiness: () => ipcRenderer.invoke("runtime:readiness"),
    modelInstallState: () => ipcRenderer.invoke("runtime:model-install-state"),
    installModel: () => ipcRenderer.invoke("runtime:model-install"),
    cancelModelInstall: () => ipcRenderer.invoke("runtime:model-install-cancel"),
    openModelsFolder: () => ipcRenderer.invoke("runtime:open-models-folder")
  },
  diagnostics: {
    preview: (options: unknown) => ipcRenderer.invoke("diagnostics:preview", options),
    export: (options: unknown) => ipcRenderer.invoke("diagnostics:export", options)
  },
  applicationVersion: () => ipcRenderer.invoke("application:version")
});
