<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { LogEntry } from "../types";

const props = defineProps<{ logs: LogEntry[] }>();

const list = ref<HTMLElement | null>(null);
const onlyProblems = ref(false);
const stickToBottom = ref(true);

const visible = computed(() => (onlyProblems.value ? props.logs.filter((l) => l.level !== "info") : props.logs));

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("de-DE");
}

function onScroll() {
  const el = list.value;
  if (!el) return;
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
}

watch(
  () => visible.value.length,
  async () => {
    if (!stickToBottom.value) return;
    await nextTick();
    if (list.value) list.value.scrollTop = list.value.scrollHeight;
  },
  { immediate: true }
);
</script>

<template>
  <section class="page" aria-labelledby="log-title">
    <div class="page-head">
      <div>
        <h1 id="log-title">Protokoll</h1>
        <p class="intro">Was der Bot in deinem Kanal gerade tut, live. Die letzten 200 Einträge seit dem Start.</p>
      </div>
      <label class="filter">
        <input v-model="onlyProblems" type="checkbox" />
        Nur Warnungen und Fehler
      </label>
    </div>

    <ol ref="list" class="panel entries" aria-live="polite" @scroll="onScroll">
      <li v-if="visible.length === 0" class="none">
        {{ onlyProblems ? "Keine Warnungen oder Fehler." : "Noch nichts passiert." }}
      </li>
      <li v-for="entry in visible" :key="entry.id" :class="entry.level">
        <time :datetime="entry.time">{{ time(entry.time) }}</time>
        <span class="source">{{ entry.source }}</span>
        <span class="msg">{{ entry.message }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.filter {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--step--1);
  color: var(--text-muted);
  cursor: pointer;
}

.entries {
  list-style: none;
  margin: 0;
  padding: 0.75rem 0;
  height: calc(100vh - var(--topbar) - 14rem);
  min-height: 18rem;
  overflow-y: auto;
  font-family: var(--font-log);
  font-size: 0.8rem;
  line-height: 1.6;
  background: var(--field);
}

li {
  display: grid;
  grid-template-columns: 5.5rem 9rem minmax(0, 1fr);
  gap: 0.75rem;
  padding: 0.15rem 1.25rem;
}

li:hover {
  background: var(--surface);
}

time {
  color: var(--text-faint);
}

.source {
  color: var(--accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.msg {
  overflow-wrap: anywhere;
}

.warn .msg {
  color: var(--warn);
}

.error .msg {
  color: var(--fault);
}

.none {
  display: block;
  color: var(--text-faint);
  font-family: var(--font);
}

@media (max-width: 640px) {
  li {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .source {
    display: none;
  }
}
</style>
