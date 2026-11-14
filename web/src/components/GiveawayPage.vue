<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../api";
import type { GiveawayInput, GiveawayState, Me } from "../types";
import GiveawayBoard from "./GiveawayBoard.vue";
import GiveawayHistory from "./GiveawayHistory.vue";
import GiveawaySetup from "./GiveawaySetup.vue";

const props = defineProps<{ state: GiveawayState | null; me: Me }>();

const busy = ref<string | null>(null);
const notice = ref<{ kind: "ok" | "error"; text: string } | null>(null);

const active = computed(() => props.state?.active ?? null);
const history = computed(() => props.state?.history ?? []);

async function run(key: string, task: () => Promise<unknown>) {
  busy.value = key;
  notice.value = null;
  try {
    await task();
  } catch (err) {
    notice.value = { kind: "error", text: err instanceof Error ? err.message : String(err) };
  } finally {
    busy.value = null;
  }
}

function start(input: GiveawayInput) {
  run("start", () => api.startGiveaway(input));
}

function action(name: "draw" | "close" | "reopen") {
  run(name, () => api.giveawayAction(name));
}

function remove(login: string, name: string) {
  if (active.value?.mode === "points" && !confirm(`${name} entfernen? Die eingelösten Punkte gibt es nicht zurück.`))
    return;
  run("remove", () => api.removeGiveawayEntry(login));
}

function end() {
  const extra = active.value?.mode === "points" ? " Die Belohnung wird bei Twitch gelöscht." : "";
  if (!confirm(`Giveaway beenden? Die Teilnehmerliste wird geleert, die Gewinner bleiben gespeichert.${extra}`)) return;
  run("end", () => api.giveawayAction("end"));
}
</script>

<template>
  <section class="page" aria-labelledby="giveaway-title">
    <div class="page-head">
      <div>
        <h1 id="giveaway-title">Giveaway</h1>
        <p class="intro">
          Teilnahme per Stichwort im Chat oder mit Kanalpunkten. Gezogen wird per Zufall, jedes Los zählt.
        </p>
      </div>
    </div>

    <p v-if="notice" class="notice" :class="notice.kind" :role="notice.kind === 'error' ? 'alert' : 'status'">
      {{ notice.text }}
    </p>

    <GiveawaySetup
      v-if="!active"
      :busy="busy"
      :channel="me.channel"
      :is-streamer="me.user.login === me.channel"
      :points-available="state?.pointsAvailable ?? false"
      :follow-check-available="state?.followCheckAvailable ?? false"
      @start="start"
    />
    <GiveawayBoard v-else :active="active" :busy="busy" @action="action" @remove="remove" @end="end" />

    <GiveawayHistory v-if="history.length" :history="history" />
  </section>
</template>
