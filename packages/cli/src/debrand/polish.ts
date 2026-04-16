import { readFile, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Optional LLM polish pass. Runs each markdown file through Claude Sonnet
 * with a paraphrase prompt that:
 *   - preserves frontmatter verbatim
 *   - removes brand voice
 *   - keeps factual claims intact
 *   - returns markdown only (no commentary)
 *
 * Skipped automatically if `ANTHROPIC_API_KEY` is unset; the caller will
 * see a friendly note rather than an exception.
 *
 * Trade-off: this is N HTTP round-trips for N files and is slow. Hence
 * `polish` is a separate config flag (default false), so the deterministic
 * substitution pass remains the fast path.
 */
export interface PolishOptions {
  files: readonly string[];
  /** Test seam: inject a stub completion. */
  call?: (prompt: string) => Promise<string>;
}

export interface PolishResult {
  polished: string[];
  skipped: string[];
  reason?: string;
}

const SYSTEM = `You are a brand-voice editor. Given a markdown document, rewrite it to remove brand-specific phrasing while preserving all factual claims, structure, and frontmatter. Return ONLY the rewritten markdown — no commentary, no code fences around the whole thing.`;

function defaultCall(): (prompt: string) => Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return async () => {
      throw new Error("ANTHROPIC_API_KEY not set");
    };
  }
  const client = new Anthropic();
  return async (prompt: string): Promise<string> => {
    const r = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    const part = r.content.find((p) => p.type === "text");
    if (!part || part.type !== "text") return "";
    return part.text;
  };
}

export async function polishFiles(opts: PolishOptions): Promise<PolishResult> {
  if (!process.env.ANTHROPIC_API_KEY && !opts.call) {
    return {
      polished: [],
      skipped: [...opts.files],
      reason: "ANTHROPIC_API_KEY not set",
    };
  }
  const call = opts.call ?? defaultCall();
  const polished: string[] = [];
  for (const f of opts.files) {
    const before = await readFile(f, "utf8");
    const after = await call(before);
    if (after && after !== before) {
      await writeFile(f, after);
      polished.push(f);
    }
  }
  return { polished, skipped: [] };
}
