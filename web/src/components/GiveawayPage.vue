<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../api";
import type { GiveawayMode, GiveawayState, Me } from "../types";
import ToggleSwitch from "./ToggleSwitch.vue";

const props = defineProps<{ state: GiveawayState | null; me: Me }>();

const mode = ref<GiveawayMode>("chat");
const keyword = ref("!join");
const rewardTitle = ref("Giveaway-Los");
const rewardCost = ref(1000);
const maxTickets = ref(1);
const followerOnly = ref(false);
const minDays = ref(0);
const minHours = ref(0);
const subOnly = ref(false);
const subMultiplier = ref(1);
const search = ref("");
const busy = ref<string | null>(null);
const notice = ref<{ kind: "ok" | "error"; text: string } | null>(null);

const active = computed(() => props.state?.active ?? null);
const isOpen = computed(() => active.value?.status === "open");
const followCheckAvailable = computed(() => props.state?.followCheckAvailable ?? false);
const pointsAvailable = computed(() => props.state?.pointsAvailable ?? false);
const isStreamer = computed(() => props.me.user.login === props.me.channel);
const pool = computed(() => (active.value?.entries ?? []).filter((e) => !e.won).length);

const canStart = computed(() => {
  if (busy.value !== null) return false;
  if (mode.value === "chat") return keyword.value.trim() !== "";
  return pointsAvailable.value && rewardTitle.value.trim() !== "" && rewardCost.value > 0;
});

const entries = computed(() => {
  const list = active.value?.entries ?? [];
  const term = search.value.trim().toLowerCase();
  const filtered = term ? list.filter((e) => e.login.includes(term) || e.displayName.toLowerCase().includes(term)) : list;
  return [...filtered].reverse();
});

