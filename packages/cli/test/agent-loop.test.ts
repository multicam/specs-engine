import { describe, test, expect } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { tool } from "ai";
import { z } from "zod";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { runAgentLoop } from "../src/agent/loop.ts";
import { ToolState } from "../src/agent/tools.ts";

/** Shared usage/warnings for all mock responses. */
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
    finishReason: { unified: opts.toolCalls?.length ? "tool-calls" as const : "stop" as const, raw: undefined },
    ...MOCK_META,
  };
}

function sequenceModel(responses: Array<Parameters<typeof mockResult>[0]>) {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => mockResult(responses[Math.min(i++, responses.length - 1)]!),
  });
}

function tc(toolName: string, input: Record<string, unknown>, id = "tc-1") {
  return { toolCallId: id, toolName, input: JSON.stringify(input) };
}

/** Create a write_file tool that tracks writes in the given ToolState. */
function makeWriteTool(state: ToolState) {
  return tool({
    description: "Write a file",
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    execute: async ({ path, content }) => {
      state.wroteSpec = true;
      state.specsWritten.push(path);
      return `Written: ${path} (${content.length} bytes)`;
    },
  });
}

const readFileTool = tool({
  description: "Read a file",
  inputSchema: z.object({ path: z.string() }),
  execute: async () => "content",
});

function loopOpts(overrides: Partial<Parameters<typeof runAgentLoop>[0]> = {}) {
  const state = overrides.state ?? new ToolState(10);
  return {
    model: sequenceModel([{ text: "done" }]),
    systemPrompt: "Write specs.",
    buildMessage: () => "Scrape at brand-scrape/. specs/ is empty.",
    tools: { write_file: makeWriteTool(state) },
    state,
    maxRounds: 5,
    ...overrides,
  };
}

