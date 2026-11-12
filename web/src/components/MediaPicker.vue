<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import type { MediaFile } from "../types";

const props = defineProps<{ id: string; accept: "image" | "audio"; modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const MAX_BYTES = 25 * 1024 * 1024;

const media = ref<MediaFile[]>([]);
const busy = ref(false);
const error = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const fitting = computed(() =>
  media.value.filter((m) => (props.accept === "audio" ? m.kind === "audio" : m.kind === "image" || m.kind === "video"))
);
const selected = computed(() => media.value.find((m) => m.file === props.modelValue) ?? null);
const missing = computed(() => props.modelValue !== "" && !selected.value && media.value.length > 0);
const fileTypes = computed(() =>
  props.accept === "audio" ? ".mp3,.ogg,.wav,audio/*" : ".png,.jpg,.jpeg,.gif,.webp,.webm,.mp4,image/*,video/*"
);
const previewUrl = computed(() => (selected.value ? `/overlay-media/${encodeURIComponent(selected.value.file)}` : null));

async function load() {
  try {
    media.value = (await api.listMedia()).media;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(load);

async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  error.value = null;
  if (file.size > MAX_BYTES) {
    error.value = `Die Datei ist ${size(file.size)} groß. Erlaubt sind höchstens 25 MB.`;
    return;
  }
  busy.value = true;
  try {
    const { media: uploaded } = await api.uploadMedia(file);
    await load();
    emit("update:modelValue", uploaded.file);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!selected.value) return;
  if (!confirm(`„${selected.value.name}“ endgültig löschen? Alerts, die sie nutzen, fallen auf den Standard zurück.`)) return;
  busy.value = true;
  error.value = null;
  try {
    await api.deleteMedia(selected.value.file);
    emit("update:modelValue", "");
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

const size = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
</script>

<template>
  <div class="picker">
    <div class="row">
      <select :id="id" :value="modelValue" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
        <option value="">Keine (Standard)</option>
        <option v-for="m in fitting" :key="m.file" :value="m.file">{{ m.name }} · {{ size(m.size) }}</option>
        <option v-if="missing" :value="modelValue">Datei fehlt</option>
      </select>
      <button type="button" class="btn" :disabled="busy" @click="fileInput?.click()">
        {{ busy ? "Lädt …" : "Hochladen" }}
      </button>
      <button v-if="selected" type="button" class="btn btn-ghost" :disabled="busy" @click="remove">Löschen</button>
      <input ref="fileInput" type="file" :accept="fileTypes" hidden @change="upload" />
    </div>

    <div v-if="previewUrl && selected" class="preview">
      <audio v-if="selected.kind === 'audio'" :src="previewUrl" controls preload="none"></audio>
      <video v-else-if="selected.kind === 'video'" :src="previewUrl" autoplay muted loop playsinline></video>
      <img v-else :src="previewUrl" alt="Vorschau" />
    </div>

    <p v-if="missing" class="error">Die gewählte Datei gibt es nicht mehr. Der Alert nutzt den Standard.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.picker {
  display: grid;
  gap: 0.6rem;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

select {
  width: auto;
  min-width: 14rem;
  max-width: 22rem;
}

.preview img,
.preview video {
  display: block;
  max-width: 180px;
  max-height: 120px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: repeating-conic-gradient(#232b3d 0% 25%, #1b2231 0% 50%) 50% / 14px 14px;
}

.preview audio {
  max-width: 22rem;
}

.error {
  color: var(--fault);
  font-size: var(--step--1);
}
</style>
