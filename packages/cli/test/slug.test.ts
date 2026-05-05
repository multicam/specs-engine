import { describe, test, expect } from "bun:test";
import { modelSlug, parseSlug } from "../src/agent/slug.ts";

describe("modelSlug", () => {
  test("ollama qwen2.5-coder:7b → ollama--qwen2.5-coder-7b (colon→dash, dot kept)", () => {
    expect(modelSlug("ollama", "qwen2.5-coder:7b")).toBe(
      "ollama--qwen2.5-coder-7b",
    );
  });

  test("openrouter deepseek/r1-0528 → openrouter--deepseek-r1-0528 (slash→dash)", () => {
    expect(modelSlug("openrouter", "deepseek/r1-0528")).toBe(
      "openrouter--deepseek-r1-0528",
    );
  });

  test("openrouter qwen/qwen-2.5-coder-7b-instruct → kebab", () => {
    expect(modelSlug("openrouter", "qwen/qwen-2.5-coder-7b-instruct")).toBe(
      "openrouter--qwen-qwen-2.5-coder-7b-instruct",
    );
  });

  test("mixed case + underscores normalise", () => {
    expect(modelSlug("ollama", "MIXED_Case:Tag")).toBe(
      "ollama--mixed-case-tag",
    );
  });

  test("collapses repeated dashes inside model part", () => {
    expect(modelSlug("ollama", "foo--bar")).toBe("ollama--foo-bar");
  });
});

describe("parseSlug", () => {
  test("roundtrips ollama--qwen2.5-coder-7b", () => {
    expect(parseSlug("ollama--qwen2.5-coder-7b")).toEqual({
      provider: "ollama",
      model: "qwen2.5-coder-7b",
    });
  });

  test("throws on slug without separator", () => {
    expect(() => parseSlug("invalid")).toThrow(/invalid run slug/);
  });

  test("throws on empty provider half", () => {
    expect(() => parseSlug("--model")).toThrow(/invalid run slug/);
  });

  test("throws on empty model half", () => {
    expect(() => parseSlug("provider--")).toThrow(/invalid run slug/);
  });
});
