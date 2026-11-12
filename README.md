# Bot-Zentrale

Twitch-Bot mit Web-Dashboard für mehrere Streamer. Ein Server, eine Twitch-Anwendung: Freigeschaltete Streamer melden sich mit ihrem Twitch-Account an und bekommen ihren eigenen Bereich mit eigenen Modulen, Overlays und Statistiken. Funktionen lassen sich als Module einzeln an- und ausschalten und im Dashboard konfigurieren.

## Module

- **Watch-Streaks in Discord**: Geteilte Watch-Streaks aus dem Chat werden per Webhook in einen Discord-Kanal gepostet.
- **Subs in Discord**: Erste Subs und Resub-Meilensteine (Standard: 6, 12, 18, 24 Monate).
- **Gifted Subs in Discord**: Ein Beitrag pro Geschenk, auch bei Community-Gifts mit vielen Einzelmeldungen.
- **Raids in Discord**: Ab einer einstellbaren Viewerzahl, mit Profilbild und letzter Kategorie des Raiders.
- **Stream-Zusammenfassung**: Dauer, Viewer-Peak, Raids, Gifted Subs, Chatnachrichten und ein Clip des Streams. Wird automatisch oder nach Freigabe im Dashboard gepostet.
- **Top-Chatter (OBS)**: Live-Rangliste der aktivsten Chatter als Browserquelle.
- **Watch-Streak-Alert (OBS)**: Alert mit Profilbild, Text und Ton. Eigene Bilder, Videos und Sounds lassen sich hochladen.

Dazu kommt ein **Giveaway-Tool**. Mitmachen geht per Stichwort im Chat oder mit **Kanalpunkten**: Der Bot legt die Belohnung bei Twitch selbst an, empfängt Einlösungen über EventSub (WebSocket) und erstattet Punkte automatisch zurück, wenn jemand schon alle Lose hat oder eine Bedingung nicht erfüllt. Pro Giveaway einstellbar: Lose pro Person, nur Follower (optional mit Mindestdauer), nur Subscriber und ein Bonus-Faktor für Subscriber. Gezogen wird gewichtet nach Losen mit `crypto.randomInt`, die Follower-Bedingung wird beim Ziehen noch einmal geprüft, und das Dashboard zeigt danach die Chatnachrichten des Gewinners live.

Unabhängig von den Modulen erfasst der Bot jeden Stream (Ø Zuschauer, Peak, neue Follower, Subs, Bits, Raids) und zeigt die Werte in der Übersicht.

Das Dashboard läuft im Browser. In Chrome oder Edge lässt es sich über „Als App installieren“ als eigenes Fenster mit Desktop-Symbol einrichten.

Alle OBS-Overlays laufen über einen einzigen Link. Position und Größe stellt man im Dashboard ein, Änderungen sind sofort im OBS-Bild sichtbar.

## Technik

| Teil | Stack |
|---|---|
| Server | Node.js 22, TypeScript, Fastify, tmi.js, WebSockets |
| Datenbank | SQLite (`node:sqlite`), optional Postgres |
| Dashboard | Vue 3, Vite |
| Betrieb | Ubuntu (ARM64), Caddy, systemd |

Das Projekt ist ein npm-Workspace mit `server/` und `web/`.

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

Die Ausgabe von `npm run secret` kommt in `SESSION_SECRET`. In der `.env` außerdem Client-ID, Secret und `OWNER_LOGINS` eintragen.

| Variable | |
|---|---|
| `PUBLIC_URL` | Adresse des Dashboards. Entwicklung `http://localhost:5173`, Build `http://localhost:3000` |
| `PORT`, `HOST` | Standard `3000` und `127.0.0.1` |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Aus der Twitch-Konsole |
| `OWNER_LOGINS` | Betreiber der Zentrale, kommagetrennt. Sie schalten Streamer frei und sehen alle Kanäle |
| `TWITCH_CHANNEL` | Optional: eigener Kanal, wird beim Start automatisch freigeschaltet |
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
| `npm run deploy` | Committeten Stand auf den Server bringen |

## Mehrere Streamer

Im Reiter **Zugriff** schalten Betreiber neue Streamer frei. Der Bot tritt dann dem Chat des Kanals bei, und der Streamer kann sich anmelden. Jeder Streamer kann dort außerdem Mods eintragen, die sein Dashboard mitbenutzen dürfen. Wer Zugriff auf mehrere Kanäle hat, wechselt oben rechts.

