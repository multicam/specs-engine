/**
 * Submodule helpers under real git, plus end-to-end status/diff/repin against
 * a project + sibling scrape repo built by `runInit`.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.ts";
import { runScrape } from "../src/commands/scrape.ts";
import { runStatus } from "../src/commands/status.ts";
import { runRepin } from "../src/commands/repin.ts";
import {
  getPinnedSha,
  changedFilesSincePin,
  getScrapeHeadSha,
} from "../src/git/submodule.ts";
import type { JinaClient, JinaResult } from "../src/crawler/jina.ts";

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

interface Setup {
  cwd: string;
  projectDir: string;
  scrapeDir: string;
}

async function freshProject(): Promise<Setup> {
  const cwd = await mkdtemp(join(tmpdir(), "submodule-test-"));
  const r = await runInit({ target: "acme", startUrl: "https://example.com", cwd });
  // Replace the auto-generated config to use rate-limit 0 + tighter follow.
  await writeFile(
    r.configPath,
    `target: acme
scrape_repo: ../acme-scrape
scrape_mount: scrape
crawl:
  start: [https://example.com/]
  follow: ["https://example.com/**"]
  ignore: []
  max_depth: 2
  max_pages: 10
  rate_limit_ms: 0
debrand:
  glossary: {}
`,
  );
  return { cwd, projectDir: r.projectDir, scrapeDir: r.scrapeDir };
}

function fakeJina(version: string): () => JinaClient {
  return () => ({
    async fetchMarkdown(url: string): Promise<JinaResult> {
      if (url === "https://example.com/") {
        return {
          status: "ok",
          title: "Home",
          urlSource: url,
          body: `# Home — ${version}\n[docs](/docs)\n`,
        };
      }
      if (url === "https://example.com/docs") {
        return { status: "ok", title: "Docs", urlSource: url, body: `# Docs — ${version}\n` };
      }
      return { status: "error", reason: "404", httpStatus: 404 };
    },
  });
}

let s: Setup;

beforeEach(async () => {
  s = await freshProject();
});

/** Run a deterministic scrape against the test setup. */
function scrape(version = "v1"): Promise<number> {
  return runScrape({
    cwd: s.projectDir,
    noRateLimit: true,
    jinaFactory: fakeJina(version),
    now: () => new Date("2026-04-16T12:00:00Z"),
  });
}

describe("submodule helpers", () => {
  test("getPinnedSha returns the SHA recorded at the submodule path", () => {
    const sha = getPinnedSha(s.projectDir, "scrape");
    // After init, the scrape repo has one commit; the project pins it.
    const scrapeHead = getScrapeHeadSha(s.scrapeDir);
    expect(sha).toBe(scrapeHead);
  });

  test("changedFilesSincePin walks scrape commits between pin and HEAD", async () => {
    const before = git(s.scrapeDir, ["rev-parse", "HEAD"]);

    // Create a new commit in the scrape repo by hand.
    await writeFile(join(s.scrapeDir, "newpage.md"), "hello\n");
    git(s.scrapeDir, ["add", "-A"]);
    git(s.scrapeDir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "add newpage"]);

    const changed = changedFilesSincePin(s.scrapeDir, before);
    expect(changed).toContain("newpage.md");
  });

  test("changedFilesSincePin with null pin returns whole tree", () => {
    const all = changedFilesSincePin(s.scrapeDir, null);
    // The init commit dropped a README.md
    expect(all).toContain("README.md");
  });
});

describe("status / repin / diff", () => {
  test("after init: pinned == HEAD, changed = 0", async () => {
    const out = captureStdout(() => runStatus({ cwd: s.projectDir }));
    const text = await out;
    expect(text).toMatch(/pinned: [0-9a-f]{40}/);
    expect(text).toMatch(/HEAD:\s+[0-9a-f]{40}/);
    expect(text).toMatch(/changed: 0/);
  });

  test("after scrape: HEAD advances; pinned stays; changed > 0", async () => {
    await scrape();
    const text = await captureStdout(() => runStatus({ cwd: s.projectDir }));
    const lines = text.split("\n");
    const pinned = lines.find((l) => l.startsWith("pinned:"))!.slice(8).trim();
    const head = lines.find((l) => l.startsWith("HEAD:"))!.slice(5).trim();
    const changed = parseInt(lines.find((l) => l.startsWith("changed:"))!.slice(8).trim(), 10);
    expect(pinned).not.toBe(head);
    expect(changed).toBeGreaterThan(0);
  });

  test("after repin: pinned == HEAD, changed = 0; project log gains repin commit", async () => {
    await scrape();
    const before = git(s.projectDir, ["log", "--oneline"]).split("\n").length;
    const code = await runRepin({ cwd: s.projectDir });
    expect(code).toBe(0);
    const after = git(s.projectDir, ["log", "--oneline"]).split("\n");
    expect(after.length).toBe(before + 1);
    expect(after[0]).toMatch(/repin: [0-9a-f]{7}/);

    const text = await captureStdout(() => runStatus({ cwd: s.projectDir }));
    const pinned = text.match(/pinned: ([0-9a-f]{40})/)![1];
    const head = text.match(/HEAD:\s+([0-9a-f]{40})/)![1];
    expect(pinned).toBe(head);
    expect(text).toMatch(/changed: 0/);
  });

  test("repin twice in a row: second is a no-op (no extra commit)", async () => {
    await scrape();
    await runRepin({ cwd: s.projectDir });
    const log1 = git(s.projectDir, ["log", "--oneline"]).split("\n").length;
    await runRepin({ cwd: s.projectDir });
    const log2 = git(s.projectDir, ["log", "--oneline"]).split("\n").length;
    expect(log2).toBe(log1);
  });
});

/** Helper: capture stdout writes during an async fn. */
async function captureStdout(fn: () => Promise<unknown>): Promise<string> {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  // Monkey-patch process.stdout.write for the duration of fn().
  (process.stdout.write as unknown) = (chunk: string | Buffer): boolean => {
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = orig;
  }
  return buf;
}
