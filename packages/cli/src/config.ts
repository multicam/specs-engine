import { z } from "zod";
import yaml from "js-yaml";
import { readFile } from "node:fs/promises";

/**
 * Schema for `.specs-engine.yaml`. See plan §`.specs-engine.yaml schema`.
 *
 * Defaults mirror the defaults written by `specs init`: missing optional
 * sections evaluate to safe values so callers can `config.crawl.max_depth`
 * without per-field guarding.
 *
 * The `llm` section is the **single source of truth for LLM routing**:
 *   - `llm.defaults.<task>` selects the default model for a task (agent,
 *     polish). `--model` on the CLI overrides per-call.
 *   - `llm.budgets.<tier>` overrides the built-in tier budgets from
 *     `agent/budgets.ts`. Partial overrides are merged with the defaults.
 *   - `llm.polish.max_tokens` controls the debrand-polish completion size.
 *   - `llm.agent.max_iterations` is the default for `specs agent`'s outer
 *     loop when `--max-iterations` is not passed.
 *
 * The historical `agent.openrouter_api_key_env` knob is retained for
 * back-compat — when set, the agent resolves the OpenRouter key from that
 * env var instead of `OPENROUTER_API_KEY`. New configs should drop it.
 */
const BudgetOverrideSchema = z
  .object({
    readBudget: z.number().int().positive().optional(),
    exploreBudget: z.number().int().positive().optional(),
    stepsPerRound: z.number().int().positive().optional(),
  })
  .strict();

export const ConfigSchema = z.object({
  target: z.string().min(1, "target is required"),
  scrape_repo: z.string().min(1, "scrape_repo is required"),
  /**
   * Submodule mount point *inside* the project repo where `scrape_repo` is
   * pulled in. Default `scrape` — a role-named directory so the project tree
   * reads as `dub-project/scrape/`, not `dub-project/dub-scrape/` (the latter
   * looked like duplication of the sibling).
   *
   * Pre-2026-05-22 projects scaffolded without this field; the resolver falls
   * back to the basename of `scrape_repo` (e.g. `dub-scrape`) so existing
   * layouts keep working until they're migrated.
   */
  scrape_mount: z.string().min(1).optional(),

  crawl: z.object({
    start: z
      .array(z.string().url("crawl.start[*] must be a valid URL"))
      .min(1, "crawl.start must contain at least one URL"),
    follow: z.array(z.string()).default([]),
    ignore: z.array(z.string()).default([]),
    max_depth: z.number().int().nonnegative().default(4),
    max_pages: z.number().int().positive().default(500),
    rate_limit_ms: z.number().int().nonnegative().default(500),
  }),

  jina: z
    .object({
      base_url: z.string().url().default("https://r.jina.ai"),
      api_key_env: z.string().default("JINA_API_KEY"),
      timeout_ms: z.number().int().positive().default(30_000),
    })
    .default({
      base_url: "https://r.jina.ai",
      api_key_env: "JINA_API_KEY",
      timeout_ms: 30_000,
    }),

  debrand: z
    .object({
      glossary: z.record(z.string(), z.string()).default({}),
      polish: z.boolean().default(false),
    })
    .default({ glossary: {}, polish: false }),

  agent: z
    .object({
      ralph_pack: z.string().min(1, "agent.ralph_pack is required").optional(),
      /** @deprecated use `llm.providers.openrouter.api_key_env` (not yet implemented) or just `OPENROUTER_API_KEY`. */
      openrouter_api_key_env: z.string().default("OPENROUTER_API_KEY"),
    })
    .optional(),

  llm: z
    .object({
      defaults: z
        .object({
          /** Default model for `specs agent` when `--model` is not passed. */
          agent: z.string().min(1).optional(),
          /** Default model for `specs debrand --polish`. Anthropic models recommended. */
          polish: z.string().min(1).optional(),
        })
        .default({}),
      budgets: z
        .object({
          strong: BudgetOverrideSchema.optional(),
          weak: BudgetOverrideSchema.optional(),
        })
        .default({}),
      polish: z
        .object({
          /** Max completion tokens for the polish pass. */
          max_tokens: z.number().int().positive().default(8000),
          /**
           * Max in-flight polish calls. 6 is the empirical sweet spot for
           * z.ai/Anthropic-style providers; bump up on subscription-billed
           * providers, drop to 1 if you hit rate limits.
           */
          concurrency: z.number().int().positive().default(6),
        })
        .default({ max_tokens: 8000, concurrency: 6 }),
      agent: z
        .object({
          /** Default `--max-iterations` for `specs agent`. */
          max_iterations: z.number().int().positive().default(5),
        })
        .default({ max_iterations: 5 }),
    })
    .default({
      defaults: {},
      budgets: {},
      polish: { max_tokens: 8000, concurrency: 6 },
      agent: { max_iterations: 5 },
    }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type BudgetOverride = z.infer<typeof BudgetOverrideSchema>;

/**
 * Resolve the submodule mount path inside the project repo.
 *
 * Prefer `config.scrape_mount` (post-2026-05-22 scaffolds use `scrape`).
 * Legacy fallback: basename of `config.scrape_repo` — old projects scaffolded
 * `scrape_repo: ../<target>-scrape` and mounted as `<target>-scrape/`.
 *
 * Used by every command that touches the submodule (agent, status, repin,
 * diff, scrape) so the resolution rule lives in exactly one place.
 */
export function resolveScrapeMount(config: Config): string {
  const explicit = config.scrape_mount?.trim();
  if (explicit) return explicit;
  return config.scrape_repo.replace(/^\.\.\//, "").replace(/\/$/, "");
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
  }
}

/**
 * Parse + validate raw YAML text. Rethrows zod errors as a single ConfigError
 * with one bullet per issue, so the CLI prints something a human can act on
 * rather than a JSON dump.
 */
export function parseConfig(yamlText: string, source = "<config>"): Config {
  let raw: unknown;
  try {
    raw = yaml.load(yamlText);
  } catch (err) {
    throw new ConfigError(`${source}: invalid YAML: ${(err as Error).message}`, err);
  }
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`${source}: invalid config:\n${issues}`);
  }
  return result.data;
}

export async function loadConfig(path: string): Promise<Config> {
  const text = await readFile(path, "utf8");
  return parseConfig(text, path);
}
