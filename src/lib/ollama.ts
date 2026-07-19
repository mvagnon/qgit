import { COMMIT_SYSTEM_PROMPT } from "../prompts";
import type { CommitType } from "../types/commit";
import type { ZapdevConfig } from "../types/config";
import { applyCommitType, sanitizeCommitMessage, truncateDiff } from "./commit-message";

const REQUEST_TIMEOUT_MS = 25_000;
const KEEP_ALIVE = "30m";

type ChatMessage = { role: "system" | "user"; content: string };

export async function generateCommitMessage(
  diff: string,
  config: ZapdevConfig,
  type?: CommitType,
): Promise<string> {
  const systemPrompt = type ? applyCommitType(COMMIT_SYSTEM_PROMPT, type) : COMMIT_SYSTEM_PROMPT;

  const content = await chat(config, [
    { role: "system", content: systemPrompt },
    { role: "user", content: truncateDiff(diff) },
  ]);

  return sanitizeCommitMessage(content);
}

async function chat(config: ZapdevConfig, messages: ChatMessage[]): Promise<string> {
  const url = `${config.ollamaUrl}/api/chat`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        keep_alive: KEEP_ALIVE,
        options: { temperature: 0.2 },
        messages,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(describeRequestError(error, url), { cause: error });
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Ollama error: ${serverError(body) ?? `HTTP ${response.status}`}`);
  }

  const content = messageContent(body);
  if (content === null) throw new Error("Ollama returned an unexpected response shape.");
  return content;
}

function describeRequestError(error: unknown, url: string): string {
  if (errorName(error) === "TimeoutError") {
    return `Ollama did not answer within ${REQUEST_TIMEOUT_MS / 1000}s (${url}).`;
  }
  return `Could not reach Ollama at ${url}. Is it running?`;
}

function errorName(error: unknown): string | null {
  if (error && typeof error === "object" && "name" in error && typeof error.name === "string") {
    return error.name;
  }
  return null;
}

function serverError(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return null;
}

function messageContent(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("message" in body)) return null;
  const message = body.message;
  if (!message || typeof message !== "object" || !("content" in message)) return null;
  return typeof message.content === "string" ? message.content : null;
}
