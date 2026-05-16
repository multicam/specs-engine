/**
 * Tests that the agent command wires tier-derived budgets into ToolState
 * and stepsPerRound, rather than using hard-coded literals.
 */
import { describe, test, expect } from "bun:test";
import { getBudgets } from "../src/agent/budgets.ts";
import { resolveProvider } from "../src/agent/router.ts";
import { ToolState } from "../src/agent/tools.ts";

describe("budget wiring integration", () => {
  test("strong-tier provider yields stepsPerRound of 12", () => {
    const resolved = resolveProvider("openrouter/deepseek/deepseek-chat");
    const budgets = getBudgets(resolved.tier);
    expect(budgets.stepsPerRound).toBe(12);
  });

  test("weak-tier provider yields stepsPerRound of 6", () => {
    const resolved = resolveProvider("ollama/qwen2.5-coder:7b");
    const budgets = getBudgets(resolved.tier);
    expect(budgets.stepsPerRound).toBe(6);
  });

  test("strong-tier ToolState has readBudget 8", () => {
    const resolved = resolveProvider("openrouter/deepseek/deepseek-chat");
    const { readBudget, exploreBudget } = getBudgets(resolved.tier);
    const state = new ToolState(readBudget, exploreBudget);
    expect(state.readBudget).toBe(8);
  });

  test("weak-tier ToolState has readBudget 4", () => {
    const resolved = resolveProvider("ollama/qwen2.5-coder:7b");
    const { readBudget, exploreBudget } = getBudgets(resolved.tier);
    const state = new ToolState(readBudget, exploreBudget);
    expect(state.readBudget).toBe(4);
  });

  test("strong-tier ToolState has exploreBudget 6", () => {
    const resolved = resolveProvider("openrouter/anthropic/claude-sonnet-4-5");
    const { readBudget, exploreBudget } = getBudgets(resolved.tier);
    const state = new ToolState(readBudget, exploreBudget);
    expect(state.exploreBudget).toBe(6);
  });

  test("weak-tier ToolState has exploreBudget 3", () => {
    const resolved = resolveProvider("ollama/llama3.1:8b");
    const { readBudget, exploreBudget } = getBudgets(resolved.tier);
    const state = new ToolState(readBudget, exploreBudget);
    expect(state.exploreBudget).toBe(3);
  });
});

describe("commands/agent.ts source does not hard-code budget literals", () => {
  test("agent.ts imports getBudgets from budgets module", async () => {
    const source = await Bun.file(
      new URL("../src/commands/agent.ts", import.meta.url).pathname,
    ).text();
    expect(source).toContain("getBudgets");
  });

  test("agent.ts does not hard-code ToolState(4) literal", async () => {
    const source = await Bun.file(
      new URL("../src/commands/agent.ts", import.meta.url).pathname,
    ).text();
    // ToolState should not be called with a bare 4 literal after the wiring
    expect(source).not.toMatch(/new ToolState\(\s*4\s*\)/);
  });

  test("agent.ts does not hard-code stepsPerRound: 6 literal", async () => {
    const source = await Bun.file(
      new URL("../src/commands/agent.ts", import.meta.url).pathname,
    ).text();
    expect(source).not.toMatch(/stepsPerRound:\s*6\b/);
  });

  test("agent.ts does not hard-code 'at most 4' in prompt text", async () => {
    const source = await Bun.file(
      new URL("../src/commands/agent.ts", import.meta.url).pathname,
    ).text();
    expect(source).not.toContain("at most 4");
  });
});
