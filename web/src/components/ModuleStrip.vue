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
      return "Gestoppt wegen Fehler";
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
  <article class="strip" :class="module.status">
    <div class="row">
      <span class="tally" aria-hidden="true"></span>

      <div class="info">
        <h2>{{ module.name }}</h2>
        <p class="desc">{{ module.description }}</p>
        <p class="state">{{ statusText }}</p>
      </div>

      <ToggleSwitch
        :model-value="module.enabled"
        :label="`${module.name} ${module.enabled ? 'ausschalten' : 'einschalten'}`"
        :disabled="toggling"
        @update:model-value="toggle"
      />
    </div>

    <p v-if="module.error" class="fault" role="alert">{{ module.error }}</p>

    <div class="tools">
      <button
        type="button"
        class="btn btn-ghost"
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
        class="btn"
        :disabled="actionBusy !== null"
        @click="runAction(action.id)"
      >
        {{ actionBusy === action.id ? "Läuft …" : action.label }}
      </button>
    </div>

    <details v-if="module.overlayUrl" class="overlay" :open="standalone">
      <summary>{{ standalone ? "Eigener Link für OBS" : "Einzeln einbinden (optional)" }}</summary>
      <p v-if="standalone" class="help">
        Dieses Overlay steht auf „Nur einzeln“ und fehlt deshalb im gemeinsamen Link. Füge diesen Link in OBS als eigene
        Browserquelle ein und verschieb sie dort frei.
      </p>
      <p v-else class="help">
        Normalerweise reicht der gemeinsame Link oben auf dieser Seite. Willst du dieses Overlay in OBS frei verschieben,
        stell in den Einstellungen die Position auf „Nur einzeln“ und nimm diesen Link als eigene Browserquelle.
      </p>
      <CopyLink :id="`overlay-${module.id}`" :url="module.overlayUrl" />
    </details>

    <p v-if="notice" class="notice" :class="notice.kind" :role="notice.kind === 'error' ? 'alert' : 'status'">
      {{ notice.text }}
    </p>

    <SettingsForm v-if="open" :id="`settings-${module.id}`" :module="module" @saved="onSaved" />
  </article>
</template>

<style scoped>
.strip {
  background: var(--desk);
  border: 1px solid var(--line);
  border-radius: 12px;
  backdrop-filter: var(--glass);
  -webkit-backdrop-filter: var(--glass);
  box-shadow: var(--shadow);
  padding: 1.1rem 1.25rem;
}

.strip.running {
  border-color: rgba(47, 107, 255, 0.5);
}

.strip.error {
  border-color: var(--fault);
}

.row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 1rem;
  align-items: start;
}

.tally {
  width: 12px;
  height: 12px;
  margin-top: 0.4rem;
  border-radius: 50%;
  background: var(--line);
  transition: background 0.25s, box-shadow 0.25s;
}

.running .tally {
  background: var(--tally);
  box-shadow: 0 0 0 5px var(--tally-glow);
}

.error .tally {
  background: var(--fault);
}

h2 {
  font-size: var(--step-1);
}

.desc {
  margin: 0.3rem 0 0;
  color: var(--text-muted);
  max-width: 62ch;
}

.state {
  margin: 0.45rem 0 0;
  font-size: var(--step--1);
  color: var(--text-faint);
}

.running .state {
  color: var(--tally);
}

.error .state {
  color: var(--fault);
}

.fault {
  margin: 0.9rem 0 0 calc(12px + 1rem);
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
  margin-top: 1rem;
  padding-left: calc(12px + 1rem);
}

.overlay {
  display: grid;
  gap: 0.35rem;
  margin-top: 1rem;
  padding-left: calc(12px + 1rem);
}

.overlay summary {
  cursor: pointer;
  font-size: var(--step--1);
  color: var(--text-muted);
}

.overlay .help {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--step--1);
  max-width: 62ch;
}

.notice {
  margin: 0.75rem 0 0;
  padding-left: calc(12px + 1rem);
  font-size: var(--step--1);
}

.notice.ok {
  color: var(--ok);
}

.notice.error {
  color: var(--fault);
}

@media (max-width: 520px) {
  .tools,
  .overlay,
  .notice {
    padding-left: 0;
  }

  .fault {
    margin-left: 0;
  }
}
</style>
