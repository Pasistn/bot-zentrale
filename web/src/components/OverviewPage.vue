<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { StatsOverview, StreamStats } from "../types";

const props = defineProps<{ stats: StatsOverview }>();

const selectedId = ref<number | null>(null);

const selected = computed<StreamStats | undefined>(
  () => props.stats.streams.find((s) => s.id === selectedId.value) ?? props.stats.streams[0]
);

watch(
  () => props.stats.streams.map((s) => s.id).join(","),
  () => {
    if (selectedId.value !== null && !props.stats.streams.some((s) => s.id === selectedId.value)) selectedId.value = null;
  }
);

const number = (n: number) => n.toLocaleString("de-DE");

function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} Std. ${m} Min.` : `${m} Min.`;
}

function date(iso: string) {
  return new Date(iso).toLocaleString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const tiles = computed(() => {
  const s = selected.value;
  if (!s) return [];
  return [
    { label: "Ø Zuschauer", value: number(s.avgViewers), icon: "👀", accent: true },
    { label: "Viewer-Peak", value: number(s.peakViewers), icon: "📈" },
    {
      label: "Neue Follower",
      value: s.newFollowers === null ? "–" : `+${number(s.newFollowers)}`,
      icon: "💜",
      accent: true,
    },
    { label: "Subs", value: number(s.subs), icon: "⭐", hint: "Neue Subs und Resubs" },
    { label: "Gifted Subs", value: number(s.giftedSubs), icon: "🎁" },
    { label: "Bits", value: number(s.bits), icon: "💎" },
    {
      label: "Raids",
      value: number(s.raids),
      icon: "🚀",
      hint: s.raids > 0 ? `${number(s.raidViewers)} Viewer insgesamt` : undefined,
    },
    { label: "Chatnachrichten", value: number(s.chatMessages), icon: "💬" },
    { label: "Dauer", value: duration(s.durationMinutes), icon: "⏱️" },
  ];
});
</script>

<template>
  <section class="overview" aria-labelledby="overview-title">
    <div class="section-head">
      <div>
        <h1 id="overview-title">{{ selected?.live ? "Aktueller Stream" : "Letzter Stream" }}</h1>
        <p v-if="selected" class="meta">
          <span v-if="selected.live" class="live-badge">● Live</span>
          {{ date(selected.startedAt) }}
          <template v-if="selected.games.length"> · {{ selected.games.join(", ") }}</template>
        </p>
      </div>
      <label v-if="stats.streams.length > 1" class="picker">
        <span class="sr-only">Stream auswählen</span>
        <select :value="selected?.id" @change="selectedId = Number(($event.target as HTMLSelectElement).value)">
          <option v-for="s in stats.streams" :key="s.id" :value="s.id">
            {{ s.live ? "Live: " : "" }}{{ date(s.startedAt) }}
          </option>
        </select>
      </label>
    </div>

    <p v-if="!selected" class="empty">
      Noch kein Stream erfasst. Sobald du live gehst, siehst du hier Zuschauer, Follower, Subs, Bits und mehr. Der Bot
      fragt jede Minute bei Twitch nach, ob du live bist.
    </p>

    <template v-else>
      <p v-if="selected.title" class="title">„{{ selected.title }}“</p>

      <div class="tiles">
        <div v-for="t in tiles" :key="t.label" class="tile" :class="{ accent: t.accent }">
          <span class="icon" aria-hidden="true">{{ t.icon }}</span>
          <span class="value">{{ t.value }}</span>
          <span class="label">{{ t.label }}</span>
          <span v-if="t.hint" class="hint">{{ t.hint }}</span>
        </div>
      </div>

      <p v-if="!stats.followersAvailable" class="notice">
        Für die Follower-Zahl braucht der Bot einmal deine Erlaubnis: Melde dich oben rechts ab und als Streamer wieder an.
        Twitch fragt dann, ob der Bot deine Follower sehen darf.
      </p>
      <p v-else-if="selected.newFollowers === null" class="notice subtle">
        Für diesen Stream gibt es keine Follower-Zahl. Gezählt wird ab dem ersten Stream nach deiner Anmeldung.
      </p>

      <h2 v-if="stats.streams.length > 1" class="history-title">Letzte Streams</h2>
      <div v-if="stats.streams.length > 1" class="history">
        <table>
          <thead>
            <tr>
              <th scope="col">Datum</th>
              <th scope="col">Dauer</th>
              <th scope="col" class="num">Ø Zuschauer</th>
              <th scope="col" class="num">Peak</th>
              <th scope="col" class="num">Follower</th>
              <th scope="col" class="num">Subs</th>
              <th scope="col" class="num">Gifts</th>
              <th scope="col" class="num">Bits</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in stats.streams"
              :key="s.id"
              :class="{ active: s.id === selected.id }"
              tabindex="0"
              @click="selectedId = s.id"
              @keydown.enter="selectedId = s.id"
            >
              <td>
                <span v-if="s.live" class="live-dot" aria-label="Live"></span>
                {{ date(s.startedAt) }}
              </td>
              <td>{{ duration(s.durationMinutes) }}</td>
              <td class="num">{{ number(s.avgViewers) }}</td>
              <td class="num">{{ number(s.peakViewers) }}</td>
              <td class="num">{{ s.newFollowers === null ? "–" : `+${number(s.newFollowers)}` }}</td>
              <td class="num">{{ number(s.subs) }}</td>
              <td class="num">{{ number(s.giftedSubs) }}</td>
              <td class="num">{{ number(s.bits) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.overview {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

h1 {
  font-size: var(--step-2);
  letter-spacing: -0.015em;
}

.meta {
  margin: 0.3rem 0 0;
  color: var(--text-muted);
  font-size: var(--step--1);
}

.live-badge {
  color: #fff;
  background: #e5304f;
  border-radius: 999px;
  padding: 0.1rem 0.55rem;
  margin-right: 0.35rem;
  font-weight: 600;
}

.picker select {
  font: inherit;
  font-size: var(--step--1);
  color: var(--text);
  background: var(--desk-raised);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0.45rem 0.6rem;
}

.title {
  margin: 0;
  color: var(--text-muted);
  font-style: italic;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.75rem;
}

.tile {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.9rem 1rem;
  background: var(--desk);
  border: 1px solid var(--line);
  border-radius: 12px;
  backdrop-filter: var(--glass);
  -webkit-backdrop-filter: var(--glass);
  box-shadow: var(--shadow);
}

.tile.accent {
  border-color: rgba(47, 107, 255, 0.45);
}

.icon {
  font-size: 1.1rem;
}

.value {
  font-family: var(--font-display);
  font-size: var(--step-3);
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.tile.accent .value {
  background: var(--frost);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.label {
  font-size: var(--step--1);
  font-weight: 500;
  color: var(--text-muted);
}

.hint {
  font-size: 0.75rem;
  color: var(--text-faint);
}

.notice {
  margin: 0;
  padding: 0.7rem 0.9rem;
  border-radius: 8px;
  background: rgba(47, 107, 255, 0.08);
  border: 1px solid var(--line);
  color: var(--text-muted);
  font-size: var(--step--1);
}

.notice.subtle {
  background: transparent;
}

.history-title {
  font-size: var(--step-1);
  margin-top: 0.75rem;
}

.history {
  overflow-x: auto;
  background: var(--desk);
  border: 1px solid var(--line);
  border-radius: 12px;
  backdrop-filter: var(--glass);
  -webkit-backdrop-filter: var(--glass);
  box-shadow: var(--shadow);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--step--1);
}

th,
td {
  padding: 0.55rem 0.8rem;
  text-align: left;
  white-space: nowrap;
}

th {
  color: var(--text-faint);
  font-weight: 500;
  border-bottom: 1px solid var(--line);
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

tbody tr {
  cursor: pointer;
}

tbody tr:hover,
tbody tr:focus-visible {
  background: rgba(47, 107, 255, 0.06);
}

tbody tr.active {
  background: rgba(47, 107, 255, 0.12);
  font-weight: 500;
}

.live-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e5304f;
  margin-right: 0.3rem;
}

.empty {
  color: var(--text-muted);
  border: 1px dashed var(--line-strong);
  border-radius: 10px;
  padding: 1.5rem;
  margin: 0;
  background: var(--desk);
  backdrop-filter: var(--glass);
  -webkit-backdrop-filter: var(--glass);
}
</style>
