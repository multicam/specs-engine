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

describe("PROVIDERS.zai", () => {
  test("exists with prefix 'zai' and ZAI_API_KEY env name", () => {
    const p = PROVIDERS["zai"];
    expect(p).toBeDefined();
    expect(p!.prefix).toBe("zai");
    expect(p!.apiKeyEnvName).toBe("ZAI_API_KEY");
  });

  test("promptDirs walks zai/ then glm-5/ then anthropic/", () => {
    expect(PROVIDERS["zai"]!.promptDirs).toEqual(["zai", "glm-5", "anthropic"]);
  });

  test("baseURL is the z.ai coding-paas v4 endpoint", () => {
    expect(PROVIDERS["zai"]!.baseURL({})).toBe(
      "https://api.z.ai/api/coding/paas/v4",
    );
  });

  test("apiKey reads ZAI_API_KEY from env, null when absent", () => {
    const p = PROVIDERS["zai"]!;
    expect(p.apiKey({ ZAI_API_KEY: "sk-test" })).toBe("sk-test");
    // S-7-4: host-independent null. skipDotenv keeps this true even on a host
    // with a real ~/.claude/.env (regression guard for D-7-1).
    expect(p.apiKey({})).toBeNull();
  });

  test("apiKey resolves the D4 fallback chain (ZAI_CODING_CN_API_KEY, ZHIPU_API_KEY)", () => {
    const p = PROVIDERS["zai"]!;
    // S-7-2: each fallback var resolves when ZAI_API_KEY is absent.
    expect(p.apiKey({ ZAI_CODING_CN_API_KEY: "sk-b" })).toBe("sk-b");
    expect(p.apiKey({ ZHIPU_API_KEY: "sk-c" })).toBe("sk-c");
  });

  test("apiKey precedence is ZAI_API_KEY first (D4 order)", () => {
    const p = PROVIDERS["zai"]!;
    // S-7-3: primary var wins over the fallbacks when all are set.
    expect(
      p.apiKey({
        ZAI_API_KEY: "sk-primary",
        ZAI_CODING_CN_API_KEY: "sk-b",
        ZHIPU_API_KEY: "sk-c",
      }),
    ).toBe("sk-primary");
  });

  test("apiKey trims surrounding whitespace", () => {
    const p = PROVIDERS["zai"]!;
    // S-7-5: resolveApiKey trims the resolved value.
    expect(p.apiKey({ ZAI_API_KEY: "  sk-d  " })).toBe("sk-d");
  });

  test("knownGoodModels includes the GLM-5.1 flagship", () => {
    expect(PROVIDERS["zai"]!.knownGoodModels).toContain("glm-5.1");
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
