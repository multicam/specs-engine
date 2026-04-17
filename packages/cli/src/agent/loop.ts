/**
 * Agent iteration loop — outer loop per topic.
 *
 * Each "round" is a fresh generateText call for one topic.
 * ToolState tracks read budget + write detection per round;
 * reset between rounds by the loop.
 *
 * Stops when:
 * - Model's final text contains "ALL_TOPICS_COVERED"
 * - maxRounds reached
 * - Two consecutive stalls (rounds with no write)
 */
import {
  generateText,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
} from "ai";
import type { ToolState } from "./tools.ts";

export interface AgentLoopOptions {
  model: LanguageModel;
  systemPrompt: string;
  buildMessage: () => Promise<string> | string;
  tools: ToolSet;
  state: ToolState;
  maxRounds: number;
  stepsPerRound?: number;
  onStepFinish?: (info: { round: number; stepNumber: number; toolCalls: number }) => void;
  onRoundFinish?: (info: { round: number; steps: number; wroteSpec: boolean; done: boolean }) => void;
}

export interface AgentLoopResult {
  rounds: number;
  totalSteps: number;
  specsWritten: string[];
  allTopicsCovered: boolean;
}

const DONE_SIGNAL = "ALL_TOPICS_COVERED";

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    model, systemPrompt, buildMessage, tools, state,
    maxRounds, stepsPerRound = 10, onStepFinish, onRoundFinish,
  } = opts;

  let totalSteps = 0;
  let allTopicsCovered = false;
  let roundsCompleted = 0;
  let consecutiveStalls = 0;

  for (let round = 0; round < maxRounds; round++) {
    state.reset();
    const specsBeforeRound = state.specsWritten.length;
    const message = await buildMessage();

    const prompt = round === 0
      ? message
      : buildContinuation(message, state.specsWritten, consecutiveStalls > 0);

    const result = await generateText({
      model,
      system: systemPrompt,
      prompt,
      tools,
      stopWhen: stepCountIs(stepsPerRound),
      onStepFinish: (event) => {
        onStepFinish?.({
          round: round + 1,
          stepNumber: event.stepNumber,
          toolCalls: event.toolCalls?.length ?? 0,
        });
      },
    });

    totalSteps += result.steps.length;
    roundsCompleted = round + 1;
    const wroteSpec = state.specsWritten.length > specsBeforeRound;

    if (result.text.includes(DONE_SIGNAL)) {
      allTopicsCovered = true;
      onRoundFinish?.({ round: round + 1, steps: result.steps.length, wroteSpec, done: true });
      break;
    }

    onRoundFinish?.({ round: round + 1, steps: result.steps.length, wroteSpec, done: false });

    if (wroteSpec) {
      consecutiveStalls = 0;
    } else {
      consecutiveStalls++;
      if (consecutiveStalls >= 2) break; // two stalls in a row = give up
    }
  }

  return {
    rounds: roundsCompleted,
    totalSteps,
    specsWritten: [...state.specsWritten],
    allTopicsCovered,
  };
}

function buildContinuation(
  baseMessage: string,
  specsWritten: string[],
  isRetry: boolean,
): string {
  const specsList = specsWritten.join(", ");
  const uncoveredHint =
    `Review the scraped pages list above. Compare against the specs already written. ` +
    `Identify a topic area with scraped pages but NO corresponding spec.`;

  if (isRetry) {
    return (
      baseMessage +
      `\n\nPREVIOUS ROUND FAILED TO WRITE. This is your retry.\n` +
      `Already written: ${specsList}\n` +
      `${uncoveredHint}\n` +
      `Pick a SIMPLE topic with only 1-2 source pages. Read them. ` +
      `You MUST call write_file this round. If truly nothing is left, respond: ${DONE_SIGNAL}`
    );
  }

  return (
    baseMessage +
    `\n\nAlready written: ${specsList}\n` +
    `${uncoveredHint}\n` +
    `Pick the next unspecified topic. You MUST call write_file. ` +
    `If all major topics are covered, respond with exactly: ${DONE_SIGNAL}`
  );
}
