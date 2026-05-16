import { resolve, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../config.ts";
import { getPinnedSha } from "../git/submodule.ts";
import { fileExists } from "../fs-util.ts";

export interface DiffOptions {
  cwd: string;
  stat: boolean;
}

/**
 * `specs diff` — show per-page diff between the pinned submodule SHA and
 * the scrape repo's current HEAD. Falls back to "no pin" when the project
 * has never been repinned (just lists the entire current tree as new).
 *
 * `--stat` swaps the unified diff for `git diff --stat` summary output.
 */
export async function runDiff(opts: DiffOptions): Promise<number> {
  const cwd = resolve(opts.cwd);
  const configPath = `${cwd}/.specs-engine.yaml`;
  if (!(await fileExists(configPath))) {
    process.stderr.write(`diff: ${configPath} not found.\n`);
    return 1;
  }
  const config = await loadConfig(configPath);
  const scrapeRoot = resolve(cwd, config.scrape_repo);
  const submodulePath = basename(scrapeRoot);
  const pinned = getPinnedSha(cwd, submodulePath);

  const args = pinned
    ? ["diff", opts.stat ? "--stat" : "--patch", `${pinned}..HEAD`]
    : ["log", opts.stat ? "--stat" : "--patch", "HEAD"];

  const r = spawnSync("git", args, { cwd: scrapeRoot, stdio: "inherit" });
  return r.status ?? 1;
}
