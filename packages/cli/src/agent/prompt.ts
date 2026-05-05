/**
 * Prompt discovery for the agent runner.
 *
 * Walks `<ralphPack>/.ralph/prompts/<dir>/<mode>.md` for each `dir` in the
 * provider's `promptDirs` (router-supplied), with `anthropic/` as the final
 * defensive fallback. Strips YAML frontmatter before returning the body as the
 * system prompt.
 */
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";

/**
 * Extract the first slash-delimited segment from a model ID. Used by callers
 * who want the bare-prefix form (e.g. `deepseek/r1-0528` → `deepseek`); the
 * provider prefix from the router is preferred for prompt resolution.
 *
 *   "deepseek/deepseek-chat"     → "deepseek"
 *   "google/gemini-2.5-flash"    → "google"
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
  /** Full model ID (used in error messages only). */
  modelId: string;
  /**
   * Ordered list of prompt directory names to try under `<ralphPack>/.ralph/prompts/`.
   * `anthropic/` is always tried last as a defensive fallback even if not listed.
   */
  promptDirs: readonly string[];
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
 *   2. each `<promptDirs[i]>/<mode>.md` in order
 *   3. `anthropic/<mode>.md` (defensive fallback if not already in promptDirs)
 */
export async function resolvePrompt(
  opts: PromptResolutionOptions,
): Promise<ResolvedPrompt> {
  if (opts.promptOverride) {
    const text = await readFile(opts.promptOverride, "utf8");
    return { path: opts.promptOverride, body: stripFrontmatter(text) };
  }

  const promptsDir = join(opts.ralphPackPath, ".ralph", "prompts");

  const dirsToTry: string[] = [...opts.promptDirs];
  if (!dirsToTry.includes("anthropic")) dirsToTry.push("anthropic");

  for (const dir of dirsToTry) {
    const candidate = join(promptsDir, dir, `${opts.mode}.md`);
    if (await fileExists(candidate)) {
      const text = await readFile(candidate, "utf8");
      return { path: candidate, body: stripFrontmatter(text) };
    }
  }

  throw new Error(
    `agent: prompt not found for mode '${opts.mode}' (model: ${opts.modelId}). ` +
      `Searched dirs: ${dirsToTry.join(", ")} under ${promptsDir}`,
  );
}