const number = (n: number) => n.toLocaleString("de-DE");
const percent = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: n < 10 ? 1 : 0 })} %`;
const day = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function duration(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const parts = [];
  if (days) parts.push(days === 1 ? "einem Tag" : `${days} Tagen`);
  if (hours) parts.push(hours === 1 ? "einer Stunde" : `${hours} Stunden`);
  return parts.join(" und ");
}

function factor(n: number): string {
  return ({ 2: "doppelt", 3: "dreifach", 4: "vierfach", 5: "fünffach" } as Record<number, string>)[n] ?? `${n}-fach`;
}

const rules = computed(() => {
  const g = active.value;
  if (!g) return [];
  const list: string[] = [];
  if (g.mode === "points") {
    list.push(`Einlösen für ${number(g.rewardCost ?? 0)} Kanalpunkte.`);
    list.push(g.maxTickets > 1 ? `Bis zu ${g.maxTickets} Lose pro Person.` : "Ein Los pro Person.");
  } else {
    list.push("In den Chat schreiben, um mitzumachen.");
  }
  if (g.followerOnly) {
    list.push(g.minFollowMinutes > 0 ? `Nur wer seit mindestens ${duration(g.minFollowMinutes)} folgt.` : "Nur Follower.");
  }
  if (g.subOnly) list.push("Nur Subscriber.");
  if (g.subMultiplier > 1) list.push(`Lose von Subscribern zählen ${factor(g.subMultiplier)}.`);
  return list;
});

async function run(key: string, task: () => Promise<unknown>, success?: string) {
  busy.value = key;
  notice.value = null;
  try {
    await task();
    if (success) notice.value = { kind: "ok", text: success };
  } catch (err) {
    notice.value = { kind: "error", text: err instanceof Error ? err.message : String(err) };
  } finally {
    busy.value = null;
  }
}

function start() {
  run("start", () =>
    api.startGiveaway({
      mode: mode.value,
      keyword: keyword.value.trim(),
      rewardTitle: rewardTitle.value.trim(),
      rewardCost: Number(rewardCost.value) || 0,
      maxTickets: Number(maxTickets.value) || 1,
      followerOnly: followerOnly.value,
      minFollowDays: Number(minDays.value) || 0,
      minFollowHours: Number(minHours.value) || 0,
      subOnly: subOnly.value,
      subMultiplier: Number(subMultiplier.value) || 1,
    })
  );
}

function remove(login: string, name: string) {
  if (active.value?.mode === "points" && !confirm(`${name} entfernen? Die eingelösten Punkte gibt es nicht zurück.`)) return;
  run("remove", () => api.removeGiveawayEntry(login));
}

function end() {
  const extra = active.value?.mode === "points" ? " Die Belohnung wird bei Twitch gelöscht." : "";
  if (!confirm(`Giveaway beenden? Die Teilnehmerliste wird geleert, die Gewinner bleiben gespeichert.${extra}`)) return;
  run("end", () => api.giveawayAction("end"));
}
</script>

<template>
  <section class="page" aria-labelledby="giveaway-title">
    <div class="page-head">
      <div>
        <h1 id="giveaway-title">Giveaway</h1>
        <p class="intro">Teilnahme per Stichwort im Chat oder mit Kanalpunkten. Gezogen wird per Zufall, jedes Los zählt.</p>
      </div>
    </div>

    <p v-if="notice" class="notice" :class="notice.kind" :role="notice.kind === 'error' ? 'alert' : 'status'">
      {{ notice.text }}
    </p>

    <form v-if="!active" class="panel setup" @submit.prevent="start">
      <h2>Neues Giveaway</h2>

      <fieldset class="group">
        <legend>Teilnahme über</legend>
        <div class="segmented" role="radiogroup">
          <label :class="{ on: mode === 'chat' }">
            <input v-model="mode" type="radio" value="chat" />
            Stichwort im Chat
          </label>
          <label :class="{ on: mode === 'points' }">
            <input v-model="mode" type="radio" value="points" />
            Kanalpunkte
          </label>
        </div>

        <div v-if="mode === 'chat'" class="field">
          <label for="gw-keyword">Stichwort</label>
          <input id="gw-keyword" v-model="keyword" class="keyword-input" type="text" maxlength="30" autocomplete="off" spellcheck="false" />
          <p class="help">Ein einzelnes Wort, Groß- und Kleinschreibung egal. Jeder bekommt ein Los.</p>
        </div>

        <template v-else>
          <div v-if="!pointsAvailable" class="notice warn unlock">
            <template v-if="isStreamer">
              <p>Twitch muss dem Bot einmal erlauben, Belohnungen anzulegen und den Sub-Status zu lesen.</p>
              <a class="btn btn-primary" href="/auth/login?streamer=1">Kanalpunkte freischalten</a>
            </template>
            <p v-else>Kanalpunkte muss {{ me.channel }} selbst einmal im Dashboard freischalten.</p>
          </div>
          <div class="field">
            <label for="gw-title">Name der Belohnung</label>
            <input id="gw-title" v-model="rewardTitle" type="text" maxlength="45" autocomplete="off" />
            <p class="help">So erscheint sie bei Twitch. Der Bot legt sie beim Start an und löscht sie am Ende wieder.</p>
          </div>
          <div class="pair">
            <div class="field">
              <label for="gw-cost">Preis in Kanalpunkten</label>
              <input id="gw-cost" v-model.number="rewardCost" type="number" min="1" max="1000000" inputmode="numeric" />
            </div>
            <div class="field">
              <label for="gw-tickets">Lose pro Person höchstens</label>
              <input id="gw-tickets" v-model.number="maxTickets" type="number" min="1" max="100" inputmode="numeric" />
            </div>
          </div>
          <p class="help">
            Wer schon alle Lose hat, die Bedingungen nicht erfüllt oder zu spät kommt, bekommt die Punkte automatisch zurück.
          </p>
        </template>
      </fieldset>

      <fieldset class="group">
        <legend>Wer mitmachen darf</legend>
        <div class="switch-row">
          <ToggleSwitch v-model="followerOnly" label="Nur Follower" />
          <span>Nur Follower</span>
        </div>
        <div v-if="followerOnly" class="indent">
          <p class="sub-label">Folgt seit mindestens</p>
          <div class="pair">
            <label class="unit">
              <input v-model.number="minDays" type="number" min="0" max="1095" inputmode="numeric" />
              <span>Tagen</span>
            </label>
            <label class="unit">
              <input v-model.number="minHours" type="number" min="0" max="23" inputmode="numeric" />
              <span>Stunden</span>
            </label>
          </div>
          <p class="help">Bei 0 und 0 reicht es, überhaupt zu folgen. Der Gewinner wird beim Ziehen noch einmal geprüft.</p>
          <p v-if="!followCheckAvailable" class="notice warn">
            Twitch gibt die Follower erst frei, wenn sich der Streamer oder ein Mod einmal neu anmeldet.
          </p>
        </div>
        <div class="switch-row">
          <ToggleSwitch v-model="subOnly" label="Nur Subscriber" />
          <span>Nur Subscriber</span>
        </div>
      </fieldset>

      <fieldset class="group">
        <legend>Bonus für Subscriber</legend>
        <div class="field">
          <label for="gw-bonus">Lose von Subscribern zählen</label>
          <select id="gw-bonus" v-model.number="subMultiplier" class="short">
            <option :value="1">normal</option>
            <option v-for="n in [2, 3, 4, 5]" :key="n" :value="n">{{ factor(n) }}</option>
            <option :value="10">10-fach</option>
          </select>
          <p class="help">Bei doppelt hat ein Sub mit einem Los die gleiche Chance wie jemand anderes mit zwei.</p>
        </div>
      </fieldset>

      <div>
        <button type="submit" class="btn btn-primary" :disabled="!canStart">
          {{ busy === "start" ? "Startet …" : "Giveaway starten" }}
        </button>
      </div>
    </form>

    <template v-else>
      <div class="panel board" :class="active.status">
        <div class="board-main">
          <p class="board-state">
            <span class="lamp" aria-hidden="true"></span>
            {{ isOpen ? "Teilnahme offen" : "Teilnahme geschlossen" }}
            <span class="via">{{ active.mode === "points" ? "über Kanalpunkte" : "über den Chat" }}</span>
          </p>
          <p class="keyword">{{ active.mode === "points" ? active.rewardTitle : active.keyword }}</p>
          <ul class="rules">
            <li v-for="r in rules" :key="r">{{ r }}</li>
          </ul>
        </div>
        <div class="counter">
          <span class="counter-value num">{{ active.entries.length }}</span>
          <span class="counter-label">Teilnehmer</span>
          <span v-if="active.tickets !== active.entries.length" class="counter-extra num">
            {{ number(active.tickets) }} Lose
          </span>
        </div>
        <div class="board-actions">
          <button
            type="button"
            class="btn btn-primary"
            :disabled="busy !== null || pool === 0"
            @click="run('draw', () => api.giveawayAction('draw'))"
          >
            {{ busy === "draw" ? "Zieht …" : active.winner ? "Neuen Gewinner ziehen" : "Gewinner ziehen" }}
          </button>
          <button
            v-if="isOpen"
            type="button"
            class="btn"
            :disabled="busy !== null"
            @click="run('close', () => api.giveawayAction('close'))"
          >
            Teilnahme schließen
          </button>
          <button
            v-else
            type="button"
            class="btn"
            :disabled="busy !== null"
            @click="run('reopen', () => api.giveawayAction('reopen'))"
          >
            Teilnahme wieder öffnen
          </button>
          <button type="button" class="btn btn-danger" :disabled="busy !== null" @click="end">Giveaway beenden</button>
        </div>
        <p v-if="active.rejected > 0" class="rejected">
          {{ active.rejected === 1 ? "1 Account wurde" : `${active.rejected} Accounts wurden` }} nicht aufgenommen, weil
          eine Bedingung nicht erfüllt war. Details stehen im Protokoll.
        </p>
      </div>

      <div v-if="active.winner" class="panel winner" aria-live="polite">
        <div class="winner-head">
          <div>
            <h2>Gewinner</h2>
            <p class="winner-name">{{ active.winner.displayName }}</p>
            <p class="winner-meta">
              <template v-if="active.winner.followedAt">Folgt seit {{ day(active.winner.followedAt) }}</template>
              <template v-if="active.winner.subscriber">{{ active.winner.followedAt ? ", " : "" }}Subscriber</template>
              <template v-if="active.winner.tickets > 1">
                {{ active.winner.followedAt || active.winner.subscriber ? ", " : "" }}{{ active.winner.tickets }} Lose
              </template>
            </p>
          </div>
          <a class="btn" :href="`https://twitch.tv/${active.winner.login}`" target="_blank" rel="noopener noreferrer">
            Kanal öffnen
          </a>
        </div>
        <div class="messages">
          <h3>Nachrichten seit der Ziehung</h3>
          <ol v-if="active.winner.messages.length">
            <li v-for="(m, i) in active.winner.messages" :key="i">
              <time class="num" :datetime="m.at">{{ time(m.at) }}</time>
              <span>{{ m.text }}</span>
            </li>
          </ol>
          <p v-else class="quiet">Noch nichts geschrieben.</p>
        </div>
      </div>

      <div class="panel entries">
        <div class="entries-head">
          <h2>Im Topf <span class="num faint">{{ pool }} von {{ active.entries.length }}</span></h2>
          <label class="search">
            <span class="sr-only">Teilnehmer suchen</span>
            <input v-model="search" type="search" placeholder="Name suchen" autocomplete="off" />
          </label>
        </div>
        <p v-if="active.entries.length === 0" class="quiet pad">
          <template v-if="active.mode === 'points'">
            Noch niemand dabei. Sobald jemand „{{ active.rewardTitle }}“ einlöst, erscheint er hier.
          </template>
          <template v-else>Noch niemand dabei. Sobald jemand „{{ active.keyword }}“ in den Chat schreibt, erscheint er hier.</template>
        </p>
        <p v-else-if="entries.length === 0" class="quiet pad">Kein Teilnehmer passt zu „{{ search }}“.</p>
        <ul v-else>
          <li v-for="e in entries" :key="e.login" :class="{ won: e.won }">
            <span class="who">
              <span class="name">{{ e.displayName }}</span>
              <span v-if="e.subscriber" class="tag sub">Sub</span>
              <span v-if="e.won" class="tag">Gewonnen</span>
            </span>
            <span class="meta since">{{ e.followedAt ? `Folgt seit ${day(e.followedAt)}` : "" }}</span>
            <span class="meta num">{{ e.tickets > 1 ? `${e.tickets} Lose` : "" }}</span>
            <span class="chance num">{{ e.chance !== null ? percent(e.chance) : "" }}</span>
            <button
              type="button"
              class="remove"
              :aria-label="`${e.displayName} entfernen`"
              :disabled="busy !== null"
              @click="remove(e.login, e.displayName)"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </li>
        </ul>
      </div>
    </template>

    <div v-if="state && state.recentWinners.length" class="history">
      <h2>Letzte Gewinner</h2>
      <ul>
        <li v-for="(w, i) in state.recentWinners" :key="`${w.login}-${w.wonAt}-${i}`">
          <span class="name">{{ w.displayName }}</span>
          <span class="faint">{{ w.keyword }}</span>
          <time class="num faint" :datetime="w.wonAt">{{ dateTime(w.wonAt) }}</time>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.setup {
  display: grid;
  gap: 1.5rem;
  padding: 1.4rem 1.5rem 1.5rem;
  max-width: 42rem;
}

