<script setup lang="ts">
import { computed } from "vue";
import type { ModuleView } from "../types";
import ModuleStrip from "./ModuleStrip.vue";

const props = withDefaults(
  defineProps<{ title: string; intro: string; modules: ModuleView[]; empty: string; headingLevel?: "h1" | "h2" }>(),
  { headingLevel: "h1" }
);
const emit = defineEmits<{ updated: [module: ModuleView] }>();

const runningCount = computed(() => props.modules.filter((m) => m.status === "running").length);
</script>

<template>
  <section class="page" :aria-label="title">
    <div class="page-head">
      <div>
        <component :is="headingLevel" :class="{ sub: headingLevel === 'h2' }">{{ title }}</component>
        <p class="intro">{{ intro }}</p>
      </div>
      <div class="side">
        <slot name="actions" />
        <p v-if="modules.length > 0" class="count num">{{ runningCount }} von {{ modules.length }} aktiv</p>
      </div>
    </div>

    <slot />

    <p v-if="modules.length === 0" class="empty">{{ empty }}</p>
    <div v-else class="panel list">
      <ModuleStrip v-for="mod in modules" :key="mod.id" :module="mod" @updated="emit('updated', $event)" />
    </div>
  </section>
</template>

<style scoped>
.sub {
  font-size: var(--step-2);
}

.side {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.count {
  color: var(--text-faint);
  font-size: var(--step--1);
}

.list {
  overflow: hidden;
}
</style>
