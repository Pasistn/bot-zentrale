<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../api";
import type { ModuleView, SummaryStatus, SummaryView } from "../types";
import ToggleSwitch from "./ToggleSwitch.vue";

const props = defineProps<{ summaries: SummaryView[]; module: ModuleView | undefined }>();
const emit = defineEmits<{ "module-updated": [module: ModuleView]; "summary-updated": [summary: SummaryView] }>();

const COLLAPSED_COUNT = 4;

const showAll = ref(false);
const savingMode = ref(false);
const busy = ref<number | null>(null);
const notice = ref<{ id: number | null; kind: "ok" | "error"; text: string } | null>(null);

const autoPost = computed(() => props.module?.settings.find((s) => s.key === "autoPost")?.value === true);
const pendingCount = computed(() => props.summaries.filter((s) => s.status === "pending").length);
const visible = computed(() => (showAll.value ? props.summaries : props.summaries.slice(0, COLLAPSED_COUNT)));

const statusLabels: Record<SummaryStatus, string> = {
  live: "Live",
  pending: "Wartet auf Freigabe",
  posted: "Gepostet",
  discarded: "Verworfen",
};

function date(iso: string) {
  return new Date(iso).toLocaleString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} Std. ${m} Min.` : `${m} Min.`;
}

async function setAutoPost(value: boolean) {
  if (!props.module) return;
  savingMode.value = true;
  notice.value = null;
  try {
    const { module } = await api.saveSettings(props.module.id, { autoPost: value });
    emit("module-updated", module);
  } catch (err) {
    notice.value = { id: null, kind: "error", text: err instanceof Error ? err.message : String(err) };
  } finally {
    savingMode.value = false;
  }
}

async function run(summary: SummaryView, action: "post" | "discard") {
  busy.value = summary.id;
  notice.value = null;
  try {
    const result = action === "post" ? await api.postSummary(summary.id) : await api.discardSummary(summary.id);
    emit("summary-updated", result.summary);
    notice.value = {
      id: summary.id,
      kind: "ok",
      text: action === "post" ? "In Discord gepostet." : "Verworfen. Du kannst sie später trotzdem noch posten.",
    };
  } catch (err) {
    notice.value = { id: summary.id, kind: "error", text: err instanceof Error ? err.message : String(err) };
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <section class="highlights" aria-labelledby="highlights-title">
    <div class="section-head">
      <div>
        <h1 id="highlights-title">Stream-Highlights</h1>
        <p class="mode">
          {{
            autoPost
              ? "Nach jedem Stream geht die Zusammenfassung direkt in Discord."
              : "Nach jedem Stream wartet die Zusammenfassung hier auf deine Freigabe."
          }}
        </p>
      </div>
      <div class="auto">
        <span>Automatisch posten</span>
        <ToggleSwitch
          :model-value="autoPost"
          :label="autoPost ? 'Automatisch posten ausschalten' : 'Automatisch posten einschalten'"
          :disabled="!module || savingMode"
          @update:model-value="setAutoPost"
        />
      </div>
    </div>

    <p v-if="notice && notice.id === null" class="notice" :class="notice.kind" role="alert">{{ notice.text }}</p>

    <p v-if="!module" class="hint">Das Modul „Stream-Zusammenfassung“ fehlt auf dem Server.</p>
    <p v-else-if="module.status !== 'running'" class="hint">
      Das Modul „Stream-Zusammenfassung“ ist aus. Deine Streams werden trotzdem erfasst und du kannst sie hier von Hand
      posten. Damit nach dem Stream automatisch gepostet wird, schalte das Modul unten ein.
    </p>

    <p v-if="pendingCount > 0" class="pending-note" role="status">
      {{ pendingCount === 1 ? "1 Zusammenfassung wartet" : `${pendingCount} Zusammenfassungen warten` }} auf deine
      Freigabe.
    </p>

    <p v-if="summaries.length === 0" class="empty">
      Noch kein Stream erfasst. Sobald du live gehst, erscheint hier die laufende Zusammenfassung.
    </p>

    <article v-for="s in visible" :key="s.id" class="card" :class="s.status">
      <header class="card-head">
        <span class="badge">
          <span v-if="s.status === 'live'" class="dot" aria-hidden="true"></span>
          {{ statusLabels[s.status] }}
        </span>
        <span class="when">
          <time :datetime="s.startedAt">{{ date(s.startedAt) }}</time> · {{ duration(s.durationMinutes) }}
        </span>
      </header>

      <p v-if="s.title" class="title">{{ s.title }}</p>

      <dl class="stats">
        <div>
          <dt>Viewer-Peak</dt>
          <dd>{{ s.peakViewers }}</dd>
        </div>
        <div>
          <dt>Raids</dt>
          <dd>
            {{ s.raids.count }}<small v-if="s.raids.count > 0"> · {{ s.raids.viewers }} Viewer</small>
          </dd>
        </div>
        <div>
          <dt>Gifted Subs</dt>
          <dd>{{ s.gifts.count }}</dd>
        </div>
        <div>
          <dt>Chatnachrichten</dt>
          <dd>{{ s.chatMessages.toLocaleString("de-DE") }}</dd>
        </div>
      </dl>

      <p class="text">{{ s.text }}</p>

      <details v-if="s.raids.list.length > 0 || s.gifts.gifters.length > 0 || s.games.length > 0" class="details">
        <summary>Details</summary>
        <p v-if="s.games.length > 0"><strong>Kategorie:</strong> {{ s.games.join(", ") }}</p>
        <div v-if="s.raids.list.length > 0">
          <strong>Raids</strong>
          <ul>
            <li v-for="(r, i) in s.raids.list" :key="`r${i}`">
              <a :href="`https://twitch.tv/${r.login}`" target="_blank" rel="noopener noreferrer">{{ r.name }}</a>
              – {{ r.amount }} Viewer
            </li>
          </ul>
        </div>
        <div v-if="s.gifts.gifters.length > 0">
          <strong>Schenker</strong>
          <ul>
            <li v-for="(g, i) in s.gifts.gifters" :key="`g${i}`">
              {{ g.name }} – {{ g.amount === 1 ? "1 Sub" : `${g.amount} Subs` }}
            </li>
          </ul>
        </div>
      </details>

      <p v-if="s.postError && s.status !== 'posted'" class="fault" role="alert">
        Posten fehlgeschlagen: {{ s.postError }}
      </p>

      <div v-if="s.status === 'pending' || s.status === 'discarded'" class="tools">
        <button type="button" class="btn btn-primary" :disabled="busy !== null" @click="run(s, 'post')">
          {{ busy === s.id ? "Postet …" : "In Discord posten" }}
        </button>
        <button
          v-if="s.status === 'pending'"
          type="button"
          class="btn btn-ghost"
          :disabled="busy !== null"
          @click="run(s, 'discard')"
        >
          Verwerfen
        </button>
      </div>

      <p v-if="notice && notice.id === s.id" class="notice" :class="notice.kind" :role="notice.kind === 'error' ? 'alert' : 'status'">
        {{ notice.text }}
      </p>
    </article>

    <button
      v-if="summaries.length > COLLAPSED_COUNT"
      type="button"
      class="btn btn-ghost more"
      @click="showAll = !showAll"
    >
      {{ showAll ? "Weniger anzeigen" : `Ältere anzeigen (${summaries.length - COLLAPSED_COUNT})` }}
    </button>
  </section>
