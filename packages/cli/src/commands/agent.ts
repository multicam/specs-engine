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
import { loadConfig, resolveScrapeMount } from "../config.ts";
import { resolvePrompt } from "../agent/prompt.ts";
import { createAgentModel } from "../agent/client.ts";
import { resolveLLM } from "../agent/resolve.ts";
import { getBudgets } from "../agent/budgets.ts";
import { createTools, ToolState } from "../agent/tools.ts";
import {
  computeCoverage,
  extractCitedSources,
  type SpecRef,
} from "../agent/coverage.ts";
import { runAgentLoop } from "../agent/loop.ts";
import { probeToolCalling } from "../agent/probe.ts";
import { modelSlug } from "../agent/slug.ts";
import { fileExists } from "../fs-util.ts";
import { Glob } from "bun";

export interface AgentOptions {
  cwd: string;
  /** Mode name, e.g. "docs-reverse". */
  mode: string;
  /**
   * Provider-prefixed model id, e.g. `openrouter/anthropic/claude-sonnet-4-5`.
   * Optional — falls back to `llm.defaults.agent` from `.specs-engine.yaml`.
   */
  model?: string;
  /**
   * Max agent iterations. Optional — falls back to `llm.agent.max_iterations`
   * from config (default 5).
   */
  maxIterations?: number;
  /** Optional explicit prompt file path. */
  promptOverride?: string;
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
  /**
   * Spec directory the model writes to and is scored against. Per-run dirs
   * (`specs/.runs/<provider>--<model>`) keep parallel runs from colliding;
   * coverage is scored relative to this directory, NOT the canonical specs/.
   */
  specsDirRel: string,
  /** Max read_file calls per round, derived from the model tier. */
  readBudget: number = 4,
): Promise<string> {
  const scrapeDir = join(cwd, mount);
  const specsDir = join(cwd, specsDirRel);

  const scrapedFiles = await scanDir(scrapeDir);
  const existingSpecPaths = await scanDir(specsDir);

  // Read each spec body so we can parse its `## Source pages` block. This
  // catches the dedup leak where the agent invents variant filenames for the
  // same source pages.
  const existingSpecs: SpecRef[] = await Promise.all(
    existingSpecPaths.map(async (p) => {
      const body = await Bun.file(join(specsDir, p)).text().catch(() => "");
      return { path: p, citedSources: extractCitedSources(body) };
    }),
  );
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
    lines.push(existingSpecs.map((s) => `${specsDirRel}/${s.path}`).join(", "));
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
    `2. Read at most ${readBudget} pages with read_file("${mount}/..."). Do NOT read more than ${readBudget}.`,
  );
  lines.push(
    `3. Write exactly ONE spec file with write_file("${specsDirRel}/<area>/<topic>.md").`,
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

  // Resolve model + provider + api-key in one shot (CLI flag > config default).
  const llm = resolveLLM({
    config,
    task: "agent",
    ...(opts.model ? { modelOverride: opts.model } : {}),
  });
  if (!llm.ok) {
    process.stderr.write(`agent: ${llm.error}`);
    return llm.exitCode;
  }
  const { resolved } = llm;
  const effectiveModelId = resolved.modelId;
  const maxIterations =
    opts.maxIterations ?? config.llm.agent.max_iterations;

  // Resolve prompt
  process.stderr.write(
    `agent: resolving prompt for mode '${opts.mode}' (model: ${effectiveModelId})\n`,
  );
  let resolvedPrompt;
  try {
    resolvedPrompt = await resolvePrompt({
      ralphPackPath: ralphPackPath
        ? ralphPackPath.replace(/^~/, process.env.HOME ?? "~")
        : "",
      mode: opts.mode,
      modelId: effectiveModelId,
      promptDirs: resolved.provider.promptDirs,
      ...(opts.promptOverride ? { promptOverride: opts.promptOverride } : {}),
    });
  } catch (err) {
    process.stderr.write(`agent: ${(err as Error).message}\n`);
    return 1;
  }
  process.stderr.write(`agent: using prompt from ${resolvedPrompt.path}\n`);

  // Create model + tools with shared state for read budget + write tracking.
  const model = createAgentModel({
    provider: resolved.provider,
    modelName: resolved.modelName,
    env: llm.env,
  });
  // Budget values are tier-dependent (strong: frontier APIs, weak: Ollama).
  // `llm.budgets.<tier>` in .specs-engine.yaml may override per-field.
  const { readBudget, exploreBudget, stepsPerRound } = getBudgets(
    resolved.tier,
    config.llm.budgets,
  );
  const state = new ToolState(readBudget, exploreBudget);
  // Each run lands under specs/.runs/<provider>--<model-slug>/ so concurrent
  // models can produce side-by-side specs without collision.
  const runSlug = modelSlug(resolved.provider.prefix, resolved.modelName);
  const runDir = `specs/.runs/${runSlug}`;
  const tools = createTools(cwd, state, runDir);

  const mount = resolveScrapeMount(config);

  process.stderr.write(
    `agent: writing to ${runDir}/\n`,
  );

  // Warn when the user picks an Ollama model that's not on the curated list;
  // the probe is still the source of truth, this is just a heads-up.
  if (
    resolved.provider.knownGoodModels &&
    !resolved.provider.knownGoodModels.includes(resolved.modelName)
  ) {
    process.stderr.write(
      `agent: '${resolved.modelName}' is outside the known-good model list for ` +
        `${resolved.provider.prefix}; expect possible tool-call flakiness.\n`,
    );
  }

  // Pre-flight tool-call probe — also warms the model on Ollama.
  process.stderr.write(`agent: pre-flight tool-call probe...\n`);
  const probe = await probeToolCalling({
    model,
    tools,
    modelId: effectiveModelId,
    ...(resolved.provider.knownGoodModels
      ? { knownGoodModels: resolved.provider.knownGoodModels }
      : {}),
  });
  if (!probe.ok) {
    process.stderr.write(`${probe.diagnostic}\n`);
    return 2; // distinct exit code from "config error" (1)
  }
  process.stderr.write(`agent: probe ok (${probe.toolCallCount} tool call(s))\n`);

  process.stderr.write(
    `agent: starting loop (model: ${effectiveModelId}, max rounds: ${maxIterations})\n`,
  );

  const result = await runAgentLoop({
    model,
    systemPrompt: resolvedPrompt.body,
    buildMessage: () => buildInitialMessage(cwd, mount, runDir, readBudget),
    tools,
    state,
    maxRounds: maxIterations,
    stepsPerRound,
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
