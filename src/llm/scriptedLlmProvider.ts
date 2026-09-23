/**
 * `ScriptedLlmProvider` - a language model that cannot surprise you.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The governing rule of this system is that the LLM reasons and converses but
 * APPLICATION CODE owns state and executes actions. A rule like that is only
 * worth anything if it is tested against a model that misbehaves. A real model
 * misbehaves rarely and unpredictably; this one misbehaves exactly when the
 * test says so.
 *
 * So the entire test suite - every guardrail test, every rejection test, the
 * whole end-to-end slice - runs against this double. No network, no
 * `OPENAI_API_KEY`, no flake, no cost. `OpenAiLlmProvider` is exercised by one
 * optional test that skips cleanly when the key is absent.
 *
 * WHAT IT CAN DO TO YOU
 * ---------------------------------------------------------------------------
 * `ADVERSARIAL` below is the catalogue of hostile turns the dispatcher must
 * survive: an unknown tool name, arguments that are not JSON at all, a missing
 * required field, a time in the past, a timezone that does not exist, a
 * contact id the model invented, a time outside business hours, a tool the
 * configuration does not permit, and a qualification score above the
 * decision-maker cap. Each one is a named factory, so a test reads as the
 * sentence it is proving rather than as a wall of JSON.
 */
import type {
  CompleteTurnRequest,
  CompleteTurnResult,
  LlmProvider,
  ToolCallRequest,
} from '../ports/llm.js';
import { InvariantViolationError } from '../shared/errors.js';

/** A tool call to hand back, with the id made optional so scripts stay short. */
export interface ScriptedToolCall {
  readonly toolCallId?: string;
  readonly toolName: string;
  /**
   * Raw arguments, EXACTLY as a model would emit them - a string, not an
   * object. Deliberately a string even when well-formed, because the thing
   * under test is application code's handling of untrusted text.
   */
  readonly argumentsJson: string;
}

/** One model turn: what it says, and what it asks to do. */
export interface ScriptedStep {
  readonly assistantText?: string | null;
  readonly toolCalls?: readonly ScriptedToolCall[];
}

/** What happens once the script runs out. */
export type ScriptExhaustionBehaviour =
  /** Return `finalText` with no tool calls, forever. The default. */
  | 'final-text'
  /** Repeat the last step forever. Use to prove the turn loop is bounded. */
  | 'repeat-last'
  /** Throw. Use when a test asserts the model was called exactly N times. */
  | 'throw';

export interface ScriptedLlmProviderOptions {
  readonly name?: string;
  readonly script?: readonly ScriptedStep[];
  readonly onExhausted?: ScriptExhaustionBehaviour;
  /** Used by `final-text`. */
  readonly finalText?: string;
  /** Prefix for generated tool call ids: `scripted-call-1`, `-2`, ... */
  readonly toolCallIdPrefix?: string;
}

/** Everything the provider was asked, kept so a test can inspect the prompt. */
export interface RecordedCompletion {
  readonly request: CompleteTurnRequest;
  readonly result: CompleteTurnResult;
  /** 1-based index among calls to `completeTurn`. */
  readonly index: number;
}

export class ScriptedLlmProvider implements LlmProvider {
  private readonly providerName: string;
  private script: readonly ScriptedStep[];
  private readonly onExhausted: ScriptExhaustionBehaviour;
  private readonly finalText: string;
  private readonly toolCallIdPrefix: string;

  private cursor = 0;
  private toolCallCounter = 0;

  /** Every completion, in order. The record of what the model actually saw. */
  readonly completions: RecordedCompletion[] = [];

  constructor(options: ScriptedLlmProviderOptions = {}) {
    this.providerName = options.name ?? 'scripted-test';
    this.script = options.script ?? [];
    this.onExhausted = options.onExhausted ?? 'final-text';
    this.finalText = options.finalText ?? 'Thanks - is there anything else I can help you with?';
    this.toolCallIdPrefix = options.toolCallIdPrefix ?? 'scripted-call';
  }

  name(): string {
    return this.providerName;
  }

  async completeTurn(req: CompleteTurnRequest): Promise<CompleteTurnResult> {
    const step = this.nextStep();
    const result: CompleteTurnResult = {
      assistantText: step.assistantText ?? null,
      toolCalls: (step.toolCalls ?? []).map((call) => this.materialize(call)),
    };
    this.completions.push({ request: req, result, index: this.completions.length + 1 });
    return result;
  }

  /**
   * Replace the script and rewind to its first step.
   *
   * This exists because a script usually has to name a contact id, and that id
   * does not exist until the world has been seeded. The alternative - building
   * the provider after the fixtures - would mean the runtime could not be wired
   * up front, which is worse. Recorded completions are kept: a test that
   * installs a second script is usually asserting across both turns.
   */
  setScript(script: readonly ScriptedStep[]): void {
    this.script = script;
    this.cursor = 0;
  }

  /** How many times the model was asked to complete a turn. */
  get callCount(): number {
    return this.completions.length;
  }

  /** The system prompt the provider was handed on its most recent call. */
  lastSystemPrompt(): string | undefined {
    return this.completions.at(-1)?.request.systemPrompt;
  }

  /** The tool names offered on the most recent call, in the order given. */
  lastOfferedToolNames(): string[] {
    return (this.completions.at(-1)?.request.tools ?? []).map((tool) => tool.name);
  }

  // -------------------------------------------------------------------------

