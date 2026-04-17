import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { safePath, assertSpecsPath, createTools, ToolState } from "../src/agent/tools.ts";

describe("safePath", () => {
  test("resolves relative path within root", () => {
    const result = safePath("/project", "specs/foo.md");
    expect(result).toBe("/project/specs/foo.md");
  });

  test("throws on path traversal escaping root", () => {
    expect(() => safePath("/project", "../etc/passwd")).toThrow(
      /escapes project root/,
    );
  });

  test("throws on absolute path that escapes root", () => {
    expect(() => safePath("/project", "/etc/passwd")).toThrow(
      /escapes project root/,
    );
  });
});

describe("assertSpecsPath", () => {
  test("allows paths under specs/", () => {
    expect(() => assertSpecsPath("/project", "specs/feature.md")).not.toThrow();
  });

  test("allows nested specs paths", () => {
    expect(() =>
      assertSpecsPath("/project", "specs/deep/nested/file.md"),
    ).not.toThrow();
  });

  test("rejects paths outside specs/", () => {
    expect(() => assertSpecsPath("/project", "src/index.ts")).toThrow(
      /writes are restricted to specs\//,
    );
  });

  test("rejects scrape repo paths", () => {
    expect(() =>
      assertSpecsPath("/project", "acme-scrape/index.md"),
    ).toThrow(/writes are restricted to specs\//);
  });

  test("rejects root-level files", () => {
    expect(() =>
      assertSpecsPath("/project", ".specs-engine.yaml"),
    ).toThrow(/writes are restricted to specs\//);
  });
});

describe("createTools", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "tools-test-"));
    await mkdir(join(tmpDir, "specs"), { recursive: true });
    await mkdir(join(tmpDir, "scrape", "docs"), { recursive: true });
    await writeFile(join(tmpDir, "scrape", "docs", "api.md"), "# API Docs\nSome content.");
    await writeFile(join(tmpDir, "specs", "existing.md"), "# Existing Spec");
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("read_file", () => {
    const execOpts = { toolCallId: "t", messages: [], abortSignal: undefined as never };

    test("reads file content from scrape submodule", async () => {
      const tools = createTools(tmpDir, new ToolState());
      const result = await tools.read_file.execute!({ path: "scrape/docs/api.md" }, execOpts);
      expect(result).toContain("# API Docs");
    });

    test("reads file from specs/", async () => {
      const tools = createTools(tmpDir, new ToolState());
      const result = await tools.read_file.execute!({ path: "specs/existing.md" }, execOpts);
      expect(result).toContain("# Existing Spec");
    });

    test("returns error for nonexistent file", async () => {
      const tools = createTools(tmpDir, new ToolState());
      const result = await tools.read_file.execute!({ path: "nonexistent.md" }, execOpts);
      expect(result).toContain("Error reading");
    });

    test("enforces read budget", async () => {
      const state = new ToolState(2); // budget of 2
      const tools = createTools(tmpDir, state);
      await tools.read_file.execute!({ path: "scrape/docs/api.md" }, execOpts);
      await tools.read_file.execute!({ path: "specs/existing.md" }, execOpts);
      expect(state.readCount).toBe(2);
      const result = await tools.read_file.execute!({ path: "scrape/docs/api.md" }, execOpts);
      expect(result).toContain("BUDGET EXHAUSTED");
      expect(state.readCount).toBe(2); // counter doesn't increment past budget
    });

    test("read budget resets between rounds", async () => {
      const state = new ToolState(1);
      const tools = createTools(tmpDir, state);
      await tools.read_file.execute!({ path: "scrape/docs/api.md" }, execOpts);
      const blocked = await tools.read_file.execute!({ path: "specs/existing.md" }, execOpts);
      expect(blocked).toContain("BUDGET EXHAUSTED");
      state.reset();
      const result = await tools.read_file.execute!({ path: "specs/existing.md" }, execOpts);
      expect(result).toContain("# Existing Spec");
    });
  });

  describe("write_file", () => {
    test("writes file under specs/", async () => {
      const tools = createTools(tmpDir, new ToolState());
      const result = await tools.write_file.execute!(
        { path: "specs/new-spec.md", content: "# New Spec\nContent." },
        { toolCallId: "t4", messages: [], abortSignal: undefined as never },
      );
      expect(result).toContain("Written: specs/new-spec.md");
      const content = await readFile(join(tmpDir, "specs", "new-spec.md"), "utf8");
      expect(content).toBe("# New Spec\nContent.");
    });

    test("creates nested directories under specs/", async () => {
      const tools = createTools(tmpDir, new ToolState());
      const result = await tools.write_file.execute!(
        { path: "specs/deep/nested/file.md", content: "nested content" },
        { toolCallId: "t5", messages: [], abortSignal: undefined as never },
      );
      expect(result).toContain("Written: specs/deep/nested/file.md");
      const content = await readFile(
        join(tmpDir, "specs", "deep", "nested", "file.md"),
        "utf8",
      );
      expect(content).toBe("nested content");
    });

    test("rejects writes outside specs/", async () => {
      const tools = createTools(tmpDir, new ToolState());
      const result = await tools.write_file.execute!(
        { path: "src/malicious.ts", content: "bad code" },
        { toolCallId: "t6", messages: [], abortSignal: undefined as never },
      );
      expect(result).toContain("writes are restricted to specs/");
    });

    test("rejects writes to scrape repo", async () => {
      const tools = createTools(tmpDir, new ToolState());
      const result = await tools.write_file.execute!(
        { path: "scrape/docs/tampered.md", content: "tampered" },
        { toolCallId: "t7", messages: [], abortSignal: undefined as never },
      );
      expect(result).toContain("writes are restricted to specs/");
    });

    test("rejects writes to config", async () => {
      const tools = createTools(tmpDir, new ToolState());
      const result = await tools.write_file.execute!(
        { path: ".specs-engine.yaml", content: "overwrite config" },
        { toolCallId: "t8", messages: [], abortSignal: undefined as never },
      );
      expect(result).toContain("writes are restricted to specs/");
    });

    test("tracks write in ToolState", async () => {
      const state = new ToolState();
      const tools = createTools(tmpDir, state);
      expect(state.wroteSpec).toBe(false);
      await tools.write_file.execute!(
        { path: "specs/tracked.md", content: "# Tracked" },
        { toolCallId: "t-track", messages: [], abortSignal: undefined as never },
      );
      expect(state.wroteSpec).toBe(true);
      expect(state.specsWritten).toEqual(["specs/tracked.md"]);
    });
  });

  describe("list_files", () => {
    test("returns matching files for glob", async () => {
      const tools = createTools(tmpDir, new ToolState());
      const result = await tools.list_files.execute!(
        { glob: "specs/**/*.md" },
        { toolCallId: "t9", messages: [], abortSignal: undefined as never },
      );
      expect(result).toContain("specs/existing.md");
    });

    test("returns no-match message for empty results", async () => {
      const tools = createTools(tmpDir, new ToolState());
      const result = await tools.list_files.execute!(
        { glob: "nonexistent/**/*.xyz" },
        { toolCallId: "t10", messages: [], abortSignal: undefined as never },
      );
      expect(result).toBe("No files matched.");
    });
  });

  describe("grep", () => {
    test("finds matching lines in files", async () => {
      const tools = createTools(tmpDir, new ToolState());
      const result = await tools.grep.execute!(
        { pattern: "API Docs" },
        { toolCallId: "t11", messages: [], abortSignal: undefined as never },
      );
      expect(result).toContain("API Docs");
    });

    test("searches within specific subdirectory", async () => {
      const tools = createTools(tmpDir, new ToolState());
      const result = await tools.grep.execute!(
        { pattern: "Existing", path: "specs" },
        { toolCallId: "t12", messages: [], abortSignal: undefined as never },
      );
      expect(result).toContain("Existing Spec");
    });

    test("returns no-match message when nothing found", async () => {
      const tools = createTools(tmpDir, new ToolState());
      const result = await tools.grep.execute!(
        { pattern: "zzz_nonexistent_pattern_zzz" },
        { toolCallId: "t13", messages: [], abortSignal: undefined as never },
      );
      expect(result).toBe("No matches found.");
    });
  });
});
