/**
 * Centralized LLM routing — the single entry point that combines:
 *   1. Model selection (CLI flag → config default → error)
 *   2. Provider resolution (via router)
 *   3. API-key validation
 *   4. Legacy env-var override (back-compat with `agent.openrouter_api_key_env`)
 *
 * Both `specs agent` and `specs debrand --polish` route through here so
 * model-resolution logic exists in exactly one place.
 */
import type { Config } from "../config.ts";
import { resolveProvider, type ResolvedProvider } from "./router.ts";

/**
 * A "task" identifies which `llm.defaults.<task>` key feeds the default
 * model. Add new tasks to `Config.llm.defaults` alongside an entry here.
 */
export type LLMTask = "agent" | "polish";

export interface ResolveLLMOptions {
  /** Loaded project config (`.specs-engine.yaml`). */
  config: Config;
  /** Which task is requesting a model — picks the default from config. */
  task: LLMTask;
  /** Explicit override from CLI (`--model`). Wins over config defaults. */
  modelOverride?: string;
  /** Environment for api-key lookup. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export type ResolveLLMResult =
  | {
      ok: true;
      resolved: ResolvedProvider;
      /** Final api key after env + legacy override lookup; null when the provider needs none. */
      apiKey: string | null;
      /**
       * Env to forward to `createAgentModel`. When the legacy
       * `agent.openrouter_api_key_env` is set, the resolved key is mirrored
       * onto the canonical env name so downstream `provider.apiKey(env)` works
       * uniformly.
       */
      env: NodeJS.ProcessEnv;
    }
  | {
      ok: false;
      /** Human-readable diagnostic line(s); already newline-terminated. */
      error: string;
      /** Suggested process exit code. 1 = config/auth error, 2 = usage error. */
      exitCode: 1 | 2;
    };

/**
 * Resolve the model + provider + api key for a task. See module doc.
 *
 * Resolution order for the model id:
 *   1. `opts.modelOverride` (CLI flag)
 *   2. `config.llm.defaults[task]`
 *   3. Error — caller must surface the diagnostic.
 */
export function resolveLLM(opts: ResolveLLMOptions): ResolveLLMResult {
  const { config, task, modelOverride } = opts;
  const env = opts.env ?? process.env;

  const modelId = modelOverride ?? config.llm?.defaults?.[task];
  if (!modelId) {
    return {
      ok: false,
      exitCode: 2,
      error:
        `${task}: no model selected. Pass --model <id> or set ` +
        `llm.defaults.${task} in .specs-engine.yaml.\n`,
    };
  }

  const resolved = resolveProvider(modelId);

  // Legacy override only applies to the openrouter provider; ignored for others
  // so configs that left it at default ("OPENROUTER_API_KEY") don't shadow the
  // anthropic/zai env vars.
  const legacyEnvName =
    resolved.provider.prefix === "openrouter"
      ? config.agent?.openrouter_api_key_env
      : undefined;
  const apiKey = legacyEnvName
    ? (env[legacyEnvName] ?? null)
    : resolved.provider.apiKey(env);

  if (resolved.provider.apiKeyEnvName && !apiKey) {
    const envName = legacyEnvName ?? resolved.provider.apiKeyEnvName;
    return {
      ok: false,
      exitCode: 1,
      error:
        `${task}: ${envName} environment variable is not set ` +
        `(required for provider '${resolved.provider.prefix}').\n`,
    };
  }

  // Mirror the legacy-resolved key onto the canonical env name so the
  // downstream client factory's apiKey(env) call sees the same value.
  const forwardEnv =
    legacyEnvName && apiKey
      ? { ...env, [resolved.provider.apiKeyEnvName!]: apiKey }
      : env;

  return { ok: true, resolved, apiKey, env: forwardEnv };
}
