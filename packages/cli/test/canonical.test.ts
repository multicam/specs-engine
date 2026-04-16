import { describe, test, expect } from "bun:test";
import { canonicalize } from "../src/crawler/canonical.ts";

describe("canonicalize", () => {
  test("strips trailing slash on non-root path", () => {
    expect(canonicalize("https://linear.app/docs/")).toBe("https://linear.app/docs");
  });

  test("keeps trailing slash on root path", () => {
    expect(canonicalize("https://linear.app/")).toBe("https://linear.app/");
  });

  test("lowercases host", () => {
    expect(canonicalize("https://LINEAR.APP/Docs")).toBe("https://linear.app/Docs");
  });

  test("preserves case of path", () => {
    expect(canonicalize("https://linear.app/Docs/Webhooks"))
      .toBe("https://linear.app/Docs/Webhooks");
  });

  test("drops query string", () => {
    expect(canonicalize("https://linear.app/docs?ref=nav&utm=x"))
      .toBe("https://linear.app/docs");
  });

  test("drops fragment", () => {
    expect(canonicalize("https://linear.app/docs#section"))
      .toBe("https://linear.app/docs");
  });

  test("collapses query+fragment+trailing-slash together", () => {
    expect(canonicalize("https://linear.app/docs/?x=1#frag"))
      .toBe("https://linear.app/docs");
  });

  test("rejects non-http(s) protocols", () => {
    expect(canonicalize("mailto:a@b.com")).toBeNull();
    expect(canonicalize("javascript:void(0)")).toBeNull();
    expect(canonicalize("ftp://x.example/y")).toBeNull();
  });

  test("rejects malformed URLs", () => {
    expect(canonicalize("not a url")).toBeNull();
    expect(canonicalize("")).toBeNull();
  });

  test("resolves relative URLs against base", () => {
    expect(canonicalize("/docs/api", "https://linear.app/foo"))
      .toBe("https://linear.app/docs/api");
  });

  test("collapses repeated trailing slashes", () => {
    expect(canonicalize("https://linear.app/docs///")).toBe("https://linear.app/docs");
  });
});
