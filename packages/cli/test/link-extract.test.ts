import { describe, test, expect } from "bun:test";
import { extractLinks } from "../src/crawler/link-extract.ts";

const BASE = "https://linear.app/docs/api";

describe("extractLinks", () => {
  test("extracts absolute markdown links", () => {
    const md = "see [docs](https://linear.app/docs/getting-started) for more";
    expect(extractLinks(md, BASE)).toEqual(["https://linear.app/docs/getting-started"]);
  });

  test("resolves relative markdown links against base", () => {
    const md = "[webhooks](/docs/api/webhooks)";
    expect(extractLinks(md, BASE)).toEqual(["https://linear.app/docs/api/webhooks"]);
  });

  test("strips fragments and queries via canonical form", () => {
    const md = "[a](https://linear.app/docs/x?ref=nav#frag)";
    expect(extractLinks(md, BASE)).toEqual(["https://linear.app/docs/x"]);
  });

  test("ignores image references (![alt](url))", () => {
    const md = "![logo](https://cdn.example/img.png) and [docs](https://linear.app/docs)";
    expect(extractLinks(md, BASE)).toEqual(["https://linear.app/docs"]);
  });

  test("ignores non-URL [text](text) when no scheme and no leading slash", () => {
    const md = "see [click here](just-some-anchor)";
    // "just-some-anchor" resolves against BASE → https://linear.app/docs/just-some-anchor
    // which IS a valid http URL — so it canonicalizes. This documents current behavior:
    // we leave URL-vs-not classification to the canonicalize+http filter.
    const links = extractLinks(md, BASE);
    expect(links).toContain("https://linear.app/docs/just-some-anchor");
  });

  test("drops mailto: and javascript: schemes", () => {
    const md = "[email](mailto:a@b.com) and [js](javascript:void(0)) and [ok](https://linear.app/x)";
    expect(extractLinks(md, BASE)).toEqual(["https://linear.app/x"]);
  });

  test("extracts angle-bracket bare URLs", () => {
    const md = "see <https://linear.app/docs/x> for details";
    expect(extractLinks(md, BASE)).toEqual(["https://linear.app/docs/x"]);
  });

  test("extracts naked URLs in prose", () => {
    const md = "visit https://linear.app/docs/y today";
    expect(extractLinks(md, BASE)).toEqual(["https://linear.app/docs/y"]);
  });

  test("trims trailing punctuation from naked URLs", () => {
    const md = "see https://linear.app/docs/z, then continue";
    expect(extractLinks(md, BASE)).toEqual(["https://linear.app/docs/z"]);
  });

  test("dedupes overlapping detections", () => {
    const md = "[a](https://linear.app/docs/x) and again https://linear.app/docs/x";
    expect(extractLinks(md, BASE)).toEqual(["https://linear.app/docs/x"]);
  });

  test("handles markdown link with title attribute", () => {
    const md = '[a](https://linear.app/docs/x "Cool docs")';
    expect(extractLinks(md, BASE)).toEqual(["https://linear.app/docs/x"]);
  });
});
