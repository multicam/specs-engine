/**
 * Verifies: when `--model ollama/...` is used and no api-key env is set,
 * `runAgent` does NOT short-circuit on api-key validation. The Ollama
 * provider has `apiKeyEnvName: null`, so the validation check should be
 * skipped entirely.
 *
 * The downstream call may still fail (no Ollama server, prompt missing, etc.)
 * — but the failure must NOT be the api-key gate.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAgent } from "../src/commands/agent.ts";

let tmp: string;
let stderrBuf: string;
let originalWrite: typeof process.stderr.write;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "agent-no-key-"));

  // Minimal valid .specs-engine.yaml + ralph-pack with anthropic/docs-reverse.md
  // (so prompt resolution succeeds via the anthropic/ fallback in promptDirs).
  const ralphPack = join(tmp, "ralph-pack");
  await mkdir(join(ralphPack, ".ralph", "prompts", "anthropic"), {
    recursive: true,
  });
  await writeFile(
    join(ralphPack, ".ralph", "prompts", "anthropic", "docs-reverse.md"),
    "# fallback prompt body",
  );

  const config = [
    "target: example",
    "scrape_repo: ../example-scrape",
    "crawl:",
    "  start:",
    "    - https://example.com",
    "agent:",
    `  ralph_pack: ${ralphPack}`,
    "",
  ].join("\n");
  await writeFile(join(tmp, ".specs-engine.yaml"), config);
  // Sibling scrape dir + a marker file so buildInitialMessage doesn't crash.
  await mkdir(join(tmp, "example-scrape"), { recursive: true });
  await mkdir(join(tmp, "specs"), { recursive: true });

  // Capture stderr output.
  stderrBuf = "";
  originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrBuf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stderr.write;
});

afterEach(async () => {
  process.stderr.write = originalWrite;
  // Make sure no env leak from the test run.
  delete process.env["OPENROUTER_API_KEY"];
  delete process.env["OLLAMA_HOST"];
  await rm(tmp, { recursive: true, force: true });
});

describe("runAgent — ollama provider (no api key)", () => {
  test("does NOT short-circuit on missing api key when --model ollama/... used", async () => {
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["OLLAMA_HOST"];

    // Point Ollama at a guaranteed-dead port so the actual chat call fails fast
    // — we only care about getting *past* the api-key validation gate.
    process.env["OLLAMA_HOST"] = "http://127.0.0.1:1";

    // Race the agent run against a short timer. The chat call against a dead
    // host may take seconds to surface ECONNREFUSED across network stacks; we
    // only need to confirm execution reached prompt resolution (i.e. the
    // api-key gate did NOT block it). Either outcome is acceptable as long as
    // the api-key short-circuit message is absent from stderr.
    const runPromise = runAgent({
      cwd: tmp,
      mode: "docs-reverse",
      model: "ollama/qwen2.5-coder:7b",
      maxIterations: 1,
    }).catch(() => -1);
    const timeoutPromise = new Promise<number>((r) => setTimeout(() => r(-2), 1500));
    await Promise.race([runPromise, timeoutPromise]);

    // The api-key gate would emit "environment variable is not set". Assert
    // we got past it.
    expect(stderrBuf).not.toContain("environment variable is not set");
    // We should have at least reached prompt resolution.
    expect(stderrBuf).toContain("resolving prompt");
  });

  test("DOES short-circuit on missing OPENROUTER_API_KEY when --model openrouter/... used", async () => {
    delete process.env["OPENROUTER_API_KEY"];

    const exitCode = await runAgent({
      cwd: tmp,
      mode: "docs-reverse",
      model: "openrouter/deepseek/deepseek-r1-0528",
      maxIterations: 1,
    });

    expect(exitCode).toBe(1);
    expect(stderrBuf).toContain("OPENROUTER_API_KEY");
    expect(stderrBuf).toContain("not set");
  });
});
