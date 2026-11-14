import type { GiveawayRules } from "./types";

export const number = (n: number) => n.toLocaleString("de-DE");

export const percent = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: n < 10 ? 1 : 0 })} %`;

export const day = (iso: string) =>
  new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

export const time = (iso: string) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function duration(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const parts = [];
  if (days) parts.push(days === 1 ? "einem Tag" : `${days} Tagen`);
  if (hours) parts.push(hours === 1 ? "einer Stunde" : `${hours} Stunden`);
  return parts.join(" und ");
}

export function factor(n: number): string {
  return ({ 2: "doppelt", 3: "dreifach", 4: "vierfach", 5: "fünffach" } as Record<number, string>)[n] ?? `${n}-fach`;
}

export function rulesFor(g: GiveawayRules): string[] {
  const list: string[] = [];
  if (g.mode === "points") {
    list.push(`Einlösen für ${number(g.rewardCost ?? 0)} Kanalpunkte.`);
    list.push(g.maxTickets > 1 ? `Bis zu ${g.maxTickets} Lose pro Person.` : "Ein Los pro Person.");
  } else {
    list.push("In den Chat schreiben, um mitzumachen.");
  }
  if (g.followerOnly) {
    list.push(
      g.minFollowMinutes > 0 ? `Nur wer seit mindestens ${duration(g.minFollowMinutes)} folgt.` : "Nur Follower."
    );
  }
  if (g.subOnly) list.push("Nur Subscriber.");
  if (g.subMultiplier > 1) list.push(`Lose von Subscribern zählen ${factor(g.subMultiplier)}.`);
  return list;
}

export function title(g: GiveawayRules): string {
  return g.mode === "points" ? (g.rewardTitle ?? "") : g.keyword;
}

export function lasted(fromIso: string, toIso: string | null): string {
  if (!toIso) return "";
  const minutes = Math.max(1, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h} Std. ${minutes % 60} Min.` : `${minutes} Min.`;
}
