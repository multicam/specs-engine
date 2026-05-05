/**
 * Model-tier budget constants for the agent loop.
 *
 * Strong models (frontier APIs) get higher budgets — more reads, more explore
 * calls, more steps per round — so they can produce richer specs.
 * Weak models (local/Ollama) keep the tight values to avoid runaway loops.
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

const BUDGETS: Record<ModelTier, AgentBudgets> = {
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

export function getBudgets(tier: ModelTier): AgentBudgets {
  return BUDGETS[tier];
}
