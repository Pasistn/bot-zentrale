<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api } from "../api";
import type { Me, ModuleCategory, ModuleView, SummaryView } from "../types";
import { useLive } from "../composables/useLive";
import AccessPage from "./AccessPage.vue";
import CopyLink from "./CopyLink.vue";
import GiveawayPage from "./GiveawayPage.vue";
import LiveLog from "./LiveLog.vue";
import ModuleSection from "./ModuleSection.vue";
import OverviewPage from "./OverviewPage.vue";
import StreamSummaries from "./StreamSummaries.vue";

const props = defineProps<{ me: Me }>();
const emit = defineEmits<{ logout: []; "session-lost": []; refresh: [] }>();

const live = useLive(() => emit("session-lost"));

type Page = "overview" | "giveaway" | ModuleCategory | "log" | "access";

const icons: Record<Page, string> = {
  overview: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  giveaway: "M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9c-1.5-3-5-3.5-5-1s3 1 5 1zm0 0c1.5-3 5-3.5 5-1s-3 1-5 1z",
  obs: "M3 5h18v12H3zM8 21h8M12 17v4",
  "twitch-discord": "M4 5h16v11H9l-4 4v-4H4z",
  twitch: "M5 3 3 7v13h5v2h3l2-2h4l4-4V3zM10 8v5M15 8v5",
  log: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  access: "M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2",
};

const pages = computed(() => {
  const list: { id: Page; label: string; divider?: boolean }[] = [
    { id: "overview", label: "Übersicht" },
    { id: "giveaway", label: "Giveaway" },
    { id: "obs", label: "OBS-Overlays" },
    { id: "twitch-discord", label: "Discord-Posts" },
    { id: "twitch", label: "Twitch-Chat" },
    { id: "log", label: "Protokoll", divider: true },
  ];
  if (props.me.canManageAccess || props.me.owner) list.push({ id: "access", label: "Zugriff" });
  return list;
});

