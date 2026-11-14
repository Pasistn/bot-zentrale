<script setup lang="ts">
import { computed, ref } from "vue";
import { day, number, percent, rulesFor, time } from "../giveaway";
import type { GiveawayState } from "../types";

const props = defineProps<{ active: NonNullable<GiveawayState["active"]>; busy: string | null }>();

const emit = defineEmits<{
  action: [action: "draw" | "close" | "reopen"];
  remove: [login: string, name: string];
  end: [];
}>();

const search = ref("");

const isOpen = computed(() => props.active.status === "open");
const pool = computed(() => props.active.entries.filter((e) => !e.won).length);
const rules = computed(() => rulesFor(props.active));

const entries = computed(() => {
  const term = search.value.trim().toLowerCase();
  const list = props.active.entries;
  const filtered = term
    ? list.filter((e) => e.login.includes(term) || e.displayName.toLowerCase().includes(term))
    : list;
  return [...filtered].reverse();
});
</script>

<template>
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
        @click="emit('action', 'draw')"
      >
        {{ busy === "draw" ? "Zieht …" : active.winner ? "Neuen Gewinner ziehen" : "Gewinner ziehen" }}
      </button>
      <button v-if="isOpen" type="button" class="btn" :disabled="busy !== null" @click="emit('action', 'close')">
        Teilnahme schließen
      </button>
      <button v-else type="button" class="btn" :disabled="busy !== null" @click="emit('action', 'reopen')">
        Teilnahme wieder öffnen
      </button>
      <button type="button" class="btn btn-danger" :disabled="busy !== null" @click="emit('end')">
        Giveaway beenden
      </button>
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
      <h2>
        Im Topf <span class="num faint">{{ pool }} von {{ active.entries.length }}</span>
      </h2>
      <label class="search">
        <span class="sr-only">Teilnehmer suchen</span>
        <input v-model="search" type="search" placeholder="Name suchen" autocomplete="off" />
      </label>
    </div>
    <p v-if="active.entries.length === 0" class="quiet pad">
      <template v-if="active.mode === 'points'">
        Noch niemand dabei. Sobald jemand „{{ active.rewardTitle }}“ einlöst, erscheint er hier.
      </template>
      <template v-else
        >Noch niemand dabei. Sobald jemand „{{ active.keyword }}“ in den Chat schreibt, erscheint er hier.</template
      >
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
          @click="emit('remove', e.login, e.displayName)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
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
}
</style>
