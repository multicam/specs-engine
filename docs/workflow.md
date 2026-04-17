# End-to-end workflow

Competitive reverse-engineering pipeline from a public product site to reviewed code. Each step is a single CLI command or a single manual invocation.

```
┌─────────────┐   ┌─────────┐   ┌───────────────┐   ┌─────────┐   ┌──────────────┐   ┌───────┐   ┌────────────┐
│ specs init  │──▶│  scrape │──▶│ repin (pin    │──▶│ docs-   │──▶│ debrand      │──▶│ edit  │──▶│ ralph      │
│ (one-time)  │   │ (Jina)  │   │  baseline)    │   │ reverse │   │ (glossary    │   │ slice │   │ build +    │
└─────────────┘   └─────────┘   └───────────────┘   └─────────┘   │  substitute) │   │ refactor│  │ review/TDD │
                      ▲                                │           └──────────────┘   └───────┘   └────────────┘
                      │                                ▼
                 (phase 2)                          specs/
                re-run scrape
                → diff vs pin
                → repin when ready
```

## 0. Prereqs

- `bun` installed and on `PATH`
- The `specs-engine` repo cloned at `~/Code/specs-engine` (any location works; just use an absolute path when invoking the CLI).
- Optional: `JINA_API_KEY` exported in your shell for higher Jina rate limits.

Run the CLI by full path:

```bash
bun ~/Code/specs-engine/packages/cli/src/index.ts <subcommand> [args]
```

Alias it if you prefer: `alias specs='bun ~/Code/specs-engine/packages/cli/src/index.ts'`. The rest of this doc uses `specs` for brevity.

## 1. Initialize a target (one-time per product)

```bash
cd ~/Code
specs init acme https://acme.example.com/
```

Creates:

```
~/Code/acme-project/        # normal project repo: specs/ + src/ + config + submodule pointer
  .specs-engine.yaml        # pre-filled; edit before first scrape
  .gitignore                # .idea/ thoughts/ .env
  .gitmodules               # points at ../acme-scrape (relative URL)
  specs/                    # empty; will be populated by docs-reverse
  src/                      # empty; will be populated by ralph build
~/Code/acme-scrape/         # pristine; crawler-only writes
  .gitignore
  README.md
```

Sibling layout on disk. The scrape repo is registered as a git submodule of the project repo with the relative URL `../acme-scrape`, so re-cloning the project alongside the scrape Just Works.

## 2. Tune the crawl config

Open `~/Code/acme-project/.specs-engine.yaml`. The `init` defaults set `follow: ["<origin>/**"]` from the first start URL. For multi-host crawls (e.g. marketing + docs subdomain) add each host to both `start` and `follow`:

```yaml
crawl:
  start:
    - https://acme.example.com/
    - https://docs.acme.example.com/
  follow:
    - "https://acme.example.com/**"
    - "https://docs.acme.example.com/**"
  ignore:
    - "**/blog/**"
    - "**/careers/**"
    - "**/legal/**"
  max_depth: 4
  max_pages: 500
  rate_limit_ms: 500
```

For a cautious first run, drop `max_pages` to 10 or 50, inspect the output, then raise to 500 and re-scrape.

See [`config-schema.md`](./config-schema.md) for every field.

## 3. First scrape

```bash
cd ~/Code/acme-project
specs scrape
```

For each URL: canonicalize, check dedup, sleep `rate_limit_ms`, fetch via Jina Reader, strip Jina's header block into YAML frontmatter, write to `<host>/<path>.md` in the scrape repo, extract markdown links for the frontier. Commits if the working tree changed.

Output line per URL:

```
  OK   https://acme.example.com/docs/api -> acme.example.com/docs/api.md
  ERR  https://acme.example.com/asset.zip: HTTP 422
scrape: committed <sha> — scrape: <n ok>, <n err>, <n dispatched>
```

Failed URLs are recorded in `_meta.json` with `status: error` and the HTTP status; batch continues.

## 4. Pin the baseline

```bash
specs repin
```

Bumps the project repo's submodule pointer to the current scrape HEAD and commits `repin: <short-sha>`. This is the baseline for phase-2 diffs — everything "what's new since I last built" is measured from this pin.

**Discipline:** never auto-bump. Pin only when you've decided "this scrape snapshot is what I'm generating specs from." Scrape runs advance `<target>-scrape` freely; the pointer moves only on `repin`.

`specs status` tells you where you are:

```
pinned: e691faba503d77d235d4c66d326118a58003ac01
HEAD:   e691faba503d77d235d4c66d326118a58003ac01
changed: 0
```

## 5. Generate claimed specs (docs-reverse)

Two paths depending on which model you want to use:

### Path A — Anthropic (Claude via CC / ralph loop.sh)

```bash
cd ~/Code/acme-project
~/Code/ralph-loop-pack/.ralph/loop.sh docs-reverse 5
```

Uses `ralph-loop-pack/.ralph/prompts/anthropic/docs-reverse.md`. Runs in CC with Anthropic API.

### Path B — OpenRouter (DeepSeek, Gemini, Llama, etc.)

```bash
cd ~/Code/acme-project
specs agent docs-reverse --model deepseek/deepseek-r1-0528 --max-iterations 5
```

Uses `ralph-loop-pack/.ralph/prompts/deepseek/docs-reverse.md` (auto-resolved by model prefix). Requires `OPENROUTER_API_KEY` in env.

### Model recommendations

| Task | Model | Path |
|------|-------|------|
| docs-reverse (reasoning-heavy) | `deepseek/deepseek-r1-0528` | Path B |
| review | `deepseek/deepseek-r1-0528` | Path B |
| build (code gen) | `deepseek/deepseek-v3-2` | Path B |
| docs-reverse (Anthropic) | Claude (via CC default) | Path A |

Note: `deepseek/deepseek-chat` and `deepseek/deepseek-reasoner` are obsolete OpenRouter model IDs. Use `deepseek-r1-0528` (reasoning) and `deepseek-v3-2` (code gen) instead.

The prompt's job: read `<target>-scrape/` as declared product behavior and write claim-based specs into `<target>-project/specs/`.

## 6. De-brand

```bash
specs debrand                 # deterministic glossary substitution only
specs debrand --polish        # + LLM cleanup pass (Sonnet 4.6)
```

Walks `specs/**/*.md`, replaces glossary terms with word-boundary regex, longest-match-first. In-place: pre-debrand content stays in git history (`git show HEAD^:specs/...`).

Glossary lives in `.specs-engine.yaml`:

```yaml
debrand:
  glossary:
    Acme: Projectify
    "Acme's": "Projectify's"
    widget: item
    widgets: items
  polish: false
```

`--polish` sends each file through Claude after substitution to catch paraphrases the glossary missed ("Acme's approach to widgets" becomes "Projectify's approach to items" even if the glossary only defines the nouns).

## 7. Edit / slice / refactor

Manual. Open `specs/`, keep what matters for your product, delete what doesn't, tighten the prose. This is where you impose product decisions — you don't want a full clone, you want the feature subset that makes sense for you.

## 8. Build

```bash
cd ~/Code/acme-project
~/Code/ralph-loop-pack/.ralph/loop.sh build
```

Ralph reads `specs/`, generates `src/`, iterates. `review` mode validates. Outside the scope of specs-engine.

---

## Phase 2: incremental update

When the source product ships new features:

```bash
cd ~/Code/acme-project
specs scrape                  # re-crawl; commits in scrape repo advance
specs status                  # see how many pages changed since the pinned SHA
specs diff                    # page-level diff from pin → HEAD
```

If changes are substantive and you want to spec them:

```bash
specs repin                   # move the baseline forward
# → re-run docs-reverse against the new scrape-repo HEAD
# → review new specs/ entries
# → specs debrand
# → ralph build / review
```

`specs diff` is the key signal. If it's empty, nothing to do. If it lists a handful of changed pages, those are your candidates for new-feature specs.

## Common patterns

### Ship a glossary update without re-scraping

`specs debrand` re-reads `.specs-engine.yaml` every run. Update the glossary, re-run. Idempotent: if nothing changes, no commit.

### Check what changed without bumping the pin

```bash
specs diff --stat     # page-level summary
specs diff            # full diff
```

### Start over on a target

```bash
rm -rf ~/Code/acme-project ~/Code/acme-scrape
specs init acme https://acme.example.com/
```

No state lives outside those two directories.

### Scrape more URLs than `max_pages`

Raise `max_pages`. No other config changes needed.

### Scrape succeeded but one URL errored

Normal. `_meta.json` records the error (`status: error`, `httpStatus`, `reason`). The rest of the batch committed. Either fix your `follow` patterns to exclude that URL, or leave it — the scraper won't retry automatically but will try again on the next `specs scrape`.