Alle Kanäle teilen sich eine Chat-Verbindung. Pro Kanal gibt es eigene Moduleinstellungen, Statistiken, Medien, Overlay-Links und ein eigenes Protokoll. Die Trennung passiert serverseitig über die Sitzung, nicht über Parameter aus dem Browser.

Bestehende Daten aus der Version für einen Kanal werden beim ersten Start automatisch `TWITCH_CHANNEL` (sonst dem ersten Eintrag aus `OWNER_LOGINS`) zugeordnet. Vorher legt der Server eine Sicherung als `bot.vor-umbau.db` an. Overlay-Links bleiben gültig.

## Aufbau

```
server/src/
  index.ts          Startpunkt
  config.ts         .env lesen und prüfen
  channels.ts       Kanäle starten und stoppen, Zugriffsregeln
  giveaway.ts       Giveaways pro Kanal: Teilnahme per Stichwort, Follower-Prüfung, Ziehung
  auth.ts           Twitch-OAuth, Sitzungen
  db.ts, db/        SQLite/Postgres
  twitch/           Chat-Verbindung (chat.ts), Ereignisse pro Kanal (hub.ts), EventSub für Kanalpunkte,
                    Helix-API, Streamer-Token
  stream/           Stream-Erfassung und Statistik
  modules/          Module und Modul-Manager
  overlays/         Verteilung an OBS-Overlays
  routes/           REST-API und WebSocket
server/assets/      Overlay-Seiten, Platzhalterbild
web/src/            Vue-Dashboard
deploy/             Dienst, Caddy, Update-Skript
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

Läuft produktiv auf einer Ubuntu-VM (ARM64) hinter Caddy, der das HTTPS-Zertifikat selbst holt. Die Dateien dazu liegen in `deploy/`:

| Datei | |
|---|---|
| `deploy/Caddyfile` | Reverse-Proxy auf `127.0.0.1:3000` |
| `deploy/bot-zentrale.service` | systemd-Dienst mit Neustart bei Absturz, Schreibrechte nur auf `data/` |
| `deploy/update.sh` | Sichert die Datenbank, installiert, baut und startet neu |

Auf dem Server steht in der `.env` `PUBLIC_URL` auf der öffentlichen HTTPS-Adresse, `HOST` bleibt `127.0.0.1`. Bei `https://` werden Cookies automatisch als `Secure` gesetzt. Die Callback-URL `https://…/auth/callback` muss in der Twitch-Konsole eingetragen sein.

Updates gehen per Git über SSH direkt auf den Server, ohne Umweg über GitHub:

```bash
git remote add server bot-zentrale:/opt/bot-zentrale
npm run deploy
```

`npm run deploy` bricht ab, wenn es nicht committete Änderungen gibt. Auf dem Server muss dafür `git config receive.denyCurrentBranch updateInstead` gesetzt sein. Vor jedem Update landet eine Sicherung der Datenbank in `data/backups/`, die letzten 14 bleiben erhalten.

Mit `DATABASE_URL` nutzt der Bot Postgres statt SQLite. Beim ersten Start werden die Tabellen angelegt und die Daten aus der lokalen SQLite-Datei übernommen, sofern die Postgres-Datenbank leer ist.

## Bekannte Punkte

- `redirect_mismatch` bei Twitch: Die Callback-URL muss exakt `PUBLIC_URL` + `/auth/callback` sein, ohne Slash am Ende.
- Nach dem Login wieder auf der Login-Seite: Dashboard über eine andere Adresse geöffnet als `PUBLIC_URL`, z. B. `127.0.0.1` statt `localhost`.
- Die Follower-Zahl braucht das Token des Streamers oder eines Mods. Dafür einmal neu anmelden.
- Kanalpunkte-Giveaways brauchen einen Affiliate- oder Partner-Kanal. Der Streamer schaltet sie einmal im Giveaway-Formular frei, das fragt bei Twitch die Rechte `channel:manage:redemptions` und `channel:read:subscriptions` an.
- Der Bot liest den Chat anonym. Module, die selbst im Chat schreiben, brauchen später einen eigenen Bot-Account.

## Lizenz

MIT
