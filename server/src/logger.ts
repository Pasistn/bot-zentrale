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
const entries: LogEntry[] = [];
let nextId = 1;

export const logEvents = new EventEmitter<{ entry: [LogEntry] }>();

export function log(level: LogLevel, source: string, message: string): void {
  const entry: LogEntry = {
    id: nextId++,
    time: new Date().toISOString(),
    level,
    source,
    message,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  const line = `[${new Date().toLocaleTimeString("de-DE")}] [${source}] ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  logEvents.emit("entry", entry);
}

export function recentLogs(): LogEntry[] {
  return [...entries];
}
