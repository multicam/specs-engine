#!/usr/bin/env bun
/**
 * `specs` — CLI dispatcher.
 *
 * Subcommands are wired here and delegate to `src/commands/*`. Keep this file
 * argument-parsing only; behavior lives in command modules so it stays
 * testable without spawning a process.
 */
import { runInit } from "./commands/init.ts";
import { runScrape } from "./commands/scrape.ts";
import { runStatus } from "./commands/status.ts";
import { runDiff } from "./commands/diff.ts";
import { runRepin } from "./commands/repin.ts";
import { runDebrand } from "./commands/debrand.ts";
import { runAgent } from "./commands/agent.ts";

const HELP = `specs — competitive docs scraper

Usage:
  specs init <target> <start-url>   Scaffold project + sibling scrape repo + submodule
  specs scrape                       Crawl via patterns, fetch via Jina, commit if dirty
  specs status                       Pinned SHA, current HEAD, changed pages since pin
  specs diff [--stat]                Page-level diff since pinned SHA
  specs repin                        Bump submodule to scrape HEAD; commit in project
  specs debrand [--polish]           Apply glossary to specs/, optional LLM polish
  specs agent <mode> [options]       Run LLM agent via OpenRouter with tool access

Agent options:
  --model <id>              OpenRouter model ID (required)
  --max-iterations <n>      Max agent steps (default: 5)
  --prompt <path>           Override prompt file (optional)

Run inside a <target>-project/ directory (containing .specs-engine.yaml),
except for 'init' which creates one.
`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  switch (cmd) {
    case "init": {
      const [target, startUrl] = rest;
      if (!target || !startUrl) {
        process.stderr.write("init: usage: specs init <target> <start-url>\n");
        return 2;
      }
      const r = await runInit({ target, startUrl });
      process.stdout.write(
        `initialized:\n  project: ${r.projectDir}\n  scrape:  ${r.scrapeDir}\n  config:  ${r.configPath}\n`,
      );
      return 0;
    }
    case "scrape":
      return runScrape({ cwd: process.cwd() });
    case "status":
      return runStatus({ cwd: process.cwd() });
    case "diff":
      return runDiff({ cwd: process.cwd(), stat: rest.includes("--stat") });
    case "repin":
      return runRepin({ cwd: process.cwd() });
    case "debrand":
      return runDebrand({ cwd: process.cwd(), polish: rest.includes("--polish") });
    case "agent": {
      const mode = rest[0];
      if (!mode || mode.startsWith("--")) {
        process.stderr.write(
          "agent: usage: specs agent <mode> --model <model-id> [--max-iterations <n>] [--prompt <path>]\n",
        );
        return 2;
      }
      const modelIdx = rest.indexOf("--model");
      const model = modelIdx >= 0 ? rest[modelIdx + 1] : undefined;
      if (!model) {
        process.stderr.write("agent: --model is required\n");
        return 2;
      }
      const maxIterIdx = rest.indexOf("--max-iterations");
      const maxIterations =
        maxIterIdx >= 0 ? parseInt(rest[maxIterIdx + 1] ?? "5", 10) : 5;
      const promptIdx = rest.indexOf("--prompt");
      const promptOverride =
        promptIdx >= 0 ? rest[promptIdx + 1] : undefined;
      return runAgent({
        cwd: process.cwd(),
        mode,
        model,
        maxIterations,
        promptOverride,
      });
    }
    default:
      process.stderr.write(`unknown command: ${cmd}\n${HELP}`);
      return 2;
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: Error) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  });
