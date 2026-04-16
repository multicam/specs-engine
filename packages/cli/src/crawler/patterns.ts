import micromatch from "micromatch";

/**
 * Pattern matcher for crawl frontier admission.
 *
 * Decision: a URL is followed iff it matches at least one `follow` glob AND
 * matches no `ignore` glob. `ignore` always wins over `follow`.
 *
 * Empty `follow` array means "follow nothing" — explicit allow-list. This
 * is the safe default; init writes a `<origin>/**` follow pattern so a
 * fresh config can crawl out of the box.
 *
 * Globs are matched against the canonical URL string (post-canonicalize),
 * so patterns can include the scheme/host (e.g. `https://linear.app/docs/**`).
 */
export function shouldFollow(
  url: string,
  follow: readonly string[],
  ignore: readonly string[],
): boolean {
  if (ignore.length > 0 && micromatch.isMatch(url, ignore as string[])) {
    return false;
  }
  if (follow.length === 0) return false;
  return micromatch.isMatch(url, follow as string[]);
}
