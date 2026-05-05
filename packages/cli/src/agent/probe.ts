/**
 * Pre-flight probe that confirms the chosen model can drive OpenAI-style tool
 * calls. Without this gate, models that don't support tool calling (e.g.
 * `gemma3:1b`) silently stall the main loop with the misleading "no spec
 * written" failure mode.
 *
 * Side effect: the probe call also warms the model into VRAM on Ollama
 * (5–30s for 7B), so the main loop has no first-call surprise. Net wall-clock
 * is unchanged — the warm-up cost is paid here instead of in round 1.
 */
import { generateText, stepCountIs, type LanguageModel, type ToolSet } from "ai";

export interface ProbeOptions {
  model: LanguageModel;
  tools: ToolSet;
  /** Used in the diagnostic if the probe fails. */
  modelId: string;
  /** Optional curated list shown in the diagnostic if the probe fails. */
  knownGoodModels?: readonly string[];
}

export interface ProbeResult {
  ok: boolean;
  /** Number of tool calls observed in the probe step. */
  toolCallCount: number;
  /** Diagnostic to print on failure (undefined on success). */
  diagnostic?: string;
}

const PROBE_PROMPT =
  `Call the list_files tool with glob 'specs/**/*.md' to inventory existing specs. ` +
  `Just call the tool. Don't write anything else. Don't explain.`;

export async function probeToolCalling(opts: ProbeOptions): Promise<ProbeResult> {
  const result = await generateText({
    model: opts.model,
    prompt: PROBE_PROMPT,
    tools: opts.tools,
    // 2-step cap: 1 thinking step + 1 tool-call step. Reasoning models that
    // can't emit a tool call within 2 steps wouldn't drive the main loop
    // either, so this is a useful upper bound.
    stopWhen: stepCountIs(2),
  });

  const toolCallCount = result.steps.flatMap((s) => s.toolCalls ?? []).length;

  if (toolCallCount === 0) {
    const suggestions =
      opts.knownGoodModels && opts.knownGoodModels.length > 0
        ? ` Try one of: ${opts.knownGoodModels.join(", ")}`
        : "";
    return {
      ok: false,
      toolCallCount: 0,
      diagnostic:
        `agent: model '${opts.modelId}' did not emit any tool calls during pre-flight probe. ` +
        `This usually means the model does not support OpenAI-style tool calling.${suggestions}`,
    };
  }

  return { ok: true, toolCallCount };
}
