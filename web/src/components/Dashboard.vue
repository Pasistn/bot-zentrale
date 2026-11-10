<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { api } from "../api";
import type { Me, ModuleCategory, ModuleView, SummaryView } from "../types";
import { useLive } from "../composables/useLive";
import AccessPage from "./AccessPage.vue";
import CopyLink from "./CopyLink.vue";
import LiveLog from "./LiveLog.vue";
import ModuleSection from "./ModuleSection.vue";
import OverviewPage from "./OverviewPage.vue";
import StreamSummaries from "./StreamSummaries.vue";

const props = defineProps<{ me: Me }>();
const emit = defineEmits<{ logout: []; "session-lost": []; refresh: [] }>();

const live = useLive(() => emit("session-lost"));

type Tab = "overview" | ModuleCategory | "access";

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Übersicht" },
  { id: "obs", label: "OBS" },
  { id: "twitch-discord", label: "Twitch + Discord" },
  { id: "twitch", label: "Twitch" },
  ...(props.me.canManageAccess || props.me.owner ? [{ id: "access" as Tab, label: "Zugriff" }] : []),
];

function tabFromHash(): Tab {
  const id = location.hash.replace(/^#\/?/, "");
  return tabs.some((t) => t.id === id) ? (id as Tab) : "overview";
}

const switching = ref(false);

async function switchChannel(event: Event) {
  const channel = (event.target as HTMLSelectElement).value;
  if (channel === props.me.channel) return;
  switching.value = true;
  try {
    await api.switchChannel(channel);
    location.reload();
  } catch (err) {
    switching.value = false;
    alert(err instanceof Error ? err.message : String(err));
  }
}

const tab = ref<Tab>(tabFromHash());
const onHashChange = () => (tab.value = tabFromHash());
window.addEventListener("hashchange", onHashChange);
onBeforeUnmount(() => window.removeEventListener("hashchange", onHashChange));

function select(id: Tab) {
  tab.value = id;
  history.replaceState(null, "", id === "overview" ? location.pathname : `#${id}`);
}

const runningCount = computed(() => live.modules.value.filter((m) => m.status === "running").length);
const summaryModule = computed(() => live.modules.value.find((m) => m.id === "stream-summary"));
const modulesIn = (category: ModuleCategory) => live.modules.value.filter((m) => m.category === category);
const liveNow = computed(() => live.stats.value.streams[0]?.live === true);

const allOverlaysUrl = computed(() => {
  const single = live.modules.value.find((m) => m.overlayUrl)?.overlayUrl;
  if (!single) return null;
  const url = new URL(single);
  url.pathname = "/overlay";
  return url.toString();
});

const renewing = ref(false);
const overlayNotice = ref<{ kind: "ok" | "error"; text: string } | null>(null);

async function renewOverlayLinks() {
  if (!confirm("Alle Overlay-Links erneuern? Die alten Links in OBS funktionieren danach nicht mehr.")) return;
  renewing.value = true;
  overlayNotice.value = null;
  try {
    overlayNotice.value = { kind: "ok", text: (await api.renewOverlayToken()).message };
  } catch (err) {
    overlayNotice.value = { kind: "error", text: err instanceof Error ? err.message : String(err) };
  } finally {
    renewing.value = false;
  }
}

function onUpdated(module: ModuleView) {
  live.replaceModule(module);
}

function onSummaryUpdated(summary: SummaryView) {
  live.replaceSummary(summary);
}

function onLogout() {
  live.close();
  emit("logout");
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="lamp" :class="{ live: runningCount > 0 }" aria-hidden="true"></span>
        <span class="name">Q2-Zentrale</span>
      </div>

      <div class="status" aria-live="polite">
        <span v-if="!live.connected.value" class="pill warn">Verbindung zum Bot getrennt</span>
        <template v-else-if="live.twitch.value">
          <span class="pill" :class="live.twitch.value.connected ? 'ok' : 'warn'">
            <span class="dot" aria-hidden="true"></span>
            {{ live.twitch.value.connected ? "Twitch verbunden" : "Twitch getrennt" }}
          </span>
          <span v-if="liveNow" class="pill on-air">● Live</span>
          <span v-if="props.me.channels.length < 2" class="channel">#{{ live.twitch.value.channel }}</span>
        </template>
        <label v-if="props.me.channels.length > 1" class="switch">
          <span class="sr-only">Kanal</span>
          <select :value="props.me.channel" :disabled="switching" @change="switchChannel">
            <option v-for="c in props.me.channels" :key="c.login" :value="c.login">#{{ c.login }}</option>
          </select>
        </label>
      </div>

      <div class="account">
        <img v-if="props.me.user.avatarUrl" :src="props.me.user.avatarUrl" alt="" width="28" height="28" />
        <span class="user">{{ props.me.user.displayName }}</span>
        <button type="button" class="btn btn-ghost" @click="onLogout">Abmelden</button>
      </div>
    </header>

    <nav class="tabs" aria-label="Bereiche">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="tab"
        :class="{ active: tab === t.id }"
        :aria-current="tab === t.id ? 'page' : undefined"
        @click="select(t.id)"
      >
        {{ t.label }}
        <span v-if="t.id !== 'overview' && t.id !== 'access' && live.loaded.value" class="tab-count">
          {{ modulesIn(t.id).length }}
        </span>
      </button>
    </nav>

    <main class="desk">
      <div class="column">
        <p v-if="!live.loaded.value" class="loading">Lade …</p>

        <template v-else-if="tab === 'overview'">
          <OverviewPage :stats="live.stats.value" />
        </template>

        <template v-else-if="tab === 'obs'">
          <ModuleSection
            title="OBS"
            intro="Overlays für deine Browserquellen in OBS. Jedes Modul hat einen eigenen Link, den du in OBS als Quelle „Browser“ einfügst."
            :modules="modulesIn('obs')"
            empty="Noch keine OBS-Funktionen eingebaut."
            @updated="onUpdated"
          >
            <template #actions>
              <button type="button" class="btn btn-ghost" :disabled="renewing" @click="renewOverlayLinks">
                {{ renewing ? "Erneuert …" : "Overlay-Links erneuern" }}
              </button>
            </template>
            <p v-if="overlayNotice" class="notice" :class="overlayNotice.kind" role="status">{{ overlayNotice.text }}</p>

            <div v-if="allOverlaysUrl" class="all-overlays">
              <h2>Ein Link für alle Overlays</h2>
              <p>
                In OBS: <b>Quelle hinzufügen → Browser</b>, diesen Link einfügen, Breite <b>1920</b> und Höhe <b>1080</b>,
                über die ganze Szene legen. Alle Overlays erscheinen darin an der Position aus ihren Einstellungen,
                neue kommen automatisch dazu. Für den Ton beim Alert „Audio über OBS steuern“ anhaken.
              </p>
              <CopyLink id="overlay-all" :url="allOverlaysUrl" primary />
              <p class="secret">Der Link ist geheim, zeig ihn nicht im Stream.</p>
            </div>
          </ModuleSection>
        </template>

        <template v-else-if="tab === 'twitch-discord'">
          <StreamSummaries
            :summaries="live.summaries.value"
            :module="summaryModule"
            @module-updated="onUpdated"
            @summary-updated="onSummaryUpdated"
          />
          <ModuleSection
            title="Twitch + Discord"
            intro="Ereignisse aus deinem Twitch-Kanal als Beiträge in Discord."
            :modules="modulesIn('twitch-discord')"
            empty="Noch keine Funktionen eingebaut."
            @updated="onUpdated"
          />
        </template>

        <template v-else-if="tab === 'access'">
          <AccessPage :me="props.me" @channels-changed="emit('refresh')" />
        </template>

        <template v-else>
          <ModuleSection
            title="Twitch"
            intro="Funktionen, die nur in deinem Twitch-Kanal wirken, z. B. im Chat."
            :modules="modulesIn('twitch')"
            empty="Hier ist noch nichts. Funktionen, die nur mit Twitch arbeiten (z. B. Chat-Befehle), erscheinen hier."
            @updated="onUpdated"
          />
        </template>
      </div>

      <LiveLog :logs="live.logs.value" />
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 0.75rem clamp(1rem, 3vw, 2rem);
  border-bottom: 1px solid var(--line);
  background: var(--desk);
  backdrop-filter: var(--glass);
  -webkit-backdrop-filter: var(--glass);
  box-shadow: 0 4px 20px rgba(40, 70, 160, 0.08);
  flex-wrap: wrap;
  position: sticky;
  top: 0;
  z-index: 10;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.name {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: var(--step-1);
  background: var(--frost);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.lamp {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--line);
  transition: background 0.3s, box-shadow 0.3s;
}

.lamp.live {
  background: var(--tally);
  box-shadow: 0 0 0 4px var(--tally-glow);
}

.status {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1;
  min-width: 12rem;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--step--1);
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--desk-raised);
}

