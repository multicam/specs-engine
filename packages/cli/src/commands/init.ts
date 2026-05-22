import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileExists } from "../fs-util.ts";

export interface InitOptions {
  /** Target slug, e.g. `linear`. */
  target: string;
  /** Bootstrap start URL. Origin is reused for default follow patterns. */
  startUrl: string;
  /**
   * Parent dir under which we create `<target>-project/` and `<target>-scrape/`
   * as siblings. Defaults to the current process cwd.
   *
   * When omitted, init refuses to scaffold inside an existing git work tree
   * (the sibling layout breaks if `<target>-project/` lands nested in another
   * repo). Passing this explicitly — either via tests or the `-C` CLI flag —
   * acknowledges the location and skips the guard.
   */
  cwd?: string;
}

export interface InitResult {
  projectDir: string;
  scrapeDir: string;
  configPath: string;
  gitmodulesPath: string;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}:\n${result.stderr || result.stdout}`,
    );
  }
}

/**
 * `git commit` with a stable identity baked in. Used during init so the
 * scaffold is reproducible regardless of the user's global git config (CI,
 * fresh boxes, etc).
 */
function gitCommit(cwd: string, message: string): void {
  git(cwd, [
    "-c",
    "user.email=specs-engine@local",
    "-c",
    "user.name=specs-engine",
    "commit",
    "-q",
    "-m",
    message,
  ]);
}

/**
 * Default `.gitignore` written into both the project repo and the scrape repo
 * on init. Covers IDE metadata, the HumanLayer thoughts convention, and local
 * `.env` files so secrets never get tracked.
 */
const DEFAULT_GITIGNORE = `.idea/
thoughts/
.env
`;

/**
 * Build the default `.specs-engine.yaml` body for a fresh target. Origin is
 * derived from the start URL; follow defaults to `<origin>/**`. Glossary keeps
 * the human-readable target name to seed de-brand work.
 */
export function defaultConfigYaml(target: string, startUrl: string): string {
  const url = new URL(startUrl);
  const origin = url.origin;
  // Normalize trailing slash on the start URL itself for the default seed.
  const seed = startUrl.endsWith("/") || url.pathname !== "/" ? startUrl : `${origin}/`;
  const human = target.charAt(0).toUpperCase() + target.slice(1);
  return `target: ${target}
scrape_repo: ../${target}-scrape

crawl:
  start:
    - ${seed}
  follow:
    - "${origin}/**"
  ignore:
    - "**/blog/**"
    - "**/careers/**"
    - "**/legal/**"
  max_depth: 4
  max_pages: 500
  rate_limit_ms: 500

jina:
  base_url: https://r.jina.ai
  api_key_env: JINA_API_KEY
  timeout_ms: 30000

debrand:
  glossary:
    ${human}: Projectify
  polish: false

agent:
  ralph_pack: ~/Code/ralph-loop-pack

# LLM routing — single source of truth for which model each task uses.
# Per-call --model on the CLI overrides these defaults.
llm:
  defaults:
    agent: openrouter/anthropic/claude-sonnet-4-5
    polish: anthropic/claude-sonnet-4-5
  agent:
    max_iterations: 5
  polish:
    max_tokens: 8000
    concurrency: 6        # parallel polish calls (1 = serial; bump on subscription billing)
  # budgets:        # optional per-tier overrides; defaults live in agent/budgets.ts
  #   strong: { readBudget: 8, exploreBudget: 6, stepsPerRound: 12 }
  #   weak:   { readBudget: 4, exploreBudget: 3, stepsPerRound: 6 }
`;
}

/**
 * Scaffold a per-target layout:
 *   <cwd>/<target>-project/    git repo, contains .specs-engine.yaml + submodule
 *   <cwd>/<target>-scrape/     git repo, will receive scraped markdown
 *
 * The scrape repo is registered as a submodule with the *relative* URL
 * `../<target>-scrape` so that re-cloning the project alongside the scrape
 * repo Just Works.
 */
export async function runInit(opts: InitOptions): Promise<InitResult> {
  const explicitCwd = opts.cwd !== undefined;
  const cwd = resolve(opts.cwd ?? process.cwd());

  // Guard: scaffolding inside an existing git work tree produces a confusing
  // nested layout (the sibling assumption breaks). Refuse unless the caller
  // explicitly opted in via `cwd` / `-C`.
  if (!explicitCwd) {
    const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
    });
    if (probe.status === 0) {
      const repoRoot = probe.stdout.trim();
      throw new Error(
        `init: refusing to scaffold inside existing git repo '${repoRoot}'.\n` +
          `       cd to its parent directory, or pass -C <dir> to override.`,
      );
    }
  }

  if (!/^[a-z0-9][a-z0-9-]*$/i.test(opts.target)) {
    throw new Error(
      `init: invalid target slug '${opts.target}'. Use [a-zA-Z0-9-], starting with alphanumeric.`,
    );
  }
  // Validate URL early so we fail before mutating the filesystem.
  // eslint-disable-next-line no-new
  new URL(opts.startUrl);

  const projectDir = join(cwd, `${opts.target}-project`);
  const scrapeDir = join(cwd, `${opts.target}-scrape`);

  if (await fileExists(projectDir)) {
    throw new Error(`init: ${projectDir} already exists`);
  }
  if (await fileExists(scrapeDir)) {
    throw new Error(`init: ${scrapeDir} already exists`);
  }

  // 1. Create + git-init the scrape repo first; submodule add requires it to exist.
  await mkdir(scrapeDir, { recursive: true });
  git(scrapeDir, ["init", "-q", "-b", "main"]);
  // Empty repo can't be added as submodule; commit README + .gitignore.
  await writeFile(
    join(scrapeDir, "README.md"),
    `# ${opts.target}-scrape\n\nPristine scrape output for target \`${opts.target}\`.\nManaged by specs-engine. Do not edit by hand.\n`,
  );
  await writeFile(join(scrapeDir, ".gitignore"), DEFAULT_GITIGNORE);
  git(scrapeDir, ["add", "README.md", ".gitignore"]);
  gitCommit(scrapeDir, "init scrape repo");

  // 2. Create + git-init the project repo.
  await mkdir(projectDir, { recursive: true });
  await mkdir(join(projectDir, "specs"), { recursive: true });
  await mkdir(join(projectDir, "src"), { recursive: true });
  git(projectDir, ["init", "-q", "-b", "main"]);

  const configPath = join(projectDir, ".specs-engine.yaml");
  await writeFile(configPath, defaultConfigYaml(opts.target, opts.startUrl));
  await writeFile(join(projectDir, ".gitignore"), DEFAULT_GITIGNORE);

  // 3. Register scrape repo as submodule with relative URL. Modern git
  // refuses `file://` and bare-path transports by default; we pass the
  // override on this invocation (and the submodule child processes inherit
  // it via `-c`, unlike a `git config` write that only affects later procs).
  git(projectDir, [
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "-q",
    `../${opts.target}-scrape`,
    `${opts.target}-scrape`,
  ]);

  const gitmodulesPath = join(projectDir, ".gitmodules");

  // 4. Initial project commit so the submodule pointer is recorded.
  git(projectDir, ["add", "-A"]);
  gitCommit(projectDir, `init: ${opts.target} project + ${opts.target}-scrape submodule`);

  return { projectDir, scrapeDir, configPath, gitmodulesPath };
}
