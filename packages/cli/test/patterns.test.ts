import { describe, test, expect } from "bun:test";
import { shouldFollow } from "../src/crawler/patterns.ts";

describe("shouldFollow", () => {
  const follow = [
    "https://linear.app/docs/**",
    "https://linear.app/changelog",
    "https://linear.app/pricing",
    "https://linear.app/",
  ];
  const ignore = ["**/blog/**", "**/careers/**", "**/legal/**"];

  test("matches exact follow URL", () => {
    expect(shouldFollow("https://linear.app/", follow, ignore)).toBe(true);
    expect(shouldFollow("https://linear.app/changelog", follow, ignore)).toBe(true);
  });

  test("matches glob follow URL", () => {
    expect(shouldFollow("https://linear.app/docs/getting-started", follow, ignore))
      .toBe(true);
    expect(shouldFollow("https://linear.app/docs/api/webhooks", follow, ignore))
      .toBe(true);
  });

  test("rejects URL not in follow list", () => {
    expect(shouldFollow("https://linear.app/about", follow, ignore)).toBe(false);
  });

  test("rejects URL on different domain", () => {
    expect(shouldFollow("https://other.example/docs/x", follow, ignore)).toBe(false);
  });

  test("ignore beats follow", () => {
    const followAll = ["https://linear.app/**"];
    expect(shouldFollow("https://linear.app/blog/post-1", followAll, ignore))
      .toBe(false);
    expect(shouldFollow("https://linear.app/careers/engineer", followAll, ignore))
      .toBe(false);
  });

  test("empty follow array means no-match", () => {
    expect(shouldFollow("https://linear.app/", [], [])).toBe(false);
  });

  test("empty ignore array is safe", () => {
    expect(shouldFollow("https://linear.app/docs/x", follow, [])).toBe(true);
  });
});
