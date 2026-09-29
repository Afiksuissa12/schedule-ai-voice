/**
 * The bound: how much transcript a turn is allowed to carry, and which turns.
 *
 * WHY THERE HAS TO BE A BOUND AT ALL
 * ---------------------------------------------------------------------------
 * `messagesFromTurns` has always defaulted to NO truncation, and its comment
 * explains why that was right for Baseline V1: truncation loses history and the
 * slice's conversations were short. Both halves of that reasoning stop holding
 * the moment a 7B model with a fixed `num_ctx` is on the other end of the port.
 * An unbounded transcript against a fixed window does not degrade gracefully -
 * it overflows, and what falls out is chosen by whatever the runtime does when
 * it runs out of room, which is usually "drop the oldest messages silently" and
 * occasionally "drop the system prompt". Losing the guardrails to make room for
 * small talk is the worst possible failure, and it is the default one.
 *
 * So the bound lives HERE, in application code, applied to rows read from the
 * database, where it is visible, testable and reported. What falls out of the
 * window does not fall off a cliff either: it is what the rolling summary in
 * `conversationMemory.ts` exists to carry.
 *
 * WHY CHARACTERS AND NOT TOKENS
 * ---------------------------------------------------------------------------
 * Because this file may not import a tokenizer, and that is a deliberate
 * architectural constraint rather than laziness:
 * `tests/invariants/vendorBoundary.test.ts` asserts that no file under
 * `src/conversation` imports a vendor SDK, and every accurate tokenizer for a
 * given model IS one. A tokenizer would also be model-specific, so it would be
 * wrong for whichever model the deployment actually loaded.
 *
 * Characters are the thing this layer can count exactly. `charsPerToken` turns
 * the model's `num_ctx` into a character budget, and it is set LOW (a
 * pessimistic 4 characters per token for English prose, where the true figure
 * for most BPE vocabularies is nearer 4.5) so the estimate errs towards leaving
 * room rather than towards overflow. The direction of the error is the point:
 * an over-cautious budget costs a little context; an over-confident one costs
 * the system prompt.
 *
 * WHY THE FRONT EDGE OF THE WINDOW IS NOT JUST `slice(-n)`
 * ---------------------------------------------------------------------------
 * A tool-calling transcript has pairs in it. Cutting blindly can leave a `tool`
 * result message whose assistant tool-call message fell outside the window, and
 * a provider that validates its input - OpenAI's does, and llama.cpp's
 * chat templates increasingly do - rejects the whole request. That is a dropped
 * call caused by a truncation strategy, so `selectRecentTurns` repairs the
 * front edge rather than hoping. (`messagesFromTurns` already repairs the other
 * direction, an assistant call with no result.)
 */
import type { ConversationTurn } from '../domain/entities.js';

/**
 * The budget, as a function of the model's context length.
 *
 * `modelNumCtx` IS A REQUIREMENT ON THE DEPLOYMENT, NOT A GUESS
 * ---------------------------------------------------------------------------
 * It belongs to whoever configures the local runtime, and 16384 is here as a
 * MEASURED minimum rather than a round number. `npm run context:render --sizes`
 * prints the arithmetic; this is what it says today:
 *
 *   system prompt (sales-scheduler-local@v2) ... 10,130 chars  (~2,533 tokens)
 *   nine tool schemas ......................... 11,256 chars  (~2,814 tokens)
 *   = fixed overhead, before any conversation .. 21,386 chars  (~5,347 tokens)
 *
 * On an 8192-token window that overhead is 65% of everything, and the budget
 * ladder has to strip the ENTIRE business profile to fit - pricing included. An
 * agent that cannot answer "what does this cost" is not a demo, so 8192 is a
 * configuration this code will serve but should not default to.
 *
 * At 16384 the same turn keeps its persona, its products, its real prices, its
 * open unknowns and a full transcript, shedding only the marketing surface and
 * the policy list - and the policy list is still reachable on demand through
 * `get_contact_context`, which is why that tool carries a business digest.
 * 16k is unremarkable for the 7B/8B models this mission targets: Qwen2.5 and
 * Llama 3.1 both support far more natively, and it is Ollama's 2048 DEFAULT
 * rather than the model that is the real constraint. Raising it costs KV cache
 * and nothing else.
 *
 * If the deployment cannot afford 16k, the honest lever is fewer tools in
 * `allowedToolsJson` rather than a thinner context: nine tool schemas are 2,814
 * tokens, and an agent that only books and follows up needs about half of them.
 * This was raised with `MISSION-2-LOCAL-BRAIN-AUTO-PROVIDER` through the
 * mailbox, with these numbers.
 *
 * Nothing else in this file assumes a value. Changing it is changing one field.
 */
