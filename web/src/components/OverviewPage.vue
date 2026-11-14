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
    if (selectedId.value !== null && !props.stats.streams.some((s) => s.id === selectedId.value))
      selectedId.value = null;
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

const primary = computed(() => {
  const s = selected.value;
  if (!s) return [];
  return [
    { label: "Ø Zuschauer", value: number(s.avgViewers) },
    { label: "Viewer-Peak", value: number(s.peakViewers) },
    { label: "Neue Follower", value: s.newFollowers === null ? "–" : `+${number(s.newFollowers)}` },
  ];
});

const secondary = computed(() => {
  const s = selected.value;
  if (!s) return [];
  return [
    { label: "Subs", value: number(s.subs) },
    { label: "Gifted Subs", value: number(s.giftedSubs) },
    { label: "Bits", value: number(s.bits) },
    { label: s.raids > 0 ? `Raids, ${number(s.raidViewers)} Viewer` : "Raids", value: number(s.raids) },
    { label: "Chatnachrichten", value: number(s.chatMessages) },
    { label: "Dauer", value: duration(s.durationMinutes) },
  ];
});
</script>

<template>
  <section class="page" aria-labelledby="overview-title">
    <div class="page-head">
      <div>
        <h1 id="overview-title">{{ selected?.live ? "Aktueller Stream" : "Letzter Stream" }}</h1>
        <p v-if="selected" class="intro">
          <span v-if="selected.live" class="on-air">Live</span>
          {{ date(selected.startedAt)
          }}<template v-if="selected.games.length">, {{ selected.games.join(", ") }}</template>
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
      Noch kein Stream erfasst. Sobald du live gehst, erscheinen hier Zuschauer, Follower, Subs und Bits. Der Bot prüft
      jede Minute, ob du live bist.
    </p>

    <template v-else>
      <p v-if="selected.title" class="title">{{ selected.title }}</p>

      <div class="panel board">
        <dl class="primary">
          <div v-for="t in primary" :key="t.label">
            <dt>{{ t.label }}</dt>
            <dd class="num">{{ t.value }}</dd>
          </div>
        </dl>
        <dl class="secondary">
          <div v-for="t in secondary" :key="t.label">
            <dt>{{ t.label }}</dt>
            <dd class="num">{{ t.value }}</dd>
          </div>
        </dl>
      </div>

      <p v-if="!stats.followersAvailable" class="notice warn">
        Für die Follower-Zahl braucht der Bot einmal deine Erlaubnis: abmelden und als Streamer wieder anmelden. Twitch
        fragt dann, ob der Bot deine Follower sehen darf.
      </p>
      <p v-else-if="selected.newFollowers === null" class="notice">
        Für diesen Stream gibt es keine Follower-Zahl. Gezählt wird ab dem ersten Stream nach deiner Anmeldung.
      </p>

      <template v-if="stats.streams.length > 1">
        <h2 class="history-title">Letzte Streams</h2>
        <div class="panel history">
          <table>
            <thead>
              <tr>
                <th scope="col">Datum</th>
                <th scope="col">Dauer</th>
                <th scope="col" class="r">Ø Zuschauer</th>
                <th scope="col" class="r">Peak</th>
                <th scope="col" class="r">Follower</th>
                <th scope="col" class="r">Subs</th>
                <th scope="col" class="r">Gifts</th>
                <th scope="col" class="r">Bits</th>
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
                <td class="r num">{{ number(s.avgViewers) }}</td>
                <td class="r num">{{ number(s.peakViewers) }}</td>
                <td class="r num">{{ s.newFollowers === null ? "–" : `+${number(s.newFollowers)}` }}</td>
                <td class="r num">{{ number(s.subs) }}</td>
                <td class="r num">{{ number(s.giftedSubs) }}</td>
                <td class="r num">{{ number(s.bits) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.on-air {
  font-size: var(--step--1);
  font-weight: 650;
  color: #fff;
  background: var(--live);
  border-radius: 4px;
  padding: 0.05rem 0.45rem;
  margin-right: 0.4rem;
}

.picker select {
  width: auto;
  font-size: var(--step--1);
  background: var(--surface);
}

.title {
  color: var(--text-muted);
  font-size: var(--step-1);
  max-width: 70ch;
}

.board {
  overflow: hidden;
}

dl {
  margin: 0;
  display: grid;
}

dd {
  margin: 0;
}

dt {
  font-size: var(--step--1);
  color: var(--text-muted);
}

.primary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.primary div {
  display: flex;
  flex-direction: column-reverse;
  gap: 0.2rem;
  padding: 1.4rem 1.5rem 1.3rem;
}

.primary div + div {
  border-left: 1px solid var(--line);
}

.primary dd {
  font-size: var(--step-4);
  font-stretch: 65%;
  font-weight: 700;
  line-height: 1;
}

.primary div:first-child dd {
  color: var(--accent);
}

.secondary {
  grid-template-columns: repeat(6, minmax(0, 1fr));
  border-top: 1px solid var(--line);
  background: var(--bg);
}

.secondary div {
  display: flex;
  flex-direction: column-reverse;
  gap: 0.1rem;
  padding: 0.9rem 1.25rem;
}

.secondary div + div {
  border-left: 1px solid var(--line);
}

.secondary dd {
  font-size: var(--step-2);
  font-stretch: 75%;
  font-weight: 650;
  line-height: 1.15;
  white-space: nowrap;
}

.history-title {
  margin-top: 0.5rem;
}

.history {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--step--1);
}

th,
td {
  padding: 0.6rem 1rem;
  text-align: left;
  white-space: nowrap;
}

th {
  color: var(--text-faint);
  font-weight: 500;
  border-bottom: 1px solid var(--line);
}

.r {
  text-align: right;
}

tbody tr {
  cursor: pointer;
}

tbody tr + tr td {
  border-top: 1px solid var(--line);
}

tbody tr:hover,
tbody tr:focus-visible {
  background: var(--surface-2);
}

tbody tr.active {
  background: var(--accent-soft);
}

.live-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--live);
  margin-right: 0.35rem;
}

@media (max-width: 900px) {
  .secondary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .secondary div:nth-child(4) {
    border-left: 0;
  }

  .secondary div:nth-child(n + 4) {
    border-top: 1px solid var(--line);
  }
}

@media (max-width: 560px) {
  .primary {
    grid-template-columns: 1fr;
  }

  .primary div + div {
    border-left: 0;
    border-top: 1px solid var(--line);
  }

  .primary dd {
    font-size: var(--step-3);
  }

  .secondary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .secondary div:nth-child(odd) {
    border-left: 0;
  }

  .secondary div:nth-child(4) {
    border-left: 1px solid var(--line);
  }

  .secondary div:nth-child(n + 3) {
    border-top: 1px solid var(--line);
  }
}
</style>
