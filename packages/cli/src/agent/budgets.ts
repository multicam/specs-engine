/**
 * Model-tier budget constants for the agent loop.
 *
 * Strong models (frontier APIs) get higher budgets — more reads, more explore
 * calls, more steps per round — so they can produce richer specs.
 * Weak models (local/Ollama) keep the tight values to avoid runaway loops.
 *
 * Defaults live here; per-project overrides come from `.specs-engine.yaml`'s
 * `llm.budgets.<tier>` block. `getBudgets(tier, overrides)` merges them.
 */

export type ModelTier = "strong" | "weak";

export interface AgentBudgets {
  /** Max read_file calls per round. */
  readBudget: number;
  /** Max list_files + grep calls per round. */
  exploreBudget: number;
  /** Max AI SDK steps per round (stopWhen: stepCountIs). */
  stepsPerRound: number;
}

/** Partial overrides — any subset of AgentBudgets fields. */
export type AgentBudgetsOverride = Partial<AgentBudgets>;

export interface BudgetOverridesByTier {
  strong?: AgentBudgetsOverride;
  weak?: AgentBudgetsOverride;
}

const DEFAULT_BUDGETS: Record<ModelTier, AgentBudgets> = {
  weak: {
    readBudget: 4,
    exploreBudget: 3,
    stepsPerRound: 6,
  },
  strong: {
    readBudget: 8,
    exploreBudget: 6,
    stepsPerRound: 12,
  },
};

/**
 * Resolve the budget for a tier. When `overrides` is supplied, fields present
 * on `overrides[tier]` win over the defaults; missing fields fall through.
 */
export function getBudgets(
  tier: ModelTier,
  overrides?: BudgetOverridesByTier,
): AgentBudgets {
  const base = DEFAULT_BUDGETS[tier];
  const o = overrides?.[tier];
  if (!o) return base;
  return {
    readBudget: o.readBudget ?? base.readBudget,
    exploreBudget: o.exploreBudget ?? base.exploreBudget,
    stepsPerRound: o.stepsPerRound ?? base.stepsPerRound,
  };
}
