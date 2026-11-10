import type { BotModule } from "./types.js";
import { createWatchStreakModule } from "./watch-streak.js";
import { createSubsModule } from "./subs.js";
import { createGiftSubsModule } from "./gift-subs.js";
import { createRaidsModule } from "./raids.js";
import { createStreamSummaryModule } from "./stream-summary.js";
import { createTopChatterModule } from "./top-chatter.js";
import { createWatchStreakAlertModule } from "./watch-streak-alert.js";

export function createModules(): BotModule[] {
  return [
    createWatchStreakModule(),
    createSubsModule(),
    createGiftSubsModule(),
    createRaidsModule(),
    createStreamSummaryModule(),
    createTopChatterModule(),
    createWatchStreakAlertModule(),
  ];
}