.group {
  display: grid;
  gap: 0.9rem;
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  float: left;
  width: 100%;
  padding: 0;
  margin-bottom: 0.1rem;
  font-size: var(--step-0);
  font-stretch: 85%;
  font-weight: 650;
}

legend + * {
  clear: both;
}

.group + .group {
  padding-top: 1.4rem;
  border-top: 1px solid var(--line);
}

.segmented {
  display: inline-flex;
  width: fit-content;
  padding: 3px;
  gap: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--field);
}

.segmented label {
  padding: 0.4rem 0.9rem;
  border-radius: 4px;
  font-size: var(--step--1);
  font-weight: 550;
  color: var(--text-muted);
  cursor: pointer;
}

.segmented label.on {
  background: var(--surface-2);
  color: var(--text);
}

.segmented label:has(input:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.segmented input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.field {
  display: grid;
  gap: 0.4rem;
}

.field label,
.sub-label {
  font-weight: 550;
  font-size: var(--step--1);
}

.keyword-input {
  max-width: 16rem;
  font-size: var(--step-1);
  font-weight: 600;
}

#gw-title {
  max-width: 22rem;
}

.pair {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.pair .field input {
  width: 9rem;
}

.short {
  width: auto;
  min-width: 10rem;
  justify-self: start;
}

.unit {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
}

.unit input {
  width: 5.5rem;
}

.help {
  color: var(--text-faint);
  font-size: var(--step--1);
  max-width: 62ch;
}

.unlock {
  display: grid;
  gap: 0.7rem;
  justify-items: start;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-weight: 500;
}

.indent {
  display: grid;
  gap: 0.5rem;
  padding-left: calc(2.75rem + 0.75rem);
}

.board {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1.25rem 2rem;
  padding: 1.6rem 1.75rem;
  border-top: 4px solid var(--on);
}

.board.closed {
  border-top-color: var(--warn);
}

.board-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--step--1);
  font-weight: 600;
  color: var(--on);
}

