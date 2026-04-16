import { describe, test, expect } from "bun:test";
import { urlToFilepath, hashBody, buildFrontmatter } from "../src/git/snapshot.ts";

describe("urlToFilepath", () => {
  test("origin root → <host>/index.md", () => {
    expect(urlToFilepath("https://linear.app/")).toBe("linear.app/index.md");
  });

  test("single segment → <host>/segment.md", () => {
    expect(urlToFilepath("https://linear.app/docs")).toBe("linear.app/docs.md");
  });

  test("nested segments → mirrored tree under host", () => {
    expect(urlToFilepath("https://linear.app/docs/api/webhooks"))
      .toBe("linear.app/docs/api/webhooks.md");
  });

  test("trailing slash → index.md inside dir", () => {
    expect(urlToFilepath("https://linear.app/docs/"))
      .toBe("linear.app/docs/index.md");
  });

  test("preserves case and dashes in path; lowercases host", () => {
    expect(urlToFilepath("https://Linear.App/Docs/Getting-Started"))
      .toBe("linear.app/Docs/Getting-Started.md");
  });

  test("different hosts with same path do not collide", () => {
    const a = urlToFilepath("https://standards.site/");
    const b = urlToFilepath("https://help.standards.site/");
    expect(a).toBe("standards.site/index.md");
    expect(b).toBe("help.standards.site/index.md");
    expect(a).not.toBe(b);
  });

  test("rejects invalid URL", () => {
    expect(() => urlToFilepath("not a url")).toThrow();
  });

  test("neutralizes path-traversal segments", () => {
    const out = urlToFilepath("https://x.example/a/../b");
    expect(out.startsWith("/")).toBe(false);
    expect(out.includes("../")).toBe(false);
  });
});

describe("hashBody", () => {
  test("is deterministic", () => {
    const h1 = hashBody("# Hello\nworld\n");
    const h2 = hashBody("# Hello\nworld\n");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  test("changes when content changes", () => {
    expect(hashBody("a")).not.toBe(hashBody("b"));
  });
});

describe("buildFrontmatter", () => {
  test("emits standard YAML keys", () => {
    const fm = buildFrontmatter({
      url: "https://linear.app/docs",
      title: "Linear Docs",
      fetched: "2026-04-16T12:00:00Z",
      hash: "abc123",
    });
    expect(fm.startsWith("---\n")).toBe(true);
    expect(fm.includes(`url: "https://linear.app/docs"`)).toBe(true);
    expect(fm.includes(`title: "Linear Docs"`)).toBe(true);
    expect(fm.includes(`fetched: "2026-04-16T12:00:00Z"`)).toBe(true);
    expect(fm.includes(`hash: "abc123"`)).toBe(true);
    expect(fm.endsWith("---\n\n")).toBe(true);
  });

  test("escapes embedded quotes in title", () => {
    const fm = buildFrontmatter({
      url: "https://x/",
      title: 'A "quoted" title',
      fetched: "2026-04-16T00:00:00Z",
      hash: "h",
    });
    expect(fm.includes(`title: "A \\"quoted\\" title"`)).toBe(true);
  });
});
