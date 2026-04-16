import { describe, test, expect } from "bun:test";
import { sortGlossary } from "../src/debrand/glossary.ts";
import { substitute } from "../src/debrand/substitute.ts";

describe("sortGlossary", () => {
  test("longest source first", () => {
    const sorted = sortGlossary({ Linear: "Projectify", "Linear's": "Projectify's" });
    expect(sorted.map((e) => e.source)).toEqual(["Linear's", "Linear"]);
  });

  test("preserves entries with equal length in original-ish order", () => {
    const sorted = sortGlossary({ a: "x", b: "y" });
    expect(sorted).toHaveLength(2);
  });
});

describe("substitute", () => {
  const entries = sortGlossary({
    Linear: "Projectify",
    "Linear's": "Projectify's",
    issue: "item",
    issues: "items",
  });

  test("basic word-boundary replacement", () => {
    expect(substitute("I use Linear daily", entries)).toBe("I use Projectify daily");
  });

  test("does NOT rewrite suffix matches like 'linearly'", () => {
    expect(substitute("She moves linearly", entries)).toBe("She moves linearly");
  });

  test("longest-match-first prevents 'Projectify's' becoming 'Projectifys'", () => {
    // If 'Linear' fired before 'Linear's', we'd get "Projectify's" with broken anchoring.
    expect(substitute("This is Linear's approach", entries))
      .toBe("This is Projectify's approach");
  });

  test("plural variants are independent entries", () => {
    expect(substitute("one issue, many issues", entries))
      .toBe("one item, many items");
  });

  test("preserves leading/trailing whitespace", () => {
    expect(substitute("  Linear  ", entries)).toBe("  Projectify  ");
  });

  test("multiple occurrences in one string", () => {
    expect(substitute("Linear and Linear and Linear", entries))
      .toBe("Projectify and Projectify and Projectify");
  });

  test("no glossary entries → identity", () => {
    expect(substitute("untouched text", [])).toBe("untouched text");
  });

  test("respects start-of-string boundary", () => {
    expect(substitute("Linear at start", entries)).toBe("Projectify at start");
  });

  test("respects end-of-string boundary", () => {
    expect(substitute("ends with Linear", entries)).toBe("ends with Projectify");
  });
});
