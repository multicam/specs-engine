/**
 * Vercel AI SDK client factory for OpenRouter.
 *
 * Creates an OpenAI-compatible provider pointed at OpenRouter's API endpoint.
 * The API key is read from the environment variable specified in config
 * (default: OPENROUTER_API_KEY).
 */
import { createOpenAI } from "@ai-sdk/openai";

export interface AgentClientOptions {
  /** OpenRouter API key. */
  apiKey: string;
  /** OpenRouter model ID, e.g. "deepseek/deepseek-chat". */
  modelId: string;
}

/**
 * Create a Vercel AI SDK language model pointed at OpenRouter.
 */
export function createAgentModel(opts: AgentClientOptions) {
  const openrouter = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: opts.apiKey,
  });
  // .chat() forces Chat Completions API; default uses Responses API which OpenRouter doesn't support
  return openrouter.chat(opts.modelId);
}
