# Scenario: Model-tier budget constants

## Feature
Given the agent runs with a specific model tier
When getBudgets() is called with that tier
Then it returns the correct budget triplet for that tier

---

## Scenario: weak tier budgets

Given model tier is 'weak'
When getBudgets('weak') is called
Then readBudget is 4
And exploreBudget is 3
And stepsPerRound is 6

---

## Scenario: strong tier budgets

Given model tier is 'strong'
When getBudgets('strong') is called
Then readBudget is 8
And exploreBudget is 6
And stepsPerRound is 12

---

## Scenario: ModelTier is exported

Given the budgets module
When it is imported
Then ModelTier type is available
And getBudgets is a callable function
