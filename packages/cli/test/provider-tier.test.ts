/**
 * Tests for tier field on ProviderConfig and ResolvedProvider.
 */
import { describe, test, expect } from "bun:test";
import { PROVIDERS } from "../src/agent/providers.ts";
import { resolveProvider } from "../src/agent/router.ts";

describe("ProviderConfig.defaultTier", () => {
  test("openrouter has defaultTier 'strong'", () => {
    expect(PROVIDERS["openrouter"]!.defaultTier).toBe("strong");
  });

  test("anthropic has defaultTier 'strong'", () => {
    expect(PROVIDERS["anthropic"]!.defaultTier).toBe("strong");
  });

  test("ollama has defaultTier 'weak'", () => {
    expect(PROVIDERS["ollama"]!.defaultTier).toBe("weak");
  });
});

describe("ResolvedProvider.tier", () => {
  test("resolving openrouter yields tier 'strong'", () => {
    const r = resolveProvider("openrouter/deepseek/deepseek-r1");
    expect(r.tier).toBe("strong");
  });

  test("resolving anthropic yields tier 'strong'", () => {
    const r = resolveProvider("anthropic/claude-sonnet-4-6");
    expect(r.tier).toBe("strong");
  });

  test("anthropic provider strips prefix correctly", () => {
    const r = resolveProvider("anthropic/claude-opus-4-7");
    expect(r.modelName).toBe("claude-opus-4-7");
    expect(r.provider.prefix).toBe("anthropic");
  });

  test("anthropic has native createModel factory", () => {
    expect(typeof PROVIDERS["anthropic"]!.createModel).toBe("function");
  });

  test("resolving ollama yields tier 'weak'", () => {
    const r = resolveProvider("ollama/qwen2.5-coder:7b");
    expect(r.tier).toBe("weak");
  });

  test("legacy bare route (unknown prefix) falls through to openrouter, tier 'strong'", () => {
    const r = resolveProvider("deepseek/r1");
    expect(r.tier).toBe("strong");
  });

  test("plain name (no slash) falls through to openrouter, tier 'strong'", () => {
    const r = resolveProvider("plain-model");
    expect(r.tier).toBe("strong");
  });
});