.closed .board-state {
  color: var(--warn);
}

.via {
  color: var(--text-faint);
  font-weight: 400;
}

.lamp {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.keyword {
  margin-top: 0.35rem;
  font-size: var(--step-4);
  font-stretch: 65%;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}

.rules {
  list-style: none;
  margin: 0.75rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.25rem;
  color: var(--text-muted);
}

.counter {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
  text-align: right;
}

.counter-value {
  font-size: var(--step-4);
  font-stretch: 65%;
  font-weight: 700;
  line-height: 1;
  color: var(--accent);
}

.counter-label {
  font-size: var(--step--1);
  color: var(--text-muted);
}

.counter-extra {
  margin-top: 0.15rem;
  font-size: var(--step--1);
  color: var(--text-faint);
}

.board-actions {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.board-actions .btn-danger {
  margin-left: auto;
}

.rejected {
  grid-column: 1 / -1;
  font-size: var(--step--1);
  color: var(--text-faint);
}

.winner {
  display: grid;
  gap: 1.25rem;
  padding: 1.4rem 1.5rem;
  border-left: 4px solid var(--accent);
}

.winner-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
}

.winner h2 {
  font-size: var(--step--1);
  font-stretch: 100%;
  font-weight: 550;
  color: var(--accent);
}

.winner-name {
  margin-top: 0.2rem;
  font-size: var(--step-3);
  font-stretch: 75%;
  font-weight: 700;
  line-height: 1.1;
  overflow-wrap: anywhere;
}

.winner-meta {
  margin-top: 0.3rem;
  color: var(--text-muted);
  font-size: var(--step--1);
}

.messages h3 {
  font-size: var(--step--1);
  font-stretch: 100%;
  font-weight: 550;
  color: var(--text-muted);
  margin-bottom: 0.5rem;
}

.messages ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.3rem;
}

