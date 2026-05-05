import { describe, test, expect } from "bun:test";
import { getBudgets } from "../src/agent/budgets.ts";
import type { ModelTier } from "../src/agent/budgets.ts";

describe("getBudgets", () => {
  test("weak tier returns current tight values", () => {
    const b = getBudgets("weak" satisfies ModelTier);
    expect(b.readBudget).toBe(4);
    expect(b.exploreBudget).toBe(3);
    expect(b.stepsPerRound).toBe(6);
  });

  test("strong tier returns higher values", () => {
    const b = getBudgets("strong" satisfies ModelTier);
    expect(b.readBudget).toBe(8);
    expect(b.exploreBudget).toBe(6);
    expect(b.stepsPerRound).toBe(12);
  });

  test("strong tier budgets exceed weak tier budgets", () => {
    const weak = getBudgets("weak");
    const strong = getBudgets("strong");
    expect(strong.readBudget).toBeGreaterThan(weak.readBudget);
    expect(strong.exploreBudget).toBeGreaterThan(weak.exploreBudget);
    expect(strong.stepsPerRound).toBeGreaterThan(weak.stepsPerRound);
  });

  test("returns object with all three budget fields", () => {
    const b = getBudgets("weak");
    expect(b).toHaveProperty("readBudget");
    expect(b).toHaveProperty("exploreBudget");
    expect(b).toHaveProperty("stepsPerRound");
  });
});
