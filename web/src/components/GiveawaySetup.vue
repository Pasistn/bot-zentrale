<script setup lang="ts">
import { computed, ref } from "vue";
import { factor } from "../giveaway";
import type { GiveawayInput, GiveawayMode } from "../types";
import ToggleSwitch from "./ToggleSwitch.vue";

const props = defineProps<{
  busy: string | null;
  channel: string;
  isStreamer: boolean;
  pointsAvailable: boolean;
  followCheckAvailable: boolean;
}>();

const emit = defineEmits<{ start: [input: GiveawayInput] }>();

const mode = ref<GiveawayMode>("chat");
const keyword = ref("!join");
const rewardTitle = ref("Giveaway-Los");
const rewardCost = ref(1000);
const maxTickets = ref(1);
const followerOnly = ref(false);
const minDays = ref(0);
const minHours = ref(0);
const subOnly = ref(false);
const subMultiplier = ref(1);

const canStart = computed(() => {
  if (props.busy !== null) return false;
  if (mode.value === "chat") return keyword.value.trim() !== "";
  return props.pointsAvailable && rewardTitle.value.trim() !== "" && rewardCost.value > 0;
});

function start() {
  emit("start", {
    mode: mode.value,
    keyword: keyword.value.trim(),
    rewardTitle: rewardTitle.value.trim(),
    rewardCost: Number(rewardCost.value) || 0,
    maxTickets: Number(maxTickets.value) || 1,
    followerOnly: followerOnly.value,
    minFollowDays: Number(minDays.value) || 0,
    minFollowHours: Number(minHours.value) || 0,
    subOnly: subOnly.value,
    subMultiplier: Number(subMultiplier.value) || 1,
  });
}
</script>

