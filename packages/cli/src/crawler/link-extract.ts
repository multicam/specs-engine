import { canonicalize } from "./canonical.ts";

/**
 * Extract outbound links from a Jina-returned markdown body.
 *
 * Two flavors are recognized:
 *   1. Inline links:    `[text](https://...)` and `[text](/relative)`
 *   2. Bare URLs:       `<https://...>` and naked `https://...` outside markup
 *
 * Image refs `![alt](url)` are intentionally excluded (handled by Phase 6
 * archival; not crawled).
 *
 * The `base` URL is used to resolve relative paths into absolute URLs before
 * canonicalization. URLs that fail to canonicalize (mailto:, javascript:,
 * malformed) are dropped.
 *
 * Output is deduplicated and order-stable (insertion order).
 */
export function extractLinks(markdown: string, base: string): string[] {
  const out = new Set<string>();

  // Pre-strip image references so the naked-URL pass below doesn't pick up
  // CDN URLs sitting inside `![alt](url)`. We don't crawl image hosts.
  const stripped = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

  // 1. Inline `[text](url)` — non-image only, since we already stripped images.
  const inline = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const m of stripped.matchAll(inline)) {
    const url = m[1];
    if (url) addCandidate(out, url, base);
  }

  // 2. Angle-bracket bare URLs: <https://...>
  const angle = /<((?:https?:\/\/)[^>\s]+)>/gi;
  for (const m of stripped.matchAll(angle)) {
    const url = m[1];
    if (url) addCandidate(out, url, base);
  }

  // 3. Naked URLs in plain text. Conservative: must be preceded by start,
  // whitespace, newline, or simple punctuation. Markdown link targets that
  // already matched in step 1 will dedupe via the Set.
  const naked = /(?:^|[\s(<])(https?:\/\/[^\s)<>\]]+)/gi;
  for (const m of stripped.matchAll(naked)) {
    const url = m[1];
    if (url) addCandidate(out, url, base);
  }

  return [...out];
}

function addCandidate(out: Set<string>, raw: string, base: string): void {
  // Trim trailing punctuation that often follows bare URLs in prose.
  const cleaned = raw.replace(/[.,;:!?'"]+$/, "");
  const canon = canonicalize(cleaned, base);
  if (canon !== null) out.add(canon);
}
