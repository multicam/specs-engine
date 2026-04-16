/**
 * End-to-end integration test for `specs scrape` against a mocked Jina backend.
 * Spins up a tempdir with the same layout `specs init` creates, then runs
 * the orchestrator with a `jinaFactory` that returns canned responses.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScrape } from "../src/commands/scrape.ts";
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

const CONFIG_YAML = `
target: example
scrape_repo: ../example-scrape
crawl:
  start:
    - https://example.com/
  follow:
    - "https://example.com/**"
  ignore: []
  max_depth: 3
  max_pages: 50
  rate_limit_ms: 0
debrand:
  glossary: {}
`;

async function setup(): Promise<Setup> {
  const cwd = await mkdtemp(join(tmpdir(), "scrape-int-"));
  const projectDir = join(cwd, "example-project");
  const scrapeDir = join(cwd, "example-scrape");
  await mkdir(projectDir, { recursive: true });
  await mkdir(scrapeDir, { recursive: true });
  await writeFile(join(projectDir, ".specs-engine.yaml"), CONFIG_YAML);
  git(scrapeDir, ["init", "-q", "-b", "main"]);
  await writeFile(join(scrapeDir, ".keep"), "");
  git(scrapeDir, ["add", "-A"]);
  git(scrapeDir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  return { cwd, projectDir, scrapeDir };
}

/** Build a JinaClient that serves a tiny canned site. */
function fakeJina(): JinaClient {
  const PAGES: Record<string, { title: string; body: string }> = {
    "https://example.com/": {
      title: "Example Home",
      body: "# Home\n\nWelcome. See [docs](/docs) and [changelog](https://example.com/changelog).\n\n![logo](https://cdn.example/logo.png)\n",
    },
    "https://example.com/docs": {
      title: "Example Docs",
      body: "# Docs\n\nMore at [api](/docs/api).\n",
    },
    "https://example.com/docs/api": {
      title: "Example API",
      body: "# API\n\nSee [webhooks](/docs/api/webhooks).\n",
    },
    "https://example.com/docs/api/webhooks": {
      title: "Example Webhooks",
      body: "# Webhooks\n\nLeaf page.\n",
    },
    "https://example.com/changelog": {
      title: "Example Changelog",
      body: "# Changelog\n\nv1\n",
    },
  };
  return {
    async fetchMarkdown(url: string): Promise<JinaResult> {
      const page = PAGES[url];
      if (!page) {
        return { status: "error", reason: "404", httpStatus: 404 };
      }
      return { status: "ok", title: page.title, urlSource: url, body: page.body };
    },
  };
}

let s: Setup;

beforeEach(async () => {
  s = await setup();
});

/** Run scrape with the test defaults. Override only what each scenario needs. */
function scrape(
  jinaFactory: () => JinaClient = () => fakeJina(),
): Promise<number> {
  return runScrape({
    cwd: s.projectDir,
    noRateLimit: true,
    jinaFactory,
    now: () => new Date("2026-04-16T12:00:00Z"),
  });
}

describe("scrape integration (mock Jina)", () => {
  test("crawls + writes markdown + commits when dirty", async () => {
    const code = await scrape();
    expect(code).toBe(0);

    // Files landed in the scrape repo, namespaced by host.
    const indexPath = join(s.scrapeDir, "example.com/index.md");
    const indexStat = await stat(indexPath);
    expect(indexStat.isFile()).toBe(true);

    const docsPath = join(s.scrapeDir, "example.com/docs.md");
    expect((await stat(docsPath)).isFile()).toBe(true);

    const webhooksPath = join(s.scrapeDir, "example.com/docs/api/webhooks.md");
    expect((await stat(webhooksPath)).isFile()).toBe(true);

    const changelogPath = join(s.scrapeDir, "example.com/changelog.md");
    expect((await stat(changelogPath)).isFile()).toBe(true);

    // Frontmatter is well-formed.
    const indexBody = await readFile(indexPath, "utf8");
    expect(indexBody.startsWith("---\n")).toBe(true);
    expect(indexBody.includes(`url: "https://example.com/"`)).toBe(true);
    expect(indexBody.includes(`title: "Example Home"`)).toBe(true);
    expect(indexBody.includes(`fetched: "2026-04-16T12:00:00.000Z"`)).toBe(true);
    expect(indexBody.includes("# Home")).toBe(true);
    // Image refs preserved as absolute URLs in the body.
    expect(indexBody.includes("https://cdn.example/logo.png")).toBe(true);

    // _meta.json contains an entry per crawled URL.
    const meta = JSON.parse(
      await readFile(join(s.scrapeDir, "_meta.json"), "utf8"),
    ) as Record<string, { status: string }>;
    expect(Object.keys(meta).sort()).toEqual([
      "https://example.com/",
      "https://example.com/changelog",
      "https://example.com/docs",
      "https://example.com/docs/api",
      "https://example.com/docs/api/webhooks",
    ]);

    // A commit was made.
    const log = git(s.scrapeDir, ["log", "--oneline"]);
    expect(log.split("\n").length).toBeGreaterThanOrEqual(2);
    expect(log).toMatch(/scrape: 5 ok, 0 err/);
  });

  test("idempotent: second run with no source change produces no new commit", async () => {
    await scrape();
    const log1 = git(s.scrapeDir, ["log", "--oneline"]).split("\n").length;
    await scrape();
    const log2 = git(s.scrapeDir, ["log", "--oneline"]).split("\n").length;
    expect(log2).toBe(log1);
  });

  test("does not leave the target domain (follow patterns enforced)", async () => {
    // Add an off-domain link to the home page mock.
    const factory = () => {
      const c = fakeJina();
      const original = c.fetchMarkdown.bind(c);
      return {
        async fetchMarkdown(url: string): Promise<JinaResult> {
          const r = await original(url);
          if (r.status === "ok" && url === "https://example.com/") {
            return {
              ...r,
              body: r.body + "\n\n[external](https://other.example/page)\n",
            };
          }
          return r;
        },
      };
    };
    await scrape(factory);
    const meta = JSON.parse(
      await readFile(join(s.scrapeDir, "_meta.json"), "utf8"),
    ) as Record<string, unknown>;
    for (const k of Object.keys(meta)) {
      expect(k.startsWith("https://example.com/")).toBe(true);
    }
    // Did not write off-domain files.
    const top = await readdir(s.scrapeDir);
    expect(top).not.toContain("page.md");
  });

  test("error responses recorded in _meta.json without aborting crawl", async () => {
    const factory = (): JinaClient => ({
      async fetchMarkdown(url: string): Promise<JinaResult> {
        if (url === "https://example.com/") {
          return {
            status: "ok",
            title: "Home",
            urlSource: url,
            body: "# Home\n[broken](/missing)\n",
          };
        }
        return { status: "error", reason: "HTTP 404", httpStatus: 404 };
      },
    });
    const code = await scrape(factory);
    expect(code).toBe(0);
    const meta = JSON.parse(
      await readFile(join(s.scrapeDir, "_meta.json"), "utf8"),
    ) as Record<string, { status: string; httpStatus?: number }>;
    expect(meta["https://example.com/missing"]?.status).toBe("error");
    expect(meta["https://example.com/missing"]?.httpStatus).toBe(404);
  });
});
