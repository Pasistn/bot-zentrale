import { getAvatarUrl } from "../twitch/helix.js";
import type { ModuleContext, SettingField } from "./types.js";

export const SHOW_AVATAR_SETTING: SettingField = {
  key: "showAvatar",
  label: "Profilbild anzeigen",
  type: "boolean",
  default: true,
  description: "Holt das Twitch-Profilbild der Person über die Twitch-API und zeigt es oben rechts im Beitrag.",
};

export async function avatarFor(ctx: ModuleContext, login: string | null): Promise<string | null> {
  if (ctx.settings.showAvatar !== true || !login) return null;
  try {
    return await getAvatarUrl(login);
  } catch (err) {
    ctx.log("warn", `Profilbild von ${login} nicht geladen: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
