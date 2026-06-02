let electron = require("electron");
//#region electron/preload.ts
electron.contextBridge.exposeInMainWorld("electronAPI", {
	openProject: () => electron.ipcRenderer.invoke("dialog:openProject"),
	openFile: () => electron.ipcRenderer.invoke("dialog:openFile"),
	shellOpenPath: (path) => electron.ipcRenderer.invoke("shell:openPath", path),
	serverStatus: () => electron.ipcRenderer.invoke("server:status"),
	machineId: () => electron.ipcRenderer.invoke("app:machineId"),
	connect: () => electron.ipcRenderer.invoke("app:connect")
});
//#endregion
