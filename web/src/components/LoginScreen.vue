<script setup lang="ts">
defineProps<{ error: string | null }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <main class="login">
    <div class="panel">
      <span class="lamp" aria-hidden="true"></span>
      <h1>Q2-Zentrale</h1>
      <p class="lead">Schalte die Funktionen deines Stream-Bots an und aus und passe sie an.</p>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <a class="btn btn-primary twitch" href="/auth/login">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4.3 3 3 6.4v13.4h4.6V22h2.6l2.2-2.2h3.5L20.6 15V3H4.3Zm14.6 11.2-2.7 2.7h-4.3L9.6 19.2v-2.3H6V4.7h12.9v9.5ZM16.2 7.9v4.6h-1.7V7.9h1.7Zm-4.6 0v4.6H9.9V7.9h1.7Z"
          />
        </svg>
        Mit Twitch anmelden
      </a>

      <p class="hint">Zugriff haben nur freigeschaltete Streamer und die Mods, denen sie Zugriff gegeben haben.</p>
    </div>
  </main>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
}

.panel {
  width: min(100%, 26rem);
  background: var(--desk);
  border: 1px solid var(--line);
  border-radius: 14px;
  backdrop-filter: var(--glass);
  -webkit-backdrop-filter: var(--glass);
  box-shadow: var(--shadow);
  padding: 2.25rem 2rem 2rem;
}

.lamp {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--tally);
  box-shadow: 0 0 0 6px var(--tally-glow);
  margin-bottom: 1.5rem;
}

h1 {
  font-size: var(--step-3);
  letter-spacing: -0.02em;
  background: var(--frost);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.lead {
  color: var(--text-muted);
  margin: 0.75rem 0 1.75rem;
}

.error {
  background: var(--fault-bg);
  border: 1px solid var(--fault);
  color: var(--fault);
  padding: 0.7rem 0.85rem;
  border-radius: 8px;
  margin: 0 0 1.25rem;
  font-size: var(--step--1);
}

.twitch {
  width: 100%;
  justify-content: center;
  padding: 0.8rem 1rem;
  font-size: var(--step-0);
  text-decoration: none;
}

.hint {
  margin: 1.25rem 0 0;
  color: var(--text-faint);
  font-size: var(--step--1);
}
</style>
