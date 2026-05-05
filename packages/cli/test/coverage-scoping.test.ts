/**
 * Verifies: `buildInitialMessage` walks the run-specific specsDir argument,
 * not the global `specs/`. If `specs/api/foo.md` exists (canonical) but the
 * run dir lacks it, the run sees the topic as uncovered.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildInitialMessage } from "../src/commands/agent.ts";

let tmp: string;
const mount = "test-scrape";

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "agent-coverage-scope-"));
  // Scrape submodule with one page.
  await mkdir(join(tmp, mount, "example.com"), { recursive: true });
  await writeFile(join(tmp, mount, "example.com", "api.md"), "# API");
  // Canonical specs/ has the page covered.
  await mkdir(join(tmp, "specs", "api"), { recursive: true });
  await writeFile(join(tmp, "specs", "api", "api.md"), "# API spec");
  // Run dir exists but is empty.
  await mkdir(join(tmp, "specs", ".runs", "ollama--qwen-7b"), { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("buildInitialMessage scopes coverage to the run dir", () => {
  test("run dir empty → page reads as uncovered even though canonical specs/ covers it", async () => {
    const msg = await buildInitialMessage(tmp, mount, "specs/.runs/ollama--qwen-7b");
    // Run dir has zero specs.
    expect(msg).toContain("0 specs written");
    // The scrape page is in the uncovered list.
    expect(msg).toContain("test-scrape/example.com/api.md");
  });

  test("run dir with a spec → that spec appears in 'Already written'", async () => {
    await mkdir(join(tmp, "specs", ".runs", "ollama--qwen-7b", "api"), { recursive: true });
    await writeFile(
      join(tmp, "specs", ".runs", "ollama--qwen-7b", "api", "api.md"),
      "# Run-scoped API spec",
    );
    const msg = await buildInitialMessage(tmp, mount, "specs/.runs/ollama--qwen-7b");
    expect(msg).toContain("Already written");
    expect(msg).toContain("api/api.md");
  });

  test("write_file instruction points at the run dir", async () => {
    const msg = await buildInitialMessage(tmp, mount, "specs/.runs/ollama--qwen-7b");
    expect(msg).toContain('write_file("specs/.runs/ollama--qwen-7b/');
  });
});
