/**
 * Coverage analysis for the docs-reverse agent.
 *
 * Compares scraped pages to existing specs to identify:
 * - which scraped pages are already specced (by cited-source URL match,
 *   falling back to basename match for hand-written specs without citations)
 * - which areas are over-represented in specs (topic bias)
 * - whether we're close to full coverage (auto-stop signal)
 *
 * Cited-source matching defeats the dedup leak where the agent invents
 * variant filenames (`links-crud-api-reference.md` vs
 * `links-crud-api-complete-reference.md`) for the same source pages.
 *
 * Purpose: inject actionable pointers into the agent's initial message
 * so it can focus on gaps rather than re-discover the scrape tree.
 */

export interface SpecRef {
  /** Spec file path (rel to specs dir). Used for basename + area extraction. */
  path: string;
  /**
   * Scrape-relative paths the spec cites (from its `## Source pages` block).
   * Undefined when the body wasn't parsed; empty when the spec has no citations.
   */
  citedSources?: string[];
}

export interface AreaStats {
  /** Top-level area (first path segment of the spec path). */
  area: string;
  /** Number of specs written under that area. */
  specCount: number;
}

export interface CoverageReport {
  /** Total scraped pages considered (after noise filter). */
  totalPages: number;
  /** Scraped pages either cited by a spec or matched by basename. */
  coveredPages: string[];
  /** Scraped pages neither cited nor basename-matched. */
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

/**
 * Parse the `## Source pages` block of a spec body and return scrape-relative
 * paths for every cited URL.
 *
 *   "https://dub.co/docs/data-model"             → "dub.co/docs/data-model.md"
 *   "https://dub.co/docs/api-reference/links/"   → "dub.co/docs/api-reference/links/index.md"
 *   "https://dub.co/"                             → "dub.co/index.md"
 *
 * Returns [] when the section is missing, empty, or contains no parseable URLs.
 * Malformed URLs are skipped (not thrown).
 */
export function extractCitedSources(specBody: string): string[] {
  // Match "## Source pages" up to the next "## " or "# " heading or EOF.
  // Note: no `m` flag so `$` means end-of-input (with `m`, `$` matches every
  // line-end and the lazy quantifier truncates the block to one line).
  const block = specBody.match(/(?:^|\n)## Source pages[^\n]*\n([\s\S]*?)(?=\n## |\n# |$)/);
  if (!block) return [];
  const urlRe = /https?:\/\/[^\s)>\]"']+/g;
  const urls = block[1]!.match(urlRe) ?? [];
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    // Strip trailing punctuation that URL regex grabs but isn't part of the URL.
    const trimmed = raw.replace(/[.,;]+$/, "");
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      continue;
    }
    let pathname = parsed.pathname;
    if (pathname === "" || pathname === "/") {
      pathname = "/index";
    } else if (pathname.endsWith("/")) {
      pathname = pathname + "index";
    }
    const stripped = pathname.replace(/^\//, "");
    const withExt = stripped.endsWith(".md") ? stripped : `${stripped}.md`;
    const fullPath = `${parsed.host}/${withExt}`;
    if (!seen.has(fullPath)) {
      seen.add(fullPath);
      paths.push(fullPath);
    }
  }
  return paths;
}

export function computeCoverage(
  scrapedPages: string[],
  existingSpecs: SpecRef[],
  opts: CoverageOptions = {},
): CoverageReport {
  const ignoreAreas = new Set(opts.ignoreAreas ?? DEFAULT_IGNORE_AREAS);
  const completeThreshold = opts.completeThreshold ?? DEFAULT_COMPLETE_THRESHOLD;

  // Filter noise: pages whose top-level area is in ignoreAreas
  const relevantPages = scrapedPages.filter(
    (p) => !ignoreAreas.has(topArea(p, true)),
  );

  // Union of all cited source paths across all specs. The principled signal:
  // a scrape page is covered if any spec quotes it.
  const citedSet = new Set<string>();
  for (const spec of existingSpecs) {
    for (const src of spec.citedSources ?? []) citedSet.add(src);
  }

  // Basename fallback for hand-written specs with no `## Source pages` block.
  const specBasenames = new Set(existingSpecs.map((s) => basename(s.path)));

  const coveredPages: string[] = [];
  const uncoveredPages: string[] = [];
  for (const page of relevantPages) {
    if (citedSet.has(page) || specBasenames.has(basename(page))) {
      coveredPages.push(page);
    } else {
      uncoveredPages.push(page);
    }
  }

  // Area stats from spec paths.
  const areaCounts = new Map<string, number>();
  for (const spec of existingSpecs) {
    const area = topArea(spec.path, false);
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
