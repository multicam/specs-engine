import { describe, test, expect } from "bun:test";
import {
  computeCoverage,
  extractCitedSources,
  type SpecRef,
} from "../src/agent/coverage.ts";

const scraped = [
  "standards.site/index.md",
  "standards.site/pricing.md",
  "standards.site/news/a.md",              // news is filtered out
  "standards.site/news/b.md",
  "standards.site/case-studies/big-co.md", // case-studies filtered out
  "help.standards.site/workspaces.md",
  "help.standards.site/workspace-members.md",
  "help.standards.site/button.md",
  "help.standards.site/color.md",
  "help.standards.site/sequence.md",
];

const specs: SpecRef[] = [
  { path: "workspace/workspaces.md" },
  { path: "editor/button.md" },
  { path: "editor/color.md" },
];

describe("computeCoverage", () => {
  test("filters out noise areas (news, case-studies, updates)", () => {
    const r = computeCoverage(scraped, specs);
    // news (2) + case-studies (1) = 3 filtered from 10 → 7 relevant
    expect(r.totalPages).toBe(7);
  });

  test("matches specs to scrape pages by basename (no citations)", () => {
    const r = computeCoverage(scraped, specs);
    expect(r.coveredPages.sort()).toEqual([
      "help.standards.site/button.md",
      "help.standards.site/color.md",
      "help.standards.site/workspaces.md",
    ]);
  });

  test("lists uncovered pages", () => {
    const r = computeCoverage(scraped, specs);
    expect(r.uncoveredPages).toContain("help.standards.site/workspace-members.md");
    expect(r.uncoveredPages).toContain("help.standards.site/sequence.md");
    expect(r.uncoveredPages).toContain("standards.site/pricing.md");
  });

  test("area stats counted from spec paths", () => {
    const r = computeCoverage(scraped, specs);
    const editor = r.areaStats.find((a) => a.area === "editor");
    const workspace = r.areaStats.find((a) => a.area === "workspace");
    expect(editor?.specCount).toBe(2);
    expect(workspace?.specCount).toBe(1);
  });

  test("area stats sorted by count descending", () => {
    const r = computeCoverage(scraped, specs);
    for (let i = 1; i < r.areaStats.length; i++) {
      expect(r.areaStats[i - 1]!.specCount).toBeGreaterThanOrEqual(r.areaStats[i]!.specCount);
    }
  });

  test("suggestComplete=false when uncovered > threshold", () => {
    const r = computeCoverage(scraped, specs, { completeThreshold: 2 });
    expect(r.suggestComplete).toBe(false);
  });

  test("suggestComplete=true when uncovered ≤ threshold", () => {
    const r = computeCoverage(scraped, specs, { completeThreshold: 10 });
    expect(r.suggestComplete).toBe(true);
  });

  test("custom ignoreAreas filter", () => {
    const r = computeCoverage(scraped, specs, { ignoreAreas: ["index"] });
    // No filtering of news/case-studies now, but we pass a different filter
    expect(r.totalPages).toBe(10); // "index" never appears as top-level area
  });

  test("empty specs yields everything uncovered", () => {
    const r = computeCoverage(scraped, []);
    expect(r.coveredPages).toEqual([]);
    expect(r.uncoveredPages.length).toBe(7); // after noise filter
  });

  test("empty scraped list is safe", () => {
    const r = computeCoverage([], specs);
    expect(r.totalPages).toBe(0);
    expect(r.coveredPages).toEqual([]);
    expect(r.uncoveredPages).toEqual([]);
  });

  test("underrepresented areas identifies areas below median", () => {
    const manySpecs: SpecRef[] = [
      ...Array(10).fill(null).map((_, i) => ({ path: `editor/e${i}.md` })),
      { path: "api/one.md" },
      { path: "workspace/one.md" },
    ];
    const r = computeCoverage(scraped, manySpecs);
    expect(r.underrepresentedAreas).toContain("api");
    expect(r.underrepresentedAreas).toContain("workspace");
    expect(r.underrepresentedAreas).not.toContain("editor");
  });
});

