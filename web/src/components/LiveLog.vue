<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { LogEntry } from "../types";

const props = defineProps<{ logs: LogEntry[] }>();

const list = ref<HTMLElement | null>(null);
const onlyProblems = ref(false);
const stickToBottom = ref(true);

const visible = computed(() =>
  onlyProblems.value ? props.logs.filter((l) => l.level !== "info") : props.logs
);

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
  <section class="log" aria-labelledby="log-title">
    <div class="head">
      <h2 id="log-title">Protokoll</h2>
      <label class="filter">
        <input v-model="onlyProblems" type="checkbox" />
        Nur Warnungen und Fehler
      </label>
    </div>

    <ol ref="list" class="entries" aria-live="polite" @scroll="onScroll">
      <li v-if="visible.length === 0" class="none">Noch nichts passiert.</li>
      <li v-for="entry in visible" :key="entry.id" :class="entry.level">
        <time :datetime="entry.time">{{ time(entry.time) }}</time>
        <span class="source">{{ entry.source }}</span>
        <span class="msg">{{ entry.message }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.log {
  background: var(--desk);
  border: 1px solid var(--line);
  border-radius: 12px;
  backdrop-filter: var(--glass);
  -webkit-backdrop-filter: var(--glass);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 8rem);
  position: sticky;
  top: 5rem;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}

h2 {
  font-size: var(--step-1);
}

.filter {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--step--1);
  color: var(--text-muted);
  cursor: pointer;
}

.filter input {
  accent-color: var(--tally);
}

.entries {
  list-style: none;
  margin: 0;
  padding: 0.6rem 0;
  overflow-y: auto;
  font-family: var(--font-log);
  font-size: 0.78rem;
  line-height: 1.5;
  min-height: 12rem;
}

li {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 0.6rem;
  padding: 0.2rem 1.1rem;
}

time {
  color: var(--text-faint);
}

.source {
  color: var(--violet);
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
  font-family: var(--font-body);
}

@media (max-width: 900px) {
  .log {
    position: static;
    max-height: 26rem;
  }
}
</style>
