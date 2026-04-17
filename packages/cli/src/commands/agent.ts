/**
 * `specs agent` — lightweight LLM agent runner via OpenRouter.
 *
 * Uses the Vercel AI SDK to run any OpenRouter-available model against the
 * project's scrape repo and specs directory with tool access.
 *
 * Usage:
 *   specs agent docs-reverse --model deepseek/deepseek-chat --max-iterations 5
 */
import { resolve, join } from "node:path";
import { access, readdir } from "node:fs/promises";
import { loadConfig } from "../config.ts";
import { resolvePrompt } from "../agent/prompt.ts";
import { createAgentModel } from "../agent/client.ts";
import { createTools, ToolState } from "../agent/tools.ts";
import { computeCoverage } from "../agent/coverage.ts";
import { runAgentLoop } from "../agent/loop.ts";
import { Glob } from "bun";

export interface AgentOptions {
  cwd: string;
  /** Mode name, e.g. "docs-reverse". */
  mode: string;
  /** OpenRouter model ID, e.g. "deepseek/deepseek-chat". */
  model: string;
  /** Max agent iterations. Default 5. */
  maxIterations: number;
  /** Optional explicit prompt file path. */
  promptOverride?: string;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the initial user message with project pointers (paths, counts, structure).
 * No file content — the model uses its tools to read.
 */
/**
 * Derive the submodule mount path inside the project.
 * Config has `scrape_repo: ../brand-scrape` (sibling); the submodule is mounted
 * as `brand-scrape/` inside the project dir. The basename of the relative path
 * is the mount point.
 */
function submoduleMountName(scrapeRepo: string): string {
  return scrapeRepo.replace(/^\.\.\//, "").replace(/\/$/, "");
}

export async function scanDir(dir: string, pattern = "**/*.md"): Promise<string[]> {
  const files: string[] = [];
  try {
    const g = new Glob(pattern);
    for await (const path of g.scan({ cwd: dir, dot: false })) files.push(path);
  } catch { /* dir may not exist */ }
  return files.sort();
}

export async function buildInitialMessage(
  cwd: string,
  mount: string,
): Promise<string> {
  const scrapeDir = join(cwd, mount);
  const specsDir = join(cwd, "specs");

  const scrapedFiles = await scanDir(scrapeDir);
  const existingSpecs = await scanDir(specsDir);
  const coverage = computeCoverage(scrapedFiles, existingSpecs);

  const lines: string[] = [];

  // Coverage summary — actionable pointers, not raw tree
  lines.push(
    `## Coverage: ${coverage.coveredPages.length}/${coverage.totalPages} scraped pages covered ` +
    `(${existingSpecs.length} specs written)`,
  );

  if (coverage.areaStats.length > 0) {
    lines.push(`\n### Specs per area (bias check)`);
    for (const s of coverage.areaStats) {
      const marker = coverage.underrepresentedAreas.includes(s.area) ? " ← underrepresented" : "";
      lines.push(`- ${s.area}: ${s.specCount}${marker}`);
    }
  }

  // Uncovered pages — the action list
  if (coverage.uncoveredPages.length === 0) {
    lines.push(`\n### Uncovered pages: NONE — every scraped page has a matching spec.`);
  } else {
    lines.push(`\n### Uncovered pages (${coverage.uncoveredPages.length}) — pick ONE`);
    lines.push("```");
    for (const p of coverage.uncoveredPages) lines.push(`${mount}/${p}`);
    lines.push("```");
  }

  // Existing specs list (compact)
  if (existingSpecs.length > 0) {
    lines.push(`\n### Already written`);
    lines.push(existingSpecs.map((f) => `specs/${f}`).join(", "));
  }

  // Instructions with priority + completion rules
  lines.push("\n## Your task this round");
  if (coverage.suggestComplete) {
    lines.push(
      `**Coverage is near complete** (≤ ${coverage.uncoveredPages.length} uncovered). ` +
      `If the remaining pages are marketing noise or duplicates, respond with exactly: ALL_TOPICS_COVERED`,
    );
    lines.push(`Otherwise, pick one and write a spec.`);
  } else {
    const priorityHint =
      coverage.underrepresentedAreas.length > 0
        ? `PRIORITIZE these under-covered areas first: ${coverage.underrepresentedAreas.join(", ")}. `
        : "";
    lines.push(
      `1. Pick ONE uncovered page from the list above. ${priorityHint}` +
      `Avoid over-covered areas.`,
    );
  }
  lines.push(
    `2. Read at most 4 pages with read_file("${mount}/..."). Do NOT read more than 4.`,
  );
  lines.push(
    `3. Write exactly ONE spec file with write_file("specs/<area>/<topic>.md").`,
  );
  lines.push(
    `4. You MUST call write_file before finishing. A round without a write is a failure.`,
  );
  lines.push(
    `5. If ALL major product topics are already covered, respond with exactly: ALL_TOPICS_COVERED`,
  );

  return lines.join("\n");
}

export async function runAgent(opts: AgentOptions): Promise<number> {
  const cwd = resolve(opts.cwd);
  const configPath = join(cwd, ".specs-engine.yaml");

  if (!(await fileExists(configPath))) {
    process.stderr.write(
      `agent: ${configPath} not found. Run inside a <target>-project/ directory.\n`,
    );
    return 1;
  }

  const config = await loadConfig(configPath);

  // Resolve ralph-loop-pack path from config
  const ralphPackPath = config.agent?.ralph_pack;
  if (!ralphPackPath && !opts.promptOverride) {
    process.stderr.write(
      `agent: agent.ralph_pack not set in .specs-engine.yaml and no --prompt override provided.\n` +
        `Add:\n  agent:\n    ralph_pack: ~/Code/ralph-loop-pack\n`,
    );
    return 1;
  }

  // Resolve API key
  const apiKeyEnv = config.agent?.openrouter_api_key_env ?? "OPENROUTER_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    process.stderr.write(
      `agent: ${apiKeyEnv} environment variable is not set.\n`,
    );
    return 1;
  }

