<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api";
import { dateTime, lasted, number, rulesFor, time, title } from "../giveaway";
import type { GiveawayEntry, GiveawayState } from "../types";

defineProps<{ history: GiveawayState["history"] }>();

type PastState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "list"; entries: GiveawayEntry[] };
const pastEntries = ref<Record<number, PastState>>({});

async function loadPast(event: Event, id: number) {
  if (!(event.target as HTMLDetailsElement).open || pastEntries.value[id]) return;
  pastEntries.value = { ...pastEntries.value, [id]: { kind: "loading" } };
  try {
    const { entries } = await api.giveawayHistory(id);
    pastEntries.value = { ...pastEntries.value, [id]: { kind: "list", entries } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pastEntries.value = { ...pastEntries.value, [id]: { kind: "error", message } };
  }
}
</script>

<template>
  <section class="history" aria-labelledby="history-title">
    <h2 id="history-title">Vergangene Giveaways</h2>
    <div class="panel past-list">
      <details v-for="h in history" :key="h.id" class="past" @toggle="loadPast($event, h.id)">
        <summary>
          <span class="past-main">
            <span class="past-title">{{ title(h) }}</span>
            <span class="past-meta">
              <time :datetime="h.createdAt">{{ dateTime(h.createdAt) }}</time
              >, {{ lasted(h.createdAt, h.endedAt) }}, {{ h.mode === "points" ? "Kanalpunkte" : "Chat" }}
            </span>
          </span>
          <span class="past-count num">
            {{ h.entryCount }} Teilnehmer<template v-if="h.ticketCount !== h.entryCount"
              >, {{ number(h.ticketCount) }} Lose</template
            >
          </span>
          <span class="past-winners">
            <template v-if="h.winners.length">{{ h.winners.map((w) => w.displayName).join(", ") }}</template>
            <span v-else class="faint">Kein Gewinner gezogen</span>
          </span>
        </summary>

        <div class="past-body">
          <ul class="rules">
            <li v-for="r in rulesFor(h)" :key="r">{{ r }}</li>
          </ul>
          <template v-for="past in [pastEntries[h.id]]" :key="past?.kind ?? 'leer'">
            <p v-if="past?.kind === 'loading'" class="quiet">Lade Teilnehmer …</p>
            <p v-else-if="past?.kind === 'error'" class="notice error">{{ past.message }}</p>
            <p v-else-if="past?.kind === 'list' && past.entries.length === 0" class="quiet">Niemand hat mitgemacht.</p>
            <table v-else-if="past?.kind === 'list'">
              <thead>
                <tr>
                  <th scope="col">Teilnehmer</th>
                  <th scope="col" class="r">Lose</th>
                  <th scope="col">Beigetreten</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in past.entries" :key="e.login" :class="{ won: e.won }">
                  <td>
                    <span class="name">{{ e.displayName }}</span>
                    <span v-if="e.subscriber" class="tag sub">Sub</span>
                    <span v-if="e.won" class="tag">Gewonnen</span>
                  </td>
                  <td class="r num">{{ e.tickets }}</td>
                  <td class="faint num">{{ time(e.enteredAt) }}</td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>
      </details>
    </div>
  </section>
</template>

<style scoped>
.rules {
  list-style: none;
  margin: 0.75rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.25rem;
  color: var(--text-muted);
}

.quiet {
  color: var(--text-faint);
  font-size: var(--step--1);
}

.faint {
  color: var(--text-faint);
  font-size: var(--step--1);
  font-weight: 400;
  font-stretch: 100%;
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

.history {
  display: grid;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.past-list {
  overflow: hidden;
}

.past + .past {
  border-top: 1px solid var(--line);
}

.past summary {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.8fr) minmax(0, 1fr);
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 1.25rem;
  cursor: pointer;
  list-style: none;
}

.past summary::-webkit-details-marker {
  display: none;
}

.past summary:hover {
  background: var(--surface-2);
}

.past[open] summary {
  background: var(--surface-2);
}

.past-main {
  display: grid;
  min-width: 0;
}

.past-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.past-meta,
.past-count {
  font-size: var(--step--1);
  color: var(--text-faint);
}

.past-winners {
  font-size: var(--step--1);
  color: var(--accent);
  font-weight: 550;
  overflow-wrap: anywhere;
}

.past-body {
  display: grid;
  gap: 0.9rem;
  padding: 1rem 1.25rem 1.25rem;
  border-top: 1px solid var(--line);
  background: var(--bg);
}

.past-body .rules {
  margin: 0;
  font-size: var(--step--1);
}

.past-body table {
  width: 100%;
  max-width: 34rem;
  border-collapse: collapse;
  font-size: var(--step--1);
}

.past-body th,
.past-body td {
  padding: 0.4rem 0.6rem;
  text-align: left;
}

.past-body th {
  color: var(--text-faint);
  font-weight: 500;
  border-bottom: 1px solid var(--line);
}

.past-body td .tag {
  margin-left: 0.5rem;
}

.past-body tr.won td {
  background: var(--accent-soft);
}

.past-body .r {
  text-align: right;
}

@media (max-width: 640px) {
  .past summary {
    grid-template-columns: 1fr;
    gap: 0.25rem;
  }
}
</style>
