/**
 * V6 — specs-engine's `zai` provider drives z.ai through the V4 AI-SDK adapter
 * (`createZaiLanguageModel`) instead of the generic `createOpenAI(...).chat()` path.
 *
 * S-V6-1: wiring conformance — `createModel` builds a valid LanguageModelV2.
 * S-V6-2: D-7-1 host-independence preserved — keyless construction does not throw,
 *         does not read `~/.claude/.env`.
 * S-V6-3/4: e2e tool-call through the REAL adapter with a mock transport, asserting
 *         both `result.toolCalls` (S-V6-3) and `result.steps[*].toolCalls` (S-V6-4,
 *         the probe's actual gate condition at probe.ts:45).
 */
import { describe, test, expect } from "bun:test";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { ZaiClient } from "@zai-tools/zai";
import { createZaiLanguageModel } from "@zai-tools/zai/ai-sdk";
import { PROVIDERS } from "../src/agent/providers.ts";

describe("PROVIDERS.zai.createModel (V6 adapter wiring)", () => {
  test("S-V6-1: createModel builds a valid LanguageModelV2 (specVersion v2, provider zai, modelId)", () => {
    const p = PROVIDERS["zai"]!;
    expect(p.createModel).toBeDefined();
    const model = p.createModel!("glm-5.1", { ZAI_API_KEY: "sk-x" });
    // `ai`'s LanguageModel is `string | LanguageModelV2`; the adapter returns the
    // object form. Narrow off the string branch before reading the V2 fields.
    expect(typeof model).toBe("object");
    if (typeof model === "string") throw new Error("expected a LanguageModelV2 object");
    expect(model.specificationVersion).toBe("v2");
    expect(model.provider).toBe("zai");
    expect(model.modelId).toBe("glm-5.1");
  });

  test("S-V6-2: createModel with empty env does NOT throw (keyless ZaiClient is valid; host-independent)", () => {
    const p = PROVIDERS["zai"]!;
    // A keyless ZaiClient is valid — rawKey is null until a call is attempted.
    // skipDotenv keeps this from reading ~/.claude/.env (D-7-1 regression guard).
    expect(() => p.createModel!("glm-4.7", {})).not.toThrow();
  });
});

describe("PROVIDERS.zai e2e tool-call through the REAL adapter (mock transport)", () => {
  test("S-V6-3 + S-V6-4: generateText drives a tool call; result.toolCalls AND result.steps[*].toolCalls non-empty", async () => {
    // Non-streaming application/json OpenAI-style chat-completion: generateText drives
    // doGenerate → chatRaw → openai create(), which parses JSON (NOT an SSE stream).
    const mockFetch = async (_url: any, _init?: any): Promise<Response> => {
      const body = {
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "glm-5.1",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "list_files",
                    arguments: JSON.stringify({ glob: "specs/**/*.md" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    // Build the model via the REAL adapter, swapping only the transport. An explicit
    // apiKey is fine HERE (test) — it's the providers.ts wiring that must use `key:{...}`.
    const model = createZaiLanguageModel({
      model: "glm-5.1",
      client: new ZaiClient({ apiKey: "sk-test", _fetch: mockFetch }),
    });

    const result = await generateText({
      model,
      tools: {
        list_files: tool({
          description: "List files matching a glob pattern",
          inputSchema: z.object({ glob: z.string() }),
          execute: async () => "specs/foo.md\nspecs/bar.md",
        }),
      },
      prompt: "List the spec files.",
      // Stop after one model turn so the tool's execute loop won't re-call the mock.
      stopWhen: stepCountIs(1),
    });

    // S-V6-3: top-level toolCalls populated (D-V4-4 final tool-call part survives e2e).
    expect(result.toolCalls.length).toBeGreaterThan(0);
    expect(result.toolCalls[0]!.toolName).toBe("list_files");

    // S-V6-4: the probe's ACTUAL gate condition (probe.ts:45) reads steps, not the
    // top-level toolCalls — assert it directly.
    expect(
      result.steps.flatMap((s) => s.toolCalls ?? []).length,
    ).toBeGreaterThan(0);
    expect(result.steps[0]!.toolCalls.length).toBeGreaterThan(0);
  });
});
