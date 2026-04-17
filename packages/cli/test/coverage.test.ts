import { describe, test, expect } from "bun:test";
import { computeCoverage } from "../src/agent/coverage.ts";

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

const specs = [
  "workspace/workspaces.md",
  "editor/button.md",
  "editor/color.md",
];

describe("computeCoverage", () => {
  test("filters out noise areas (news, case-studies, updates)", () => {
    const r = computeCoverage(scraped, specs);
    // news (2) + case-studies (1) = 3 filtered from 10 → 7 relevant
    expect(r.totalPages).toBe(7);
  });

  test("matches specs to scrape pages by basename", () => {
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
    const manySpecs = [
      ...Array(10).fill(null).map((_, i) => `editor/e${i}.md`),
      "api/one.md",
      "workspace/one.md",
    ];
    const r = computeCoverage(scraped, manySpecs);
    expect(r.underrepresentedAreas).toContain("api");
    expect(r.underrepresentedAreas).toContain("workspace");
    expect(r.underrepresentedAreas).not.toContain("editor");
  });
});