describe("computeCoverage with citedSources", () => {
  test("page cited by a spec is covered even when basename doesn't match", () => {
    const scrapedPages = ["dub.co/docs/api-reference/links/create.md"];
    const specsWithCites: SpecRef[] = [
      {
        // Agent picked a clever filename that doesn't match `create`.
        path: "links/links-crud-api-complete-reference.md",
        citedSources: ["dub.co/docs/api-reference/links/create.md"],
      },
    ];
    const r = computeCoverage(scrapedPages, specsWithCites);
    expect(r.coveredPages).toEqual(["dub.co/docs/api-reference/links/create.md"]);
    expect(r.uncoveredPages).toEqual([]);
  });

  test("two variant-named specs citing the same source mark it covered once", () => {
    const scrapedPages = ["dub.co/docs/api-reference/links/create.md"];
    const variantSpecs: SpecRef[] = [
      {
        path: "links/links-crud-api-reference.md",
        citedSources: ["dub.co/docs/api-reference/links/create.md"],
      },
      {
        path: "links/links-crud-api-complete-reference.md",
        citedSources: ["dub.co/docs/api-reference/links/create.md"],
      },
    ];
    const r = computeCoverage(scrapedPages, variantSpecs);
    expect(r.coveredPages).toHaveLength(1);
    expect(r.uncoveredPages).toEqual([]);
  });

  test("cited and basename signals union (either marks covered)", () => {
    const scrapedPages = [
      "host.com/docs/a.md",
      "host.com/docs/b.md",
    ];
    const mixed: SpecRef[] = [
      { path: "x/a.md" },                                       // basename hit for a
      { path: "x/zzz.md", citedSources: ["host.com/docs/b.md"] }, // citation hit for b
    ];
    const r = computeCoverage(scrapedPages, mixed);
    expect(r.coveredPages.sort()).toEqual([
      "host.com/docs/a.md",
      "host.com/docs/b.md",
    ]);
  });
});

describe("extractCitedSources", () => {
  test("parses Source pages block with citation-key suffixes", () => {
    const body = [
      "# Title",
      "",
      "## Source pages",
      "- https://dub.co/docs/concepts/links/introduction (citation key: links-intro)",
      "- https://dub.co/docs/api-reference/links/create (citation key: links-create)",
      "",
      "## Claims",
      "- something",
    ].join("\n");
    expect(extractCitedSources(body)).toEqual([
      "dub.co/docs/concepts/links/introduction.md",
      "dub.co/docs/api-reference/links/create.md",
    ]);
  });

  test("trailing slash maps to /index.md", () => {
    const body = "## Source pages\n- https://dub.co/docs/api-reference/links/\n\n## Other";
    expect(extractCitedSources(body)).toEqual([
      "dub.co/docs/api-reference/links/index.md",
    ]);
  });

  test("bare host maps to host/index.md", () => {
    const body = "## Source pages\n- https://dub.co/\n\n## Other";
    expect(extractCitedSources(body)).toEqual(["dub.co/index.md"]);
  });

  test("returns [] when Source pages section is missing", () => {
    expect(extractCitedSources("# Title\n\n## Claims\n- foo")).toEqual([]);
  });

  test("returns [] when Source pages section is empty", () => {
    expect(extractCitedSources("## Source pages\n\n## Claims")).toEqual([]);
  });

  test("dedupes repeated URLs within one spec", () => {
    const body = [
      "## Source pages",
      "- https://dub.co/docs/x",
      "- https://dub.co/docs/x (alt)",
      "",
      "## Claims",
    ].join("\n");
    expect(extractCitedSources(body)).toEqual(["dub.co/docs/x.md"]);
  });

  test("skips malformed URL tokens, keeps valid ones", () => {
    const body = [
      "## Source pages",
      "- not-a-url",
      "- https://dub.co/docs/y",
      "- htp://broken",
      "",
      "## Claims",
    ].join("\n");
    expect(extractCitedSources(body)).toEqual(["dub.co/docs/y.md"]);
  });

  test("stops at next heading (## or #), not in mid-paragraph 'http'", () => {
    const body = [
      "## Source pages",
      "- https://dub.co/docs/inside",
      "",
      "## Claims",
      "- See https://example.com/should-not-be-cited",
    ].join("\n");
    expect(extractCitedSources(body)).toEqual(["dub.co/docs/inside.md"]);
  });
});
