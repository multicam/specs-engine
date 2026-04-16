import { canonicalize } from "./canonical.ts";

/**
 * BFS frontier with visited-set dedup, depth cap, and max-pages cap.
 *
 * Visited dedup uses canonical URL form, so `/docs/`, `/docs`, `/docs?ref=x`,
 * and `/docs#frag` all collapse to one entry.
 *
 * `take()` returns null once the frontier is exhausted OR the take-count has
 * reached `maxPages`. Note: the cap is on items *taken* (i.e. dispatched for
 * fetching), not items enqueued — so we can enqueue freely and let the loop
 * terminate naturally.
 */
export interface FrontierItem {
  url: string;
  depth: number;
}

export interface Frontier {
  enqueue(url: string, depth: number): boolean;
  take(): FrontierItem | null;
  visitedCount(): number;
  takenCount(): number;
}

export interface FrontierOptions {
  maxDepth: number;
  maxPages: number;
}

export function createFrontier(opts: FrontierOptions): Frontier {
  const queue: FrontierItem[] = [];
  const visited = new Set<string>();
  let taken = 0;

  return {
    enqueue(url, depth) {
      if (depth > opts.maxDepth) return false;
      const canon = canonicalize(url);
      if (canon === null) return false;
      if (visited.has(canon)) return false;
      visited.add(canon);
      queue.push({ url: canon, depth });
      return true;
    },
    take() {
      if (taken >= opts.maxPages) return null;
      const next = queue.shift();
      if (!next) return null;
      taken++;
      return next;
    },
    visitedCount: () => visited.size,
    takenCount: () => taken,
  };
}
