# Scenario: Wire tier-derived budgets into the agent command

## Feature
Given the agent command resolves a provider with a tier
When it constructs ToolState and calls runAgentLoop
Then the budgets come from getBudgets(tier), not hard-coded literals

---

## Scenario: strong-tier model gets higher stepsPerRound

Given a model that resolves to 'strong' tier (e.g. openrouter/*)
When runAgent is called (pre-flight fails fast)
Then stepsPerRound used is 12 (strong value), not 6 (weak value)

---

## Scenario: weak-tier model gets lower budgets

Given a model that resolves to 'weak' tier (e.g. ollama/*)
When runAgent is called (pre-flight fails fast)
Then stepsPerRound used is 6 (weak value)

---

## Scenario: no budget literals remain in commands/agent.ts

Given the source of commands/agent.ts
When it is inspected
Then the ToolState constructor arg and stepsPerRound come from getBudgets()
And the literals 4 (readBudget), 3 (exploreBudget), 6 (stepsPerRound) are not hard-coded standalone
