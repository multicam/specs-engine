/**
 * Resolve a CLI `--model` argument to a provider config + the model name to
 * send to that provider. Supports the `<provider>/<model>` form and the legacy
 * bare `<vendor>/<model>` form (back-compat: routes to openrouter and passes
 * the literal string through).
 */
import { PROVIDERS, type ProviderConfig } from "./providers.ts";
import type { ModelTier } from "./budgets.ts";

export interface ResolvedProvider {
  provider: ProviderConfig;
  /** The model name to send to the provider (provider prefix stripped). */
  modelName: string;
  /** The original model id as passed on the CLI (used for prompt + slug context). */
  modelId: string;
  /** Budget tier derived from the provider's defaultTier (defaults to 'weak'). */
  tier: ModelTier;
}

export function resolveProvider(modelId: string): ResolvedProvider {
  const slashIdx = modelId.indexOf("/");
  if (slashIdx > 0) {
    const head = modelId.slice(0, slashIdx);
    const tail = modelId.slice(slashIdx + 1);
    const provider = PROVIDERS[head];
    if (provider) {
      return { provider, modelName: tail, modelId, tier: provider.defaultTier ?? "weak" };
    }
  }
  // Legacy / no-prefix / unknown-prefix: route to openrouter with the literal string.
  // OpenRouter handles its own model-not-found errors.
  const fallback = PROVIDERS["openrouter"];
  if (!fallback) {
    throw new Error("router: openrouter provider missing from registry");
  }
  return { provider: fallback, modelName: modelId, modelId, tier: fallback.defaultTier ?? "weak" };
}
