import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../config.ts";
import { sortGlossary } from "../debrand/glossary.ts";
import { substituteTree } from "../debrand/substitute.ts";
import { polishFiles, type PolishOptions } from "../debrand/polish.ts";
import { fileExists } from "../fs-util.ts";

export interface DebrandOptions {
  cwd: string;
  polish: boolean;
  /** Test seam: stub LLM polish call. */
  polishCall?: PolishOptions["call"];
}

function gitOk(cwd: string, args: string[]): { stdout: string; status: number } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { stdout: r.stdout, status: r.status ?? -1 };
}

/**
 * `specs debrand` — apply the per-project glossary to every `.md` under
 * `<projectDir>/specs/`, then optionally run the LLM polish pass.
 *
 * Substitution is in-place: pre-debrand content lives in git history, so a
 * `git show HEAD^:specs/<file>.md` always recovers the original. The command
 * commits at the end iff anything changed.
 *
 * Idempotent: a second run with no source change is a no-op (no commit).
 */
export async function runDebrand(opts: DebrandOptions): Promise<number> {
  const cwd = resolve(opts.cwd);
  const configPath = join(cwd, ".specs-engine.yaml");
  if (!(await fileExists(configPath))) {
    process.stderr.write(`debrand: ${configPath} not found.\n`);
    return 1;
  }
  const config = await loadConfig(configPath);
  const specsDir = join(cwd, "specs");
  if (!(await fileExists(specsDir))) {
    process.stderr.write(`debrand: ${specsDir} not found. Nothing to debrand.\n`);
    return 0;
  }

  const entries = sortGlossary(config.debrand.glossary);
  const subResult = await substituteTree(specsDir, entries);
  process.stderr.write(
    `debrand: glossary applied to ${subResult.changed.length}/${subResult.scanned} files\n`,
  );

  let polishResult: { polished: string[]; skipped: string[]; reason?: string } = {
    polished: [],
    skipped: [],
  };
  if (opts.polish) {
    polishResult = await polishFiles({
      files: subResult.changed.length > 0 ? subResult.changed : await listSpecsMd(specsDir),
      ...(opts.polishCall ? { call: opts.polishCall } : {}),
    });
    if (polishResult.reason) {
      process.stderr.write(`debrand: polish skipped (${polishResult.reason})\n`);
    } else {
      process.stderr.write(`debrand: polish applied to ${polishResult.polished.length} files\n`);
    }
  }

  // Commit in the project repo if anything changed.
  const status = gitOk(cwd, ["status", "--porcelain"]);
  if (status.status === 0 && status.stdout.trim() !== "") {
    gitOk(cwd, ["add", "specs"]);
    const commit = gitOk(cwd, [
      "-c",
      "user.email=specs-engine@local",
      "-c",
      "user.name=specs-engine",
      "commit",
      "-q",
      "-m",
      opts.polish ? "debrand: glossary + polish" : "debrand: glossary",
    ]);
    if (commit.status !== 0) {
      // Only specs/ changes were intended; if there's nothing under specs/
      // staged this is fine. Don't fail the command.
      process.stderr.write(`debrand: no specs/ changes to commit\n`);
    }
  } else {
    process.stderr.write(`debrand: clean, no commit\n`);
  }
  return 0;
}

async function listSpecsMd(specsDir: string): Promise<string[]> {
  const { readdir, stat: lstat } = await import("node:fs/promises");
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      // Skip dot-prefixed entries (matches substitute.ts; excludes specs/.runs/).
      if (name.startsWith(".")) continue;
      const p = join(dir, name);
      const s = await lstat(p);
      if (s.isDirectory()) await walk(p);
      else if (s.isFile() && name.endsWith(".md")) out.push(p);
    }
  }
  await walk(specsDir);
  return out;
}
