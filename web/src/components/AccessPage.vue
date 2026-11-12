<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
import type { ManagedChannel, Me } from "../types";

const props = defineProps<{ me: Me }>();
const emit = defineEmits<{ "channels-changed": [] }>();

const mods = ref<string[]>([]);
const modInput = ref("");
const channels = ref<ManagedChannel[]>([]);
const channelInput = ref("");
const busy = ref(false);
const notice = ref<{ kind: "ok" | "error"; text: string } | null>(null);

async function run(task: () => Promise<void>, success?: string) {
  busy.value = true;
  notice.value = null;
  try {
    await task();
    if (success) notice.value = { kind: "ok", text: success };
  } catch (err) {
    notice.value = { kind: "error", text: err instanceof Error ? err.message : String(err) };
  } finally {
    busy.value = false;
  }
}

function addMod() {
  const login = modInput.value.trim();
  if (!login) return;
  run(async () => {
    mods.value = (await api.addAccess(login)).logins;
    modInput.value = "";
  }, `${login} hat jetzt Zugriff auf dein Dashboard.`);
}

function removeMod(login: string) {
  run(async () => {
    mods.value = (await api.removeAccess(login)).logins;
  });
}

function addChannel() {
  const login = channelInput.value.trim();
  if (!login) return;
  run(async () => {
    channels.value = (await api.addChannel(login)).channels;
    channelInput.value = "";
    emit("channels-changed");
  }, `Freigeschaltet. ${login} kann sich jetzt mit Twitch anmelden.`);
}

function removeChannel(channel: ManagedChannel) {
  if (!confirm(`#${channel.login} entfernen? Der Bot verlässt den Kanal, Einstellungen und Statistik bleiben gespeichert.`)) {
    return;
  }
  run(async () => {
    channels.value = (await api.removeChannel(channel.login)).channels;
    emit("channels-changed");
  });
}

onMounted(() => {
  if (props.me.canManageAccess) run(async () => void (mods.value = (await api.listAccess()).logins));
  if (props.me.owner) run(async () => void (channels.value = (await api.listChannels()).channels));
});
</script>

<template>
  <section class="page" aria-labelledby="access-title">
    <div class="page-head">
      <div>
        <h1 id="access-title">Zugriff</h1>
        <p class="intro">Wer dieses Dashboard öffnen darf.</p>
      </div>
    </div>

    <p v-if="notice" class="notice" :class="notice.kind" role="status">{{ notice.text }}</p>

    <div v-if="me.canManageAccess" class="panel">
      <h2>Mods für #{{ me.channel }}</h2>
      <p>
        Diese Twitch-Accounts können sich anmelden und alles für deinen Kanal einstellen. Hat noch niemand die
        Follower-Zahl freigegeben, übernimmt das der erste Mod, der sich anmeldet.
      </p>
      <ul v-if="mods.length > 0" class="list">
        <li v-for="login in mods" :key="login">
          <span>{{ login }}</span>
          <button type="button" class="btn btn-ghost" :disabled="busy" @click="removeMod(login)">Entfernen</button>
        </li>
      </ul>
      <p v-else class="empty">Noch niemand außer dir.</p>
      <form class="add" @submit.prevent="addMod">
        <label class="sr-only" for="mod-login">Twitch-Name</label>
        <input id="mod-login" v-model="modInput" placeholder="Twitch-Name" autocomplete="off" spellcheck="false" />
        <button type="submit" class="btn btn-primary" :disabled="busy || !modInput.trim()">Hinzufügen</button>
      </form>
    </div>

    <div v-if="me.owner" class="panel">
      <h2>Streamer</h2>
      <p>
        Freigeschaltete Kanäle. Der Bot liest in jedem davon mit, und der Streamer kann sich mit seinem Twitch-Account
        anmelden. Als Betreiber kannst du jeden Kanal oben rechts auswählen.
      </p>
      <ul class="list">
        <li v-for="c in channels" :key="c.login">
          <span>
            <b>{{ c.displayName }}</b>
            <small>#{{ c.login }}<template v-if="c.access.length">, Mods: {{ c.access.join(", ") }}</template></small>
          </span>
          <button type="button" class="btn btn-ghost" :disabled="busy" @click="removeChannel(c)">Entfernen</button>
        </li>
      </ul>
      <form class="add" @submit.prevent="addChannel">
        <label class="sr-only" for="channel-login">Twitch-Kanal</label>
        <input id="channel-login" v-model="channelInput" placeholder="Twitch-Kanal" autocomplete="off" spellcheck="false" />
        <button type="submit" class="btn btn-primary" :disabled="busy || !channelInput.trim()">Freischalten</button>
      </form>
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: grid;
  gap: 0.9rem;
  padding: 1.3rem 1.5rem;
}

.panel p {
  color: var(--text-muted);
  font-size: var(--step--1);
  max-width: 65ch;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.55rem 0.5rem 0.55rem 0.9rem;
}

.list li + li {
  border-top: 1px solid var(--line);
}

.list li span {
  display: grid;
  min-width: 0;
}

.list small {
  color: var(--text-faint);
  overflow-wrap: anywhere;
}

.panel .empty {
  padding: 0.9rem 1rem;
}

.add {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.add input {
  flex: 1;
  min-width: 12rem;
  max-width: 20rem;
}
</style>
