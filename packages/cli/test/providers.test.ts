import { describe, test, expect } from "bun:test";
import { PROVIDERS } from "../src/agent/providers.ts";

describe("PROVIDERS.openrouter", () => {
  test("exists with prefix 'openrouter' and OPENROUTER_API_KEY env name", () => {
    const p = PROVIDERS["openrouter"];
    expect(p).toBeDefined();
    expect(p!.prefix).toBe("openrouter");
    expect(p!.apiKeyEnvName).toBe("OPENROUTER_API_KEY");
    expect(p!.promptDirs).toEqual(["openrouter", "anthropic"]);
  });

  test("apiKey reads OPENROUTER_API_KEY from env", () => {
    const p = PROVIDERS["openrouter"]!;
    expect(p.apiKey({ OPENROUTER_API_KEY: "sk-test" })).toBe("sk-test");
    expect(p.apiKey({})).toBeNull();
  });

  test("baseURL is the OpenRouter v1 endpoint", () => {
    expect(PROVIDERS["openrouter"]!.baseURL({})).toBe(
      "https://openrouter.ai/api/v1",
    );
  });
});

describe("PROVIDERS.ollama", () => {
  test("exists with prefix 'ollama' and no apiKey requirement", () => {
    const p = PROVIDERS["ollama"];
    expect(p).toBeDefined();
    expect(p!.prefix).toBe("ollama");
    expect(p!.apiKeyEnvName).toBeNull();
    expect(p!.apiKey({})).toBeNull();
  });

  test("promptDirs walks ollama/ then anthropic/ as fallback", () => {
    expect(PROVIDERS["ollama"]!.promptDirs[0]).toBe("ollama");
    expect(PROVIDERS["ollama"]!.promptDirs).toContain("anthropic");
  });

  test("baseURL defaults to localhost when OLLAMA_HOST unset", () => {
    expect(PROVIDERS["ollama"]!.baseURL({})).toBe(
      "http://localhost:11434/v1",
    );
  });

  test("baseURL appends /v1 when OLLAMA_HOST lacks it", () => {
    expect(
      PROVIDERS["ollama"]!.baseURL({ OLLAMA_HOST: "http://gpu.lan:11434" }),
    ).toBe("http://gpu.lan:11434/v1");
  });

  test("baseURL is idempotent when OLLAMA_HOST already ends in /v1", () => {
    expect(
      PROVIDERS["ollama"]!.baseURL({ OLLAMA_HOST: "http://gpu.lan:11434/v1" }),
    ).toBe("http://gpu.lan:11434/v1");
  });

  test("baseURL strips trailing slash before appending /v1", () => {
    expect(
      PROVIDERS["ollama"]!.baseURL({ OLLAMA_HOST: "http://gpu.lan:11434/" }),
    ).toBe("http://gpu.lan:11434/v1");
  });

  test("knownGoodModels includes the curated tool-call-reliable list", () => {
    const list = PROVIDERS["ollama"]!.knownGoodModels;
    expect(list).toBeDefined();
    expect(list!.length).toBeGreaterThan(0);
    expect(list).toContain("qwen2.5-coder:7b");
    expect(list).toContain("llama3.1:8b");
  });
});
