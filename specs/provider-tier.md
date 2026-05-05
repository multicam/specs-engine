# Scenario: Tier field on ProviderConfig

## Feature
Given providers are registered with a defaultTier
When a provider is resolved
Then the resolved result exposes the tier

---

## Scenario: openrouter has strong tier

Given PROVIDERS.openrouter
When its defaultTier is read
Then it equals 'strong'

---

## Scenario: ollama has weak tier

Given PROVIDERS.ollama
When its defaultTier is read
Then it equals 'weak'

---

## Scenario: resolved provider exposes tier

Given resolveProvider('openrouter/some-model')
When the result is read
Then result.tier equals 'strong'

Given resolveProvider('ollama/qwen2.5-coder:7b')
When the result is read
Then result.tier equals 'weak'

---

## Scenario: legacy bare route defaults to strong (openrouter fallback)

Given resolveProvider('deepseek/r1') (no known prefix)
When the result is read
Then result.tier equals 'strong' (openrouter fallback)
