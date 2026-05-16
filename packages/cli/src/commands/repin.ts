import { resolve, basename } from "node:path";
import { loadConfig } from "../config.ts";
import { repin } from "../git/submodule.ts";
import { fileExists } from "../fs-util.ts";

export interface RepinOptions {
  cwd: string;
}

/**
 * `specs repin` — bump the project's submodule pointer to the scrape repo's
 * current HEAD and create a `repin: <short-sha>` commit in the project.
 *
 * No-op (with a friendly note) when the pin is already at HEAD; this keeps
 * `specs repin && specs repin` from creating empty commits.
 */
export async function runRepin(opts: RepinOptions): Promise<number> {
  const cwd = resolve(opts.cwd);
  const configPath = `${cwd}/.specs-engine.yaml`;
  if (!(await fileExists(configPath))) {
    process.stderr.write(`repin: ${configPath} not found.\n`);
    return 1;
  }
  const config = await loadConfig(configPath);
  const scrapeRoot = resolve(cwd, config.scrape_repo);
  const submodulePath = basename(scrapeRoot);

  const result = repin(cwd, submodulePath, scrapeRoot);
  if (result.changed) {
    process.stdout.write(`repinned to ${result.sha.slice(0, 7)}\n`);
  } else {
    process.stdout.write(`already at ${result.sha.slice(0, 7)}; nothing to do\n`);
  }
  return 0;
}
