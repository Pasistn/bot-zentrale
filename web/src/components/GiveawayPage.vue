<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../api";
import type { GiveawayState } from "../types";
import ToggleSwitch from "./ToggleSwitch.vue";

const props = defineProps<{ state: GiveawayState | null }>();

const keyword = ref("!join");
const followerOnly = ref(false);
const minDays = ref(0);
const minHours = ref(0);
const search = ref("");
const busy = ref<string | null>(null);
const notice = ref<{ kind: "ok" | "error"; text: string } | null>(null);

const active = computed(() => props.state?.active ?? null);
const isOpen = computed(() => active.value?.status === "open");
const followCheckAvailable = computed(() => props.state?.followCheckAvailable ?? false);

const entries = computed(() => {
  const list = active.value?.entries ?? [];
  const term = search.value.trim().toLowerCase();
  const filtered = term ? list.filter((e) => e.login.includes(term) || e.displayName.toLowerCase().includes(term)) : list;
  return [...filtered].reverse();
});

const pool = computed(() => (active.value?.entries ?? []).filter((e) => !e.won).length);

function duration(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const parts = [];
  if (days) parts.push(days === 1 ? "einem Tag" : `${days} Tagen`);
  if (hours) parts.push(hours === 1 ? "einer Stunde" : `${hours} Stunden`);
  return parts.join(" und ");
}

const rule = computed(() => {
  const g = active.value;
  if (!g) return "";
  if (!g.followerOnly) return "Alle im Chat können mitmachen.";
  if (g.minFollowMinutes === 0) return "Nur Follower können mitmachen.";
  return `Nur wer seit mindestens ${duration(g.minFollowMinutes)} folgt, kann mitmachen.`;
});

const day = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

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
      keyword: keyword.value.trim(),
      followerOnly: followerOnly.value,
      minFollowDays: Number(minDays.value) || 0,
      minFollowHours: Number(minHours.value) || 0,
    })
  );
}

function end() {
  if (!confirm("Giveaway beenden? Die Teilnehmerliste wird geleert, die Gewinner bleiben unten in der Liste.")) return;
  run("end", () => api.giveawayAction("end"));
}
</script>