  // Resolve prompt
  process.stderr.write(`agent: resolving prompt for mode '${opts.mode}' (model: ${opts.model})\n`);
  let resolvedPrompt;
  try {
    resolvedPrompt = await resolvePrompt({
      ralphPackPath: ralphPackPath
        ? ralphPackPath.replace(/^~/, process.env.HOME ?? "~")
        : "",
      mode: opts.mode,
      modelId: opts.model,
      promptOverride: opts.promptOverride,
    });
  } catch (err) {
    process.stderr.write(`agent: ${(err as Error).message}\n`);
    return 1;
  }
  process.stderr.write(`agent: using prompt from ${resolvedPrompt.path}\n`);

  // Create model + tools with shared state for read budget + write tracking
  const model = createAgentModel({ apiKey, modelId: opts.model });
  const state = new ToolState(4); // 4 reads per round
  const tools = createTools(cwd, state);

  const mount = submoduleMountName(config.scrape_repo);

  process.stderr.write(
    `agent: starting loop (model: ${opts.model}, max rounds: ${opts.maxIterations})\n`,
  );

  const result = await runAgentLoop({
    model,
    systemPrompt: resolvedPrompt.body,
    buildMessage: () => buildInitialMessage(cwd, mount),
    tools,
    state,
    maxRounds: opts.maxIterations,
    stepsPerRound: 8,
    onStepFinish: ({ round, stepNumber, toolCalls }) => {
      process.stderr.write(
        `  [round ${round}] step ${stepNumber + 1}: ${toolCalls} tool call(s)\n`,
      );
    },
    onRoundFinish: ({ round, steps, wroteSpec, done }) => {
      const status = done
        ? "ALL TOPICS COVERED"
        : wroteSpec
          ? "spec written"
          : "no spec written (stall)";
      process.stderr.write(
        `  round ${round}: ${steps} steps — ${status}\n`,
      );
    },
  });

  process.stderr.write(
    `\nagent: ${result.rounds} round(s), ${result.totalSteps} total steps, ` +
      `${result.specsWritten.length} spec(s) written\n`,
  );
  if (result.specsWritten.length > 0) {
    process.stderr.write(`  specs: ${result.specsWritten.join(", ")}\n`);
  }
  if (result.allTopicsCovered) {
    process.stderr.write(`  coverage: all major topics covered\n`);
  }

  return 0;
}
