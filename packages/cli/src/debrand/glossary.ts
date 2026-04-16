/**
 * Glossary loader. The config carries a `Record<string, string>` map
 * (source term → replacement). For substitution we want longest-match-first
 * ordering so `"Linear's"` rewrites before `"Linear"` and we don't end up
 * with `"Projectify's"` morphing into `"Projectifys"` mid-pass.
 */
export interface GlossaryEntry {
  source: string;
  replacement: string;
}

export function sortGlossary(map: Readonly<Record<string, string>>): GlossaryEntry[] {
  return Object.entries(map)
    .map(([source, replacement]) => ({ source, replacement }))
    .sort((a, b) => b.source.length - a.source.length);
}
