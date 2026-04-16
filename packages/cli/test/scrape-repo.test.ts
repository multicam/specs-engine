import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitIfDirty, headSha } from "../src/git/scrape-repo.ts";

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "scrape-repo-test-"));
  git(repo, ["init", "-q", "-b", "main"]);
  await writeFile(join(repo, "README.md"), "# init\n");
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
});

describe("commitIfDirty", () => {
  test("commits when files added; returns new SHA", async () => {
    await mkdir(join(repo, "docs"), { recursive: true });
    await writeFile(join(repo, "docs/x.md"), "hello\n");
    const sha = commitIfDirty(repo, "add docs/x.md");
    expect(sha).not.toBeNull();
    expect(headSha(repo)).toBe(sha!);
  });

  test("returns null when nothing changed (idempotent)", () => {
    expect(commitIfDirty(repo, "no-op")).toBeNull();
    expect(commitIfDirty(repo, "no-op again")).toBeNull();
  });

  test("commits when existing file mutated", async () => {
    await writeFile(join(repo, "README.md"), "# updated\n");
    const sha = commitIfDirty(repo, "update readme");
    expect(sha).not.toBeNull();
  });

  test("commits when file deleted", async () => {
    await rm(join(repo, "README.md"));
    const sha = commitIfDirty(repo, "rm readme");
    expect(sha).not.toBeNull();
  });
});
