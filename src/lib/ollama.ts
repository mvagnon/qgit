import { Ollama } from "ollama";

import { COMMIT_SYSTEM_PROMPT, sanitizeCommitMessage, truncateDiff } from "./commit-message";
import type { ZapgitConfig } from "./config";

const REQUEST_TIMEOUT_MS = 25_000;

const fetchWithTimeout: typeof fetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> =>
    fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
  { preconnect: fetch.preconnect },
);

export async function generateCommitMessage(diff: string, config: ZapgitConfig): Promise<string> {
  const client = new Ollama({ host: config.ollamaUrl, fetch: fetchWithTimeout });

  const response = await client.chat({
    model: config.model,
    stream: false,
    keep_alive: "30m",
    options: { temperature: 0.2 },
    messages: [
      { role: "system", content: COMMIT_SYSTEM_PROMPT },
      { role: "user", content: truncateDiff(diff) },
    ],
  });

  return sanitizeCommitMessage(response.message.content);
}