</template>

<style scoped>
.highlights {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.section-head h1 {
  font-size: var(--step-2);
  letter-spacing: -0.015em;
}

.mode {
  margin: 0.3rem 0 0;
  color: var(--text-muted);
  font-size: var(--step--1);
}

.auto {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: var(--step--1);
  font-weight: 500;
  background: var(--desk-raised);
  border: 1px solid var(--line);
  padding: 0.35rem 0.45rem 0.35rem 0.8rem;
  border-radius: 999px;
}

.hint,
.empty {
  margin: 0;
  color: var(--text-muted);
  border: 1px dashed var(--line-strong);
  border-radius: 10px;
  padding: 1rem 1.25rem;
  background: var(--desk);
  backdrop-filter: var(--glass);
  -webkit-backdrop-filter: var(--glass);
}

.pending-note {
  margin: 0;
  font-size: var(--step--1);
  color: var(--warn);
  font-weight: 500;
}

.card {
  background: var(--desk);
  border: 1px solid var(--line);
  border-radius: 12px;
  backdrop-filter: var(--glass);
  -webkit-backdrop-filter: var(--glass);
  box-shadow: var(--shadow);
  padding: 1rem 1.25rem;
}

.card.live {
  border-color: rgba(47, 107, 255, 0.5);
}

.card.pending {
  border-color: var(--warn);
}

.card.discarded {
  opacity: 0.7;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--step--1);
  font-weight: 600;
  padding: 0.15rem 0.65rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--desk-raised);
  color: var(--text-muted);
}

.live .badge {
  color: var(--tally);
  border-color: var(--tally);
}

.live .badge .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px var(--tally-glow);
}

.pending .badge {
  color: var(--warn);
  border-color: var(--warn);
}

.posted .badge {
  color: var(--ok);
  border-color: var(--ok);
}

.when {
  color: var(--text-faint);
  font-size: var(--step--1);
}

.title {
  margin: 0.6rem 0 0;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0.8rem 0 0;
}

.stats div {
  background: var(--desk-raised);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0.5rem 0.7rem;
}

.stats dt {
  font-size: var(--step--1);
  color: var(--text-faint);
}

.stats dd {
  margin: 0.1rem 0 0;
  font-family: var(--font-display);
  font-size: var(--step-2);
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.stats small {
  font-family: var(--font-body);
  font-size: var(--step--1);
  font-weight: 400;
  color: var(--text-muted);
}

.text {
  margin: 0.8rem 0 0;
  color: var(--text-muted);
}

.details {
  margin-top: 0.6rem;
  font-size: var(--step--1);
}

.details summary {
  cursor: pointer;
  color: var(--tally);
  font-weight: 500;
}

.details p,
.details > div {
  margin: 0.5rem 0 0;
}

.details ul {
  margin: 0.2rem 0 0;
  padding-left: 1.2rem;
}

.details a {
  color: var(--tally);
}

.fault {
  margin: 0.8rem 0 0;
  padding: 0.6rem 0.8rem;
  border-radius: 8px;
  background: var(--fault-bg);
  color: var(--fault);
  font-size: var(--step--1);
}

.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.9rem;
}

.notice {
  margin: 0.6rem 0 0;
  font-size: var(--step--1);
}

.notice.ok {
  color: var(--ok);
}

.notice.error {
  color: var(--fault);
}

.more {
  align-self: flex-start;
}

@media (max-width: 520px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  
  .stats dd {
    font-size: var(--step-1);
  }
}
</style>
