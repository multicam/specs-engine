/**
 * Coverage analysis for the docs-reverse agent.
 *
 * Compares scraped pages to existing specs to identify:
 * - which scraped pages are already specced (by basename match)
 * - which areas are over-represented in specs (topic bias)
 * - whether we're close to full coverage (auto-stop signal)
 *
 * Purpose: inject actionable pointers into the agent's initial message
 * so it can focus on gaps rather than re-discover the scrape tree.
 */

export interface AreaStats {
  /** Top-level area (first path segment of the spec path). */
  area: string;
  /** Number of specs written under that area. */
  specCount: number;
}

export interface CoverageReport {
  /** Total scraped pages considered (after noise filter). */
  totalPages: number;
  /** Scraped pages whose basename matches any existing spec basename. */
  coveredPages: string[];
  /** Scraped pages with no matching spec. */
  uncoveredPages: string[];
  /** Specs grouped by top-level area, sorted most → least. */
  areaStats: AreaStats[];
  /** Areas with spec counts below the median (candidates for priority). */
  underrepresentedAreas: string[];
  /** True when uncoveredPages.length ≤ completeThreshold (suggests ALL_TOPICS_COVERED). */
  suggestComplete: boolean;
}

export interface CoverageOptions {
  /** Areas to exclude from coverage accounting (marketing/news noise). */
  ignoreAreas?: string[];
  /** Max uncovered pages that still counts as "nearly complete". */
  completeThreshold?: number;
}

const DEFAULT_IGNORE_AREAS = ["news", "case-studies", "updates"];
const DEFAULT_COMPLETE_THRESHOLD = 5;

/**
 * Strip extension and return the last path segment.
 * "help.standards.site/api/foo.md" → "foo"
 * "editor/button.md" → "button"
 */
function basename(path: string): string {
  const stripped = path.replace(/\.md$/, "");
  const segments = stripped.split("/");
  return segments[segments.length - 1] ?? "";
}

/**
 * Top-level area segment. Scraped paths start with host; specs don't.
 * Scraped: "help.standards.site/api/foo.md" → "api"  (skip host)
 * Spec:    "api/foo.md" → "api"
 */
function topArea(path: string, isScraped: boolean): string {
  const segs = path.split("/");
  if (isScraped) return segs[1] ?? "";
  return segs[0] ?? "";
}

export function computeCoverage(
  scrapedPages: string[],
  existingSpecs: string[],
  opts: CoverageOptions = {},
): CoverageReport {
  const ignoreAreas = new Set(opts.ignoreAreas ?? DEFAULT_IGNORE_AREAS);
  const completeThreshold = opts.completeThreshold ?? DEFAULT_COMPLETE_THRESHOLD;

  // Filter noise: pages whose top-level area is in ignoreAreas
  const relevantPages = scrapedPages.filter(
    (p) => !ignoreAreas.has(topArea(p, true)),
  );

  const specBasenames = new Set(existingSpecs.map(basename));

  const coveredPages: string[] = [];
  const uncoveredPages: string[] = [];
  for (const page of relevantPages) {
    if (specBasenames.has(basename(page))) coveredPages.push(page);
    else uncoveredPages.push(page);
  }

  // Area stats from specs
  const areaCounts = new Map<string, number>();
  for (const spec of existingSpecs) {
    const area = topArea(spec, false);
    if (!area) continue;
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
  }
  const areaStats: AreaStats[] = [...areaCounts.entries()]
    .map(([area, specCount]) => ({ area, specCount }))
    .sort((a, b) => b.specCount - a.specCount);

  // Underrepresented = areas below median count (bias-correcting signal)
  const underrepresentedAreas = computeUnderrepresented(areaStats);

  return {
    totalPages: relevantPages.length,
    coveredPages,
    uncoveredPages,
    areaStats,
    underrepresentedAreas,
    suggestComplete: uncoveredPages.length <= completeThreshold,
  };
}

/**
 * Areas with fewer than max/2 specs — i.e. areas heavily dominated by a
 * larger area. Used to steer the agent toward underrepresented areas when
 * one area (typically editor/ components) is eating all the coverage.
 */
function computeUnderrepresented(stats: AreaStats[]): string[] {
  if (stats.length === 0) return [];
  const max = stats[0]!.specCount; // stats is sorted desc
  const threshold = max / 2;
  return stats.filter((s) => s.specCount < threshold).map((s) => s.area);
}
