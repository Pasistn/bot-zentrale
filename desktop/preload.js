const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  getState: () => ipcRenderer.invoke("get-state"),
  start: () => ipcRenderer.invoke("start"),
  stop: () => ipcRenderer.invoke("stop"),
  openDashboard: () => ipcRenderer.invoke("open-dashboard"),
  openBrowser: () => ipcRenderer.invoke("open-browser"),
  openTwitchConsole: () => ipcRenderer.invoke("open-twitch-console"),
  saveSettings: (input) => ipcRenderer.invoke("save-settings", input),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  pickCaFile: () => ipcRenderer.invoke("pick-ca-file"),
  onStatus: (callback) => ipcRenderer.on("status", (_event, status) => callback(status)),
  onLog: (callback) => ipcRenderer.on("log", (_event, entry) => callback(entry)),
  onUpdate: (callback) => ipcRenderer.on("update", (_event, update) => callback(update)),
});
