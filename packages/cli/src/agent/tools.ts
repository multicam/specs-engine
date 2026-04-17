/**
 * Tool definitions for the agent runner.
 *
 * Minimal viable set: read_file, write_file, list_files, grep.
 * Security: write_file is restricted to `specs/` directory only.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { tool } from "ai";
import { z } from "zod";
import { Glob as BunGlob } from "bun";

/**
 * Resolve a relative path within a root directory.
 * Throws if the resolved path escapes the root.
 */
export function safePath(root: string, relPath: string): string {
  const abs = resolve(root, relPath);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || resolve(rel) === rel) {
    throw new Error(`path '${relPath}' escapes project root`);
  }
  return abs;
}

/**
 * Check that a write path is under specs/.
 */
export function assertSpecsPath(root: string, relPath: string): void {
  const normalized = relative(root, resolve(root, relPath));
  if (!normalized.startsWith("specs/") && !normalized.startsWith("specs\\")) {
    throw new Error(
      `write_file: writes are restricted to specs/ directory. Rejected: '${relPath}'`,
    );
  }
}

/**
 * Per-round state shared across tools. Reset by the loop between rounds.
 */
export class ToolState {
  readCount = 0;
  wroteSpec = false;
  specsWritten: string[] = [];
  readBudget: number;

  constructor(readBudget = 4) {
    this.readBudget = readBudget;
  }

  reset() {
    this.readCount = 0;
    this.wroteSpec = false;
  }
}

/**
 * Create the tool definitions bound to a project root directory.
 * All paths in tool args are relative to projectRoot.
 */
export function createTools(projectRoot: string, state: ToolState) {
  const root = resolve(projectRoot);

  return {
    read_file: tool({
      description:
        "Read the contents of a file. Path is relative to the project root. " +
        "You have a LIMITED read budget per round — use it wisely.",
      inputSchema: z.object({
        path: z.string().describe("Relative path to the file to read"),
      }),
      execute: async ({ path }) => {
        if (state.readCount >= state.readBudget) {
          return (
            `READ BUDGET EXHAUSTED (${state.readBudget}/${state.readBudget} reads used). ` +
            `You MUST call write_file now to write your spec.`
          );
        }
        state.readCount++;
        const abs = safePath(root, path);
        try {
          return await readFile(abs, "utf8");
        } catch (err) {
          return `Error reading ${path}: ${(err as Error).message}`;
        }
      },
    }),

    write_file: tool({
      description:
        "Write content to a file under the specs/ directory. " +
        "Path must be relative to project root and start with 'specs/'. " +
        "Creates parent directories as needed.",
      inputSchema: z.object({
        path: z.string().describe("Relative path under specs/ to write to"),
        content: z.string().describe("File content to write"),
      }),
      execute: async ({ path, content }) => {
        try {
          assertSpecsPath(root, path);
          const abs = safePath(root, path);
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, content);
          state.wroteSpec = true;
          state.specsWritten.push(path);
          return `Written: ${path} (${content.length} bytes)`;
        } catch (err) {
          return `Error writing ${path}: ${(err as Error).message}`;
        }
      },
    }),

    list_files: tool({
      description:
        "List files matching a glob pattern relative to project root. " +
        "Example: 'specs/**/*.md' or '*-scrape/**/*.md'.",
      inputSchema: z.object({
        glob: z.string().describe("Glob pattern to match files"),
      }),
      execute: async ({ glob: pattern }) => {
        try {
          const g = new BunGlob(pattern);
          const matches: string[] = [];
          for await (const path of g.scan({ cwd: root, dot: false })) {
            matches.push(path);
            if (matches.length >= 500) break; // cap output size
          }
          matches.sort();
          if (matches.length === 0) return "No files matched.";
          return matches.join("\n");
        } catch (err) {
          return `Error listing files: ${(err as Error).message}`;
        }
      },
    }),

    grep: tool({
      description:
        "Search for a regex pattern in files under the project root. " +
        "Returns matching lines with file:line format. " +
        "Optional path restricts search to a subdirectory.",
      inputSchema: z.object({
        pattern: z.string().describe("Regex pattern to search for"),
        path: z
          .string()
          .optional()
          .describe("Optional subdirectory to search in (relative to project root)"),
      }),
      execute: async ({ pattern, path }) => {
        try {
          const searchDir = path ? safePath(root, path) : root;
          const result = spawnSync(
            "rg",
            ["--no-heading", "--line-number", "--max-count=50", pattern, "."],
            {
              cwd: searchDir,
              encoding: "utf8",
              timeout: 10_000,
            },
          );
          const out = (result.stdout ?? "").trim();
          if (!out) return "No matches found.";
          // Make paths relative to project root for clarity
          if (path) {
            return out
              .split("\n")
              .map((line) => `${path}/${line}`)
              .join("\n");
          }
          return out;
        } catch (err) {
          return `Error searching: ${(err as Error).message}`;
        }
      },
    }),
  };
}
