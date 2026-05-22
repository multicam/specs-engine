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

describe("parseConfig — llm section", () => {
  test("llm section defaults to safe values when omitted", () => {
    const cfg = parseConfig(VALID);
    expect(cfg.llm).toBeDefined();
    expect(cfg.llm.defaults).toEqual({});
    expect(cfg.llm.budgets).toEqual({});
    expect(cfg.llm.polish.max_tokens).toBe(8000);
    expect(cfg.llm.agent.max_iterations).toBe(5);
  });

  test("accepts llm.defaults for both tasks", () => {
    const yaml =
      VALID +
      `
llm:
  defaults:
    agent: openrouter/anthropic/claude-sonnet-4-5
    polish: anthropic/claude-sonnet-4-5
`;
    const cfg = parseConfig(yaml);
    expect(cfg.llm.defaults.agent).toBe(
      "openrouter/anthropic/claude-sonnet-4-5",
    );
    expect(cfg.llm.defaults.polish).toBe("anthropic/claude-sonnet-4-5");
  });

  test("accepts partial llm.budgets overrides per tier", () => {
    const yaml =
      VALID +
      `
llm:
  budgets:
    strong:
      readBudget: 16
    weak:
      stepsPerRound: 4
`;
    const cfg = parseConfig(yaml);
    expect(cfg.llm.budgets.strong?.readBudget).toBe(16);
    expect(cfg.llm.budgets.weak?.stepsPerRound).toBe(4);
  });

  test("overrides llm.polish.max_tokens and llm.agent.max_iterations", () => {
    const yaml =
      VALID +
      `
llm:
  polish:
    max_tokens: 4000
  agent:
    max_iterations: 12
`;
    const cfg = parseConfig(yaml);
    expect(cfg.llm.polish.max_tokens).toBe(4000);
    expect(cfg.llm.agent.max_iterations).toBe(12);
  });

  test("rejects unknown fields inside llm.budgets.<tier>", () => {
    const yaml =
      VALID +
      `
llm:
  budgets:
    strong:
      bogus: 1
`;
    expect(() => parseConfig(yaml)).toThrow(ConfigError);
  });
});
