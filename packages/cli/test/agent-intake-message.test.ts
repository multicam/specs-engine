import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildIntakeMessage } from "../src/commands/agent.ts";

let tmp: string;
const outFileRel = "specs/.runs/ollama--m/BUSINESS_INTENT.md";

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "agent-intake-msg-"));
  const specsDir = join(tmp, "specs");

  await mkdir(join(specsDir, "core"), { recursive: true });
  await mkdir(join(specsDir, "user"), { recursive: true });
  await writeFile(join(specsDir, "core/habits.md"), "# Habits");
  await writeFile(join(specsDir, "user/personas.md"), "# Personas");

  // A prior run dir must be excluded from the input listing.
  await mkdir(join(specsDir, ".runs/ollama--m"), { recursive: true });
  await writeFile(join(specsDir, ".runs/ollama--m/BUSINESS_INTENT.md"), "# BI (prior run)");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("buildIntakeMessage", () => {
  test("lists input spec paths under specs/", async () => {
    const msg = await buildIntakeMessage(tmp, "specs", outFileRel, 4);
    expect(msg).toContain("specs/core/habits.md");
    expect(msg).toContain("specs/user/personas.md");
  });

  test("excludes anything under specs/.runs/ from the input listing", async () => {
    const msg = await buildIntakeMessage(tmp, "specs", outFileRel, 4);
    expect(msg).toContain("Input specs (2)");
    expect(msg).not.toContain("specs/.runs/ollama--m/BUSINESS_INTENT.md\n");
  });

  test("mandates exactly one BUSINESS_INTENT.md write at the given output path", async () => {
    const msg = await buildIntakeMessage(tmp, "specs", outFileRel, 4);
    expect(msg).toContain(outFileRel);
    expect(msg).toContain("write_file");
    expect(msg).toContain("BUSINESS_INTENT.md");
  });

  test("respects the read budget in instructions", async () => {
    const msg = await buildIntakeMessage(tmp, "specs", outFileRel, 4);
    expect(msg).toContain("at most 4");
  });

  test("does not contain docs-reverse coverage framing", async () => {
    const msg = await buildIntakeMessage(tmp, "specs", outFileRel, 4);
    expect(msg).not.toContain("ALL_TOPICS_COVERED");
    expect(msg).not.toContain("uncovered page");
    expect(msg).not.toContain("pick ONE");
  });

  test("handles no input specs found without inventing content", async () => {
    await rm(join(tmp, "specs/core"), { recursive: true, force: true });
    await rm(join(tmp, "specs/user"), { recursive: true, force: true });
    const msg = await buildIntakeMessage(tmp, "specs", outFileRel, 4);
    expect(msg.toLowerCase()).toMatch(/no input spec/);
  });
});
