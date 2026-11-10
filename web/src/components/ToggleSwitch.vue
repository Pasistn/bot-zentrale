<script setup lang="ts">
defineProps<{ modelValue: boolean; label: string; disabled?: boolean }>();
defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>

<template>
  <button
    type="button"
    role="switch"
    class="switch"
    :class="{ on: modelValue }"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <span class="knob" aria-hidden="true"></span>
  </button>
</template>

<style scoped>
.switch {
  position: relative;
  width: 3.25rem;
  height: 1.75rem;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--field);
  padding: 0;
  flex-shrink: 0;
  transition: background 0.18s, border-color 0.18s;
}

.switch.on {
  background: var(--tally);
  border-color: var(--tally);
}

.switch:disabled {
  opacity: 0.55;
  cursor: progress;
}

.knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  background: var(--text-muted);
  transition: transform 0.18s, background 0.18s;
}

.on .knob {
  transform: translateX(1.5rem);
  background: var(--tally-ink);
}
</style>
