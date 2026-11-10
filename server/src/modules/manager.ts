import { EventEmitter } from "node:events";
import { config } from "../config.js";
import { moduleStore, overlayTokenStore } from "../db.js";
import { mediaKind } from "../media.js";
import { log } from "../logger.js";
import type { StreamTracker } from "../stream/tracker.js";
import type { TwitchHub } from "../twitch/hub.js";
import type { HubEvents } from "../twitch/types.js";
import type {
  BotModule,
  ModuleContext,
  ModuleStatus,
  ModuleView,
  SettingField,
  SettingsValues,
  SettingValue,
} from "./types.js";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

type Listener = { event: keyof HubEvents; handler: (...args: never[]) => void };

interface Runtime {
  status: ModuleStatus;
  error: string | null;
  listeners: Listener[];
  busy: Promise<void>;
}

export class ModuleManager extends EventEmitter<{ changed: [] }> {
  private readonly modules = new Map<string, BotModule>();
  private readonly runtimes = new Map<string, Runtime>();

  constructor(
    private readonly hub: TwitchHub,
    private readonly tracker: StreamTracker,
    modules: BotModule[]
  ) {
    super();
    for (const mod of modules) {
      if (this.modules.has(mod.id)) throw new Error(`Modul-ID doppelt vergeben: ${mod.id}`);
      this.modules.set(mod.id, mod);
      this.runtimes.set(mod.id, { status: "stopped", error: null, listeners: [], busy: Promise.resolve() });
    }
  }

  async init(): Promise<void> {
    for (const mod of this.modules.values()) {
      if (moduleStore.get(mod.id).enabled) {
        await this.serialize(mod.id, () => this.startModule(mod));
      }
    }
    this.emit("changed");
  }

  async shutdown(): Promise<void> {
    for (const mod of this.modules.values()) {
      await this.serialize(mod.id, () => this.stopModule(mod));
    }
  }

  notifyChanged(): void {
    this.emit("changed");
  }

  list(): ModuleView[] {
    return [...this.modules.values()].map((mod) => this.view(mod));
  }

  get(id: string): ModuleView {
    return this.view(this.require(id));
  }

  async setEnabled(id: string, enabled: boolean): Promise<ModuleView> {
    const mod = this.require(id);
    await this.serialize(id, async () => {
      await moduleStore.setEnabled(id, enabled);
      if (enabled) {
        log("info", mod.id, "Modul wird aktiviert");
        await this.stopModule(mod);
        await this.startModule(mod);
      } else {
        log("info", mod.id, "Modul wird deaktiviert");
        await this.stopModule(mod);
      }
    });
    this.emit("changed");
    return this.view(mod);
  }

  async updateSettings(id: string, input: unknown): Promise<ModuleView> {
    const mod = this.require(id);
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new ValidationError("Einstellungen müssen ein Objekt sein.");
    }

    const current = this.resolveSettings(mod);
    const next: SettingsValues = { ...current };

    for (const field of mod.settings) {
      if (!(field.key in input)) continue;
      const raw = (input as Record<string, unknown>)[field.key];
      if (field.type === "secret" && (raw === "" || raw === null || raw === undefined)) continue;
      next[field.key] = this.coerce(field, raw);
    }

