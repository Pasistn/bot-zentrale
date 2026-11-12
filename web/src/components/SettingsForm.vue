<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { api } from "../api";
import type { ModuleView, SettingValue } from "../types";
import MediaPicker from "./MediaPicker.vue";

const props = defineProps<{ module: ModuleView }>();
const emit = defineEmits<{ saved: [module: ModuleView] }>();

const values = reactive<Record<string, SettingValue>>({});
const saving = ref(false);
const error = ref<string | null>(null);

function reset() {
  for (const field of props.module.settings) {
    values[field.key] = field.value;
  }
}

reset();
watch(
  () => props.module.settings,
  () => {
    if (!saving.value) reset();
  }
);

async function save() {
  saving.value = true;
  error.value = null;
  try {
    const payload: Record<string, SettingValue> = {};
    for (const field of props.module.settings) {
      payload[field.key] = field.type === "number" ? Number(values[field.key]) : values[field.key];
    }
    const { module } = await api.saveSettings(props.module.id, payload);
    emit("saved", module);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="settings" @submit.prevent="save">
    <div v-for="field in module.settings" :key="field.key" class="field" :class="field.type">
      <template v-if="field.type === 'boolean'">
        <label class="check">
          <input v-model="values[field.key]" type="checkbox" />
          <span>{{ field.label }}</span>
        </label>
      </template>

      <template v-else>
        <label :for="`${module.id}-${field.key}`">
          {{ field.label }}
          <span v-if="field.required" class="req">Pflichtfeld</span>
        </label>

        <input
          v-if="field.type === 'secret'"
          :id="`${module.id}-${field.key}`"
          v-model="values[field.key]"
          type="password"
          autocomplete="off"
          spellcheck="false"
          :placeholder="field.isSet ? 'Gespeichert. Leer lassen, um sie zu behalten.' : 'Noch nicht eingetragen'"
        />

        <input
          v-else-if="field.type === 'number'"
          :id="`${module.id}-${field.key}`"
          v-model.number="values[field.key]"
          type="number"
          inputmode="numeric"
          :min="field.min ?? undefined"
          :max="field.max ?? undefined"
        />

        <MediaPicker
          v-else-if="field.type === 'media'"
          :id="`${module.id}-${field.key}`"
          :accept="field.accept ?? 'image'"
          :model-value="String(values[field.key] ?? '')"
          @update:model-value="values[field.key] = $event"
        />

        <select v-else-if="field.type === 'select'" :id="`${module.id}-${field.key}`" v-model="values[field.key]">
          <option v-for="o in field.options ?? []" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>

        <div v-else-if="field.type === 'color'" class="color-picker">
          <input :id="`${module.id}-${field.key}`" v-model="values[field.key]" type="color" />
          <span>{{ String(values[field.key]).toUpperCase() }}</span>
        </div>

        <input v-else :id="`${module.id}-${field.key}`" v-model="values[field.key]" type="text" />
      </template>

      <p v-if="field.description" class="help">{{ field.description }}</p>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="actions">
      <button type="submit" class="btn btn-primary" :disabled="saving">
        {{ saving ? "Speichert …" : "Einstellungen speichern" }}
      </button>
      <button type="button" class="btn btn-ghost" :disabled="saving" @click="reset">Änderungen verwerfen</button>
    </div>
  </form>
</template>

<style scoped>
.settings {
  display: grid;
  gap: 1.1rem;
  padding-top: 1.1rem;
  border-top: 1px solid var(--line);
}

.field {
  display: grid;
  gap: 0.35rem;
  max-width: 34rem;
}

label {
  font-weight: 550;
  font-size: var(--step--1);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.req {
  font-weight: 400;
  color: var(--text-faint);
}

input[type="number"] {
  max-width: 9rem;
}

select {
  max-width: 20rem;
}

.color-picker {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--text-muted);
  font-size: var(--step--1);
  font-variant-numeric: tabular-nums;
}

input[type="color"] {
  width: 2.5rem;
  height: 2rem;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--field);
}

.check {
  cursor: pointer;
  font-weight: 500;
  font-size: var(--step-0);
}

.help {
  color: var(--text-faint);
  font-size: var(--step--1);
  max-width: 62ch;
}

.error {
  color: var(--fault);
  font-size: var(--step--1);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
