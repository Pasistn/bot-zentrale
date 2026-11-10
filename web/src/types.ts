export type SettingType = "text" | "secret" | "number" | "boolean" | "color" | "select" | "media";
export type SettingValue = string | number | boolean;
export type ModuleStatus = "stopped" | "running" | "error";
export type LogLevel = "info" | "warn" | "error";
export type ModuleCategory = "obs" | "twitch-discord" | "twitch";

export interface User {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface ChannelInfo {
  login: string;
  displayName: string;
}

export interface Me {
  user: User;
  channel: string;
  channels: ChannelInfo[];
  owner: boolean;
  canManageAccess: boolean;
}

export interface ManagedChannel extends ChannelInfo {
  createdAt: string;
  access: string[];
}

export interface SettingView {
  key: string;
  label: string;
  type: SettingType;
  description: string | null;
  required: boolean;
  min: number | null;
  max: number | null;
  options: { value: string; label: string }[] | null;
  accept: "image" | "audio" | null;
  value: SettingValue;
  isSet: boolean;
}

export interface ModuleView {
  id: string;
  name: string;
  description: string;
  category: ModuleCategory;
  enabled: boolean;
  status: ModuleStatus;
  error: string | null;
  settings: SettingView[];
  actions: { id: string; label: string }[];
  overlayUrl: string | null;
}

export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  source: string;
  message: string;
}

export type SummaryStatus = "live" | "pending" | "posted" | "discarded";

export interface SummaryEntry {
  name: string;
  login: string;
  amount: number;
}

export interface SummaryView {
  id: number;
  status: SummaryStatus;
  streamer: string;
  title: string;
  games: string[];
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  peakViewers: number;
  chatMessages: number;
  raids: { count: number; viewers: number; list: SummaryEntry[] };
  gifts: { count: number; gifters: SummaryEntry[] };
  text: string;
  postedAt: string | null;
  postError: string | null;
}

export interface StreamStats {
  id: number;
  live: boolean;
  streamer: string;
  title: string;
  games: string[];
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  avgViewers: number;
  peakViewers: number;
  newFollowers: number | null;
  chatMessages: number;
  subs: number;
  giftedSubs: number;
  bits: number;
  raids: number;
  raidViewers: number;
}

export interface StatsOverview {
  streams: StreamStats[];
  followersAvailable: boolean;
}

export interface MediaFile {
  file: string;
  name: string;
  kind: "image" | "video" | "audio";
  size: number;
}

export interface TwitchStatus {
  connected: boolean;
  channel: string;
}

export type LiveMessage =
  | {
      type: "snapshot";
      modules: ModuleView[];
      logs: LogEntry[];
      summaries: SummaryView[];
      stats: StatsOverview;
      twitch: TwitchStatus;
    }
  | { type: "stats"; stats: StatsOverview }
  | { type: "modules"; modules: ModuleView[] }
  | { type: "summaries"; summaries: SummaryView[] }
  | { type: "log"; entry: LogEntry }
  | { type: "twitch"; twitch: TwitchStatus };
