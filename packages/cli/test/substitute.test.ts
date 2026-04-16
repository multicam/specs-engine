/**
 * substituteTree + runDebrand integration test.
 * Covers in-place rewrite, idempotency, and that pre-debrand content is
 * recoverable from git history.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sortGlossary } from "../src/debrand/glossary.ts";
import { substituteTree } from "../src/debrand/substitute.ts";
import { runDebrand } from "../src/commands/debrand.ts";

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

interface Setup {
  projectDir: string;
}

const CONFIG_YAML = `
target: linear
scrape_repo: ../linear-scrape
crawl:
  start: [https://linear.app/]
  follow: ["https://linear.app/**"]
debrand:
  glossary:
    Linear: Projectify
    "Linear's": "Projectify's"
    issue: item
    issues: items
`;

async function setup(): Promise<Setup> {
  const root = await mkdtemp(join(tmpdir(), "debrand-test-"));
  const projectDir = join(root, "linear-project");
  await mkdir(join(projectDir, "specs"), { recursive: true });
  await writeFile(join(projectDir, ".specs-engine.yaml"), CONFIG_YAML);
  await writeFile(
    join(projectDir, "specs/intro.md"),
    "# Linear basics\n\nLinear's approach to issues is unique.\n",
  );
  await writeFile(
    join(projectDir, "specs/api.md"),
    "# API\n\nList all issues. Each issue has an ID.\nimage: ![diagram](https://cdn.example/x.png)\n",
  );
  git(projectDir, ["init", "-q", "-b", "main"]);
  git(projectDir, ["add", "-A"]);
  git(projectDir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init specs"]);
  return { projectDir };
}

let s: Setup;
beforeEach(async () => {
  s = await setup();
});

describe("substituteTree", () => {
  test("rewrites in place and reports changed files", async () => {
    const entries = sortGlossary({ Linear: "Projectify", issue: "item", issues: "items" });
    const r = await substituteTree(join(s.projectDir, "specs"), entries);
    expect(r.scanned).toBe(2);
    expect(r.changed.length).toBe(2);
    const intro = await readFile(join(s.projectDir, "specs/intro.md"), "utf8");
    expect(intro).toMatch(/Projectify basics/);
    expect(intro).toMatch(/items/);
  });

  test("does not modify image-URL lines", async () => {
    const entries = sortGlossary({ issue: "item", issues: "items" });
    await substituteTree(join(s.projectDir, "specs"), entries);
    const api = await readFile(join(s.projectDir, "specs/api.md"), "utf8");
    expect(api).toContain("https://cdn.example/x.png");
  });
});

describe("runDebrand", () => {
  test("commits when changes happen; idempotent on second run", async () => {
    const before = git(s.projectDir, ["log", "--oneline"]).split("\n").length;
    const code = await runDebrand({ cwd: s.projectDir, polish: false });
    expect(code).toBe(0);
    const afterFirst = git(s.projectDir, ["log", "--oneline"]).split("\n").length;
    expect(afterFirst).toBe(before + 1);

    // Second run: no changes → no commit.
    await runDebrand({ cwd: s.projectDir, polish: false });
    const afterSecond = git(s.projectDir, ["log", "--oneline"]).split("\n").length;
    expect(afterSecond).toBe(afterFirst);
  });

  test("pre-debrand content recoverable via git", async () => {
    await runDebrand({ cwd: s.projectDir, polish: false });
    const previous = git(s.projectDir, ["show", "HEAD^:specs/intro.md"]);
    expect(previous).toMatch(/Linear's approach to issues/);
    const current = await readFile(join(s.projectDir, "specs/intro.md"), "utf8");
    expect(current).toMatch(/Projectify's approach to items/);
  });

  test("--polish stub: replaces content via injected call", async () => {
    const calls: string[] = [];
    await runDebrand({
      cwd: s.projectDir,
      polish: true,
      polishCall: async (prompt) => {
        calls.push(prompt);
        // Simulate a polished version that strips the heading prefix.
        return prompt.replace(/^# /, "## ").replace(/Linear/g, "Projectify");
      },
    });
    expect(calls.length).toBeGreaterThan(0);
    const intro = await readFile(join(s.projectDir, "specs/intro.md"), "utf8");
    expect(intro.startsWith("## ")).toBe(true);
  });
});
