import { describe, test, expect } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { tool } from "ai";
import { z } from "zod";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { probeToolCalling } from "../src/agent/probe.ts";

const MOCK_META = {
  usage: {
    inputTokens: { total: 10, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 5, text: undefined, reasoning: undefined },
  },
  warnings: [] as never[],
} satisfies Pick<LanguageModelV3GenerateResult, "usage" | "warnings">;

function mockResult(opts: {
  text?: string;
  toolCalls?: Array<{ toolCallId: string; toolName: string; input: string }>;
}): LanguageModelV3GenerateResult {
  const content: LanguageModelV3GenerateResult["content"] = [];
  if (opts.toolCalls) {
    for (const tc of opts.toolCalls) content.push({ type: "tool-call", ...tc });
  }
  if (opts.text !== undefined) content.push({ type: "text", text: opts.text });
  return {
    content,
    finishReason: {
      unified: opts.toolCalls?.length ? ("tool-calls" as const) : ("stop" as const),
      raw: undefined,
    },
    ...MOCK_META,
  };
}

function sequenceModel(responses: Array<Parameters<typeof mockResult>[0]>) {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => mockResult(responses[Math.min(i++, responses.length - 1)]!),
  });
}

const listFilesTool = tool({
  description: "List files matching a glob pattern",
  inputSchema: z.object({ glob: z.string() }),
  execute: async () => "specs/foo.md\nspecs/bar.md",
});

describe("probeToolCalling", () => {
  test("emits at least one tool call → ok=true with count", async () => {
    const model = sequenceModel([
      {
        toolCalls: [
          {
            toolCallId: "p1",
            toolName: "list_files",
            input: JSON.stringify({ glob: "specs/**/*.md" }),
          },
        ],
      },
      { text: "done" },
    ]);
    const result = await probeToolCalling({
      model,
      tools: { list_files: listFilesTool },
      modelId: "ollama/qwen2.5-coder:7b",
    });
    expect(result.ok).toBe(true);
    expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
    expect(result.diagnostic).toBeUndefined();
  });

  test("text-only response → ok=false with diagnostic naming the model id", async () => {
    const model = sequenceModel([{ text: "I cannot call tools." }]);
    const result = await probeToolCalling({
      model,
      tools: { list_files: listFilesTool },
      modelId: "ollama/gemma3:1b",
    });
    expect(result.ok).toBe(false);
    expect(result.toolCallCount).toBe(0);
    expect(result.diagnostic).toBeDefined();
    expect(result.diagnostic!).toContain("ollama/gemma3:1b");
    expect(result.diagnostic!).toContain("tool call");
  });

  test("diagnostic includes knownGoodModels suggestions when provided", async () => {
    const model = sequenceModel([{ text: "no tools today" }]);
    const result = await probeToolCalling({
      model,
      tools: { list_files: listFilesTool },
      modelId: "ollama/some-flaky:7b",
      knownGoodModels: ["qwen2.5-coder:7b", "llama3.1:8b"],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostic!).toContain("qwen2.5-coder:7b");
    expect(result.diagnostic!).toContain("llama3.1:8b");
  });

  test("missing knownGoodModels → diagnostic still well-formed", async () => {
    const model = sequenceModel([{ text: "no tools today" }]);
    const result = await probeToolCalling({
      model,
      tools: { list_files: listFilesTool },
      modelId: "openrouter/some/model",
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostic).toBeDefined();
    expect(result.diagnostic!).not.toContain("undefined");
  });

  test("empty knownGoodModels array → no suggestions appended", async () => {
    const model = sequenceModel([{ text: "no tools" }]);
    const result = await probeToolCalling({
      model,
      tools: { list_files: listFilesTool },
      modelId: "ollama/x:7b",
      knownGoodModels: [],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostic!).not.toContain("Try one of:");
  });
});
