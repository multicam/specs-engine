/**
 * Canonical URL form for de-duplication and frontier comparison.
 *
 * Rules (from plan §"Canonical URL rules"):
 *   - Lowercase host
 *   - Drop query string
 *   - Drop fragment
 *   - Strip trailing `/` except for origin (so `https://x/` stays as `https://x/`,
 *     but `https://x/docs/` collapses to `https://x/docs`)
 *
 * Returns null for inputs that don't parse as absolute http(s) URLs. Callers
 * should treat null as "skip this link".
 */
export function canonicalize(url: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(url, base) : new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hostname = u.hostname.toLowerCase();
  u.search = "";
  u.hash = "";
  // URL.pathname is always at least "/". We only strip a trailing slash on
  // non-root paths so we don't collapse the origin to an unparseable form.
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  return u.toString();
}
