/**
 * Verifies: `specs debrand` does NOT touch files under `specs/.runs/`. Each run
 * directory is a per-model output that hasn't been curated; debrand operates on
 * the canonical curated specs/ tree only.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runDebrand } from "../src/commands/debrand.ts";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "debrand-runs-"));
  // git init so debrand's commit step doesn't crash.
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: tmp });
  spawnSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init"],
    { cwd: tmp },
  );
  const config = [
    "target: example",
    "scrape_repo: ../example-scrape",
    "crawl:",
    "  start:",
    "    - https://example.com",
    "debrand:",
    "  glossary:",
    "    Standards: Conventions",
    "",
  ].join("\n");
  await writeFile(join(tmp, ".specs-engine.yaml"), config);
  await mkdir(join(tmp, "specs"), { recursive: true });
  await writeFile(join(tmp, "specs", "canonical.md"), "# The Standards apply here\n");
  // Run-dir under .runs/ — must remain untouched.
  await mkdir(join(tmp, "specs", ".runs", "ollama--qwen-7b", "api"), { recursive: true });
  await writeFile(
    join(tmp, "specs", ".runs", "ollama--qwen-7b", "api", "foo.md"),
    "# Standards inside a run dir — must NOT be debranded\n",
  );
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("debrand skips specs/.runs/", () => {
  test("canonical specs/ debranded; specs/.runs/ untouched", async () => {
    const exit = await runDebrand({ cwd: tmp, polish: false });
    expect(exit).toBe(0);

    // Canonical was modified.
    const canonical = await readFile(join(tmp, "specs", "canonical.md"), "utf8");
    expect(canonical).toContain("Conventions");
    expect(canonical).not.toContain("Standards");

    // Run-dir file is untouched.
    const runFile = await readFile(
      join(tmp, "specs", ".runs", "ollama--qwen-7b", "api", "foo.md"),
      "utf8",
    );
    expect(runFile).toContain("Standards");
    expect(runFile).not.toContain("Conventions");
  });
});