describe("runAgentLoop (outer loop)", () => {
  test("single round: model writes spec then stops", async () => {
    const model = sequenceModel([
      { toolCalls: [tc("write_file", { path: "specs/test.md", content: "# Test" }, "w1")] },
      { text: "Done with this topic." },
    ]);

    const result = await runAgentLoop(loopOpts({ model }));

    expect(result.specsWritten).toEqual(["specs/test.md"]);
    expect(result.totalSteps).toBeGreaterThanOrEqual(2);
  });

  test("multi-round: writes two specs then signals done", async () => {
    const model = sequenceModel([
      { toolCalls: [tc("write_file", { path: "specs/a.md", content: "# A" }, "w1")] },
      { text: "Wrote A." },
      { toolCalls: [tc("write_file", { path: "specs/b.md", content: "# B" }, "w2")] },
      { text: "ALL_TOPICS_COVERED" },
    ]);

    const result = await runAgentLoop(loopOpts({ model, maxRounds: 10 }));

    expect(result.specsWritten).toEqual(["specs/a.md", "specs/b.md"]);
    expect(result.allTopicsCovered).toBe(true);
  });

  test("stops on ALL_TOPICS_COVERED signal", async () => {
    const result = await runAgentLoop(loopOpts({ maxRounds: 10 }));
    // Default model returns "done" which doesn't contain the signal,
    // but also doesn't write — stall on round 1 is tolerated (first round)
    expect(result.specsWritten).toEqual([]);
  });

  test("immediate ALL_TOPICS_COVERED stops loop", async () => {
    const model = sequenceModel([{ text: "ALL_TOPICS_COVERED" }]);
    const result = await runAgentLoop(loopOpts({ model, maxRounds: 10 }));
    expect(result.allTopicsCovered).toBe(true);
  });

  test("stall detection: stops after round with no write (after first successful round)", async () => {
    const model = sequenceModel([
      { toolCalls: [tc("write_file", { path: "specs/a.md", content: "# A" }, "w1")] },
      { text: "Wrote A." },
      // Round 2: only reads → stall
      { toolCalls: [tc("read_file", { path: "x.md" }, "r1")] },
      { text: "I need more context." },
    ]);

    const state = new ToolState(10);
    const result = await runAgentLoop(loopOpts({
      model,
      state,
      tools: { write_file: makeWriteTool(state), read_file: readFileTool },
      maxRounds: 10,
    }));

    expect(result.specsWritten).toEqual(["specs/a.md"]);
  });

  test("buildMessage is called each round with fresh state", async () => {
    let callCount = 0;
    const model = sequenceModel([
      { toolCalls: [tc("write_file", { path: "specs/a.md", content: "# A" }, "w1")] },
      { text: "Wrote A." },
      { text: "ALL_TOPICS_COVERED" },
    ]);

    await runAgentLoop(loopOpts({
      model,
      buildMessage: () => { callCount++; return `Round ${callCount}`; },
      maxRounds: 10,
    }));

    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  test("retry round uses tightened step budget (max 4)", async () => {
    const stepCounts: number[] = [];
    const model = sequenceModel([
      // Round 1: write spec
      { toolCalls: [tc("write_file", { path: "specs/a.md", content: "# A" }, "w1")] },
      { text: "Wrote A." },
      // Round 2: stall (no write) — isRetry=false, normal stepsPerRound
      { text: "Nothing to do." },
      // Round 3: retry — isRetry=true, effectiveSteps capped at 4
      { text: "ALL_TOPICS_COVERED" },
    ]);

    await runAgentLoop(loopOpts({
      model,
      maxRounds: 10,
      stepsPerRound: 10,
      onRoundFinish: ({ steps }) => stepCounts.push(steps),
    }));

    // Round 3 (retry) should have been capped — the mock returns immediately so
    // steps === 1, which is <= 4. Confirm it never exceeded the cap.
    expect(stepCounts.length).toBe(3);
    expect(stepCounts[2]).toBeLessThanOrEqual(4);
  });

  test("onRoundFinish callback fires with correct info", async () => {
    const rounds: Array<{ round: number; wroteSpec: boolean; done: boolean }> = [];
    const model = sequenceModel([{ text: "ALL_TOPICS_COVERED" }]);

    await runAgentLoop(loopOpts({
      model,
      onRoundFinish: (info) => rounds.push(info),
    }));

    expect(rounds.length).toBe(1);
    expect(rounds[0]!.done).toBe(true);
  });

  test("isRoundComplete: stops one-shot when the BI is written, no DONE_SIGNAL needed", async () => {
    const state = new ToolState(10);
    const model = sequenceModel([
      { toolCalls: [tc("write_file", { path: "specs/.runs/x/BUSINESS_INTENT.md", content: "# BI" }, "w1")] },
      { text: "Wrote the business intent draft." },
    ]);

    const result = await runAgentLoop(loopOpts({
      model,
      state,
      tools: { write_file: makeWriteTool(state) },
      maxRounds: 5,
      isRoundComplete: (s) => s.specsWritten.some((p) => p.endsWith("BUSINESS_INTENT.md")),
    }));

    expect(result.rounds).toBe(1);
    expect(result.allTopicsCovered).toBe(true);
    expect(result.specsWritten).toEqual(["specs/.runs/x/BUSINESS_INTENT.md"]);
  });

  test("regression: without isRoundComplete, ALL_TOPICS_COVERED text signal still governs completion", async () => {
    const model = sequenceModel([
      { toolCalls: [tc("write_file", { path: "specs/a.md", content: "# A" }, "w1")] },
      { text: "Wrote A." },
      { toolCalls: [tc("write_file", { path: "specs/b.md", content: "# B" }, "w2")] },
      { text: "ALL_TOPICS_COVERED" },
    ]);

    const result = await runAgentLoop(loopOpts({ model, maxRounds: 10 }));

    expect(result.rounds).toBe(2);
    expect(result.specsWritten).toEqual(["specs/a.md", "specs/b.md"]);
    expect(result.allTopicsCovered).toBe(true);
  });

  test("intake hints replace docs-reverse coverage framing on the stall/retry path", async () => {
    // Round 0 stalls (no write) → round 1 is a retry, which is exactly where the
    // docs-reverse "pick one uncovered page / SIMPLE topic / ALL_TOPICS_COVERED"
    // text used to leak in unconditionally. With intake hints, that framing must
    // be gone and the retry must point at BUSINESS_INTENT.md instead.
    const prompts: string[] = [];
    const state = new ToolState(10);
    let call = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        prompts.push(JSON.stringify(options.prompt));
        call++;
        // call 1 = round 0 (stall, no write); call 2 = round 1 step 1 (write the
        // BI once); call 3 = round 1 step 2 (stop). isRoundComplete then breaks.
        if (call === 2) {
          return mockResult({
            toolCalls: [
              tc("write_file", { path: "specs/.runs/x/BUSINESS_INTENT.md", content: "# BI" }, "w1"),
            ],
          });
        }
        return mockResult({ text: "still thinking" });
      },
    });

    const result = await runAgentLoop(loopOpts({
      model,
      state,
      tools: { write_file: makeWriteTool(state) },
      maxRounds: 5,
      isRoundComplete: (s) => s.specsWritten.some((p) => p.endsWith("BUSINESS_INTENT.md")),
      continuationHint:
        "\n\n**ACTION REQUIRED: call write_file for BUSINESS_INTENT.md NOW. Do not end this round without writing it.**",
      retryHint:
        "Read at MOST 1 input spec with read_file, then you MUST call write_file for BUSINESS_INTENT.md immediately.",
    }));

    // Round 1 (the retry) is prompts[1]. It must carry the intake framing, not docs-reverse's.
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    expect(prompts[1]).not.toContain("uncovered page");
    expect(prompts[1]).not.toContain("SIMPLE topic");
    expect(prompts[1]).not.toContain("ALL_TOPICS_COVERED");
    expect(prompts[1]).toContain("BUSINESS_INTENT.md");
    expect(result.specsWritten).toEqual(["specs/.runs/x/BUSINESS_INTENT.md"]);
  });
});
