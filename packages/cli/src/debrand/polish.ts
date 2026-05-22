import { readFile, writeFile } from "node:fs/promises";
import { generateText } from "ai";
import type { Config } from "../config.ts";
import { resolveLLM } from "../agent/resolve.ts";
import { createAgentModel } from "../agent/client.ts";

/**
 * Optional LLM polish pass. Runs each markdown file through the configured
 * polish model with a paraphrase prompt that:
 *   - preserves frontmatter verbatim
 *   - removes brand voice
 *   - keeps factual claims intact
 *   - returns markdown only (no commentary)
 *
 * Model + max_tokens are read from `.specs-engine.yaml`:
 *   llm:
 *     defaults:
 *       polish: anthropic/claude-sonnet-4-5
 *     polish:
 *       max_tokens: 8000
 *
 * Skipped automatically if the resolved provider's api-key env is unset; the
 * caller sees a friendly note rather than an exception.
 *
 * Trade-off: this is N HTTP round-trips for N files and is slow. Hence
 * `polish` is a separate config flag (default false), so the deterministic
 * substitution pass remains the fast path.
 */
export interface PolishOptions {
  files: readonly string[];
  /** Project config — provides `llm.defaults.polish` + `llm.polish.max_tokens`. */
  config: Config;
  /** Test seam: inject a stub completion that bypasses provider/model wiring. */
  call?: (prompt: string) => Promise<string>;
  /**
   * Max in-flight polish calls. Defaults to 6 — empirically a sweet spot
   * for z.ai/Anthropic-style providers that allow several concurrent requests
   * without rate-limit churn. Set to 1 to force serial (useful for tests).
   */
  concurrency?: number;
  /** Optional per-file progress callback. Fires after each file completes. */
  onProgress?: (info: {
    file: string;
    index: number;
    total: number;
    changed: boolean;
    error?: Error;
  }) => void;
}

export interface PolishResult {
  polished: string[];
  skipped: string[];
  reason?: string;
}

/**
 * Build the polish system prompt, anchoring on the glossary target names so
 * polish doesn't strip the rebranded name as "brand-specific phrasing".
 *
 * Without this anchor, GLM/Sonnet read "remove brand-specific phrasing"
 * literally and rewrite every `Vade` → `the product`, undoing the glossary
 * pass. The rebranded names ARE the canonical product names — only the prior
 * brand's marketing voice should go.
 */
function buildSystem(config: Config): string {
  const targets = Object.values(config.debrand.glossary).filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  const preserveNote =
    targets.length > 0
      ? ` The product is named ${targets.join(", ")} — preserve ${targets.length === 1 ? "this name" : "these names"} verbatim as the canonical product ${targets.length === 1 ? "name" : "names"}; do not rewrite ${targets.length === 1 ? "it" : "them"} to "the product" or similar.`
      : "";
  return `You are a brand-voice editor. Given a markdown document, rewrite it to remove the prior brand's marketing voice (superlatives, competitive framing, sloganeering, hype phrasing) while preserving all factual claims, code blocks, structure, frontmatter, and inline citation markers like [citation-key].${preserveNote} Return ONLY the rewritten markdown — no commentary, no code fences around the whole thing.`;
}

/**
 * Build the default polish-call function from project config. Returns null
 * (with a reason) when the model cannot be resolved or the api key is missing,
 * so the caller can surface a skip message rather than throwing.
 */
function buildDefaultCall(
  config: Config,
): { call: (prompt: string) => Promise<string> } | { reason: string } {
  const llm = resolveLLM({ config, task: "polish" });
  if (!llm.ok) {
    // Strip trailing newline from resolver error for cleaner inline display.
    return { reason: llm.error.replace(/\n+$/, "") };
  }

  const model = createAgentModel({
    provider: llm.resolved.provider,
    modelName: llm.resolved.modelName,
    env: llm.env,
  });
  const maxTokens = config.llm.polish.max_tokens;

  const system = buildSystem(config);

  return {
    call: async (prompt: string): Promise<string> => {
      const r = await generateText({
        model,
        system,
        prompt,
        maxOutputTokens: maxTokens,
      });
      return r.text ?? "";
    },
  };
}

export async function polishFiles(opts: PolishOptions): Promise<PolishResult> {
  let call = opts.call;
  if (!call) {
    const built = buildDefaultCall(opts.config);
    if ("reason" in built) {
      return { polished: [], skipped: [...opts.files], reason: built.reason };
    }
    call = built.call;
  }

  const files = opts.files;
  const total = files.length;
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const polished: string[] = [];

  // Worker-pool pattern: shared cursor + N workers pulling sequential indices.
  // Order of `polished[]` is non-deterministic (workers race), but file
  // identity is preserved; callers comparing sets don't care about order.
  let cursor = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= total) return;
      const f = files[i]!;
      try {
        const before = await readFile(f, "utf8");
        const after = await call!(before);
        const changed = !!after && after !== before;
        if (changed) {
          await writeFile(f, after);
          polished.push(f);
        }
        completed += 1;
        opts.onProgress?.({ file: f, index: completed, total, changed });
      } catch (err) {
        completed += 1;
        opts.onProgress?.({
          file: f,
          index: completed,
          total,
          changed: false,
          error: err as Error,
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => worker()),
  );

  return { polished, skipped: [] };
}
