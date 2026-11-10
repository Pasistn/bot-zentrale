const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { fork } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");

const serverEntry = path.join(__dirname, "bundle", "server", "dist", "index.mjs");
const iconPath = path.join(__dirname, "icon.png");
const dataDir = app.getPath("userData");
const settingsPath = path.join(dataDir, "settings.json");

const MAX_LOG_LINES = 500;
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 8_000;
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;

let launcherWindow = null;
let dashboardWindow = null;
let serverProcess = null;
let status = "stopped";
let update = { state: "idle" };
let quitting = false;
const logLines = [];

function loadSettings() {
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return {};
  }
}

function saveSettingsFile(settings) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

async function seal(name, value) {
  if (await safeStorage.isAsyncEncryptionAvailable()) {
    return { [`${name}Enc`]: (await safeStorage.encryptStringAsync(value)).toString("base64") };
  }
  return { [`${name}Plain`]: value };
}

async function unseal(settings, name) {
  const enc = settings[`${name}Enc`];
  if (enc) {
    try {
      return (await safeStorage.decryptStringAsync(Buffer.from(enc, "base64"))).result;
    } catch {
      return "";
    }
  }
  return settings[`${name}Plain`] ?? "";
}

function keepSealed(settings, name) {
  return { [`${name}Enc`]: settings[`${name}Enc`], [`${name}Plain`]: settings[`${name}Plain`] };
}

const decryptSecret = (settings) => unseal(settings, "clientSecret");

async function isConfigured(settings) {
  return Boolean(settings.channel && settings.clientId && settings.sessionSecret && (await decryptSecret(settings)));
}

function portOf(settings) {
  return settings.port || 3000;
}

function dashboardUrl() {
  return `http://localhost:${portOf(loadSettings())}`;
}

async function publicSettings() {
  const s = loadSettings();
  return {
    channel: s.channel ?? "",
    clientId: s.clientId ?? "",
    hasSecret: Boolean(await decryptSecret(s)),
    admins: (s.admins ?? []).join(", "),
    port: portOf(s),
    autoStart: Boolean(s.autoStart),
    hasDatabaseUrl: Boolean(await unseal(s, "databaseUrl")),
    databaseCa: s.databaseCa ?? "",
  };
}

