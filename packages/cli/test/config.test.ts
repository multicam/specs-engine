import { describe, test, expect } from "bun:test";
import { parseConfig, ConfigError } from "../src/config.ts";

const VALID = `
target: linear
scrape_repo: ../linear-scrape
crawl:
  start:
    - https://linear.app/
  follow:
    - "https://linear.app/**"
  ignore:
    - "**/blog/**"
  max_depth: 3
  max_pages: 100
  rate_limit_ms: 250
debrand:
  glossary:
    Linear: Projectify
`;

describe("parseConfig", () => {
  test("accepts a valid yaml and applies defaults to optional sections", () => {
    const cfg = parseConfig(VALID);
    expect(cfg.target).toBe("linear");
    expect(cfg.scrape_repo).toBe("../linear-scrape");
    expect(cfg.crawl.start).toEqual(["https://linear.app/"]);
    expect(cfg.crawl.max_depth).toBe(3);
    // jina section omitted -> defaults present
    expect(cfg.jina.base_url).toBe("https://r.jina.ai");
    expect(cfg.jina.api_key_env).toBe("JINA_API_KEY");
    expect(cfg.jina.timeout_ms).toBe(30_000);
    // debrand polish defaults to false when omitted
    expect(cfg.debrand.polish).toBe(false);
    expect(cfg.debrand.glossary).toEqual({ Linear: "Projectify" });
  });

  test("rejects missing target", () => {
    const yaml = VALID.replace("target: linear\n", "");
    expect(() => parseConfig(yaml)).toThrow(ConfigError);
    expect(() => parseConfig(yaml)).toThrow(/target/);
  });

  test("rejects missing scrape_repo", () => {
    const yaml = VALID.replace("scrape_repo: ../linear-scrape\n", "");
    expect(() => parseConfig(yaml)).toThrow(/scrape_repo/);
  });

  test("rejects missing crawl.start", () => {
    const yaml = `
target: linear
scrape_repo: ../linear-scrape
crawl:
  follow: []
`;
    expect(() => parseConfig(yaml)).toThrow(/start/);
  });

  test("rejects empty crawl.start array", () => {
    const yaml = `
target: linear
scrape_repo: ../linear-scrape
crawl:
  start: []
`;
    expect(() => parseConfig(yaml)).toThrow(/at least one URL/);
  });

  test("rejects non-URL entry in crawl.start", () => {
    const yaml = `
target: linear
scrape_repo: ../linear-scrape
crawl:
  start:
    - "not a url"
`;
    expect(() => parseConfig(yaml)).toThrow(/valid URL/);
  });

  test("rejects negative max_depth", () => {
    const yaml = VALID.replace("max_depth: 3", "max_depth: -1");
    expect(() => parseConfig(yaml)).toThrow(/max_depth/);
  });

  test("rejects malformed YAML", () => {
    expect(() => parseConfig("target: : :\n  bad")).toThrow(ConfigError);
  });
});