<template>
  <form class="panel setup" @submit.prevent="start">
    <h2>Neues Giveaway</h2>

    <fieldset class="group">
      <legend>Teilnahme über</legend>
      <div class="segmented" role="radiogroup">
        <label :class="{ on: mode === 'chat' }">
          <input v-model="mode" type="radio" value="chat" />
          Stichwort im Chat
        </label>
        <label :class="{ on: mode === 'points' }">
          <input v-model="mode" type="radio" value="points" />
          Kanalpunkte
        </label>
      </div>

      <div v-if="mode === 'chat'" class="field">
        <label for="gw-keyword">Stichwort</label>
        <input
          id="gw-keyword"
          v-model="keyword"
          class="keyword-input"
          type="text"
          maxlength="30"
          autocomplete="off"
          spellcheck="false"
        />
        <p class="help">Ein einzelnes Wort, Groß- und Kleinschreibung egal. Jeder bekommt ein Los.</p>
      </div>

      <template v-else>
        <div v-if="!pointsAvailable" class="notice warn unlock">
          <template v-if="isStreamer">
            <p>Twitch muss dem Bot einmal erlauben, Belohnungen anzulegen und den Sub-Status zu lesen.</p>
            <a class="btn btn-primary" href="/auth/login?streamer=1">Kanalpunkte freischalten</a>
          </template>
          <p v-else>Kanalpunkte muss {{ channel }} selbst einmal im Dashboard freischalten.</p>
        </div>
        <div class="field">
          <label for="gw-title">Name der Belohnung</label>
          <input id="gw-title" v-model="rewardTitle" type="text" maxlength="45" autocomplete="off" />
          <p class="help">So erscheint sie bei Twitch. Der Bot legt sie beim Start an und löscht sie am Ende wieder.</p>
        </div>
        <div class="pair">
          <div class="field">
            <label for="gw-cost">Preis in Kanalpunkten</label>
            <input id="gw-cost" v-model.number="rewardCost" type="number" min="1" max="1000000" inputmode="numeric" />
          </div>
          <div class="field">
            <label for="gw-tickets">Lose pro Person höchstens</label>
            <input id="gw-tickets" v-model.number="maxTickets" type="number" min="1" max="100" inputmode="numeric" />
          </div>
        </div>
        <p class="help">
          Wer schon alle Lose hat, die Bedingungen nicht erfüllt oder zu spät kommt, bekommt die Punkte automatisch
          zurück.
        </p>
      </template>
    </fieldset>

    <fieldset class="group">
      <legend>Wer mitmachen darf</legend>
      <div class="switch-row">
        <ToggleSwitch v-model="followerOnly" label="Nur Follower" />
        <span>Nur Follower</span>
      </div>
      <div v-if="followerOnly" class="indent">
        <p class="sub-label">Folgt seit mindestens</p>
        <div class="pair">
          <label class="unit">
            <input v-model.number="minDays" type="number" min="0" max="1095" inputmode="numeric" />
            <span>Tagen</span>
          </label>
          <label class="unit">
            <input v-model.number="minHours" type="number" min="0" max="23" inputmode="numeric" />
            <span>Stunden</span>
          </label>
        </div>
        <p class="help">
          Bei 0 und 0 reicht es, überhaupt zu folgen. Der Gewinner wird beim Ziehen noch einmal geprüft.
        </p>
        <p v-if="!followCheckAvailable" class="notice warn">
          Twitch gibt die Follower erst frei, wenn sich der Streamer oder ein Mod einmal neu anmeldet.
        </p>
      </div>
      <div class="switch-row">
        <ToggleSwitch v-model="subOnly" label="Nur Subscriber" />
        <span>Nur Subscriber</span>
      </div>
    </fieldset>

    <fieldset class="group">
      <legend>Bonus für Subscriber</legend>
      <div class="field">
        <label for="gw-bonus">Lose von Subscribern zählen</label>
        <select id="gw-bonus" v-model.number="subMultiplier" class="short">
          <option :value="1">normal</option>
          <option v-for="n in [2, 3, 4, 5]" :key="n" :value="n">{{ factor(n) }}</option>
          <option :value="10">10-fach</option>
        </select>
        <p class="help">Bei doppelt hat ein Sub mit einem Los die gleiche Chance wie jemand anderes mit zwei.</p>
      </div>
    </fieldset>

    <div>
      <button type="submit" class="btn btn-primary" :disabled="!canStart">
        {{ busy === "start" ? "Startet …" : "Giveaway starten" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.setup {
  display: grid;
  gap: 1.5rem;
  padding: 1.4rem 1.5rem 1.5rem;
  max-width: 42rem;
}

.group {
  display: grid;
  gap: 0.9rem;
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  float: left;
  width: 100%;
  padding: 0;
  margin-bottom: 0.1rem;
  font-size: var(--step-0);
  font-stretch: 85%;
  font-weight: 650;
}

legend + * {
  clear: both;
}

.group + .group {
  padding-top: 1.4rem;
  border-top: 1px solid var(--line);
}

.segmented {
  display: inline-flex;
  width: fit-content;
  padding: 3px;
  gap: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--field);
}

.segmented label {
  padding: 0.4rem 0.9rem;
  border-radius: 4px;
  font-size: var(--step--1);
  font-weight: 550;
  color: var(--text-muted);
  cursor: pointer;
}

.segmented label.on {
  background: var(--surface-2);
  color: var(--text);
}

.segmented label:has(input:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.segmented input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.field {
  display: grid;
  gap: 0.4rem;
}

.field label,
.sub-label {
  font-weight: 550;
  font-size: var(--step--1);
}

.keyword-input {
  max-width: 16rem;
  font-size: var(--step-1);
  font-weight: 600;
}

#gw-title {
  max-width: 22rem;
}

.pair {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.pair .field input {
  width: 9rem;
}

.short {
  width: auto;
  min-width: 10rem;
  justify-self: start;
}

.unit {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
}

.unit input {
  width: 5.5rem;
}

.help {
  color: var(--text-faint);
  font-size: var(--step--1);
  max-width: 62ch;
}

.unlock {
  display: grid;
  gap: 0.7rem;
  justify-items: start;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-weight: 500;
}

.indent {
  display: grid;
  gap: 0.5rem;
  padding-left: calc(2.75rem + 0.75rem);
}

@media (max-width: 640px) {
  .indent {
    padding-left: 0;
  }
}
</style>
