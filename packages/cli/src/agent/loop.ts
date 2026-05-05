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
    const isRetry = consecutiveStalls > 0;
    // Continuation rounds: explore budget tightens to 1 (model has the page list
    // from the initial message, so one list/grep call is enough).
    // Retry: also cut read budget to 1 to force quick write.
    if (round > 0) {
      state.exploreBudget = 1;
      if (isRetry) state.readBudget = 1;
    }
    state.reset();
    const specsBeforeRound = state.specsWritten.length;
    const message = await buildMessage();

    // Round 0: fresh message. Retry: append failure/retry language.
    // Non-retry continuation: fresh message + a short urgency reminder.
    // buildInitialMessage already has the write mandate but weak models need
    // a reinforcing nudge at the end to actually commit.
    const prompt = isRetry
      ? buildContinuation(message, state.specsWritten)
      : round === 0
        ? message
        : message + `\n\n**ACTION REQUIRED: Pick one uncovered page and call write_file NOW. Do not end this round without writing.**`;

    // Retry: tight step budget + 1-read budget set above forces quick write.
    const effectiveSteps = isRetry ? Math.min(stepsPerRound, 4) : stepsPerRound;

    const result = await generateText({
      model,
      system: systemPrompt,
      prompt,
      tools,
      stopWhen: stepCountIs(effectiveSteps),
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

function buildContinuation(baseMessage: string, specsWritten: string[]): string {
  const specsList = specsWritten.length > 0 ? specsWritten.join(", ") : "(none this session)";
  return (
    baseMessage +
    `\n\nPREVIOUS ROUND FAILED TO WRITE. This is your retry.\n` +
    `Written this session: ${specsList}\n` +
    `Review the uncovered pages above. Pick a SIMPLE topic. ` +
    `You may read at MOST 1 file with read_file, then you MUST call write_file immediately. ` +
    `If truly nothing is left, respond: ${DONE_SIGNAL}`
  );
}