.pill .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.pill.ok {
  color: var(--ok);
}

.pill.warn {
  color: var(--fault);
  border-color: var(--fault);
}

.pill.on-air {
  color: #fff;
  background: #e5304f;
  border-color: #e5304f;
  font-weight: 600;
}

.channel {
  color: var(--text-faint);
  font-size: var(--step--1);
}

.switch select {
  font: inherit;
  font-size: var(--step--1);
  color: var(--text);
  background: var(--desk-raised);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0.2rem 0.65rem;
}

.account {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.account img {
  border-radius: 50%;
}

.user {
  font-weight: 500;
}

.tabs {
  display: flex;
  gap: 0.35rem;
  padding: 0.75rem clamp(1rem, 3vw, 2rem) 0;
  overflow-x: auto;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid var(--line);
  background: var(--desk);
  backdrop-filter: var(--glass);
  -webkit-backdrop-filter: var(--glass);
  padding: 0.5rem 1rem;
  border-radius: 999px;
  font-weight: 500;
  font-size: var(--step--1);
  color: var(--text-muted);
  white-space: nowrap;
}

.tab:hover {
  border-color: var(--line-strong);
  color: var(--text);
}

.tab.active {
  background: var(--tally);
  border-color: var(--tally);
  color: var(--tally-ink);
  box-shadow: 0 4px 14px var(--tally-glow);
}

.tab-count {
  font-size: 0.72rem;
  min-width: 1.3rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: rgba(110, 140, 225, 0.18);
  text-align: center;
}

.tab.active .tab-count {
  background: rgba(255, 255, 255, 0.25);
}

.desk {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: clamp(1rem, 2.5vw, 2rem);
  padding: clamp(1rem, 3vw, 2rem);
  align-items: start;
}

.column {
  display: flex;
  flex-direction: column;
  gap: clamp(1.5rem, 3vw, 2.25rem);
  min-width: 0;
}

.all-overlays {
  display: grid;
  gap: 0.6rem;
  padding: 1.1rem 1.25rem;
  background: var(--desk);
  border: 1px solid rgba(47, 107, 255, 0.5);
  border-radius: 12px;
  backdrop-filter: var(--glass);
  -webkit-backdrop-filter: var(--glass);
  box-shadow: var(--shadow);
}

.all-overlays h2 {
  font-size: var(--step-1);
}

.all-overlays p {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--step--1);
  max-width: 64ch;
}

.all-overlays .secret {
  color: var(--text-faint);
}

.loading {
  color: var(--text-muted);
  margin: 0;
}

.notice {
  margin: 0;
  font-size: var(--step--1);
}

.notice.ok {
  color: var(--ok);
}

.notice.error {
  color: var(--fault);
}

@media (max-width: 900px) {
  .desk {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .topbar {
    gap: 0.6rem 1rem;
  }

  .account {
    margin-left: auto;
  }

  .user {
    display: none;
  }

  .status {
    order: 3;
    flex-basis: 100%;
  }
}
</style>
