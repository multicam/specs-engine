import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit, type InitResult } from "../src/commands/init.ts";

let tmp: string;
let res: InitResult;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "init-test-"));
  res = await runInit({
    target: "acme",
    startUrl: "https://example.com/",
    cwd: tmp,
  });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("runInit", () => {
  test("scaffolds project + scrape dirs with relative submodule URL", async () => {
    expect(res.projectDir).toBe(join(tmp, "acme-project"));
    expect(res.scrapeDir).toBe(join(tmp, "acme-scrape"));
    expect((await stat(res.configPath)).isFile()).toBe(true);

    const gitmodules = await readFile(res.gitmodulesPath, "utf8");
    expect(gitmodules).toContain("url = ../acme-scrape");
    // Submodule mount is role-named `scrape/`, not `<target>-scrape/`.
    expect(gitmodules).toContain("path = scrape");
    expect((await stat(join(res.projectDir, "scrape"))).isDirectory()).toBe(true);

    const yaml = await readFile(res.configPath, "utf8");
    expect(yaml).toContain("scrape_mount: scrape");
  });

  test("writes .gitignore with default entries in both repos", async () => {
    const projIgnore = await readFile(join(res.projectDir, ".gitignore"), "utf8");
    const scrapeIgnore = await readFile(join(res.scrapeDir, ".gitignore"), "utf8");

    for (const entry of [".idea/", "thoughts/", ".env"]) {
      expect(projIgnore).toContain(entry);
      expect(scrapeIgnore).toContain(entry);
    }
  });

  test(".gitignore is tracked in both init commits", () => {
    for (const dir of [res.projectDir, res.scrapeDir]) {
      const out = spawnSync("git", ["ls-files"], { cwd: dir, encoding: "utf8" });
      expect(out.stdout.split("\n")).toContain(".gitignore");
    }
  });
});

describe("runInit guard", () => {
  test("refuses to scaffold inside an existing git repo when cwd is implicit", async () => {
    const repo = await mkdtemp(join(tmpdir(), "init-guard-"));
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    const origCwd = process.cwd();
    try {
      process.chdir(repo);
      await expect(
        runInit({ target: "acme2", startUrl: "https://example.com/" }),
      ).rejects.toThrow(/refusing to scaffold inside existing git repo/);
    } finally {
      process.chdir(origCwd);
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("explicit cwd bypasses the guard (tests + -C flag path)", async () => {
    const repo = await mkdtemp(join(tmpdir(), "init-bypass-"));
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    try {
      const r = await runInit({
        target: "acme3",
        startUrl: "https://example.com/",
        cwd: repo,
      });
      expect(r.projectDir).toBe(join(repo, "acme3-project"));
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