export interface ContextBudgetConfig {
  /** The local model's context length, in tokens. */
  readonly modelNumCtx: number;
  /** Tokens left free for the model's own reply and its tool call. */
  readonly reserveForResponseTokens: number;
  /** Pessimistic characters-per-token. Lower = more cautious. */
  readonly charsPerToken: number;
  /**
   * Share of the free space the facts block may take, before the caps below.
   *
   * A share rather than a flat number because the right answer genuinely
   * depends on the model: at `num_ctx` 8192 the guardrail prompt and the nine
   * tool schemas already eat two thirds of the window, and at 32768 they eat a
   * sixth.
   *
   * `maxFactsChars` matters more than the share does at any realistic window
   * size, and it is set high on purpose. The transcript's binding constraint is
   * `maxRecentTurns`, not characters - 24 turns of phone conversation is a few
   * thousand characters, nowhere near the tens of thousands the share would
   * hand it - so characters withheld from the facts block in the transcript's
   * name are characters nobody spends.
   */
  readonly factsShare: number;
  /** Hard ceiling on the turn-context facts block, in characters. */
  readonly maxFactsChars: number;
  /**
   * Floor for the facts block.
   *
   * MEASURED, not chosen: this is the irreducible core the budget ladder
   * bottoms out at - the frame, the contact, the time discipline, whatever
   * memory survived, and the objective - plus headroom. `npm run context:prove`
   * asserts the ladder reaches a fitting context at this size, so if the core
   * grows past it that proof fails rather than a caller silently getting cut
   * text. See `CONVERSATION_CONTEXT.md` § "What a turn actually costs".
   */
  readonly minFactsChars: number;
  /** Hard ceiling on the number of transcript turns, whatever the char budget says. */
  readonly maxRecentTurns: number;
  /**
   * The transcript never shrinks below this many characters.
   *
   * A budget that computes its way to zero would hand the model a system prompt
   * and no conversation, which is worse than overrunning slightly. If this
   * floor is what applies, the report says so and the caller can see that the
   * configuration does not fit the model.
   */
  readonly minTranscriptChars: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudgetConfig = {
  modelNumCtx: 16384,
  reserveForResponseTokens: 512,
  charsPerToken: 4,
  factsShare: 0.55,
  maxFactsChars: 12000,
  minFactsChars: 3400,
  maxRecentTurns: 24,
  minTranscriptChars: 1500,
};

/** What the budget worked out to, recorded so a turn can be explained. */
export interface ContextBudgetReport {
  readonly config: ContextBudgetConfig;
  /** `modelNumCtx * charsPerToken`. */
  readonly totalChars: number;
  /** Measured, not guessed: the real system prompt plus the real tool schemas. */
  readonly fixedOverheadChars: number;
  readonly reservedForResponseChars: number;
  readonly factsBudgetChars: number;
  readonly transcriptBudgetChars: number;
  /** True when `minTranscriptChars` had to rescue a budget that did not fit. */
  readonly transcriptFloorApplied: boolean;
}

export interface PlanBudgetInput {
  readonly config?: Partial<ContextBudgetConfig>;
  /**
   * Characters the turn spends before any context: the rendered system prompt
   * plus the serialized tool schemas.
   *
   * Passed in rather than estimated because the caller has both strings in its
   * hand at that moment, and a measured number beats a constant that was true
   * when somebody wrote it down.
   */
  readonly fixedOverheadChars: number;
}

export function planContextBudget(input: PlanBudgetInput): ContextBudgetReport {
  const config: ContextBudgetConfig = { ...DEFAULT_CONTEXT_BUDGET, ...(input.config ?? {}) };

  const totalChars = Math.max(0, Math.floor(config.modelNumCtx * config.charsPerToken));
  const reservedForResponseChars = Math.max(0, Math.floor(config.reserveForResponseTokens * config.charsPerToken));
  const available = totalChars - input.fixedOverheadChars - reservedForResponseChars;

  // Facts first. They are bounded, and they are the part that makes a returning
  // contact feel remembered - which is this mission's whole point. The
  // transcript gets the remainder, because the transcript is the part the
  // rolling summary can carry when it does not fit.
  //
  // The floor wins over the share when the two disagree: a facts block below
  // the irreducible core cannot be produced at all, only cut, and cut context
  // loses whatever the renderer put last. Where that leaves no room for a
  // transcript, `minTranscriptChars` takes over and `transcriptFloorApplied`
  // says the configuration does not fit the model.
  const factsBudgetChars = Math.max(
    0,
    Math.min(config.maxFactsChars, Math.max(config.minFactsChars, Math.floor(available * config.factsShare))),
  );
  const remainder = available - factsBudgetChars;
  const transcriptFloorApplied = remainder < config.minTranscriptChars;
  const transcriptBudgetChars = transcriptFloorApplied ? config.minTranscriptChars : remainder;

  return {
    config,
    totalChars,
    fixedOverheadChars: input.fixedOverheadChars,
    reservedForResponseChars,
    factsBudgetChars,
    transcriptBudgetChars,
    transcriptFloorApplied,
  };
}

// ---------------------------------------------------------------------------
// Selecting the window
// ---------------------------------------------------------------------------

/** Per-message framing a provider adds around content. Counted so the budget is not optimistic. */
const PER_TURN_OVERHEAD_CHARS = 24;

export type WindowLimit = 'NONE' | 'TURN_COUNT' | 'CHAR_BUDGET';

export interface TurnWindow {
  /** The selected turns, still in ascending index order. */
  readonly turns: readonly ConversationTurn[];
  readonly totalTurnCount: number;
  readonly includedTurnCount: number;
  readonly droppedTurnCount: number;
  /**
   * The highest turn index that did NOT make the window, or null when nothing
   * was dropped. This is the line the rolling summary has to cover.
   */
  readonly droppedThroughIndex: number | null;
  readonly charCount: number;
  readonly budgetChars: number;
  /** Which limit actually bit. `NONE` means the whole conversation fits. */
  readonly limitedBy: WindowLimit;
  /**
   * Tool-result turns dropped because their tool-call turn fell outside the
   * window. Reported rather than silent: it is the one repair that changes what
   * the model sees for a reason unrelated to the budget.
   */
  readonly orphanedToolResultsDropped: number;
}

export interface SelectRecentTurnsOptions {
  readonly maxTurns: number;
  readonly maxChars: number;
}

/**
 * The most recent turns that fit, with a legal front edge.
 *
 * Always returns at least one turn when given at least one - a turn with no
 * transcript at all is a model being asked to reply to nothing.
 */
export function selectRecentTurns(
  turns: readonly ConversationTurn[],
  options: SelectRecentTurnsOptions,
): TurnWindow {
  const total = turns.length;
  if (total === 0) {
    return {
      turns: [],
      totalTurnCount: 0,
      includedTurnCount: 0,
      droppedTurnCount: 0,
      droppedThroughIndex: null,
      charCount: 0,
      budgetChars: options.maxChars,
      limitedBy: 'NONE',
      orphanedToolResultsDropped: 0,
    };
  }

  const selected: ConversationTurn[] = [];
  let charCount = 0;
  let limitedBy: WindowLimit = 'NONE';

  for (let position = total - 1; position >= 0; position -= 1) {
    const turn = turns[position];
    if (!turn) continue;

    if (selected.length >= options.maxTurns) {
      limitedBy = 'TURN_COUNT';
      break;
    }

    const size = turnCharCost(turn);
    // The most recent turn goes in whatever it costs. It is the thing the model
    // is being asked to respond to; dropping it for being large would produce a
    // reply to the wrong message.
    if (selected.length > 0 && charCount + size > options.maxChars) {
      limitedBy = 'CHAR_BUDGET';
      break;
    }

    selected.push(turn);
    charCount += size;
  }

  selected.reverse();

  // ---- repair the front edge -------------------------------------------
  // A `tool` result whose assistant tool-call turn is outside the window has
  // nothing to attach to. Drop it rather than emit an illegal transcript.
  const callIdsInWindow = new Set(
    selected.filter((turn) => turn.role === 'AGENT' && turn.toolCallId).map((turn) => turn.toolCallId),
  );
  const repaired = selected.filter(
    (turn) => !(turn.role === 'TOOL' && (!turn.toolCallId || !callIdsInWindow.has(turn.toolCallId))),
  );
  const orphanedToolResultsDropped = selected.length - repaired.length;
  if (orphanedToolResultsDropped > 0) {
    charCount = repaired.reduce((sum, turn) => sum + turnCharCost(turn), 0);
  }

  const first = repaired[0];
  const droppedTurnCount = total - repaired.length;

  return {
    turns: repaired,
    totalTurnCount: total,
    includedTurnCount: repaired.length,
    droppedTurnCount,
    // The index BELOW the window's first surviving turn. Uses the real
    // `ConversationTurn.index`, not an array position, because the summary is
    // written against database indexes.
    droppedThroughIndex: droppedTurnCount > 0 && first ? first.index - 1 : null,
    charCount,
    budgetChars: options.maxChars,
    limitedBy,
    orphanedToolResultsDropped,
  };
}

/** What one turn costs the window, counting the framing a provider adds. */
export function turnCharCost(turn: ConversationTurn): number {
  return (turn.text?.length ?? 0) + (turn.rawPayloadJson?.length ?? 0) + PER_TURN_OVERHEAD_CHARS;
}
