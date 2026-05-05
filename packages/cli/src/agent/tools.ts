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
 * Check that a write path is under the configured `writeRoot` directory.
 *
 * `writeRoot` is a forward-slash relative path inside the project (e.g.
 * `specs` or `specs/.runs/ollama--qwen-7b`). Both forward- and back-slash
 * normalised forms are accepted as the "starts-with" prefix to keep Windows
 * working without separate code paths.
 */
export function assertWriteRoot(
  root: string,
  relPath: string,
  writeRoot: string,
): void {
  const normalized = relative(root, resolve(root, relPath));
  const writeRootBack = writeRoot.replace(/\//g, "\\");
  const okForward = normalized === writeRoot || normalized.startsWith(`${writeRoot}/`);
  const okBack = normalized === writeRootBack || normalized.startsWith(`${writeRootBack}\\`);
  if (!okForward && !okBack) {
    throw new Error(
      `write_file: writes are restricted to ${writeRoot}/ directory. Rejected: '${relPath}'`,
    );
  }
}

/**
 * Back-compat shim: defaults the write root to `specs`. Existing callers and
 * tests retain their semantics; new callers pass a per-run dir via
 * `assertWriteRoot` directly.
 */
export function assertSpecsPath(root: string, relPath: string): void {
  assertWriteRoot(root, relPath, "specs");
}

/**
 * Per-round state shared across tools. Reset by the loop between rounds.
 */
export class ToolState {
  readCount = 0;
  exploreCount = 0;   // list_files + grep calls
  wroteSpec = false;
  specsWritten: string[] = [];
  readBudget: number;
  exploreBudget: number;

  constructor(readBudget = 4, exploreBudget = 3) {
    this.readBudget = readBudget;
    this.exploreBudget = exploreBudget;
  }

  get explorationExhausted(): boolean {
    return this.readCount >= this.readBudget && this.exploreCount >= this.exploreBudget;
  }

  reset() {
    this.readCount = 0;
    this.exploreCount = 0;
    this.wroteSpec = false;
  }
}

/**
 * Create the tool definitions bound to a project root directory.
 * All paths in tool args are relative to projectRoot.
 *
 * `writeRoot` (default: `specs`) restricts where `write_file` can land. The
 * agent runner passes a per-run directory like `specs/.runs/ollama--qwen-7b`
 * so multiple models can produce comparable specs side by side.
 */
export function createTools(
  projectRoot: string,
  state: ToolState,
  writeRoot = "specs",
) {
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
        `Write content to a file under the ${writeRoot}/ directory. ` +
        `Path must be relative to project root and start with '${writeRoot}/'. ` +
        `Creates parent directories as needed.`,
      inputSchema: z.object({
        path: z.string().describe(`Relative path under ${writeRoot}/ to write to`),
        content: z.string().describe("File content to write"),
      }),
      execute: async ({ path, content }) => {
        try {
          assertWriteRoot(root, path, writeRoot);
          const abs = safePath(root, path);
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, content);
          state.wroteSpec = true;
          state.specsWritten.push(path);
          return `Written: ${path} (${content.length} bytes)`;
        } catch (err) {
          const msg = (err as Error).message;
          // Provide a path correction hint when the model uses the wrong prefix.
          const hint = msg.includes("restricted to")
            ? ` Correct prefix: ${writeRoot}/<area>/<topic>.md`
            : "";
          return `Error writing ${path}: ${msg}${hint}`;
        }
      },
    }),

    list_files: tool({
      description:
        "List files matching a glob pattern relative to project root. " +
        "Example: 'specs/**/*.md' or '*-scrape/**/*.md'. " +
        "You have a LIMITED exploration budget — use it wisely.",
      inputSchema: z.object({
        glob: z.string().describe("Glob pattern to match files"),
      }),
      execute: async ({ glob: pattern }) => {
        if (state.exploreCount >= state.exploreBudget) {
          return (
            `EXPLORATION BUDGET EXHAUSTED (${state.exploreBudget}/${state.exploreBudget} list/grep calls used). ` +
            `You MUST call write_file now to write your spec.`
          );
        }
        state.exploreCount++;
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
        if (state.exploreCount >= state.exploreBudget) {
          return (
            `EXPLORATION BUDGET EXHAUSTED (${state.exploreBudget}/${state.exploreBudget} list/grep calls used). ` +
            `You MUST call write_file now to write your spec.`
          );
        }
        state.exploreCount++;
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
