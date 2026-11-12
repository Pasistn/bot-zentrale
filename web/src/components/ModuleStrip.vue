<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../api";
import type { ModuleView } from "../types";
import ToggleSwitch from "./ToggleSwitch.vue";
import SettingsForm from "./SettingsForm.vue";
import CopyLink from "./CopyLink.vue";

const props = defineProps<{ module: ModuleView }>();
const emit = defineEmits<{ updated: [module: ModuleView] }>();

const open = ref(false);
const toggling = ref(false);
const actionBusy = ref<string | null>(null);
const notice = ref<{ kind: "ok" | "error"; text: string } | null>(null);

const statusText = computed(() => {
  switch (props.module.status) {
    case "running":
      return "Läuft";
    case "error":
      return "Gestoppt";
    default:
      return props.module.enabled ? "Startet …" : "Aus";
  }
});

async function toggle(value: boolean) {
  toggling.value = true;
  notice.value = null;
  try {
    const { module } = await api.setEnabled(props.module.id, value);
    emit("updated", module);
    if (module.status === "error") open.value = true;
  } catch (err) {
    notice.value = { kind: "error", text: err instanceof Error ? err.message : String(err) };
  } finally {
    toggling.value = false;
  }
}

async function runAction(actionId: string) {
  actionBusy.value = actionId;
  notice.value = null;
  try {
    const { message } = await api.runAction(props.module.id, actionId);
    notice.value = { kind: "ok", text: message };
  } catch (err) {
    notice.value = { kind: "error", text: err instanceof Error ? err.message : String(err) };
  } finally {
    actionBusy.value = null;
  }
}

const standalone = computed(() => props.module.settings.find((s) => s.key === "position")?.value === "standalone");

function onSaved(module: ModuleView) {
  emit("updated", module);
  notice.value = { kind: "ok", text: "Einstellungen gespeichert." };
}
</script>

<template>
  <article class="strip" :class="[module.status, { open }]">
    <div class="row">
      <div class="info">
        <div class="title">
          <h3>{{ module.name }}</h3>
          <span class="state">{{ statusText }}</span>
        </div>
        <p class="desc">{{ module.description }}</p>
      </div>

      <ToggleSwitch
        :model-value="module.enabled"
        :label="`${module.name} ${module.enabled ? 'ausschalten' : 'einschalten'}`"
        :disabled="toggling"
        @update:model-value="toggle"
      />
    </div>

    <p v-if="module.error" class="notice error" role="alert">{{ module.error }}</p>

    <div class="tools">
      <button
        type="button"
        class="btn"
        :aria-expanded="open"
        :aria-controls="`settings-${module.id}`"
        @click="open = !open"
      >
        {{ open ? "Einstellungen schließen" : "Einstellungen" }}
      </button>
      <button
        v-for="action in module.actions"
        :key="action.id"
        type="button"
        class="btn btn-ghost"
        :disabled="actionBusy !== null"
        @click="runAction(action.id)"
      >
        {{ actionBusy === action.id ? "Läuft …" : action.label }}
      </button>
    </div>

    <p v-if="notice" class="notice" :class="notice.kind" :role="notice.kind === 'error' ? 'alert' : 'status'">
      {{ notice.text }}
    </p>

    <details v-if="module.overlayUrl" class="single" :open="standalone">
      <summary>{{ standalone ? "Eigener Link für OBS" : "Einzeln in OBS einbinden" }}</summary>
      <p v-if="standalone">
        Dieses Overlay steht auf „Nur einzeln“ und fehlt deshalb im gemeinsamen Link. Leg in OBS eine eigene
        Browserquelle mit diesem Link an.
      </p>
      <p v-else>
        Meist reicht der gemeinsame Link. Willst du dieses Overlay in OBS frei verschieben, stell die Position auf „Nur
        einzeln“ und nimm diesen Link.
      </p>
      <CopyLink :id="`overlay-${module.id}`" :url="module.overlayUrl" />
    </details>

    <SettingsForm v-if="open" :id="`settings-${module.id}`" :module="module" @saved="onSaved" />
  </article>
</template>

<style scoped>
.strip {
  position: relative;
  display: grid;
  gap: 0.85rem;
  padding: 1.15rem 1.25rem 1.15rem 1.5rem;
}

.strip + .strip {
  border-top: 1px solid var(--line);
}

.strip::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--line);
  transition: background 0.2s;
}

.strip.running::before {
  background: var(--on);
}

.strip.error::before {
  background: var(--fault);
}

.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.25rem;
}

.title {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
}

h3 {
  font-size: var(--step-1);
  font-stretch: 88%;
  font-weight: 600;
}

.state {
  font-size: var(--step--1);
  color: var(--text-faint);
}

.running .state {
  color: var(--on);
}

.error .state {
  color: var(--fault);
}

.desc {
  margin-top: 0.3rem;
  color: var(--text-muted);
  font-size: var(--step--1);
  max-width: 68ch;
}

.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.single {
  display: grid;
  gap: 0.5rem;
}

.single summary {
  cursor: pointer;
  width: fit-content;
  font-size: var(--step--1);
  color: var(--text-muted);
}

.single summary:hover {
  color: var(--text);
}

.single p {
  color: var(--text-faint);
  font-size: var(--step--1);
  max-width: 68ch;
}
</style>
