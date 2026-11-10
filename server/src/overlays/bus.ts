import { EventEmitter } from "node:events";
import type { SettingField } from "../modules/types.js";

export const OVERLAY_IDS = ["top-chatter", "watch-streak"] as const;
export type OverlayId = (typeof OVERLAY_IDS)[number];

export type OverlayChannel = OverlayId | "layout";

export const OVERLAY_SIZES: Record<OverlayId, { width: number; height: number }> = {
  "top-chatter": { width: 460, height: 760 },
  "watch-streak": { width: 820, height: 320 },
};

export const STANDALONE = "standalone";

export const OVERLAY_POSITIONS = [
  { value: "top-left", label: "Oben links" },
  { value: "top-center", label: "Oben Mitte" },
  { value: "top-right", label: "Oben rechts" },
  { value: "middle-left", label: "Mitte links" },
  { value: "center", label: "Mitte" },
  { value: "middle-right", label: "Mitte rechts" },
  { value: "bottom-left", label: "Unten links" },
  { value: "bottom-center", label: "Unten Mitte" },
  { value: "bottom-right", label: "Unten rechts" },
  { value: STANDALONE, label: "Nur einzeln (nicht im gemeinsamen Link)" },
];

export function overlayLayoutSettings(defaultPosition: string): SettingField[] {
  return [
    {
      key: "position",
      label: "Position im OBS-Bild",
      type: "select",
      default: defaultPosition,
      options: OVERLAY_POSITIONS,
      description:
        "Wo das Overlay im gemeinsamen Link erscheint. „Nur einzeln“: Es fehlt dort, und du bindest es mit seinem eigenen Link als eigene Browserquelle ein, die du in OBS frei verschieben kannst.",
    },
    {
      key: "scale",
      label: "Größe in Prozent",
      type: "number",
      default: 100,
      min: 30,
      max: 250,
    },
  ];
}

export interface LayoutEntry {
  id: OverlayId;
  position: string;
  scale: number;
  width: number;
  height: number;
}

const states = new Map<string, Map<OverlayChannel, unknown>>();

export const overlayBus = new EventEmitter<{ message: [channel: string, id: OverlayChannel, data: unknown] }>();

export function setOverlayState(channel: string, id: OverlayChannel, state: unknown): void {
  const channelStates = states.get(channel) ?? new Map<OverlayChannel, unknown>();
  if (JSON.stringify(channelStates.get(id)) === JSON.stringify(state)) return;
  channelStates.set(id, state);
  states.set(channel, channelStates);
  overlayBus.emit("message", channel, id, state);
}

export function overlayState(channel: string, id: OverlayChannel): unknown {
  return states.get(channel)?.get(id);
}

export function clearOverlayStates(channel: string): void {
  states.delete(channel);
}

export function sendToOverlay(channel: string, id: OverlayId, data: unknown): void {
  overlayBus.emit("message", channel, id, data);
}
