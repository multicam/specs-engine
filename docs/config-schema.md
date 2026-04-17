# `.specs-engine.yaml` reference

Per-project config for the `specs` CLI. Lives at `<target>-project/.specs-engine.yaml`. Validated on load with zod; invalid shape fails fast with readable errors.

## Minimal example

```yaml
target: acme
scrape_repo: ../acme-scrape
crawl:
  start:
    - https://acme.example.com/
  follow:
    - "https://acme.example.com/**"
  ignore: []
  max_depth: 4
  max_pages: 500
  rate_limit_ms: 500
debrand:
  glossary: {}
  polish: false
```

## Full shape

```yaml
target: <slug>                    # [a-z0-9][a-z0-9-]*, required
scrape_repo: <relative-path>      # path to sibling scrape repo, required

crawl:
  start:                          # required, non-empty list of URLs
    - https://example.com/
  follow:                         # required, non-empty glob list (micromatch)
    - "https://example.com/**"
  ignore:                         # optional, glob list
    - "**/blog/**"
  max_depth: 4                    # required, integer ≥ 0
  max_pages: 500                  # required, integer ≥ 1
  rate_limit_ms: 500              # required, integer ≥ 0 (per-target-domain min delay)

jina:                             # optional; all fields default if section omitted
  base_url: https://r.jina.ai     # default
  api_key_env: JINA_API_KEY       # env var name; if set and non-empty, sent as Bearer auth
  timeout_ms: 30000               # default

debrand:
  glossary:                       # required; may be empty
    Brand: Replacement
    "Brand's": "Replacement's"
  polish: false                   # optional boolean; default false

agent:                            # optional; required only for `specs agent`
  ralph_pack: ~/Code/ralph-loop-pack  # path to ralph-loop-pack for prompt discovery
  openrouter_api_key_env: OPENROUTER_API_KEY  # env var name; default
```

## Field reference

### Top-level

| Key | Required | Type | Notes |
|-----|----------|------|-------|
| `target` | yes | string | Slug, lowercase alphanumeric + hyphen. Used for default names and messages. |
| `scrape_repo` | yes | string | Relative path from the project dir to the sibling scrape repo (typically `../<target>-scrape`). |

### `crawl.*`

| Key | Required | Type | Notes |
|-----|----------|------|-------|
| `start` | yes | string[] | Seed URLs at depth 0. Multiple hosts allowed. |
| `follow` | yes | string[] | Glob patterns (micromatch). A URL is enqueued only if it matches at least one. |
| `ignore` | no | string[] | Globs. A URL matching any is dropped even if `follow` matched. |
| `max_depth` | yes | int ≥ 0 | BFS depth cap from seeds. |
| `max_pages` | yes | int ≥ 1 | Hard stop on total pages visited. |
| `rate_limit_ms` | yes | int ≥ 0 | Minimum delay between requests per **target domain** (not per Jina call). |

Patterns use [micromatch](https://github.com/micromatch/micromatch) syntax. `**` matches across path segments. Include the scheme and host: `"https://acme.example.com/**"` is correct; `"/docs/**"` is not. For multiple hosts, add one glob per host.

### `jina.*`

Optional. If omitted, defaults apply.

| Key | Default | Notes |
|-----|---------|-------|
| `base_url` | `https://r.jina.ai` | Jina Reader endpoint. |
| `api_key_env` | `JINA_API_KEY` | Env var name. If set and non-empty at runtime, sent as `Authorization: Bearer $KEY` for higher rate limits. Free tier works without a key (~20 req/min, IP-based). |
| `timeout_ms` | `30000` | Per-request timeout. |

### `debrand.*`

| Key | Required | Type | Notes |
|-----|----------|------|-------|
| `glossary` | yes | string→string map | Brand term → replacement. Applied with word-boundary regex, longest-match-first so `Brand's` wins over `Brand`. Case-sensitive; add each inflection explicitly. |
| `polish` | no | bool | If true, after substitution each file is sent to Claude (Anthropic SDK, Sonnet 4.6) for paraphrase cleanup. Requires `ANTHROPIC_API_KEY` env var. Default `false`. |

### `agent.*`

Optional. Required only when using `specs agent`.

| Key | Default | Notes |
|-----|---------|-------|
| `ralph_pack` | `~/Code/ralph-loop-pack` | Path to your ralph-loop-pack clone. Used for prompt auto-discovery: `<ralph_pack>/.ralph/prompts/<provider>/<mode>.md`. |
| `openrouter_api_key_env` | `OPENROUTER_API_KEY` | Env var name holding the OpenRouter API key. Key is required at runtime; this field only names the var. |

Model ID format for `--model` is the OpenRouter `provider/model-name` string (e.g. `deepseek/deepseek-r1-0528`, `google/gemini-2.5-flash`). The provider prefix is also used to resolve the prompt directory under `ralph_pack`.

## Canonical URL rules (applied before frontier dedup)

- Strip trailing `/` except for origin
- Lowercase host
- Drop query string
- Drop fragment

## URL → filepath derivation

Output path inside the scrape repo is `<host>/<path>.md`:

| URL | Filepath |
|-----|----------|
| `https://acme.example.com/` | `acme.example.com/index.md` |
| `https://acme.example.com/docs` | `acme.example.com/docs.md` |
| `https://acme.example.com/docs/api/webhooks` | `acme.example.com/docs/api/webhooks.md` |
| `https://help.acme.example.com/` | `help.acme.example.com/index.md` |

Host is the top-level namespace so multi-host crawls (marketing + docs subdomain) don't collide on shared paths like `/`.

## Frontmatter emitted per page

```yaml
---
url: "<original-url>"
title: "<page title from Jina>"
fetched: "<ISO-8601 UTC>"
hash: "<sha256 of body>"
---

<markdown body>
```

`hash` is over the body only, so timestamp/url metadata drift doesn't trigger spurious diffs.

## `.gitignore` scaffolded by `init`

Both `<target>-project/` and `<target>-scrape/` get a `.gitignore` with:

```
.idea/
thoughts/
.env
```

Keeps IDE metadata, HumanLayer thoughts dirs, and local `.env` files out of tracked content.