function pageFromHash(): Page {
  const id = location.hash.replace(/^#\/?/, "");
  return pages.value.some((p) => p.id === id) ? (id as Page) : "overview";
}

const page = ref<Page>(pageFromHash());
const onHashChange = () => (page.value = pageFromHash());

const wideQuery = window.matchMedia("(min-width: 1024px)");
const wide = ref(wideQuery.matches);
const NAV_KEY = "q2.nav";

function storedNav(): boolean {
  try {
    return localStorage.getItem(NAV_KEY) !== "closed";
  } catch {
    return true;
  }
}

const navOpen = ref(wide.value && storedNav());

function setNav(open: boolean) {
  navOpen.value = open;
  if (!wide.value) return;
  try {
    localStorage.setItem(NAV_KEY, open ? "open" : "closed");
  } catch {
    return;
  }
}

const onWideChange = (event: MediaQueryListEvent) => {
  wide.value = event.matches;
  navOpen.value = event.matches && storedNav();
};

const onKey = (event: KeyboardEvent) => {
  if (event.key === "Escape" && navOpen.value && !wide.value) navOpen.value = false;
};

onMounted(() => {
  window.addEventListener("hashchange", onHashChange);
  window.addEventListener("keydown", onKey);
  wideQuery.addEventListener("change", onWideChange);
});

onBeforeUnmount(() => {
  window.removeEventListener("hashchange", onHashChange);
  window.removeEventListener("keydown", onKey);
  wideQuery.removeEventListener("change", onWideChange);
});

watch(navOpen, (open) => {
  document.body.style.overflow = open && !wide.value ? "hidden" : "";
});

function go(id: Page) {
  page.value = id;
  history.replaceState(null, "", id === "overview" ? location.pathname : `#${id}`);
  if (!wide.value) navOpen.value = false;
  window.scrollTo({ top: 0 });
}

const modulesIn = (category: ModuleCategory) => live.modules.value.filter((m) => m.category === category);
const runningIn = (category: ModuleCategory) => modulesIn(category).filter((m) => m.status === "running").length;
const isModulePage = (id: Page): id is ModuleCategory => id === "obs" || id === "twitch-discord" || id === "twitch";
const summaryModule = computed(() => live.modules.value.find((m) => m.id === "stream-summary"));
const liveNow = computed(() => live.stats.value.streams[0]?.live === true);
const giveawayOpen = computed(() => live.giveaway.value?.active?.status === "open");

const chatState = computed(() => {
  if (!live.connected.value) return { tone: "fault", text: "Bot nicht erreichbar" };
  if (!live.twitch.value) return { tone: "idle", text: "Verbinde …" };
  return live.twitch.value.connected
    ? { tone: "on", text: "Chat verbunden" }
    : { tone: "fault", text: "Chat getrennt" };
});

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
  <div class="shell" :class="{ 'nav-open': navOpen, wide }">
    <header class="topbar">
      <button
        type="button"
        class="burger"
        :aria-expanded="navOpen"
        aria-controls="main-nav"
        :aria-label="navOpen ? 'Menü schließen' : 'Menü öffnen'"
        @click="setNav(!navOpen)"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path v-if="navOpen && !wide" d="M6 6l12 12M18 6 6 18" />
          <path v-else d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <span class="brand">Q2-Zentrale</span>

      <div class="signals" aria-live="polite">
        <span class="signal" :class="chatState.tone">
          <span class="lamp" aria-hidden="true"></span>
          <span class="signal-text">{{ chatState.text }}</span>
        </span>
        <span v-if="liveNow" class="on-air">Live</span>
      </div>

      <label v-if="props.me.channels.length > 1" class="channel-switch">
        <span class="sr-only">Kanal</span>
        <select :value="props.me.channel" :disabled="switching" @change="switchChannel">
          <option v-for="c in props.me.channels" :key="c.login" :value="c.login">#{{ c.login }}</option>
        </select>
      </label>
      <span v-else class="channel">#{{ props.me.channel }}</span>

      <div class="account">
        <img v-if="props.me.user.avatarUrl" :src="props.me.user.avatarUrl" alt="" width="30" height="30" />
        <span class="user">{{ props.me.user.displayName }}</span>
        <button type="button" class="btn btn-ghost" @click="onLogout">Abmelden</button>
      </div>
    </header>

    <nav id="main-nav" class="sidebar" aria-label="Bereiche" :inert="!navOpen || undefined">
      <ul>
        <li v-for="p in pages" :key="p.id" :class="{ divider: p.divider }">
          <button
            type="button"
            class="nav-item"
            :class="{ active: page === p.id }"
            :aria-current="page === p.id ? 'page' : undefined"
            @click="go(p.id)"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path :d="icons[p.id]" /></svg>
            <span class="nav-label">{{ p.label }}</span>
            <span v-if="isModulePage(p.id) && live.loaded.value && modulesIn(p.id).length" class="nav-meta num">
              {{ runningIn(p.id) }}/{{ modulesIn(p.id).length }}
            </span>
            <span v-else-if="p.id === 'giveaway' && giveawayOpen" class="nav-meta num">
              {{ live.giveaway.value?.active?.entries.length }}
            </span>
          </button>
        </li>
      </ul>
    </nav>

    <div v-if="navOpen && !wide" class="scrim" aria-hidden="true" @click="setNav(false)"></div>

    <main class="main">
      <p v-if="!live.loaded.value" class="loading">Lade …</p>

      <OverviewPage v-else-if="page === 'overview'" :stats="live.stats.value" />

      <GiveawayPage v-else-if="page === 'giveaway'" :state="live.giveaway.value" />

      <ModuleSection
        v-else-if="page === 'obs'"
        title="OBS-Overlays"
        intro="Browserquellen für OBS. Alle Overlays laufen über einen gemeinsamen Link, Position und Größe stellst du pro Overlay ein."
        :modules="modulesIn('obs')"
        empty="Noch keine Overlays eingebaut."
        @updated="onUpdated"
      >
        <template #actions>
          <button type="button" class="btn" :disabled="renewing" @click="renewOverlayLinks">
            {{ renewing ? "Erneuert …" : "Links erneuern" }}
          </button>
        </template>
        <p v-if="overlayNotice" class="notice" :class="overlayNotice.kind" role="status">{{ overlayNotice.text }}</p>

        <div v-if="allOverlaysUrl" class="panel overlay-link">
          <h2>Gemeinsamer Link für OBS</h2>
          <p>
            In OBS eine Browserquelle mit 1920 × 1080 anlegen und über die ganze Szene legen. Für den Ton der Alerts
            „Audio über OBS steuern“ anhaken. Den Link nicht im Stream zeigen.
          </p>
          <CopyLink id="overlay-all" :url="allOverlaysUrl" primary />
        </div>
      </ModuleSection>

      <div v-else-if="page === 'twitch-discord'" class="page">
        <StreamSummaries
          :summaries="live.summaries.value"
          :module="summaryModule"
          @module-updated="onUpdated"
          @summary-updated="onSummaryUpdated"
        />
        <ModuleSection
          title="Beiträge in Discord"
          intro="Ereignisse aus deinem Twitch-Kanal als Beiträge in Discord. Jedes Modul kann in einen eigenen Kanal posten."
          :modules="modulesIn('twitch-discord')"
          empty="Noch keine Discord-Module eingebaut."
          heading-level="h2"
          @updated="onUpdated"
        />
      </div>

      <ModuleSection
        v-else-if="page === 'twitch'"
        title="Twitch-Chat"
        intro="Funktionen, die direkt in deinem Twitch-Kanal wirken."
        :modules="modulesIn('twitch')"
        empty="Hier kommen später Chat-Befehle und andere Funktionen für deinen Kanal hin."
        @updated="onUpdated"
      />

      <LiveLog v-else-if="page === 'log'" :logs="live.logs.value" />

      <AccessPage v-else-if="page === 'access'" :me="props.me" @channels-changed="emit('refresh')" />
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
}

