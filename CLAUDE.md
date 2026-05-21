# specs-engine — Claude working notes

User-facing overview lives in `README.md`. This file is for agents working on the CLI itself.

## What this repo is

A CLI (`packages/cli/`) that drives a competitive-docs pipeline: scrape competitor product site → generate claim-based specs via LLM agent → debrand → hand off to a code-gen loop. Not a library — single `specs` binary dispatched from `packages/cli/src/index.ts`.

## Stack

- **Runtime:** Bun. `bun test`, `bun build`. No Node, no npm.
- **TypeScript.** Strict mode.
- **Deps:** `ai` (Vercel AI SDK) + `@ai-sdk/openai`/`anthropic` for the agent; `js-yaml` for config; `micromatch` for glob patterns; `zod` for validation.

## Layout

```
packages/cli/src/
  index.ts              # arg parsing only — no behavior
  commands/*.ts         # one file per subcommand (init, scrape, status, diff, repin, debrand, agent)
  agent/                # LLM loop. router→providers→client; loop.ts drives steps; tools.ts is the toolset; budgets.ts is tier→limits
  crawler/              # canonical URLs, frontier, Jina fetcher, rate-limit, link extraction, pattern matching
  debrand/              # glossary regex substitution + optional Claude polish
  git/                  # scrape-repo init, submodule wiring, snapshot helpers
  config.ts, fs-util.ts
packages/cli/test/      # bun test
```

Keep `index.ts` arg-parsing only; behavior lives in `commands/*` so it's testable without spawning a process.

## PRD-driven flow

Work in this repo is gated by `prd.json` + `specs/<story-id>.md` scenarios. Each story has `acceptance_criteria` and a `scenario_file`. Mark `passes: true` only after the verifier confirms.

Current PRD: model-tier budgets (`budget-tiers`, `provider-tier`, `wire-budgets` — all passing).

## Tests

Real I/O at boundaries — real filesystem, real subprocess for git, real network for contract tests. Mocks only where hitting the real thing is impossible (the LLM provider in unit tests). See `packages/cli/test/`.

Run: `cd packages/cli && bun test`.

## Agent loop specifics

- **Providers:** `openrouter` (cloud, strong tier default), `ollama` (local, weak tier default), legacy bare `<vendor>/<model>` routes to openrouter.
- **Tier-derived budgets:** `agent/budgets.ts` exports `getBudgets(tier)` → `{readBudget, exploreBudget, stepsPerRound}`. Weak: 4/3/6. Strong: 8/6/12. Resolved from `ResolvedProvider.tier` in `commands/agent.ts`. **Do not hard-code these literals back in.**
- **Probe:** `agent/probe.ts` runs a tool-call sanity check before the main loop on Ollama. Models that can't drive OpenAI-style tool calls fail fast with exit 2.
- **Tools:** see `agent/tools.ts` (read_file, list_files, write_file, glob, etc.). Budgets gate reads/explorations per round.
- **Prompts:** loaded from `~/Code/ralph-loop-pack/.ralph/prompts/<provider>/<mode>.md` with fallback to anthropic prompt.

## Conventions

- **Tool discipline:** Read/Grep/Glob over shell `cat`/`grep`/`find`. `bun` not `node`/`npm`.
- **Commit hygiene:** scrape commits only happen if the worktree is dirty; debrand is idempotent (no-op = no commit).
- **`specs/.runs/`** is dot-prefixed on purpose — `Bun.Glob({dot: false})` walks skip it; debrand skips it. Don't change that without thinking about both call sites.
- **Submodule URLs are relative** (`../<target>-scrape`) so re-cloning siblings works.

## Don't

- Add features beyond the active PRD story without checking with JM.
- Auto-bump the scrape submodule pointer — `repin` is a deliberate, human-driven action.
- Introduce npm/yarn/pnpm or `node` invocations.
- Mock the filesystem or git in tests "to make them faster."
