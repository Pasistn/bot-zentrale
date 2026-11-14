import { onBeforeUnmount, ref } from "vue";
import type {
  GiveawayState,
  LiveMessage,
  LogEntry,
  ModuleView,
  StatsOverview,
  SummaryView,
  TwitchStatus,
} from "../types";

const MAX_LOGS = 200;
const ACCESS_ENDED = 4003;

export function useLive(onUnauthorized: () => void) {
  const modules = ref<ModuleView[]>([]);
  const logs = ref<LogEntry[]>([]);
  const summaries = ref<SummaryView[]>([]);
  const stats = ref<StatsOverview>({ streams: [], followersAvailable: true });
  const twitch = ref<TwitchStatus | null>(null);
  const giveaway = ref<GiveawayState | null>(null);
  const connected = ref(false);
  const loaded = ref(false);

  let socket: WebSocket | null = null;
  let retryTimer: number | undefined;
  let retryDelay = 1000;
  let closedByUs = false;

  function replaceModule(updated: ModuleView) {
    modules.value = modules.value.map((m) => (m.id === updated.id ? updated : m));
  }

  function replaceSummary(updated: SummaryView) {
    summaries.value = summaries.value.map((s) => (s.id === updated.id ? updated : s));
  }

  function handle(message: LiveMessage) {
    switch (message.type) {
      case "snapshot":
        modules.value = message.modules;
        logs.value = message.logs.slice(-MAX_LOGS);
        summaries.value = message.summaries;
        stats.value = message.stats;
        giveaway.value = message.giveaway;
        twitch.value = message.twitch;
        loaded.value = true;
        break;
      case "modules":
        modules.value = message.modules;
        break;
      case "summaries":
        summaries.value = message.summaries;
        break;
      case "stats":
        stats.value = message.stats;
        break;
      case "log":
        logs.value = [...logs.value, message.entry].slice(-MAX_LOGS);
        break;
      case "twitch":
        twitch.value = message.twitch;
        break;
      case "giveaway":
        giveaway.value = message.giveaway;
        break;
    }
  }

  async function checkSession(): Promise<boolean> {
    const res = await fetch("/api/me", { credentials: "same-origin" }).catch(() => null);
    if (res && res.status === 401) {
      onUnauthorized();
      return false;
    }
    return true;
  }

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/ws`);

    socket.onopen = () => {
      connected.value = true;
      retryDelay = 1000;
    };

    socket.onmessage = (event) => {
      try {
        handle(JSON.parse(event.data) as LiveMessage);
      } catch {
        return;
      }
    };

    socket.onclose = async (event) => {
      connected.value = false;
      socket = null;
      if (closedByUs) return;
      if (event.code === ACCESS_ENDED) {
        location.reload();
        return;
      }
      if (!(await checkSession())) return;
      retryTimer = window.setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    };
  }

  function close() {
    closedByUs = true;
    window.clearTimeout(retryTimer);
    socket?.close();
  }

  connect();
  onBeforeUnmount(close);

  return { modules, logs, summaries, stats, twitch, giveaway, connected, loaded, replaceModule, replaceSummary, close };
}
