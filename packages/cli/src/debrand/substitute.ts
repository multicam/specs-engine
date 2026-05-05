import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { GlossaryEntry } from "./glossary.ts";

/** Escape a string for use as a literal in a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply glossary substitutions to a single string with word-boundary care.
 *
 * Word-boundary rule: a substitution fires only when the source term sits at
 * a word boundary on each side. So `linearly` does NOT rewrite to
 * `projectifyly` when the glossary has `Linear -> Projectify`.
 *
 * Case sensitivity: substitutions are case-sensitive. The author writes both
 * `Linear -> Projectify` and `linear -> projectify` if both should be hit.
 *
 * Apostrophes: terms that include an apostrophe (`Linear's`) match correctly
 * because we use `\b` boundaries on the source-term-as-literal regex; the
 * apostrophe is a word character break to JS regex, so we anchor the boundary
 * only to characters outside `[A-Za-z0-9_]`. This means `Linear's` matches
 * inside `(Linear's)` or after a space, which is the desired behavior.
 */
export function substitute(text: string, entries: readonly GlossaryEntry[]): string {
  let out = text;
  for (const e of entries) {
    // Build a regex with word boundaries that respect the apostrophe-or-end
    // edge case: \b only fires at \w/\W transitions; for a source ending in
    // an apostrophe we want a non-letter follower instead.
    const lit = escapeRegex(e.source);
    const re = new RegExp(`(^|[^A-Za-z0-9_])${lit}(?=$|[^A-Za-z0-9_])`, "g");
    out = out.replace(re, (_m, prefix: string) => prefix + e.replacement);
  }
  return out;
}

/**
 * Recursively list `.md` files under `root`, skipping dot-prefixed entries.
 *
 * Dot-prefix skip matches Bun Glob's `dot:false` default used elsewhere in
 * the agent runner, so per-run output dirs (`specs/.runs/<slug>/`) are
 * automatically excluded from debrand. Curated specs live alongside in
 * `specs/`; only those get glossary substitution.
 */
async function listMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const p = join(dir, name);
      const st = await stat(p);
      if (st.isDirectory()) await walk(p);
      else if (st.isFile() && name.endsWith(".md")) out.push(p);
    }
  }
  await walk(root);
  return out;
}

/**
 * Walk every `.md` under `root`, apply glossary substitutions in place, and
 * return the list of files whose content actually changed (others are
 * untouched so the next git commit only stages real changes).
 */
export async function substituteTree(
  root: string,
  entries: readonly GlossaryEntry[],
): Promise<{ changed: string[]; scanned: number }> {
  const files = await listMarkdownFiles(root);
  const changed: string[] = [];
  for (const f of files) {
    const before = await readFile(f, "utf8");
    const after = substitute(before, entries);
    if (after !== before) {
      await writeFile(f, after);
      changed.push(f);
    }
  }
  return { changed, scanned: files.length };
}
