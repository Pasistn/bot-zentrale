const STATUS = {
  setup: { text: "Einrichtung nötig", tone: "idle" },
  stopped: { text: "Gestoppt", tone: "idle" },
  starting: { text: "Startet ...", tone: "busy" },
  running: { text: "Läuft", tone: "ok" },
  external: { text: "Läuft (extern gestartet)", tone: "ok" },
  stopping: { text: "Wird gestoppt ...", tone: "busy" },
  error: { text: "Fehler", tone: "fault" },
};

const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const toggleBtn = $("toggle");
const dashboardBtn = $("dashboard");
const browserBtn = $("browser");
const logEl = $("log");
const viewMain = $("view-main");
const viewSettings = $("view-settings");
const form = $("settings-form");
const formError = $("form-error");

let current = "stopped";
let settings = null;

function render(status) {
  current = status;
  const info = STATUS[status] ?? STATUS.stopped;
  $("status-text").textContent = info.text;
  statusEl.dataset.tone = info.tone;

  const up = status === "running" || status === "external";
  const showStop = up || status === "starting";

  toggleBtn.textContent = showStop ? "Server stoppen" : "Server starten";
  toggleBtn.classList.toggle("stop", showStop);
  toggleBtn.disabled = status === "stopping" || status === "external";
  toggleBtn.title = status === "external" ? "Dieser Server wurde außerhalb der App gestartet und kann hier nicht gestoppt werden." : "";

  dashboardBtn.disabled = !up;
  browserBtn.disabled = !up;

  if (status === "setup") showSettings(true);
}

function renderUpdate(update) {
  const box = $("update");
  const install = $("update-install");
  if (update.state === "downloading") {
    $("update-text").textContent = `Update ${update.version} wird geladen ... ${update.percent ?? 0} %`;
    install.hidden = true;
    box.hidden = false;
  } else if (update.state === "ready") {
    $("update-text").textContent = `Version ${update.version} ist bereit.`;
    install.hidden = false;
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

function appendLog({ line, kind }) {
  const empty = logEl.querySelector(".empty");
  if (empty) empty.remove();

  const stick = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  const row = document.createElement("div");
  if (kind !== "out") row.className = kind;
  row.textContent = line;
  logEl.append(row);
  while (logEl.childElementCount > 500) logEl.firstElementChild.remove();
  if (stick) logEl.scrollTop = logEl.scrollHeight;
}

function redirectUrl(port) {
  return `http://localhost:${port || 3000}/auth/callback`;
}

function showSettings(firstRun = false) {
  $("settings-title").textContent = firstRun ? "Willkommen bei der Bot-Zentrale" : "Einstellungen";
  $("settings-lead").textContent = firstRun
    ? "Bevor der Bot starten kann, braucht er eine eigene Twitch-Anwendung. Das dauert etwa fünf Minuten."
    : "Zugangsdaten und Kanal für deinen Bot. Ein laufender Server wird nach dem Speichern neu gestartet.";
  $("settings-cancel").hidden = firstRun;

  $("f-channel").value = settings.channel;
  $("f-admins").value = settings.admins;
  $("f-client-id").value = settings.clientId;
  $("f-client-secret").value = "";
  $("f-client-secret").placeholder = settings.hasSecret ? "•••••••• (gespeichert)" : "";
  $("secret-hint").textContent = settings.hasSecret ? "Leer lassen, um das gespeicherte Secret zu behalten." : "";
  $("f-port").value = settings.port;
  $("f-autostart").checked = settings.autoStart;
  $("f-database-url").value = "";
  $("f-database-url").placeholder = settings.hasDatabaseUrl ? "•••••••• (gespeichert, leer lassen zum Behalten)" : "postgresql://…";
  $("database-local-row").hidden = !settings.hasDatabaseUrl;
  $("f-database-local").checked = false;
  $("f-database-ca").value = settings.databaseCa;
  $("redirect-url").textContent = redirectUrl(settings.port);
  formError.hidden = true;

  viewMain.hidden = true;
  viewSettings.hidden = false;
}

function showMain() {
  viewSettings.hidden = true;
  viewMain.hidden = false;
}

toggleBtn.addEventListener("click", () => {
  if (current === "running" || current === "starting") window.launcher.stop();
  else window.launcher.start();
});
dashboardBtn.addEventListener("click", () => window.launcher.openDashboard());
browserBtn.addEventListener("click", () => window.launcher.openBrowser());
$("open-settings").addEventListener("click", () => showSettings(false));
$("settings-cancel").addEventListener("click", showMain);
$("open-console").addEventListener("click", () => window.launcher.openTwitchConsole());
$("update-install").addEventListener("click", () => window.launcher.installUpdate());
$("pick-ca").addEventListener("click", async () => {
  const file = await window.launcher.pickCaFile();
  if (file) $("f-database-ca").value = file;
});
$("clear-ca").addEventListener("click", () => ($("f-database-ca").value = ""));
$("f-port").addEventListener("input", (e) => ($("redirect-url").textContent = redirectUrl(e.target.value)));
$("copy-redirect").addEventListener("click", async (e) => {
  await navigator.clipboard.writeText($("redirect-url").textContent);
  e.target.textContent = "Kopiert ✓";
  setTimeout(() => (e.target.textContent = "Kopieren"), 1500);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  $("settings-save").disabled = true;
  const result = await window.launcher.saveSettings({
    channel: $("f-channel").value,
    admins: $("f-admins").value,
    clientId: $("f-client-id").value,
    clientSecret: $("f-client-secret").value,
    port: $("f-port").value,
    autoStart: $("f-autostart").checked,
    databaseUrl: $("f-database-url").value,
    databaseLocal: $("f-database-local").checked,
    databaseCa: $("f-database-ca").value,
  });
  $("settings-save").disabled = false;
  if (result.error) {
    formError.textContent = result.error;
    formError.hidden = false;
    return;
  }
  settings = result.settings;
  $("url").textContent = result.dashboardUrl;
  showMain();
});

window.launcher.onStatus(render);
window.launcher.onLog(appendLog);
window.launcher.onUpdate(renderUpdate);

window.launcher.getState().then((state) => {
  settings = state.settings;
  $("version").textContent = `v${state.version}`;
  $("url").textContent = state.dashboardUrl;
  state.logLines.forEach(appendLog);
  renderUpdate(state.update);
  render(state.status);
});
