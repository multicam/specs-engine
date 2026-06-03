import { describe, test, expect } from "bun:test";
import { parseInitArgs } from "../src/index.ts";

describe("parseInitArgs", () => {
  test("parses bare <target> <start-url> (no -C)", () => {
    // Regression: previously `indexOf('-C')` returned -1 and the filter dropped
    // index 0 (-1 + 1), silently swallowing the target and triggering usage.
    const r = parseInitArgs(["zindex", "https://zindex.ai/"]);
    expect(r.target).toBe("zindex");
    expect(r.startUrl).toBe("https://zindex.ai/");
    expect(r.parent).toBeUndefined();
  });

  test("parses -C <dir> before the positionals", () => {
    const r = parseInitArgs(["-C", "/tmp/work", "zindex", "https://zindex.ai/"]);
    expect(r.parent).toBe("/tmp/work");
    expect(r.target).toBe("zindex");
    expect(r.startUrl).toBe("https://zindex.ai/");
  });

  test("parses -C <dir> after the positionals", () => {
    const r = parseInitArgs(["zindex", "https://zindex.ai/", "-C", "/tmp/work"]);
    expect(r.parent).toBe("/tmp/work");
    expect(r.target).toBe("zindex");
    expect(r.startUrl).toBe("https://zindex.ai/");
  });

  test("missing args leave target/startUrl undefined (caller shows usage)", () => {
    expect(parseInitArgs([]).target).toBeUndefined();
    expect(parseInitArgs(["zindex"]).startUrl).toBeUndefined();
  });
});