.messages li {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.75rem;
  overflow-wrap: anywhere;
}

.messages time {
  color: var(--text-faint);
  font-size: var(--step--1);
  padding-top: 0.1rem;
}

.quiet {
  color: var(--text-faint);
  font-size: var(--step--1);
}

.pad {
  padding: 1rem 1.25rem 1.25rem;
}

.entries-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}

.entries-head h2 {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.faint {
  color: var(--text-faint);
  font-size: var(--step--1);
  font-weight: 400;
  font-stretch: 100%;
}

.search input {
  width: 14rem;
  padding-block: 0.4rem;
}

.entries ul {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 28rem;
  overflow-y: auto;
}

.entries li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 4.5rem 4rem auto;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 0.75rem 0.5rem 1.25rem;
}

.entries li + li {
  border-top: 1px solid var(--line);
}

.entries li.won {
  background: var(--accent-soft);
}

.who {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}

.name {
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--accent);
}

.tag.sub {
  color: #c39bff;
}

.meta {
  color: var(--text-faint);
  font-size: var(--step--1);
  text-align: right;
}

.chance {
  text-align: right;
  font-size: var(--step--1);
  color: var(--text-muted);
}

.remove {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-faint);
}

.remove:hover:not(:disabled) {
  background: var(--fault-soft);
  color: var(--fault);
}

.remove svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.history {
  display: grid;
  gap: 0.6rem;
}

.history ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.history li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 1.25rem;
  padding: 0.45rem 0;
  border-bottom: 1px solid var(--line);
}

@media (max-width: 640px) {
  .board {
    grid-template-columns: 1fr;
  }

  .counter {
    align-items: flex-start;
    text-align: left;
  }

  .board-actions .btn-danger {
    margin-left: 0;
  }

  .entries li {
    grid-template-columns: minmax(0, 1fr) auto 3.5rem auto;
  }

  .since {
    display: none;
  }

  .search input {
    width: 100%;
  }

  .indent {
    padding-left: 0;
  }
}
</style>
