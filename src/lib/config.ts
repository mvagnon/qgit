export type ZapgitConfig = {
  ollamaUrl: string;
  model: string;
};

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_MODEL = "deepseek-v4-flash:cloud";

export function resolveConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<ZapgitConfig> = {},
): ZapgitConfig {
  return {
    ollamaUrl: overrides.ollamaUrl ?? env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL,
    model: overrides.model ?? env.OLLAMA_MODEL ?? DEFAULT_MODEL,
  };
}