    await this.serialize(id, async () => {
      await moduleStore.setSettings(id, next);
      log("info", mod.id, "Einstellungen gespeichert");
      if (moduleStore.get(id).enabled) {
        await this.stopModule(mod);
        await this.startModule(mod);
      }
    });
    this.emit("changed");
    return this.view(mod);
  }

  requireSettings(id: string): SettingsValues {
    const mod = this.require(id);
    const settings = this.resolveSettings(mod);
    const missing = this.missingRequired(mod, settings);
    if (missing) throw new ValidationError(missing);
    return settings;
  }

  async runAction(id: string, actionId: string): Promise<string> {
    const mod = this.require(id);
    const action = mod.actions?.find((a) => a.id === actionId);
    if (!action) throw new NotFoundError(`Aktion „${actionId}“ gibt es nicht.`);

    const settings = this.requireSettings(id);

    const ctx = this.createContext(mod, settings, null);
    try {
      const result = await action.run(ctx);
      log("info", mod.id, `${action.label}: ${result}`);
      this.emit("changed");
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("error", mod.id, `${action.label} fehlgeschlagen: ${message}`);
      throw new ValidationError(message);
    }
  }

  private require(id: string): BotModule {
    const mod = this.modules.get(id);
    if (!mod) throw new NotFoundError(`Modul „${id}“ gibt es nicht.`);
    return mod;
  }

  private runtime(id: string): Runtime {
    return this.runtimes.get(id)!;
  }

  private serialize(id: string, task: () => Promise<void>): Promise<void> {
    const rt = this.runtime(id);
    const next = rt.busy.then(task, task);
    rt.busy = next.catch(() => undefined);
    return next;
  }

  private resolveSettings(mod: BotModule): SettingsValues {
    const stored = moduleStore.get(mod.id).settings;
    const values: SettingsValues = {};
    for (const field of mod.settings) {
      const raw = stored[field.key];
      if (raw === undefined) {
        values[field.key] = field.default;
        continue;
      }
      try {
        values[field.key] = this.coerce(field, raw);
      } catch {
        values[field.key] = field.default;
      }
    }
    return values;
  }

  private coerce(field: SettingField, raw: unknown): SettingValue {
    switch (field.type) {
      case "boolean": {
        if (typeof raw !== "boolean") throw new ValidationError(`${field.label} muss an oder aus sein.`);
        return raw;
      }
      case "number": {
        const value = typeof raw === "number" ? raw : Number(raw);
        if (raw === "" || !Number.isFinite(value)) throw new ValidationError(`${field.label} muss eine Zahl sein.`);
        if (field.min !== undefined && value < field.min) {
          throw new ValidationError(`${field.label} muss mindestens ${field.min} sein.`);
        }
        if (field.max !== undefined && value > field.max) {
          throw new ValidationError(`${field.label} darf höchstens ${field.max} sein.`);
        }
        return value;
      }
      case "media": {
        const value = String(raw ?? "").trim();
        if (value === "") return "";
        const kind = mediaKind(value);
        const fits = field.accept === "audio" ? kind === "audio" : kind === "image" || kind === "video";
        if (!fits) throw new ValidationError(`${field.label}: Diese Datei passt hier nicht.`);
        return value;
      }
      case "select": {
        const value = String(raw);
        if (!field.options?.some((o) => o.value === value)) {
          throw new ValidationError(`${field.label}: Bitte einen der vorgegebenen Werte wählen.`);
        }
        return value;
      }
      case "color": {
        const value = String(raw).trim();
        if (!/^#?[0-9a-f]{6}$/i.test(value)) {
          throw new ValidationError(`${field.label} muss eine Farbe wie #9146FF sein.`);
        }
        return `#${value.replace(/^#/, "").toUpperCase()}`;
      }
      case "text":
      case "secret": {
        if (typeof raw !== "string") throw new ValidationError(`${field.label} muss Text sein.`);
        const value = raw.trim();
        if (value.length > 2000) throw new ValidationError(`${field.label} ist zu lang.`);
        if (value !== "" && field.pattern && !field.pattern.test(value)) {
          throw new ValidationError(field.patternMessage ?? `${field.label} hat ein ungültiges Format.`);
        }
        return value;
      }
    }
  }

  private missingRequired(mod: BotModule, settings: SettingsValues): string | null {
    for (const field of mod.settings) {
      if (!field.required) continue;
      const value = settings[field.key];
      if (value === "" || value === undefined) {
        return `Die Einstellung „${field.label}“ fehlt.`;
      }
    }
    return null;
  }

  private createContext(mod: BotModule, settings: SettingsValues, rt: Runtime | null): ModuleContext {
    const hub = this.hub;
    const tracker = this.tracker;
    return {
      channel: hub.channel,
      liveStream: () => tracker.live,
      settings: Object.freeze({ ...settings }),
      log: (level, message) => log(level, mod.id, message),
      on(event, handler) {
        if (!rt) return;
        const safeHandler = (...args: Parameters<typeof handler>) => {
          try {
            handler(...args);
          } catch (err) {
            log("error", mod.id, `Fehler bei „${event}“: ${err instanceof Error ? err.message : String(err)}`);
          }
        };
        hub.on(event, safeHandler as never);
        rt.listeners.push({ event, handler: safeHandler as never });
      },
    };
  }

  private async startModule(mod: BotModule): Promise<void> {
    const rt = this.runtime(mod.id);
    const settings = this.resolveSettings(mod);
    const missing = this.missingRequired(mod, settings);

    if (missing) {
      rt.status = "error";
      rt.error = missing;
      log("warn", mod.id, `Nicht gestartet: ${missing}`);
      return;
    }

    try {
      await mod.start(this.createContext(mod, settings, rt));
      rt.status = "running";
      rt.error = null;
      log("info", mod.id, "Läuft");
    } catch (err) {
      this.removeListeners(rt);
      rt.status = "error";
      rt.error = err instanceof Error ? err.message : String(err);
      log("error", mod.id, `Start fehlgeschlagen: ${rt.error}`);
    }
  }

  private async stopModule(mod: BotModule): Promise<void> {
    const rt = this.runtime(mod.id);
    this.removeListeners(rt);
    if (rt.status === "running") {
      try {
        await mod.stop?.();
      } catch (err) {
        log("error", mod.id, `Fehler beim Stoppen: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    rt.status = "stopped";
    rt.error = null;
  }

  private removeListeners(rt: Runtime): void {
    for (const { event, handler } of rt.listeners) {
      this.hub.off(event, handler as never);
    }
    rt.listeners = [];
  }

  private view(mod: BotModule): ModuleView {
    const rt = this.runtime(mod.id);
    const stored = moduleStore.get(mod.id);
    const settings = this.resolveSettings(mod);

    return {
      id: mod.id,
      name: mod.name,
      description: mod.description,
      category: mod.category,
      enabled: stored.enabled,
      status: rt.status,
      error: rt.error,
      settings: mod.settings.map((field) => {
        const value = settings[field.key];
        const isSet = value !== "" && value !== undefined;
        return {
          key: field.key,
          label: field.label,
          type: field.type,
          description: field.description ?? null,
          required: field.required ?? false,
          min: field.min ?? null,
          max: field.max ?? null,
          options: field.options ?? null,
          accept: field.accept ?? null,
          value: field.type === "secret" ? "" : value,
          isSet,
        };
      }),
      actions: (mod.actions ?? []).map((a) => ({ id: a.id, label: a.label })),
      overlayUrl: mod.overlayPath
        ? `${config.publicUrl}${mod.overlayPath}?token=${encodeURIComponent(overlayTokenStore.get())}`
        : null,
    };
  }
}
