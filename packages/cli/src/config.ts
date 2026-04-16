import { z } from "zod";
import yaml from "js-yaml";
import { readFile } from "node:fs/promises";

/**
 * Schema for `.specs-engine.yaml`. See plan §`.specs-engine.yaml schema`.
 *
 * Defaults mirror the defaults written by `specs init`: missing optional
 * sections evaluate to safe values so callers can `config.crawl.max_depth`
 * without per-field guarding.
 */
export const ConfigSchema = z.object({
  target: z.string().min(1, "target is required"),
  scrape_repo: z.string().min(1, "scrape_repo is required"),

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
});

export type Config = z.infer<typeof ConfigSchema>;

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
