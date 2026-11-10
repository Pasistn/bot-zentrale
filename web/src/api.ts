import type { ManagedChannel, MediaFile, Me, ModuleView, SettingValue, SummaryView } from "./types";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new ApiError(data.error ?? `Anfrage fehlgeschlagen (${res.status}).`, res.status);
  }
  return data as T;
}

export const api = {
  me: () => request<Me>("GET", "/api/me"),
  switchChannel: (channel: string) => request<{ channel: string }>("POST", "/api/me/channel", { channel }),
  listChannels: () => request<{ channels: ManagedChannel[] }>("GET", "/api/channels"),
  addChannel: (login: string) => request<{ channels: ManagedChannel[] }>("POST", "/api/channels", { login }),
  removeChannel: (login: string) =>
    request<{ channels: ManagedChannel[] }>("DELETE", `/api/channels/${encodeURIComponent(login)}`),
  listAccess: () => request<{ logins: string[] }>("GET", "/api/access"),
  addAccess: (login: string) => request<{ logins: string[] }>("POST", "/api/access", { login }),
  removeAccess: (login: string) => request<{ logins: string[] }>("DELETE", `/api/access/${encodeURIComponent(login)}`),
  logout: () => request<{ ok: true }>("POST", "/auth/logout", {}),
  setEnabled: (id: string, enabled: boolean) =>
    request<{ module: ModuleView }>("POST", `/api/modules/${encodeURIComponent(id)}/enabled`, { enabled }),
  saveSettings: (id: string, settings: Record<string, SettingValue>) =>
    request<{ module: ModuleView }>("PUT", `/api/modules/${encodeURIComponent(id)}/settings`, settings),
  runAction: (id: string, actionId: string) =>
    request<{ message: string }>(
      "POST",
      `/api/modules/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionId)}`,
      {}
    ),
  postSummary: (id: number) => request<{ summary: SummaryView }>("POST", `/api/summaries/${id}/post`, {}),
  listMedia: () => request<{ media: MediaFile[] }>("GET", "/api/media"),
  deleteMedia: (file: string) => request<{ ok: true }>("DELETE", `/api/media/${encodeURIComponent(file)}`),
  async uploadMedia(file: File): Promise<{ media: MediaFile }> {
    const res = await fetch(`/api/media?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; media?: MediaFile };
    if (!res.ok || !data.media) throw new ApiError(data.error ?? `Hochladen fehlgeschlagen (${res.status}).`, res.status);
    return { media: data.media };
  },
  renewOverlayToken: () => request<{ message: string }>("POST", "/api/overlays/renew-token", {}),
  discardSummary: (id: number) => request<{ summary: SummaryView }>("POST", `/api/summaries/${id}/discard`, {}),
};
