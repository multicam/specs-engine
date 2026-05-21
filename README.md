# specs-engine

CLI for reverse-engineering competitive product docs into claim-based specs you can hand to a code-gen loop.

Pipeline: **init → scrape → repin → docs-reverse (agent) → debrand → edit → build**.

## Install

```bash
bun install               # from packages/cli/
alias specs='bun ~/Code/specs-engine/packages/cli/src/index.ts'
```

Requires `bun`. Optional: `JINA_API_KEY` (higher scrape rate limits), `OPENROUTER_API_KEY` (cloud agent), `OLLAMA_HOST` (remote local agent).

## Quick start

```bash
specs init acme https://acme.example.com/    # scaffolds acme-project/ + acme-scrape/ sibling repos
cd ~/Code/acme-project
# edit .specs-engine.yaml (follow/ignore patterns, max_pages)
specs scrape                                  # crawl + Jina fetch → commits into acme-scrape/
specs repin                                   # pin scrape SHA as baseline
specs agent docs-reverse --model openrouter/deepseek/deepseek-r1-0528
specs debrand --polish                        # glossary substitution + LLM cleanup
```

Then hand `specs/` to `ralph` (or your code-gen loop of choice) to generate `src/`.

## Commands

| Command | What it does |
|---------|--------------|
| `specs init [-C <dir>] <target> <start-url>` | Scaffold project + sibling scrape repo + submodule (refuses inside a git repo unless `-C` overrides) |
| `specs scrape` | Crawl per `.specs-engine.yaml`, fetch via Jina, commit changed pages |
| `specs status` | Pinned SHA vs scrape HEAD, count of changed pages |
| `specs diff [--stat]` | Page-level diff since the pin |
| `specs repin` | Bump submodule pointer to scrape HEAD |
| `specs agent <mode> --model <id>` | Run LLM agent (OpenRouter or Ollama) with tool access |
| `specs debrand [--polish]` | Glossary substitution across `specs/`, optional LLM polish |

Agent model IDs: `openrouter/<vendor>/<model>` or `ollama/<model>:<tag>`. See `docs/workflow.md` for model recommendations and the full incremental-update flow.

## Docs

- `docs/workflow.md` — end-to-end pipeline, phase-2 incremental updates, agent paths
- `docs/config-schema.md` — every field in `.specs-engine.yaml`
- `docs/docs-reverse-prompt.md` — what the agent does and how to author prompts

## Layout

```
packages/cli/src/
  index.ts              # dispatcher
  commands/             # one file per subcommand
  agent/                # LLM loop, tools, providers, budgets, probe
  crawler/              # frontier, canonicalization, Jina, rate-limit
  debrand/              # glossary substitution + polish
  git/                  # scrape-repo + submodule helpers
specs/                  # PRD scenarios for this repo's own features
prd.json                # active PRD (story-driven dev)
```