<template>
  <section class="page" aria-labelledby="giveaway-title">
    <div class="page-head">
      <div>
        <h1 id="giveaway-title">Giveaway</h1>
        <p class="intro">Zuschauer machen mit, indem sie ein Stichwort in den Chat schreiben. Gezogen wird per Zufall.</p>
      </div>
    </div>

    <p v-if="notice" class="notice" :class="notice.kind" :role="notice.kind === 'error' ? 'alert' : 'status'">
      {{ notice.text }}
    </p>

    <form v-if="!active" class="panel setup" @submit.prevent="start">
      <h2>Neues Giveaway</h2>

      <div class="field">
        <label for="gw-keyword">Stichwort</label>
        <input id="gw-keyword" v-model="keyword" type="text" maxlength="30" autocomplete="off" spellcheck="false" />
        <p class="help">Ein einzelnes Wort, Groß- und Kleinschreibung egal. Wer es im Chat schreibt, ist dabei.</p>
      </div>

      <div class="switch-row">
        <ToggleSwitch v-model="followerOnly" label="Nur Follower können mitmachen" />
        <span>Nur Follower können mitmachen</span>
      </div>

      <fieldset v-if="followerOnly" class="follow">
        <legend>Folgt seit mindestens</legend>
        <div class="follow-inputs">
          <label>
            <input v-model.number="minDays" type="number" min="0" max="1095" inputmode="numeric" />
            <span>Tagen</span>
          </label>
          <label>
            <input v-model.number="minHours" type="number" min="0" max="23" inputmode="numeric" />
            <span>Stunden</span>
          </label>
        </div>
        <p class="help">Bei 0 und 0 reicht es, überhaupt zu folgen. Der Gewinner wird beim Ziehen noch einmal geprüft.</p>
        <p v-if="!followCheckAvailable" class="notice warn">
          Twitch gibt die Follower erst frei, wenn sich der Streamer oder ein Mod einmal neu anmeldet.
        </p>
      </fieldset>

      <div>
        <button type="submit" class="btn btn-primary" :disabled="busy !== null || !keyword.trim()">
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
          </p>
          <p class="keyword">{{ active.keyword }}</p>
          <p class="board-rule">{{ rule }}</p>
        </div>
        <div class="counter">
          <span class="counter-value num">{{ active.entries.length }}</span>
          <span class="counter-label">Teilnehmer</span>
        </div>
        <div class="board-actions">
          <button type="button" class="btn btn-primary" :disabled="busy !== null || pool === 0" @click="run('draw', () => api.giveawayAction('draw'))">
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
          <button v-else type="button" class="btn" :disabled="busy !== null" @click="run('reopen', () => api.giveawayAction('reopen'))">
            Teilnahme wieder öffnen
          </button>
          <button type="button" class="btn btn-danger" :disabled="busy !== null" @click="end">Giveaway beenden</button>
        </div>
        <p v-if="active.rejected > 0" class="rejected">
          {{ active.rejected === 1 ? "1 Account wurde" : `${active.rejected} Accounts wurden` }} nicht aufgenommen, weil
          die Follower-Bedingung nicht erfüllt war. Details stehen im Protokoll.
        </p>
      </div>

      <div v-if="active.winner" class="panel winner" aria-live="polite">
        <div class="winner-head">
          <div>
            <h2>Gewinner</h2>
            <p class="winner-name">{{ active.winner.displayName }}</p>
            <p v-if="active.winner.followedAt" class="winner-meta">Folgt seit {{ day(active.winner.followedAt) }}</p>
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
          Noch niemand dabei. Sobald jemand „{{ active.keyword }}“ in den Chat schreibt, erscheint er hier.
        </p>
        <p v-else-if="entries.length === 0" class="quiet pad">Kein Teilnehmer passt zu „{{ search }}“.</p>
        <ul v-else>
          <li v-for="e in entries" :key="e.login" :class="{ won: e.won }">
            <span class="who">
              <span class="name">{{ e.displayName }}</span>
              <span v-if="e.won" class="tag">Gewonnen</span>
            </span>
            <span class="since">{{ e.followedAt ? `Folgt seit ${day(e.followedAt)}` : "" }}</span>
            <time class="num" :datetime="e.enteredAt">{{ time(e.enteredAt) }}</time>
            <button
              type="button"
              class="remove"
              :aria-label="`${e.displayName} entfernen`"
              :disabled="busy !== null"
              @click="run('remove', () => api.removeGiveawayEntry(e.login))"
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
  gap: 1.25rem;
  padding: 1.4rem 1.5rem;
  max-width: 40rem;
}

.field {
  display: grid;
  gap: 0.4rem;
}

.field label,
legend {
  font-weight: 550;
  font-size: var(--step--1);
}

#gw-keyword {
  max-width: 16rem;
  font-size: var(--step-1);
  font-weight: 600;
}

.help {
  color: var(--text-faint);
  font-size: var(--step--1);
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-weight: 500;
}

.follow {
  display: grid;
  gap: 0.6rem;
  margin: 0;
  padding: 1rem 1.1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--bg);
}

legend {
  padding: 0 0.35rem;
}

.follow-inputs {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.follow-inputs label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
}

.follow-inputs input {
  width: 5.5rem;
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

.board-rule {
  margin-top: 0.6rem;
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
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 1.25rem;
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

.since,
.entries time {
  color: var(--text-faint);
  font-size: var(--step--1);
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
    grid-template-columns: minmax(0, 1fr) auto auto;
  }

  .since {
    display: none;
  }

  .search input {
    width: 100%;
  }
}
</style>
