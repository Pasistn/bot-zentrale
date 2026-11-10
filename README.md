# Bot-Zentrale

Twitch-Bot mit Web-Dashboard. Login über Twitch, Funktionen lassen sich als Module einzeln an- und ausschalten und im Dashboard konfigurieren. Läuft als Node-Server im Browser oder als Windows-Desktop-App mit Auto-Update.

## Module

- **Watch-Streaks in Discord**: Geteilte Watch-Streaks aus dem Chat werden per Webhook in einen Discord-Kanal gepostet.
- **Subs in Discord**: Erste Subs und Resub-Meilensteine (Standard: 6, 12, 18, 24 Monate).
- **Gifted Subs in Discord**: Ein Beitrag pro Geschenk, auch bei Community-Gifts mit vielen Einzelmeldungen.
- **Raids in Discord**: Ab einer einstellbaren Viewerzahl, mit Profilbild und letzter Kategorie des Raiders.
- **Stream-Zusammenfassung**: Dauer, Viewer-Peak, Raids, Gifted Subs, Chatnachrichten und ein Clip des Streams. Wird automatisch oder nach Freigabe im Dashboard gepostet.
- **Top-Chatter (OBS)**: Live-Rangliste der aktivsten Chatter als Browserquelle.
- **Watch-Streak-Alert (OBS)**: Alert mit Profilbild, Text und Ton. Eigene Bilder, Videos und Sounds lassen sich hochladen.

Unabhängig von den Modulen erfasst der Bot jeden Stream (Ø Zuschauer, Peak, neue Follower, Subs, Bits, Raids) und zeigt die Werte in der Übersicht.

Alle OBS-Overlays laufen über einen einzigen Link. Position und Größe stellt man im Dashboard ein, Änderungen sind sofort im OBS-Bild sichtbar.

## Technik

| Teil | Stack |
|---|---|
| Server | Node.js 22, TypeScript, Fastify, tmi.js, WebSockets |
| Datenbank | SQLite (`node:sqlite`), optional Postgres |
| Dashboard | Vue 3, Vite |
| Desktop | Electron, electron-builder, electron-updater |

Das Projekt ist ein npm-Workspace mit `server/` und `web/`. Die Desktop-App in `desktop/` hat eigene Abhängigkeiten.

## Einrichtung

Voraussetzung: Node.js 22.13 oder neuer und ein Twitch-Account mit 2FA.

**1. Twitch-Anwendung anlegen** unter https://dev.twitch.tv/console/apps

- Kategorie: Website Integration, Client-Typ: Vertraulich
- Redirect-URLs: `http://localhost:5173/auth/callback` (Entwicklung) und `http://localhost:3000/auth/callback` (Build)
- Client-ID und Client-Secret kopieren

**2. Installieren und konfigurieren**

```bash
npm install
cp .env.example .env
npm run secret
```

Die Ausgabe von `npm run secret` kommt in `SESSION_SECRET`. In der `.env` außerdem Client-ID, Secret, Kanal und `ADMIN_LOGINS` eintragen.

| Variable | |
|---|---|
| `PUBLIC_URL` | Adresse des Dashboards. Entwicklung `http://localhost:5173`, Build `http://localhost:3000` |
| `PORT`, `HOST` | Standard `3000` und `127.0.0.1` |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Aus der Twitch-Konsole |
| `TWITCH_CHANNEL` | Kanal, dessen Chat gelesen wird |
| `ADMIN_LOGINS` | Twitch-Namen mit Zugriff aufs Dashboard, kommagetrennt |
| `SESSION_SECRET` | Mindestens 32 Zeichen |
| `SESSION_DAYS` | Gültigkeit der Sitzung, Standard 7 |
| `DB_PATH` | SQLite-Datei, Standard `data/bot.db` |
| `DATABASE_URL`, `DATABASE_CA` | Optional: Postgres statt SQLite |

**3. Starten**

```bash
npm run dev
```

Startet Server (Port 3000) und Vite (Port 5173) mit Hot Reload. Dashboard unter http://localhost:5173.

Für den Betrieb ohne Vite `PUBLIC_URL` auf `http://localhost:3000` setzen und `npm run build && npm start` ausführen.

| Befehl | |
|---|---|
| `npm run dev` | Entwicklung |
| `npm run build` | Dashboard und Server bauen |
| `npm start` | Gebaute Version starten |
| `npm run typecheck` | TypeScript prüfen |
| `npm run secret` | Zufälliges Session-Secret |

## Desktop-App

Die App startet den Server in Electrons eigenem Node, Nutzer brauchen also weder Node.js noch eine `.env`. Kanal und Twitch-Zugangsdaten werden beim ersten Start abgefragt, das Secret wird mit `safeStorage` verschlüsselt. Einstellungen, Datenbank und hochgeladene Medien liegen in `%APPDATA%\Bot-Zentrale`.

