/**
 * Provider registry for the agent runner.
 *
 * Each provider is an OpenAI-compatible chat completions endpoint accessed via
 * the Vercel AI SDK's `@ai-sdk/openai`. Adding a new provider is a registry edit
 * here — the rest of the agent code (client, prompt resolver, command runner)
 * is provider-agnostic and reads from this map.
 */
import type { ModelTier } from "./budgets.ts";

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
  /**
   * Default budget tier for models served by this provider.
   * 'strong' = frontier API (higher budgets); 'weak' = local/Ollama (tight budgets).
   * Defaults to 'weak' when absent.
   */
  defaultTier?: ModelTier;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  openrouter: {
    prefix: "openrouter",
    baseURL: () => "https://openrouter.ai/api/v1",
    apiKey: (env) => env["OPENROUTER_API_KEY"] ?? null,
    apiKeyEnvName: "OPENROUTER_API_KEY",
    promptDirs: ["openrouter", "anthropic"],
    defaultTier: "strong",
  },
  ollama: {
    prefix: "ollama",
    baseURL: (env) => {
      const host = env["OLLAMA_HOST"] ?? "http://localhost:11434";
      if (host.endsWith("/v1")) return host;
      return `${host.replace(/\/$/, "")}/v1`;
    },
    apiKey: () => null,
    apiKeyEnvName: null,
    promptDirs: ["ollama", "anthropic"],
    // Curated list of Ollama models known to drive OpenAI-style tool calls
    // reliably. The probe in Phase 4 is the source of truth; this list seeds
    // the diagnostic when the probe fails on an unknown model.
    knownGoodModels: [
      "qwen2.5-coder:7b",
      "qwen2.5-coder:32b",
      "llama3.1:8b",
      "mistral-nemo:12b",
      "qwen2.5:7b",
      "qwen2.5:32b",
    ],
    defaultTier: "weak",
  },
};
