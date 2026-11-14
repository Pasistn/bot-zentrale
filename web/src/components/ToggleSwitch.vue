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
  width: 2.75rem;
  height: 1.5rem;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--field);
  padding: 0;
  flex-shrink: 0;
  transition:
    background 0.15s,
    border-color 0.15s;
}

.switch.on {
  background: var(--accent);
  border-color: var(--accent);
}

.switch:disabled {
  opacity: 0.5;
  cursor: progress;
}

.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 50%;
  background: var(--text-muted);
  transition:
    transform 0.15s,
    background 0.15s;
}

.on .knob {
  transform: translateX(1.25rem);
  background: var(--accent-ink);
}
</style>
