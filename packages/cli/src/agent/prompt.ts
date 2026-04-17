/**
 * Prompt discovery for the agent runner.
 *
 * Resolves a prompt `.md` file from ralph-loop-pack by model prefix, with
 * fallback to `anthropic/`. Strips YAML frontmatter before returning the
 * body as the system prompt.
 */
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";

/**
 * Extract the provider prefix from an OpenRouter model ID.
 *
 *   "deepseek/deepseek-chat"     → "deepseek"
 *   "google/gemini-2.5-flash"    → "google"
 *   "mistralai/mistral-large"    → "mistralai"
 *   "deepseek-chat"              → null (no prefix)
 */
export function extractModelPrefix(modelId: string): string | null {
  const idx = modelId.indexOf("/");
  return idx > 0 ? modelId.slice(0, idx) : null;
}

/**
 * Strip YAML frontmatter (leading `---\n...\n---\n`) from a markdown file,
 * returning only the body content.
 */
export function stripFrontmatter(text: string): string {
  const match = text.match(/^---\n[\s\S]*?\n---\n/);
  if (match) return text.slice(match[0].length).trimStart();
  return text.trimStart();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface PromptResolutionOptions {
  /** Path to ralph-loop-pack root. */
  ralphPackPath: string;
  /** Mode name, e.g. "docs-reverse". */
  mode: string;
  /** Full model ID, e.g. "deepseek/deepseek-chat". */
  modelId: string;
  /** Optional explicit prompt file override. */
  promptOverride?: string;
}

export interface ResolvedPrompt {
  /** Absolute path to the prompt file that was used. */
  path: string;
  /** The system prompt body (frontmatter stripped). */
  body: string;
}

/**
 * Resolve and load a prompt file.
 *
 * Resolution order:
 *   1. `promptOverride` (explicit path) if provided
 *   2. `<ralphPack>/.ralph/prompts/<modelPrefix>/<mode>.md`
 *   3. `<ralphPack>/.ralph/prompts/anthropic/<mode>.md` (fallback)
 */
export async function resolvePrompt(
  opts: PromptResolutionOptions,
): Promise<ResolvedPrompt> {
  if (opts.promptOverride) {
    const text = await readFile(opts.promptOverride, "utf8");
    return { path: opts.promptOverride, body: stripFrontmatter(text) };
  }

  const prefix = extractModelPrefix(opts.modelId);
  const promptsDir = join(opts.ralphPackPath, ".ralph", "prompts");

  // Try model-specific prompt dir first
  if (prefix) {
    const specific = join(promptsDir, prefix, `${opts.mode}.md`);
    if (await fileExists(specific)) {
      const text = await readFile(specific, "utf8");
      return { path: specific, body: stripFrontmatter(text) };
    }
  }

  // Fall back to anthropic/
  const fallback = join(promptsDir, "anthropic", `${opts.mode}.md`);
  if (await fileExists(fallback)) {
    const text = await readFile(fallback, "utf8");
    return { path: fallback, body: stripFrontmatter(text) };
  }

  throw new Error(
    `agent: prompt not found for mode '${opts.mode}' (model: ${opts.modelId}). ` +
      `Searched: ${prefix ? join(promptsDir, prefix, `${opts.mode}.md`) + ", " : ""}` +
      `${fallback}`,
  );
}
