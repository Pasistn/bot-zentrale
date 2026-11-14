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
    <div class="page-head">
      <div>
        <h1 id="highlights-title">Stream-Highlights</h1>
        <p class="intro">
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

    <p v-if="!module" class="notice warn">Das Modul „Stream-Zusammenfassung“ fehlt auf dem Server.</p>
    <p v-else-if="module.status !== 'running'" class="notice">
      Das Modul „Stream-Zusammenfassung“ ist aus. Deine Streams werden trotzdem erfasst und du kannst sie hier von Hand
      posten. Damit nach dem Stream automatisch gepostet wird, schalte das Modul weiter unten ein.
    </p>

    <p v-if="pendingCount > 0" class="pending-note" role="status">
      {{ pendingCount === 1 ? "1 Zusammenfassung wartet" : `${pendingCount} Zusammenfassungen warten` }} auf deine
      Freigabe.
    </p>

    <p v-if="summaries.length === 0" class="empty">
      Noch kein Stream erfasst. Sobald du live gehst, erscheint hier die laufende Zusammenfassung.
    </p>

    <div v-else class="panel list">
      <article v-for="s in visible" :key="s.id" class="card" :class="s.status">
        <header class="card-head">
          <span class="badge">{{ statusLabels[s.status] }}</span>
          <span class="when">
            <time :datetime="s.startedAt">{{ date(s.startedAt) }}</time
            >, {{ duration(s.durationMinutes) }}
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
              {{ s.raids.count }}<small v-if="s.raids.count > 0"> mit {{ s.raids.viewers }} Viewern</small>
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
                mit {{ r.amount }} Viewern
              </li>
            </ul>
          </div>
          <div v-if="s.gifts.gifters.length > 0">
            <strong>Schenker</strong>
            <ul>
              <li v-for="(g, i) in s.gifts.gifters" :key="`g${i}`">
                {{ g.name }}: {{ g.amount === 1 ? "1 Sub" : `${g.amount} Subs` }}
              </li>
            </ul>
          </div>
        </details>

        <p v-if="s.postError && s.status !== 'posted'" class="notice error" role="alert">
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

        <p
          v-if="notice && notice.id === s.id"
          class="notice"
          :class="notice.kind"
          :role="notice.kind === 'error' ? 'alert' : 'status'"
        >
          {{ notice.text }}
        </p>
      </article>
    </div>

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
  gap: 1rem;
}

.auto {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: var(--step--1);
  font-weight: 550;
}

.pending-note {
  font-size: var(--step--1);
  color: var(--warn);
  font-weight: 550;
}

.list {
  overflow: hidden;
}

.card {
  position: relative;
  display: grid;
  gap: 0.8rem;
  padding: 1.15rem 1.25rem 1.15rem 1.5rem;
}

.card + .card {
  border-top: 1px solid var(--line);
}

.card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--line);
}

.card.live::before {
  background: var(--live);
}

.card.pending::before {
  background: var(--warn);
}

.card.posted::before {
  background: var(--on);
}

.card.discarded {
  color: var(--text-muted);
}

.card-head {
  display: flex;
  align-items: baseline;
  gap: 0.9rem;
  flex-wrap: wrap;
}

.badge {
  font-size: var(--step--1);
  font-weight: 650;
  color: var(--text-muted);
}

.live .badge {
  color: var(--live);
}

.pending .badge {
  color: var(--warn);
}

.posted .badge {
  color: var(--on);
}

.when {
  color: var(--text-faint);
  font-size: var(--step--1);
}

.title {
  font-weight: 550;
  overflow-wrap: anywhere;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 2.25rem;
  margin: 0;
}

.stats div {
  display: flex;
  flex-direction: column-reverse;
}

.stats dt {
  font-size: var(--step--1);
  color: var(--text-faint);
}

.stats dd {
  margin: 0;
  font-size: var(--step-2);
  font-stretch: 75%;
  font-weight: 650;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}

.stats small {
  font-size: var(--step--1);
  font-stretch: 100%;
  font-weight: 400;
  color: var(--text-muted);
}

.text {
  color: var(--text-muted);
  max-width: 72ch;
}

.details {
  font-size: var(--step--1);
  color: var(--text-muted);
  display: grid;
  gap: 0.5rem;
}

.details summary {
  cursor: pointer;
  width: fit-content;
}

.details summary:hover {
  color: var(--text);
}

.details ul {
  margin: 0.25rem 0 0;
  padding-left: 1.1rem;
}

.details strong {
  color: var(--text);
  font-weight: 550;
}

.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.more {
  align-self: flex-start;
}
</style>
