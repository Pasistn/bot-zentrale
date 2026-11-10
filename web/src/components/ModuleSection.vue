<script setup lang="ts">
import { computed } from "vue";
import type { ModuleView } from "../types";
import ModuleStrip from "./ModuleStrip.vue";

const props = defineProps<{ title: string; intro: string; modules: ModuleView[]; empty: string }>();
const emit = defineEmits<{ updated: [module: ModuleView] }>();

const runningCount = computed(() => props.modules.filter((m) => m.status === "running").length);
</script>

<template>
  <section class="modules" :aria-label="title">
    <div class="section-head">
      <div>
        <h1>{{ title }}</h1>
        <p class="intro">{{ intro }}</p>
      </div>
      <div class="side">
        <slot name="actions" />
        <p v-if="modules.length > 0" class="count">{{ runningCount }} von {{ modules.length }} laufen</p>
      </div>
    </div>

    <slot />

    <p v-if="modules.length === 0" class="empty">{{ empty }}</p>
    <ModuleStrip v-for="mod in modules" :key="mod.id" :module="mod" @updated="emit('updated', $event)" />
  </section>
</template>

<style scoped>
.modules {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.25rem;
  flex-wrap: wrap;
}

h1 {
  font-size: var(--step-2);
  letter-spacing: -0.015em;
}

.intro {
  margin: 0.3rem 0 0;
  color: var(--text-muted);
  font-size: var(--step--1);
  max-width: 60ch;
}

.side {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.count {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--step--1);
  background: var(--desk-raised);
  padding: 0.15rem 0.65rem;
  border-radius: 999px;
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
