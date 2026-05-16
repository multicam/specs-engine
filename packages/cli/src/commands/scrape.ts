import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { loadConfig, type Config } from "../config.ts";
import { createFrontier } from "../crawler/frontier.ts";
import { canonicalize } from "../crawler/canonical.ts";
import { shouldFollow } from "../crawler/patterns.ts";
import { createRateLimiter } from "../crawler/rate-limit.ts";
import { createJinaClient, type JinaResult } from "../crawler/jina.ts";
import { extractLinks } from "../crawler/link-extract.ts";
import { urlToFilepath, hashBody, buildFrontmatter } from "../git/snapshot.ts";
import { commitIfDirty } from "../git/scrape-repo.ts";
import { fileExists } from "../fs-util.ts";

export interface ScrapeOptions {
  cwd: string;
  /** Test seam: inject a deterministic "now" for snapshot timestamps. */
  now?: () => Date;
  /** Test seam: inject a fetch mock or a per-test Jina client factory. */
  jinaFactory?: (cfg: Config) => ReturnType<typeof createJinaClient>;
  /** Test seam: skip the per-target rate-limit sleep entirely. */
  noRateLimit?: boolean;
}

interface MetaEntry {
  url: string;
  filepath: string;
  hash: string;
  fetched: string;
  status: "ok" | "error";
  reason?: string;
  httpStatus?: number;
}

type Meta = Record<string, MetaEntry>;

/**
 * `specs scrape` orchestrator.
 *
 * Loop:
 *   1. Load config from `<cwd>/.specs-engine.yaml`.
 *   2. Resolve the scrape repo path (config.scrape_repo, relative to cwd).
 *   3. Seed the frontier with `crawl.start`.
 *   4. While frontier non-empty (and under max_pages):
 *        - rate-limit per target host
 *        - fetch via Jina
 *        - on success: write markdown with frontmatter, harvest links
 *        - on error: record in _meta.json, skip
 *   5. Write _meta.json.
 *   6. Commit the scrape repo if dirty.
 *
 * Returns process exit code: 0 if a commit was made or no-op was clean,
 * 1 if any unrecoverable error.
 */
export async function runScrape(opts: ScrapeOptions): Promise<number> {
  const cwd = resolve(opts.cwd);
  const configPath = join(cwd, ".specs-engine.yaml");
  if (!(await fileExists(configPath))) {
    process.stderr.write(`scrape: ${configPath} not found. Run 'specs init' first.\n`);
    return 1;
  }
  const config = await loadConfig(configPath);
  const scrapeRoot = resolve(cwd, config.scrape_repo);
  if (!(await fileExists(scrapeRoot))) {
    process.stderr.write(`scrape: scrape repo not found at ${scrapeRoot}\n`);
    return 1;
  }

  const now = opts.now ?? (() => new Date());
  const jina = opts.jinaFactory
    ? opts.jinaFactory(config)
    : createJinaClient({
        baseUrl: config.jina.base_url,
        apiKeyEnv: config.jina.api_key_env,
        timeoutMs: config.jina.timeout_ms,
      });
  const limiter = createRateLimiter(opts.noRateLimit ? 0 : config.crawl.rate_limit_ms);

  const frontier = createFrontier({
    maxDepth: config.crawl.max_depth,
    maxPages: config.crawl.max_pages,
  });
  for (const start of config.crawl.start) {
    const canon = canonicalize(start);
    if (canon !== null) frontier.enqueue(canon, 0);
  }

  const meta: Meta = {};
  let okCount = 0;
  let errCount = 0;

  for (;;) {
    const item = frontier.take();
    if (!item) break;

    await limiter.wait(item.url);
    const result: JinaResult = await jina.fetchMarkdown(item.url);
    const fetched = now().toISOString();

    if (result.status === "error") {
      errCount++;
      meta[item.url] = {
        url: item.url,
        filepath: "",
        hash: "",
        fetched,
        status: "error",
        reason: result.reason,
        ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
      };
      process.stderr.write(`  ERR  ${item.url}: ${result.reason}\n`);
      continue;
    }

    okCount++;
    const filepath = urlToFilepath(item.url);
    const hash = hashBody(result.body);
    const fm = buildFrontmatter({
      url: item.url,
      title: result.title,
      fetched,
      hash,
    });
    const out = join(scrapeRoot, filepath);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, fm + result.body);
    meta[item.url] = {
      url: item.url,
      filepath,
      hash,
      fetched,
      status: "ok",
    };
    process.stderr.write(`  OK   ${item.url} -> ${filepath}\n`);

    // Harvest links from the body. Use urlSource (when present) as resolution
    // base, falling back to the requested URL.
    const base = result.urlSource || item.url;
    for (const link of extractLinks(result.body, base)) {
      if (shouldFollow(link, config.crawl.follow, config.crawl.ignore)) {
        frontier.enqueue(link, item.depth + 1);
      }
    }
  }

  // Persist _meta.json (sorted by URL for deterministic diffs).
  const metaPath = join(scrapeRoot, "_meta.json");
  let prevMeta: Meta = {};
  if (await fileExists(metaPath)) {
    try {
      prevMeta = JSON.parse(await readFile(metaPath, "utf8")) as Meta;
    } catch {
      // Corrupt _meta.json — treat as empty; will be overwritten.
    }
  }
  const merged: Meta = { ...prevMeta, ...meta };
  const sorted: Meta = {};
  for (const k of Object.keys(merged).sort()) sorted[k] = merged[k]!;
  await writeFile(metaPath, JSON.stringify(sorted, null, 2) + "\n");

  const commitMsg = `scrape: ${okCount} ok, ${errCount} err, ${frontier.takenCount()} dispatched`;
  const sha = commitIfDirty(scrapeRoot, commitMsg);
  if (sha) {
    process.stderr.write(`scrape: committed ${sha.slice(0, 7)} — ${commitMsg}\n`);
  } else {
    process.stderr.write(`scrape: clean, no commit (${commitMsg})\n`);
  }
  return 0;
}