```bash
cd desktop
npm install
npm start        # Bundle bauen und App starten
npm run dist     # Installer nach desktop/release
```

Für Auto-Updates in `desktop/package.json` unter `build.publish` die Update-URL eintragen. Bei jeder neuen Version `version` erhöhen und aus `desktop/release/` den Installer, die `.blockmap` und zuletzt `latest.yml` hochladen. Die App prüft beim Start und alle vier Stunden.

Der Installer ist nicht signiert, Windows SmartScreen fragt deshalb bei der ersten Installation nach.

## Aufbau

```
server/src/
  index.ts          Startpunkt
  config.ts         .env lesen und prüfen
  auth.ts           Twitch-OAuth, Sitzungen
  db.ts, db/        SQLite/Postgres
  twitch/           Chat-Verbindung (hub.ts), Helix-API, Streamer-Token
  stream/           Stream-Erfassung und Statistik
  modules/          Module und Modul-Manager
  overlays/         Verteilung an OBS-Overlays
  routes/           REST-API und WebSocket
server/assets/      Overlay-Seiten, Platzhalterbild
web/src/            Vue-Dashboard
desktop/            Electron-App
```

Login: OAuth Authorization Code Flow mit State-Cookie. Sitzungen liegen in der Datenbank, das Cookie ist signiert, `HttpOnly` und `SameSite=Lax`. Ändernde Anfragen und WebSockets werden nur von `PUBLIC_URL` angenommen. Secret-Einstellungen wie Webhook-URLs gehen nie zurück an den Browser.

Overlays können sich nicht bei Twitch anmelden und sind deshalb über einen geheimen Schlüssel im Link geschützt. Der Schlüssel lässt sich im Dashboard erneuern.

## Eigene Module

Ein Modul ist ein Objekt mit ID, Kategorie, Einstellungen und einer `start`-Funktion. Schalter und Einstellungsformular baut das Dashboard daraus selbst.

```ts
import type { BotModule } from "./types.js";

export function createChatCounterModule(): BotModule {
  let count = 0;

  return {
    id: "chat-counter",
    category: "twitch",
    name: "Chat-Zähler",
    description: "Schreibt alle X Nachrichten einen Eintrag ins Protokoll.",
    settings: [{ key: "every", label: "Alle … Nachrichten", type: "number", default: 100, min: 1 }],
    actions: [{ id: "reset", label: "Zurücksetzen", run: async () => ((count = 0), "Zähler auf 0.") }],
    start(ctx) {
      const every = Number(ctx.settings.every);
      ctx.on("chat", (msg) => {
        if (++count % every === 0) ctx.log("info", `${count} Nachrichten, zuletzt von ${msg.displayName}`);
      });
    },
  };
}
```

Danach in `server/src/modules/index.ts` in `createModules()` eintragen.

Der Manager startet ein Modul nur, wenn alle Pflichtfelder gesetzt sind, meldet Event-Listener beim Ausschalten selbst ab und startet das Modul nach geänderten Einstellungen neu. Fehler in einem Modul landen im Protokoll, der Rest läuft weiter.

Verfügbare Events über `ctx.on`: `chat`, `watchStreak`, `raid`, `sub`, `giftSub`, `cheer`, `streamOnline`, `streamOffline`, `status`. Einstellungstypen: `text`, `secret`, `number`, `boolean`, `color`, `select`, `media`.

## Betrieb auf einem Server

Hinter einem Reverse-Proxy mit HTTPS (z. B. Caddy), `HOST=127.0.0.1` lassen und `PUBLIC_URL` auf die öffentliche Adresse setzen. Bei `https://` werden Cookies automatisch als `Secure` gesetzt. Die neue Callback-URL muss in der Twitch-Konsole eingetragen werden.

Mit `DATABASE_URL` nutzt der Bot Postgres. Beim ersten Start werden die Tabellen angelegt und die Daten aus der lokalen SQLite-Datei übernommen, sofern die Postgres-Datenbank leer ist.

## Bekannte Punkte

- `redirect_mismatch` bei Twitch: Die Callback-URL muss exakt `PUBLIC_URL` + `/auth/callback` sein, ohne Slash am Ende.
- Nach dem Login wieder auf der Login-Seite: Dashboard über eine andere Adresse geöffnet als `PUBLIC_URL`, z. B. `127.0.0.1` statt `localhost`.
- Die Follower-Zahl braucht das Token des Streamers oder eines Mods. Dafür einmal neu anmelden.
- Der Bot liest den Chat anonym. Module, die selbst im Chat schreiben, brauchen später einen eigenen Bot-Account.

## Lizenz

MIT
