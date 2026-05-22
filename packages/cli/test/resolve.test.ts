/**
 * Tests the central LLM resolver. Covers:
 *   - model selection precedence (CLI > config default > error)
 *   - api-key validation per provider
 *   - legacy `agent.openrouter_api_key_env` env-var override
 *   - provider-agnostic env forwarding for downstream client construction
 */
import { describe, test, expect } from "bun:test";
import { resolveLLM } from "../src/agent/resolve.ts";
import { parseConfig } from "../src/config.ts";

const MINIMAL = `
target: example
scrape_repo: ../example-scrape
crawl:
  start:
    - https://example.com/
`;

const WITH_DEFAULTS = `
target: example
scrape_repo: ../example-scrape
crawl:
  start:
    - https://example.com/
llm:
  defaults:
    agent: openrouter/anthropic/claude-sonnet-4-5
    polish: anthropic/claude-sonnet-4-5
`;

const WITH_LEGACY = `
target: example
scrape_repo: ../example-scrape
crawl:
  start:
    - https://example.com/
agent:
  openrouter_api_key_env: MY_CUSTOM_OR_KEY
llm:
  defaults:
    agent: openrouter/deepseek/deepseek-r1-0528
`;

describe("resolveLLM — model selection", () => {
  test("modelOverride wins over config default", () => {
    const cfg = parseConfig(WITH_DEFAULTS);
    const r = resolveLLM({
      config: cfg,
      task: "agent",
      modelOverride: "ollama/qwen2.5-coder:7b",
      env: {},
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolved.provider.prefix).toBe("ollama");
      expect(r.resolved.modelName).toBe("qwen2.5-coder:7b");
    }
  });

  test("falls back to config default when no override", () => {
    const cfg = parseConfig(WITH_DEFAULTS);
    const r = resolveLLM({
      config: cfg,
      task: "agent",
      env: { OPENROUTER_API_KEY: "sk-x" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolved.provider.prefix).toBe("openrouter");
      expect(r.resolved.modelId).toBe(
        "openrouter/anthropic/claude-sonnet-4-5",
      );
    }
  });

  test("polish task picks llm.defaults.polish", () => {
    const cfg = parseConfig(WITH_DEFAULTS);
    const r = resolveLLM({
      config: cfg,
      task: "polish",
      env: { ANTHROPIC_API_KEY: "sk-x" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolved.provider.prefix).toBe("anthropic");
  });

  test("returns exit-code 2 when no override and no default", () => {
    const cfg = parseConfig(MINIMAL);
    const r = resolveLLM({ config: cfg, task: "agent", env: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.exitCode).toBe(2);
      expect(r.error).toContain("llm.defaults.agent");
    }
  });
});

describe("resolveLLM — api-key validation", () => {
  test("returns exit-code 1 when api key missing for openrouter", () => {
    const cfg = parseConfig(WITH_DEFAULTS);
    const r = resolveLLM({ config: cfg, task: "agent", env: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.exitCode).toBe(1);
      expect(r.error).toContain("OPENROUTER_API_KEY");
    }
  });

  test("does NOT require api key for ollama provider", () => {
    const cfg = parseConfig(WITH_DEFAULTS);
    const r = resolveLLM({
      config: cfg,
      task: "agent",
      modelOverride: "ollama/qwen2.5-coder:7b",
      env: {},
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.apiKey).toBeNull();
  });

  test("requires ANTHROPIC_API_KEY for anthropic provider", () => {
    const cfg = parseConfig(WITH_DEFAULTS);
    const r = resolveLLM({
      config: cfg,
      task: "polish",
      env: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ANTHROPIC_API_KEY");
  });
});

describe("resolveLLM — legacy openrouter_api_key_env override", () => {
  test("reads key from configured env name when openrouter selected", () => {
    const cfg = parseConfig(WITH_LEGACY);
    const r = resolveLLM({
      config: cfg,
      task: "agent",
      env: { MY_CUSTOM_OR_KEY: "sk-legacy" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.apiKey).toBe("sk-legacy");
      // Mirrors to canonical env name for downstream consumers.
      expect(r.env["OPENROUTER_API_KEY"]).toBe("sk-legacy");
    }
  });

  test("legacy override surfaces the custom env name in the diagnostic when missing", () => {
    const cfg = parseConfig(WITH_LEGACY);
    const r = resolveLLM({ config: cfg, task: "agent", env: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("MY_CUSTOM_OR_KEY");
  });

  test("legacy override is ignored for non-openrouter providers", () => {
    const cfg = parseConfig(WITH_LEGACY);
    const r = resolveLLM({
      config: cfg,
      task: "agent",
      modelOverride: "ollama/qwen2.5-coder:7b",
      env: {},
    });
    // Should NOT block on the legacy openrouter env var; ollama needs no key.
    expect(r.ok).toBe(true);
  });
});
