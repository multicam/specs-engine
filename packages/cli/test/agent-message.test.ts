import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildInitialMessage, scanDir } from "../src/commands/agent.ts";

let tmp: string;
let mount: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "agent-msg-"));
  mount = "test-scrape";
  const scrapeDir = join(tmp, mount);
  const specsDir = join(tmp, "specs");

  // Scaffold a mini scrape tree
  await mkdir(join(scrapeDir, "example.com"), { recursive: true });
  await mkdir(join(scrapeDir, "docs.example.com"), { recursive: true });
  await writeFile(join(scrapeDir, "example.com/index.md"), "# Home");
  await writeFile(join(scrapeDir, "example.com/pricing.md"), "# Pricing");
  await writeFile(join(scrapeDir, "docs.example.com/intro.md"), "# Intro");

  // Scaffold specs with one existing
  await mkdir(join(specsDir, "workspace"), { recursive: true });
  await writeFile(join(specsDir, "workspace/workspaces.md"), "# Workspaces spec");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("scanDir", () => {
  test("lists .md files sorted", async () => {
    const files = await scanDir(join(tmp, mount));
    expect(files).toEqual([
      "docs.example.com/intro.md",
      "example.com/index.md",
      "example.com/pricing.md",
    ]);
  });

  test("returns empty array for missing dir", async () => {
    const files = await scanDir(join(tmp, "nonexistent"));
    expect(files).toEqual([]);
  });
});

describe("buildInitialMessage", () => {
  test("includes uncovered scrape pages as paths", async () => {
    const msg = await buildInitialMessage(tmp, mount, "specs");
    expect(msg).toContain("test-scrape/example.com/index.md");
    expect(msg).toContain("test-scrape/docs.example.com/intro.md");
    expect(msg).toMatch(/Uncovered pages \(\d+\)/);
  });

  test("lists existing specs in Already written section", async () => {
    const msg = await buildInitialMessage(tmp, mount, "specs");
    expect(msg).toContain("specs/workspace/workspaces.md");
    expect(msg).toContain("Already written");
  });

  test("shows 0 specs written when specs dir missing", async () => {
    await rm(join(tmp, "specs"), { recursive: true, force: true });
    const msg = await buildInitialMessage(tmp, mount, "specs");
    expect(msg).toContain("0 specs written");
  });

  test("shows area bias stats when specs exist", async () => {
    const msg = await buildInitialMessage(tmp, mount, "specs");
    expect(msg).toContain("Specs per area");
    expect(msg).toContain("workspace: 1");
  });

  test("suggests ALL_TOPICS_COVERED when uncovered ≤ threshold", async () => {
    // Our test fixture has 3 scraped pages, default threshold is 5 → suggestComplete fires
    const msg = await buildInitialMessage(tmp, mount, "specs");
    expect(msg).toContain("near complete");
  });

  test("enforces read budget in instructions", async () => {
    const msg = await buildInitialMessage(tmp, mount, "specs");
    expect(msg).toContain("at most 4 pages");
  });

  test("includes ALL_TOPICS_COVERED signal instruction", async () => {
    const msg = await buildInitialMessage(tmp, mount, "specs");
    expect(msg).toContain("ALL_TOPICS_COVERED");
  });

  test("includes write_file instruction", async () => {
    const msg = await buildInitialMessage(tmp, mount, "specs");
    expect(msg).toContain("MUST call write_file");
  });

  test("uses submodule mount path in read_file hint", async () => {
    const msg = await buildInitialMessage(tmp, mount, "specs");
    expect(msg).toContain(`read_file("${mount}/`);
  });
});
