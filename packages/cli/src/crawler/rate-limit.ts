/**
 * Per-domain min-delay scheduler.
 *
 * Tracks the last-fetch timestamp per host (host = canonical URL hostname).
 * `wait(url)` resolves once `minDelayMs` has elapsed since the last call for
 * the same host, then records a new "last fetch" timestamp.
 *
 * Note: the rate limit applies to the *target* domain (the site we're
 * scraping), not to Jina. Jina rate-limits separately on its end.
 */
export interface RateLimiter {
  wait(url: string): Promise<void>;
}

export interface RateLimiterDeps {
  /** Override clock for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Override sleep for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export function createRateLimiter(
  minDelayMs: number,
  deps: RateLimiterDeps = {},
): RateLimiter {
  const now = deps.now ?? (() => Date.now());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const lastFetch = new Map<string, number>();

  return {
    async wait(url: string): Promise<void> {
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        return;
      }
      if (minDelayMs <= 0) {
        lastFetch.set(host, now());
        return;
      }
      const last = lastFetch.get(host);
      if (last !== undefined) {
        const elapsed = now() - last;
        const wait = minDelayMs - elapsed;
        if (wait > 0) await sleep(wait);
      }
      lastFetch.set(host, now());
    },
  };
}
