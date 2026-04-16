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
