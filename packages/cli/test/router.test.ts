import { describe, test, expect } from "bun:test";
import { resolveProvider } from "../src/agent/router.ts";
import { PROVIDERS } from "../src/agent/providers.ts";

describe("resolveProvider", () => {
  test("openrouter prefix routes to openrouter provider, strips prefix from modelName", () => {
    const r = resolveProvider("openrouter/deepseek/deepseek-r1-0528");
    expect(r.provider).toBe(PROVIDERS["openrouter"]!);
    expect(r.modelName).toBe("deepseek/deepseek-r1-0528");
    expect(r.modelId).toBe("openrouter/deepseek/deepseek-r1-0528");
  });

  test("legacy bare vendor/model routes to openrouter, modelName preserved", () => {
    const r = resolveProvider("deepseek/r1-0528");
    expect(r.provider).toBe(PROVIDERS["openrouter"]!);
    expect(r.modelName).toBe("deepseek/r1-0528");
    expect(r.modelId).toBe("deepseek/r1-0528");
  });

  test("plain model name (no slash) routes to openrouter, modelName preserved", () => {
    const r = resolveProvider("plain-model-name");
    expect(r.provider).toBe(PROVIDERS["openrouter"]!);
    expect(r.modelName).toBe("plain-model-name");
  });

  test("unknown prefix passes through to openrouter as legacy bare-prefix", () => {
    const r = resolveProvider("unknown/foo");
    expect(r.provider).toBe(PROVIDERS["openrouter"]!);
    expect(r.modelName).toBe("unknown/foo");
  });

  test("ollama prefix routes to ollama provider, modelName preserves colon-tag", () => {
    const r = resolveProvider("ollama/qwen2.5-coder:7b");
    expect(r.provider).toBe(PROVIDERS["ollama"]!);
    expect(r.modelName).toBe("qwen2.5-coder:7b");
  });

  test("ollama llama3.1:8b modelName preserves colon", () => {
    const r = resolveProvider("ollama/llama3.1:8b");
    expect(r.provider).toBe(PROVIDERS["ollama"]!);
    expect(r.modelName).toBe("llama3.1:8b");
  });
});
