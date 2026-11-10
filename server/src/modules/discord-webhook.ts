const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const DISCORD_WEBHOOK_PATTERN = /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

export function escapeMarkdown(text: string): string {
  return text.replace(/([\\_*~`|>#\[\]()])/g, "\\$1");
}

export function discordColor(hex: unknown): number {
  return Number.parseInt(String(hex).replace("#", ""), 16);
}

export function createPostQueue(delayMs = 1000) {
  let queue: Promise<void> = Promise.resolve();
  let generation = 0;

  return {
    reset(): void {
      generation++;
    },
    push(task: () => Promise<void>, onError: (message: string) => void): void {
      const gen = generation;
      queue = queue
        .then(async () => {
          if (gen !== generation) return;
          await task();
          await sleep(delayMs);
        })
        .catch((err) => onError(err instanceof Error ? err.message : String(err)));
    },
  };
}

export interface WebhookFile {
  name: string;
  data: Uint8Array;
  contentType: string;
}

function buildBody(payload: unknown, files: WebhookFile[]): { body: string | FormData; headers?: Record<string, string> } {
  if (files.length === 0) {
    return { body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } };
  }
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  files.forEach((file, i) => {
    form.append(`files[${i}]`, new Blob([file.data], { type: file.contentType }), file.name);
  });
  return { body: form };
}

export async function sendDiscordWebhook(url: string, payload: unknown, files: WebhookFile[] = []): Promise<void> {
  let lastError = "Unbekannter Fehler";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", ...buildBody(payload, files) });
    } catch (err) {
      lastError = `Netzwerkfehler: ${err instanceof Error ? err.message : String(err)}`;
      await sleep(2000 * attempt);
      continue;
    }

    if (res.ok) return;

    if (res.status === 429) {
      const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
      lastError = "Discord Rate Limit";
      await sleep((data.retry_after ?? 2) * 1000);
      continue;
    }

    if (res.status === 401 || res.status === 404) {
      throw new Error("Die Webhook-URL ist ungültig oder der Webhook wurde in Discord gelöscht.");
    }

    const text = await res.text().catch(() => "");
    throw new Error(`Discord antwortet mit ${res.status}: ${text.slice(0, 200)}`);
  }

  throw new Error(`Nach ${MAX_ATTEMPTS} Versuchen aufgegeben (${lastError}).`);
}
