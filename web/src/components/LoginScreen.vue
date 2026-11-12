<script setup lang="ts">
import banner from "../assets/banner.png";

defineProps<{ error: string | null }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <main class="login">
    <img class="banner" :src="banner" alt="" />

    <div class="panel">
      <h1>Q2-Zentrale</h1>
      <p class="lead">Module, Overlays und Giveaways für deinen Stream an einem Ort.</p>

      <p v-if="error" class="notice error" role="alert">{{ error }}</p>

      <a class="btn btn-primary twitch" href="/auth/login">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4.3 3 3 6.4v13.4h4.6V22h2.6l2.2-2.2h3.5L20.6 15V3H4.3Zm14.6 11.2-2.7 2.7h-4.3L9.6 19.2v-2.3H6V4.7h12.9v9.5ZM16.2 7.9v4.6h-1.7V7.9h1.7Zm-4.6 0v4.6H9.9V7.9h1.7Z"
          />
        </svg>
        Mit Twitch anmelden
      </a>

      <p class="hint">Zugriff haben freigeschaltete Streamer und die Mods, die sie eingetragen haben.</p>
    </div>
  </main>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr;
  justify-items: center;
}

.banner {
  width: 100%;
  height: clamp(11rem, 42vh, 26rem);
  object-fit: cover;
  object-position: center 48%;
  border-bottom: 1px solid var(--line);
}

.panel {
  width: min(100% - 2rem, 26rem);
  margin-top: -3.5rem;
  margin-bottom: 3rem;
  align-self: start;
  display: grid;
  gap: 1.1rem;
  padding: 2rem 1.9rem 1.8rem;
  position: relative;
  border-top: 4px solid var(--accent);
}

h1 {
  font-size: var(--step-3);
  font-stretch: 70%;
  font-weight: 700;
}

.lead {
  color: var(--text-muted);
  margin-top: -0.5rem;
}

.twitch {
  justify-self: start;
  padding: 0.7rem 1.2rem;
  font-size: var(--step-0);
}

.hint {
  color: var(--text-faint);
  font-size: var(--step--1);
}
</style>