  private nextStep(): ScriptedStep {
    const step = this.script[this.cursor];
    if (step !== undefined) {
      this.cursor += 1;
      return step;
    }

    switch (this.onExhausted) {
      case 'repeat-last': {
        const last = this.script.at(-1);
        if (last === undefined) {
          throw new InvariantViolationError(
            'ScriptedLlmProvider was configured with onExhausted="repeat-last" but has an empty script.',
          );
        }
        return last;
      }
      case 'throw':
        throw new InvariantViolationError(
          `ScriptedLlmProvider script is exhausted after ${this.completions.length} completion(s), ` +
            'and onExhausted="throw". Either lengthen the script or expect fewer model turns.',
          { details: { scriptLength: this.script.length, completions: this.completions.length } },
        );
      case 'final-text':
      default:
        return { assistantText: this.finalText, toolCalls: [] };
    }
  }

  private materialize(call: ScriptedToolCall): ToolCallRequest {
    this.toolCallCounter += 1;
    return {
      toolCallId: call.toolCallId ?? `${this.toolCallIdPrefix}-${this.toolCallCounter}`,
      toolName: call.toolName,
      argumentsJson: call.argumentsJson,
    };
  }
}

// ---------------------------------------------------------------------------
// The adversarial catalogue.
//
// Every entry is a turn a real model could plausibly produce, and every one of
// them must be refused by application code with a SPECIFIC ValidationErrorCode
// and ZERO domain rows written. `tests/e2e/adversarial.test.ts` proves exactly
// that, one test per entry.
// ---------------------------------------------------------------------------

/** Shorthand: a well-formed arguments string from an object. */
export function scriptedArgs(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

export const ADVERSARIAL = {
  /** A tool that does not exist. Expect `UNSUPPORTED_TOOL`. */
  unknownTool(contactId: string): ScriptedToolCall {
    return {
      toolName: 'send_contract_and_charge_card',
      argumentsJson: scriptedArgs({ contact_id: contactId, amount_usd: 4999 }),
    };
  },

  /** Arguments that are not JSON at all. Expect `SCHEMA_VIOLATION`. */
  malformedArgumentsJson(): ScriptedToolCall {
    return {
      toolName: 'schedule_followup',
      argumentsJson: '{ "contact_id": "c_1", "when": tomorrow afternoon at 3 }',
    };
  },

  /** Valid JSON, required field missing. Expect `SCHEMA_VIOLATION`. */
  missingRequiredField(contactId: string): ScriptedToolCall {
    return {
      toolName: 'schedule_followup',
      // `when` is required: a callback with no time is not a callback.
      argumentsJson: scriptedArgs({ contact_id: contactId, reason: 'follow up on pricing' }),
    };
  },

  /** A time that has already happened. Expect `IN_THE_PAST`. */
  datetimeInThePast(contactId: string): ScriptedToolCall {
    return {
      toolName: 'schedule_followup',
      argumentsJson: scriptedArgs({
        contact_id: contactId,
        when: '2019-06-11T14:00',
        reason: 'confirm the details we discussed',
      }),
    };
  },

  /** A timezone this runtime has never heard of. Expect `UNKNOWN_TIMEZONE`. */
  bogusTimezone(contactId: string): ScriptedToolCall {
    return {
      toolName: 'schedule_followup',
      argumentsJson: scriptedArgs({
        contact_id: contactId,
        when: 'tomorrow at 3pm',
        timezone: 'America/Notarealplace',
        reason: 'callback',
      }),
    };
  },

  /** A contact id the model made up. Expect `UNKNOWN_CONTACT`. */
  fabricatedContactId(): ScriptedToolCall {
    return {
      toolName: 'schedule_followup',
      argumentsJson: scriptedArgs({
        contact_id: 'contact_the_model_invented',
        when: 'tomorrow at 3pm',
        reason: 'callback',
      }),
    };
  },

  /** Inside the day but outside the configured hours. Expect `OUTSIDE_BUSINESS_HOURS`. */
  outsideBusinessHours(contactId: string): ScriptedToolCall {
    return {
      toolName: 'schedule_followup',
      argumentsJson: scriptedArgs({
        contact_id: contactId,
        when: 'tomorrow at 6am',
        reason: 'early callback',
      }),
    };
  },

  /** A real tool the configuration does not permit. Expect `POLICY_VIOLATION`. */
  toolNotPermittedByConfiguration(contactId: string): ScriptedToolCall {
    return {
      toolName: 'transfer_to_human',
      argumentsJson: scriptedArgs({ contact_id: contactId, reason: 'they asked for a manager' }),
    };
  },

  /** A flattering score for someone who cannot sign. Expect the cap to bite. */
  qualificationScoreAboveTheCap(contactId: string): ScriptedToolCall {
    return {
      toolName: 'update_qualification',
      argumentsJson: scriptedArgs({
        contact_id: contactId,
        proposed_score: 95,
        notes: 'Very enthusiastic, says the whole team wants it.',
      }),
    };
  },

  /** A follow-up type the slice declares but does not execute. Expect a structured refusal. */
  unsupportedFollowupType(contactId: string): ScriptedToolCall {
    return {
      toolName: 'schedule_followup',
      argumentsJson: scriptedArgs({
        contact_id: contactId,
        when: 'tomorrow at 3pm',
        action_type: 'SEND_FOLLOWUP_MESSAGE',
        reason: 'text them the pricing sheet',
      }),
    };
  },
} as const;
