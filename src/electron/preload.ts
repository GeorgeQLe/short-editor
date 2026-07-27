import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  selectMedia: (): Promise<string[]> => ipcRenderer.invoke("dialog:select-media")
});
