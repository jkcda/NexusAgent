import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import os from "os";
//#region electron/main.ts
var __dirname = dirname(fileURLToPath(import.meta.url));
var MACHINE_ID = createHash("sha256").update(`${os.hostname()}-${os.userInfo().username}-${os.platform()}`).digest("hex").slice(0, 16);
var mainWindow = null;
var SERVER_URL = `http://127.0.0.1:3000`;
async function waitForServer(retries = 30, interval = 1e3) {
	for (let i = 0; i < retries; i++) {
		try {
			if ((await fetch(`${SERVER_URL}/api/ai/models`)).ok) return true;
		} catch {}
		await new Promise((r) => setTimeout(r, interval));
	}
	return false;
}
function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 1e3,
		minHeight: 600,
		title: "NEXUS Desktop",
		titleBarStyle: "hiddenInset",
		webPreferences: {
			preload: join(__dirname, "preload.mjs"),
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	if (process.env.VITE_DEV_SERVER_URL) {
		mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
		mainWindow.webContents.openDevTools();
	} else mainWindow.loadFile(join(__dirname, "..", "dist", "index.html"));
}
ipcMain.handle("dialog:openProject", async () => {
	const result = await dialog.showOpenDialog(mainWindow, {
		properties: ["openDirectory"],
		title: "选择项目目录"
	});
	if (result.canceled || result.filePaths.length === 0) return null;
	const projectPath = result.filePaths[0];
	try {
		await fetch(`${SERVER_URL}/api/fs/workspace`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ root: projectPath })
		});
	} catch (e) {
		console.error("[Electron] workspace switch failed:", e.message);
	}
	return projectPath;
});
ipcMain.handle("dialog:openFile", async () => {
	const result = await dialog.showOpenDialog(mainWindow, {
		properties: ["openFile"],
		title: "选择文件"
	});
	return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("shell:openPath", async (_e, path) => {
	shell.openPath(path);
});
ipcMain.handle("server:status", async () => {
	try {
		return (await fetch(`${SERVER_URL}/api/ai/models`)).ok ? "connected" : "error";
	} catch {
		return "offline";
	}
});
ipcMain.handle("app:machineId", () => MACHINE_ID);
ipcMain.handle("app:connect", async () => {
	try {
		const resp = await fetch(`${SERVER_URL}/api/desktop/handshake`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ machineId: MACHINE_ID })
		});
		if (resp.ok) {
			const data = await resp.json();
			return {
				userId: data.result.userId,
				username: data.result.username
			};
		}
	} catch {}
	return {
		userId: 1,
		username: "desktop"
	};
});
app.whenReady().then(() => {
	createWindow();
	waitForServer(10, 1500).then((online) => {
		console.log(online ? "[Electron] Server detected" : "[Electron] Server not detected — start with: cd server && npx tsx src/app.ts");
	});
});
app.on("window-all-closed", () => {
	app.quit();
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
//#endregion
export {};
