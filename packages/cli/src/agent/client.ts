/**
 * Vercel AI SDK client factory for OpenAI-compatible providers.
 *
 * The provider configuration (baseURL, apiKey, etc.) comes from `providers.ts`
 * via the router; this module is provider-agnostic.
 */
import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderConfig } from "./providers.ts";

export interface AgentClientOptions {
  /** Resolved provider config (from `resolveProvider`). */
  provider: ProviderConfig;
  /** Model name to send to the provider (provider prefix already stripped). */
  modelName: string;
  /** Override env (for tests). Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Create a Vercel AI SDK language model bound to the given provider + model.
 */
export function createAgentModel(opts: AgentClientOptions) {
  const env = opts.env ?? process.env;
  const baseURL = opts.provider.baseURL(env);
  // OpenAI SDK requires a non-empty apiKey string. Providers without auth
  // (Ollama) get a placeholder; the value is ignored by the server.
  const apiKey = opts.provider.apiKey(env) ?? "no-key";
  const client = createOpenAI({ baseURL, apiKey });
  // .chat() forces Chat Completions API; default uses Responses API which
  // most OpenAI-compatible servers (OpenRouter, Ollama, etc.) don't support.
  return client.chat(opts.modelName);
}
