import { resolve, basename } from "node:path";
import { access } from "node:fs/promises";
import { loadConfig } from "../config.ts";
import {
  getPinnedSha,
  getScrapeHeadSha,
  changedFilesSincePin,
} from "../git/submodule.ts";

export interface StatusOptions {
  cwd: string;
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
 * `specs status` — print pinned SHA, scrape HEAD, and the count of pages
 * changed since the pin. Output is plain key:value lines (greppable).
 *
 * Returns 0 unless config/scrape repo is missing (then 1).
 */
export async function runStatus(opts: StatusOptions): Promise<number> {
  const cwd = resolve(opts.cwd);
  const configPath = `${cwd}/.specs-engine.yaml`;
  if (!(await fileExists(configPath))) {
    process.stderr.write(`status: ${configPath} not found.\n`);
    return 1;
  }
  const config = await loadConfig(configPath);
  const scrapeRoot = resolve(cwd, config.scrape_repo);
  const submodulePath = basename(scrapeRoot);

  const pinned = getPinnedSha(cwd, submodulePath);
  const head = getScrapeHeadSha(scrapeRoot);
  const changed = changedFilesSincePin(scrapeRoot, pinned);

  process.stdout.write(`pinned: ${pinned ?? "<nil>"}\n`);
  process.stdout.write(`HEAD:   ${head}\n`);
  process.stdout.write(`changed: ${changed.length}\n`);
  return 0;
}
