import { EventEmitter } from "node:events";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  source: string;
  message: string;
}

const MAX_ENTRIES = 200;
const entries = new Map<string, LogEntry[]>();
let nextId = 1;

export const logEvents = new EventEmitter<{ entry: [channel: string, entry: LogEntry] }>();

export function log(level: LogLevel, source: string, message: string, channel?: string): void {
  const entry: LogEntry = {
    id: nextId++,
    time: new Date().toISOString(),
    level,
    source,
    message,
  };

  const prefix = channel ? `[#${channel}] ` : "";
  const line = `[${new Date().toLocaleTimeString("de-DE")}] ${prefix}[${source}] ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  if (!channel) return;
  const list = entries.get(channel) ?? [];
  list.push(entry);
  if (list.length > MAX_ENTRIES) list.shift();
  entries.set(channel, list);
  logEvents.emit("entry", channel, entry);
}

export function recentLogs(channel: string): LogEntry[] {
  return [...(entries.get(channel) ?? [])];
}

export function clearLogs(channel: string): void {
  entries.delete(channel);
}
