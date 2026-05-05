/**
 * Provider registry for the agent runner.
 *
 * Each provider is an OpenAI-compatible chat completions endpoint accessed via
 * the Vercel AI SDK's `@ai-sdk/openai`. Adding a new provider is a registry edit
 * here — the rest of the agent code (client, prompt resolver, command runner)
 * is provider-agnostic and reads from this map.
 */

export interface ProviderConfig {
  /** Stable string used as model-id prefix and run-dir slug component. */
  prefix: string;
  /** Resolve the OpenAI-compatible base URL (e.g. ".../v1") for this provider. */
  baseURL: (env: NodeJS.ProcessEnv) => string;
  /** Resolve the API key (or null if unauthenticated). */
  apiKey: (env: NodeJS.ProcessEnv) => string | null;
  /** Env var name surfaced in diagnostics; null when no api key is required. */
  apiKeyEnvName: string | null;
  /** Prompt directory walk order under `<ralphPack>/.ralph/prompts/`. */
  promptDirs: readonly string[];
  /** Optional curated list of models known to drive tool calls reliably. */
  knownGoodModels?: readonly string[];
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  openrouter: {
    prefix: "openrouter",
    baseURL: () => "https://openrouter.ai/api/v1",
    apiKey: (env) => env["OPENROUTER_API_KEY"] ?? null,
    apiKeyEnvName: "OPENROUTER_API_KEY",
    promptDirs: ["openrouter", "anthropic"],
  },
};
