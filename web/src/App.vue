<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, ApiError } from "./api";
import type { Me } from "./types";
import LoginScreen from "./components/LoginScreen.vue";
import Dashboard from "./components/Dashboard.vue";

const me = ref<Me | null>(null);
const checking = ref(true);
const loginError = ref<string | null>(null);

const loginErrors: Record<string, string> = {
  denied: "Die Anmeldung wurde bei Twitch abgebrochen.",
  forbidden: "Dieser Twitch-Account ist nicht freigeschaltet. Frag beim Betreiber der Zentrale nach.",
  state: "Die Anmeldung ist abgelaufen. Starte sie neu.",
  twitch: "Twitch hat die Anmeldung nicht bestätigt. Prüfe Client-ID, Client-Secret und Redirect-URL.",
};

function readLoginError() {
  const params = new URLSearchParams(location.search);
  const code = params.get("login_error");
  if (!code) return;
  loginError.value = loginErrors[code] ?? "Die Anmeldung ist fehlgeschlagen.";
  history.replaceState(null, "", location.pathname);
}

async function loadUser() {
  checking.value = true;
  try {
    me.value = await api.me();
  } catch (err) {
    me.value = null;
    if (!(err instanceof ApiError && err.status === 401)) {
      loginError.value = "Der Bot-Server antwortet nicht. Läuft er?";
    }
  } finally {
    checking.value = false;
  }
}

async function refresh() {
  me.value = await api.me().catch(() => me.value);
}

async function logout() {
  await api.logout().catch(() => undefined);
  me.value = null;
}

function sessionLost() {
  me.value = null;
  loginError.value = "Deine Sitzung ist abgelaufen. Melde dich neu an.";
}

onMounted(() => {
  readLoginError();
  loadUser();
});
</script>

<template>
  <div v-if="checking" class="boot" aria-live="polite">Verbinde …</div>
  <LoginScreen v-else-if="!me" :error="loginError" @retry="loadUser" />
  <Dashboard v-else :me="me" @logout="logout" @session-lost="sessionLost" @refresh="refresh" />
</template>

<style scoped>
.boot {
  min-height: 100vh;
  display: grid;
  place-items: center;
  color: var(--text-faint);
}
</style>