async function validateSettings(input, existing) {
  const channel = String(input.channel ?? "").trim().toLowerCase().replace(/^#/, "");
  const clientId = String(input.clientId ?? "").trim();
  const clientSecret = String(input.clientSecret ?? "").trim();
  const admins = String(input.admins ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  const port = Number(input.port);
  const databaseUrl = String(input.databaseUrl ?? "").trim();
  const databaseCa = String(input.databaseCa ?? "").trim();

  if (!/^[a-z0-9_]{3,25}$/.test(channel)) return { error: "Bitte gib deinen Twitch-Kanalnamen ein (wie in der Kanal-URL)." };
  if (!clientId) return { error: "Die Client-ID fehlt." };
  if (!clientSecret && !(await decryptSecret(existing))) return { error: "Das Client-Secret fehlt." };
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return { error: "Der Port muss eine Zahl zwischen 1024 und 65535 sein." };
  if (databaseUrl && !/^postgres(ql)?:\/\/.+/.test(databaseUrl)) {
    return { error: "Die Datenbank-Adresse muss mit postgresql:// beginnen. In Supabase: Connect → Session pooler." };
  }
  if (databaseCa && !existsSync(databaseCa)) return { error: "Die Zertifikatsdatei gibt es nicht mehr." };

  const next = {
    channel,
    clientId,
    admins: admins.length > 0 ? admins : [channel],
    port,
    autoStart: Boolean(input.autoStart),
    sessionSecret: existing.sessionSecret || randomBytes(32).toString("hex"),
    databaseCa: databaseCa || undefined,
  };
  Object.assign(next, clientSecret ? await seal("clientSecret", clientSecret) : keepSealed(existing, "clientSecret"));
  if (input.databaseLocal) Object.assign(next, { databaseUrlEnc: undefined, databaseUrlPlain: undefined });
  else Object.assign(next, databaseUrl ? await seal("databaseUrl", databaseUrl) : keepSealed(existing, "databaseUrl"));
  return { settings: next };
}

function send(channel, payload) {
  if (launcherWindow && !launcherWindow.isDestroyed()) launcherWindow.webContents.send(channel, payload);
}

function setStatus(next) {
  status = next;
  send("status", status);
}

function setUpdate(next) {
  update = next;
  send("update", update);
}

function addLog(text, kind = "out") {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, "");
  for (const line of clean.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = { line, kind };
    logLines.push(entry);
    if (logLines.length > MAX_LOG_LINES) logLines.shift();
    send("log", entry);
  }
}

async function isServerReachable() {
  try {
    const response = await fetch(dashboardUrl(), { signal: AbortSignal.timeout(1500) });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function startServer() {
  if (serverProcess) return;

  const settings = loadSettings();
  const clientSecret = await decryptSecret(settings);
  const databaseUrl = await unseal(settings, "databaseUrl");
  if (!(await isConfigured(settings))) {
    setStatus("setup");
    return;
  }

  const url = dashboardUrl();
  if (await isServerReachable()) {
    addLog(`Auf ${url} läuft bereits ein Server. Läuft der Bot schon woanders, oder nutzt ein anderes Programm den Port?`, "app");
    setStatus("external");
    return;
  }

  if (!existsSync(serverEntry)) {
    addLog("Server-Bundle fehlt. Im Ordner desktop zuerst \"npm run bundle\" ausführen.", "err");
    setStatus("error");
    return;
  }

  setStatus("starting");
  addLog(`Starte Server auf ${url} ...`, "app");

  const child = fork(serverEntry, [], {
    execPath: process.execPath,
    execArgv: ["--disable-warning=ExperimentalWarning", "--disable-warning=DEP0040"],
    cwd: dataDir,
    silent: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PUBLIC_URL: url,
      PORT: String(portOf(settings)),
      HOST: "127.0.0.1",
      TWITCH_CLIENT_ID: settings.clientId,
      TWITCH_CLIENT_SECRET: clientSecret,
      TWITCH_CHANNEL: settings.channel,
      ADMIN_LOGINS: settings.admins.join(","),
      SESSION_SECRET: settings.sessionSecret,
      DB_PATH: path.join(dataDir, "bot.db"),
      DATABASE_URL: databaseUrl,
      DATABASE_CA: settings.databaseCa ?? "",
    },
  });
  serverProcess = child;

  child.stdout.on("data", (chunk) => addLog(chunk.toString()));
  child.stderr.on("data", (chunk) => addLog(chunk.toString(), "err"));
  child.on("error", (err) => addLog(`Server konnte nicht gestartet werden: ${err.message}`, "err"));
  child.on("exit", (code) => {
    if (serverProcess === child) serverProcess = null;
    const expected = status === "stopping" || quitting;
    addLog(expected ? "Server gestoppt." : `Server unerwartet beendet (Code ${code}).`, expected ? "app" : "err");
    setStatus(expected ? "stopped" : "error");
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (serverProcess === child && Date.now() < deadline) {
    if (await isServerReachable()) {
      setStatus("running");
      addLog("Server läuft. Das Dashboard kann geöffnet werden.", "app");
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (serverProcess === child) addLog("Der Server antwortet noch nicht. Sieh im Log nach Fehlern.", "err");
}

function stopServer() {
  const child = serverProcess;
  if (!child) {
    if (status === "external" || status === "error") setStatus("stopped");
    return Promise.resolve();
  }
  setStatus("stopping");
  addLog("Stoppe Server ...", "app");
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      addLog("Server reagiert nicht, wird hart beendet.", "err");
      child.kill();
    }, STOP_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    if (child.connected) child.send("shutdown");
    else child.kill();
  });
}

function setupUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    addLog(`Update auf Version ${info.version} gefunden, wird heruntergeladen ...`, "app");
    setUpdate({ state: "downloading", version: info.version, percent: 0 });
  });
  autoUpdater.on("download-progress", (progress) => {
    setUpdate({ ...update, percent: Math.round(progress.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    addLog(`Update ${info.version} ist bereit.`, "app");
    setUpdate({ state: "ready", version: info.version });
  });
  autoUpdater.on("error", (err) => {
    addLog(`Update-Prüfung fehlgeschlagen: ${err.message.split("\n")[0]}`, "err");
    if (update.state === "downloading") setUpdate({ state: "idle" });
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, UPDATE_INTERVAL_MS);
}

async function installUpdate() {
  if (update.state !== "ready") return;
  await stopServer();
  quitting = true;
  autoUpdater.quitAndInstall(true, true);
}

function openDashboard() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    if (dashboardWindow.isMinimized()) dashboardWindow.restore();
    dashboardWindow.focus();
    return;
  }
  dashboardWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: "Bot-Zentrale – Dashboard",
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  dashboardWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  dashboardWindow.loadURL(dashboardUrl());
  dashboardWindow.on("closed", () => (dashboardWindow = null));
}

function createLauncherWindow() {
  launcherWindow = new BrowserWindow({
    width: 780,
    height: 680,
    minWidth: 560,
    minHeight: 520,
    title: "Bot-Zentrale",
    icon: iconPath,
    autoHideMenuBar: true,
    backgroundColor: "#e6eeff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  launcherWindow.loadFile(path.join(__dirname, "index.html"));
  launcherWindow.on("closed", () => (launcherWindow = null));
}

ipcMain.handle("get-state", async () => ({
  status,
  logLines,
  update,
  dashboardUrl: dashboardUrl(),
  version: app.getVersion(),
  settings: await publicSettings(),
}));
ipcMain.handle("start", () => startServer());
ipcMain.handle("stop", () => stopServer());
ipcMain.handle("open-dashboard", () => openDashboard());
ipcMain.handle("open-browser", () => shell.openExternal(dashboardUrl()));
ipcMain.handle("open-twitch-console", () => shell.openExternal("https://dev.twitch.tv/console/apps"));
ipcMain.handle("install-update", () => installUpdate());
ipcMain.handle("pick-ca-file", async () => {
  const result = await dialog.showOpenDialog(launcherWindow, {
    title: "CA-Zertifikat der Datenbank wählen",
    filters: [{ name: "Zertifikat", extensions: ["crt", "pem", "cer"] }],
    properties: ["openFile"],
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("save-settings", async (_event, input) => {
  const result = await validateSettings(input, loadSettings());
  if (result.error) return { error: result.error };
  saveSettingsFile(result.settings);
  addLog("Einstellungen gespeichert.", "app");

  const wasRunning = Boolean(serverProcess);
  if (wasRunning) await stopServer();
  setStatus("stopped");
  if (wasRunning) startServer();
  return { settings: await publicSettings(), dashboardUrl: dashboardUrl() };
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!launcherWindow) return;
    if (launcherWindow.isMinimized()) launcherWindow.restore();
    launcherWindow.focus();
  });

  app.whenReady().then(async () => {
    const settings = loadSettings();
    status = (await isConfigured(settings)) ? "stopped" : "setup";
    createLauncherWindow();
    setupUpdates();

    if (status === "setup") return;
    if (await isServerReachable()) {
      addLog(`Auf ${dashboardUrl()} läuft bereits ein Server.`, "app");
      setStatus("external");
    } else if (settings.autoStart) {
      startServer();
    }
  });

  app.on("before-quit", (event) => {
    if (quitting || !serverProcess) return;
    event.preventDefault();
    quitting = true;
    stopServer().finally(() => app.quit());
  });

  app.on("window-all-closed", () => app.quit());
}
