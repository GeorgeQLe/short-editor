import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  selectMedia: (): Promise<string[]> => ipcRenderer.invoke("dialog:select-media"),
  selectWatchedDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:select-watched-directory"),
  selectRelinkCandidate: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:select-relink-candidate"),
  credentials: {
    list: () => ipcRenderer.invoke("credentials:list"),
    save: (input: unknown) => ipcRenderer.invoke("credentials:save", input),
    remove: (handle: string) => ipcRenderer.invoke("credentials:remove", handle)
  },
  cloudAuthorizations: {
    list: (scopeId?: string) => ipcRenderer.invoke("cloud-authorizations:list", scopeId),
    grant: (input: unknown) => ipcRenderer.invoke("cloud-authorizations:grant", input),
    revoke: (id: string) => ipcRenderer.invoke("cloud-authorizations:revoke", id)
  }
});
