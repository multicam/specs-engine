import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractModelPrefix,
  stripFrontmatter,
  resolvePrompt,
} from "../src/agent/prompt.ts";

describe("extractModelPrefix", () => {
  test("extracts prefix from slash-delimited model ID", () => {
    expect(extractModelPrefix("deepseek/deepseek-chat")).toBe("deepseek");
  });

  test("extracts prefix from google model", () => {
    expect(extractModelPrefix("google/gemini-2.5-flash")).toBe("google");
  });

  test("extracts prefix from mistralai model", () => {
    expect(extractModelPrefix("mistralai/mistral-large")).toBe("mistralai");
  });

  test("returns null when no slash present", () => {
    expect(extractModelPrefix("deepseek-chat")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(extractModelPrefix("")).toBeNull();
  });

  test("handles slash at start (empty prefix)", () => {
    // "/" at index 0 means idx > 0 is false
    expect(extractModelPrefix("/model")).toBeNull();
  });
});

describe("stripFrontmatter", () => {
  test("strips YAML frontmatter block", () => {
    const input = `---
description: A test prompt
model: deepseek-reasoner
---

# Prompt Title

Body content here.
`;
    const result = stripFrontmatter(input);
    expect(result).toBe("# Prompt Title\n\nBody content here.\n");
  });

  test("returns body unchanged when no frontmatter", () => {
    const input = "# No Frontmatter\n\nJust content.\n";
    expect(stripFrontmatter(input)).toBe(input.trimStart());
  });

  test("handles empty string", () => {
    expect(stripFrontmatter("")).toBe("");
  });

  test("handles frontmatter with no body", () => {
    const input = "---\ntitle: test\n---\n";
    expect(stripFrontmatter(input)).toBe("");
  });
});

describe("resolvePrompt", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "prompt-test-"));
    const promptsDir = join(tmpDir, ".ralph", "prompts");

    // Set up mock ralph-loop-pack structure
    await mkdir(join(promptsDir, "deepseek"), { recursive: true });
    await mkdir(join(promptsDir, "anthropic"), { recursive: true });

    await writeFile(
      join(promptsDir, "deepseek", "docs-reverse.md"),
      "---\nmodel: deepseek-reasoner\n---\n\n# DeepSeek Docs Reverse\n\nDeepSeek-specific prompt body.\n",
    );
    await writeFile(
      join(promptsDir, "anthropic", "docs-reverse.md"),
      "---\nmodel: claude-sonnet\n---\n\n# Anthropic Docs Reverse\n\nAnthropic fallback prompt body.\n",
    );
    await writeFile(
      join(promptsDir, "anthropic", "build.md"),
      "---\nmodel: claude-sonnet\n---\n\n# Build Prompt\n\nBuild body.\n",
    );
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("resolves model-specific prompt when available", async () => {
    const result = await resolvePrompt({
      ralphPackPath: tmpDir,
      mode: "docs-reverse",
      modelId: "deepseek/deepseek-chat",
    });
    expect(result.body).toContain("DeepSeek-specific prompt body");
    expect(result.path).toContain("deepseek/docs-reverse.md");
  });

  test("falls back to anthropic/ when model-specific dir missing", async () => {
    const result = await resolvePrompt({
      ralphPackPath: tmpDir,
      mode: "docs-reverse",
      modelId: "google/gemini-2.5-flash",
    });
    expect(result.body).toContain("Anthropic fallback prompt body");
    expect(result.path).toContain("anthropic/docs-reverse.md");
  });

  test("falls back to anthropic/ when model has no prefix", async () => {
    const result = await resolvePrompt({
      ralphPackPath: tmpDir,
      mode: "docs-reverse",
      modelId: "some-model",
    });
    expect(result.body).toContain("Anthropic fallback prompt body");
  });

  test("resolves anthropic-only mode", async () => {
    const result = await resolvePrompt({
      ralphPackPath: tmpDir,
      mode: "build",
      modelId: "deepseek/deepseek-chat",
    });
    expect(result.body).toContain("Build body");
    expect(result.path).toContain("anthropic/build.md");
  });

  test("throws when mode not found anywhere", async () => {
    await expect(
      resolvePrompt({
        ralphPackPath: tmpDir,
        mode: "nonexistent",
        modelId: "deepseek/deepseek-chat",
      }),
    ).rejects.toThrow(/prompt not found for mode 'nonexistent'/);
  });

  test("strips frontmatter from resolved prompt", async () => {
    const result = await resolvePrompt({
      ralphPackPath: tmpDir,
      mode: "docs-reverse",
      modelId: "deepseek/deepseek-chat",
    });
    expect(result.body).not.toContain("---");
    expect(result.body).toStartWith("# DeepSeek Docs Reverse");
  });

  test("promptOverride bypasses discovery", async () => {
    const overridePath = join(tmpDir, "custom-prompt.md");
    await writeFile(overridePath, "---\ncustom: true\n---\n\nCustom prompt body.\n");

    const result = await resolvePrompt({
      ralphPackPath: tmpDir,
      mode: "docs-reverse",
      modelId: "deepseek/deepseek-chat",
      promptOverride: overridePath,
    });
    expect(result.body).toBe("Custom prompt body.\n");
    expect(result.path).toBe(overridePath);
  });
});
