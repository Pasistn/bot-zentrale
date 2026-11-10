import type { HubEvents, StreamInfo } from "../twitch/types.js";
import type { LogLevel } from "../logger.js";

export type SettingType = "text" | "secret" | "number" | "boolean" | "color" | "select" | "media";

export type MediaAccept = "image" | "audio";

export interface SettingOption {
  value: string;
  label: string;
}

export type SettingValue = string | number | boolean;

export type SettingsValues = Record<string, SettingValue>;

export interface SettingField {
  key: string;
  label: string;
  type: SettingType;
  default: SettingValue;
  description?: string;
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  patternMessage?: string;
  options?: SettingOption[];
  accept?: MediaAccept;
}

export type ModuleCategory = "obs" | "twitch-discord" | "twitch";

export interface ModuleContext {
  channel: string;
  liveStream(): StreamInfo | null;
  settings: SettingsValues;
  log: (level: LogLevel, message: string) => void;
  on<K extends keyof HubEvents>(event: K, handler: (...args: HubEvents[K]) => void): void;
}

export interface ModuleAction {
  id: string;
  label: string;
  run: (ctx: ModuleContext) => Promise<string>;
}

export interface BotModule {
  id: string;
  name: string;
  description: string;
  category: ModuleCategory;
  settings: SettingField[];
  actions?: ModuleAction[];
  overlayPath?: string;
  start: (ctx: ModuleContext) => void | Promise<void>;
  stop?: () => void | Promise<void>;
}

export type ModuleStatus = "stopped" | "running" | "error";

export interface SettingView {
  key: string;
  label: string;
  type: SettingType;
  description: string | null;
  required: boolean;
  min: number | null;
  max: number | null;
  options: SettingOption[] | null;
  accept: MediaAccept | null;
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
