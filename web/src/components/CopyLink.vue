<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ id: string; url: string; primary?: boolean }>();

const show = ref(false);
const copied = ref(false);
const error = ref(false);

async function copy() {
  error.value = false;
  try {
    await navigator.clipboard.writeText(props.url);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    show.value = true;
    error.value = true;
  }
}
</script>

<template>
  <div class="copy-link">
    <input
      :id="id"
      :type="show ? 'text' : 'password'"
      :value="url"
      readonly
      spellcheck="false"
      @focus="($event.target as HTMLInputElement).select()"
    />
    <button type="button" class="btn" :class="{ 'btn-primary': primary }" @click="copy">
      {{ copied ? "Kopiert ✓" : "Link kopieren" }}
    </button>
    <button type="button" class="btn btn-ghost" @click="show = !show">{{ show ? "Verbergen" : "Anzeigen" }}</button>
    <p v-if="error" class="error" role="alert">Kopieren nicht möglich. Markiere den Link und kopiere ihn von Hand.</p>
  </div>
</template>

<style scoped>
.copy-link {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

input {
  flex: 1;
  min-width: 14rem;
  max-width: 34rem;
  background: var(--field);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0.5rem 0.7rem;
  font-family: var(--font-log);
  font-size: var(--step--1);
}

.error {
  flex-basis: 100%;
  margin: 0;
  color: var(--fault);
  font-size: var(--step--1);
}
</style>
