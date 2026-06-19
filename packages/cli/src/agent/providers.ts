/**
 * Provider registry for the agent runner.
 *
 * Most providers are OpenAI-compatible and go through `@ai-sdk/openai`.
 * Providers with a native AI SDK adapter (e.g. Anthropic) set `createModel`
 * to bypass the OpenAI-compatible path entirely.
 */
import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { resolveApiKey, ZaiClient } from "@zai-tools/zai";
import { createZaiLanguageModel } from "@zai-tools/zai/ai-sdk";
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
  /**
   * Optional native model factory. When set, `createAgentModel` uses this
   * instead of the default OpenAI-compatible path. Use for providers that have
   * a dedicated AI SDK adapter (e.g. `@ai-sdk/anthropic`).
   */
  createModel?: (modelName: string, env: NodeJS.ProcessEnv) => LanguageModel;
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
  anthropic: {
    prefix: "anthropic",
    baseURL: () => "https://api.anthropic.com/v1",
    apiKey: (env) => env["ANTHROPIC_API_KEY"] ?? null,
    apiKeyEnvName: "ANTHROPIC_API_KEY",
    promptDirs: ["anthropic"],
    defaultTier: "strong",
    createModel: (modelName, env) =>
      createAnthropic({ apiKey: env["ANTHROPIC_API_KEY"] ?? "" })(modelName),
  },
  zai: {
    prefix: "zai",
    baseURL: () => "https://api.z.ai/api/coding/paas/v4",
    // Resolves the z.ai key via @zai-tools/zai's D4 chain
    // (ZAI_API_KEY → ZAI_CODING_CN_API_KEY → ZHIPU_API_KEY). `skipDotenv: true`
    // omits the `~/.claude/.env` fallback: that is a qara convention, not
    // specs-engine's, and keeping it out makes resolution host-independent and
    // `apiKey({})` deterministically null. See specs/phase7-specs-engine.md (D-7-1).
    apiKey: (env) => resolveApiKey({ env, skipDotenv: true }),
    apiKeyEnvName: "ZAI_API_KEY",
    promptDirs: ["zai", "glm-5", "anthropic"],
    // Cosmetic: shown in the probe-failure diagnostic. GLM-5.1, 4.7, 4.6 all
    // document tool-call support; 4.5-air is a cheaper variant worth surfacing.
    knownGoodModels: [
      "glm-5.1",
      "glm-4.7",
      "glm-4.6",
      "glm-4.5-air",
    ],
    defaultTier: "strong",
    // V6 (D-V6-1): drive z.ai through the V4 adapter so each call captures the
    // value layer — retry-classify (incl. z.ai business codes), the concurrency
    // gate, per-request JWT minting, and tool-calling — instead of the generic
    // createOpenAI(...).chat() path. Key resolution stays single-path + host-
    // independent: thread `key: { env, skipDotenv: true }` so ZaiClient resolves
    // via the SAME D4 chain + skipDotenv (D-7-1). A pre-resolved `apiKey:` would
    // be a trap — on null, ZaiClient re-resolves WITH dotenv, leaking ~/.claude/.env.
    createModel: (modelName, env) =>
      createZaiLanguageModel({
        model: modelName,
        client: new ZaiClient({ key: { env, skipDotenv: true } }),
      }),
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
