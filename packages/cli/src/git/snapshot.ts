import { createHash } from "node:crypto";

/**
 * Map a canonical URL to a relative filepath inside the scrape repo.
 *
 * Host is the top-level namespace so multi-host crawls (e.g. marketing site +
 * docs subdomain) don't collide on shared paths like `/`.
 *
 * Examples:
 *   https://linear.app/                       → linear.app/index.md
 *   https://linear.app/docs/api/webhooks      → linear.app/docs/api/webhooks.md
 *   https://help.standards.site/              → help.standards.site/index.md
 *   https://standards.site/                   → standards.site/index.md
 *
 * Path components are kept verbatim (including case, `-`, `_`) so the on-disk
 * tree mirrors URL space and is greppable.
 */
export function urlToFilepath(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`urlToFilepath: invalid URL: ${url}`);
  }
  const host = u.host.toLowerCase();
  let path = u.pathname.replace(/^\/+/, "");
  if (path === "") path = "index";
  else if (path.endsWith("/")) path = `${path}index`;
  // Disallow path traversal segments. Canonical URL paths shouldn't contain
  // `..` but defense in depth: replace with `__`.
  path = path
    .split("/")
    .map((seg) => (seg === ".." || seg === "." ? `__${seg.replace(/\./g, "_")}` : seg))
    .join("/");
  return `${host}/${path}.md`;
}

/** Stable sha256 hex of the body. Used for change detection in `_meta.json`. */
export function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Build the YAML frontmatter block prepended to each scraped page.
 *
 * Hash is over the body only (not the frontmatter), so timestamp/url changes
 * don't trigger spurious diffs.
 */
export function buildFrontmatter(opts: {
  url: string;
  title: string;
  fetched: string;
  hash: string;
}): string {
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return (
    [
      "---",
      `url: "${escape(opts.url)}"`,
      `title: "${escape(opts.title)}"`,
      `fetched: "${opts.fetched}"`,
      `hash: "${opts.hash}"`,
      "---",
    ].join("\n") + "\n\n"
  );
}