.topbar {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 30;
  height: var(--topbar);
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0 1rem 0 0.5rem;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
}

.burger {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
}

.burger:hover {
  background: var(--surface-2);
}

.burger svg,
.nav-item svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.brand {
  font-stretch: 72%;
  font-weight: 700;
  font-size: 1.3rem;
  letter-spacing: 0.01em;
}

.signals {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-left: 0.5rem;
  flex: 1;
  min-width: 0;
}

.signal {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: var(--step--1);
  color: var(--text-muted);
}

.lamp {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-faint);
}

.signal.on .lamp {
  background: var(--on);
}

.signal.fault {
  color: var(--fault);
}

.signal.fault .lamp {
  background: var(--fault);
}

.on-air {
  font-size: var(--step--1);
  font-weight: 650;
  color: #fff;
  background: var(--live);
  border-radius: 4px;
  padding: 0.05rem 0.5rem;
}

.channel,
.channel-switch select {
  font-size: var(--step--1);
  color: var(--text-muted);
}

.channel-switch select {
  width: auto;
  padding: 0.3rem 0.6rem;
  background: var(--surface);
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
  font-weight: 550;
  font-size: var(--step--1);
}

.sidebar {
  position: fixed;
  top: var(--topbar);
  bottom: 0;
  left: 0;
  z-index: 20;
  width: var(--sidebar);
  overflow-y: auto;
  padding: 1rem 0.75rem;
  background: var(--bg);
  border-right: 1px solid var(--line);
  transform: translateX(-100%);
  visibility: hidden;
  transition: transform 0.2s ease, visibility 0.2s;
}

.nav-open .sidebar {
  transform: none;
  visibility: visible;
}

.sidebar ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
}

.sidebar li.divider {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--line);
}

.nav-item {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  font-weight: 500;
  text-align: left;
}

.nav-item:hover {
  background: var(--surface);
  color: var(--text);
}

.nav-item.active {
  background: var(--surface-2);
  color: var(--text);
}

.nav-item.active::before {
  content: "";
  position: absolute;
  left: -0.75rem;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
}

.nav-label {
  flex: 1;
}

.nav-meta {
  font-size: 0.75rem;
  color: var(--text-faint);
}

.scrim {
  position: fixed;
  inset: var(--topbar) 0 0 0;
  z-index: 15;
  background: rgba(8, 11, 18, 0.6);
}

.main {
  padding: calc(var(--topbar) + 2rem) clamp(1rem, 4vw, 3rem) 4rem;
  max-width: calc(1040px + 2 * clamp(1rem, 4vw, 3rem));
  transition: margin-left 0.2s ease;
}

.wide.nav-open .main {
  margin-left: var(--sidebar);
}

.loading {
  color: var(--text-faint);
}

.overlay-link {
  display: grid;
  gap: 0.6rem;
  padding: 1.1rem 1.25rem;
  border-left: 3px solid var(--accent);
}

.overlay-link p {
  color: var(--text-muted);
  font-size: var(--step--1);
  max-width: 70ch;
}

@media (max-width: 760px) {
  .signal-text,
  .user,
  .channel {
    display: none;
  }

  .topbar {
    gap: 0.6rem;
  }
}

@media (max-width: 420px) {
  .account .btn {
    padding-inline: 0.5rem;
  }
}
</style>
