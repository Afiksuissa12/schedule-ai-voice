/**
 * What a tool call hands back.
 *
 * TWO AUDIENCES, ONE OBJECT
 * ---------------------------------------------------------------------------
 * A tool result is read by a model on the next turn and by a human months
 * later. So it carries both: `summary`, one sentence written to be spoken back
 * or read in a timeline, and `data`, the structured facts. A rejection carries
 * a `ValidationErrorCode` and a `reason` that names the fix, because a model
 * that is told "invalid" learns nothing and a model that is told "you did not
 * say am or pm" asks the right question.
 *
 * A REJECTION IS A RESULT, NOT AN EXCEPTION
 * ---------------------------------------------------------------------------
 * Every refusal comes back through this type and is persisted as a TOOL turn,
 * so the model sees it on the next iteration and the transcript records it.
 * Throwing instead would lose both. Exceptions are reserved for things that are
 * genuinely our fault - a failed audit write, a broken configuration - and
 * those are supposed to stop the turn.
 */
import type { ValidationErrorCode, ValidationProvenance } from '../../ports/validation.js';
import { stringifyJson } from '../../shared/json.js';

export interface ToolSuccess {
  readonly ok: true;
  readonly toolCallId: string;
  readonly toolName: string;
  /** One sentence. Safe to render in a timeline or to speak back. */
  readonly summary: string;
  /** The structured facts the model may rely on. Persisted facts only. */
  readonly data: Record<string, unknown>;
  /** Present whenever a datetime was validated to produce this. */
  readonly provenance?: ValidationProvenance;
  /** The row this call wrote, when it wrote one. */
  readonly persisted?: { readonly type: string; readonly id: string };
}

export interface ToolRejection {
  readonly ok: false;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly code: ValidationErrorCode;
  /** Written to be handed straight to the model. Names the fix where it can. */
  readonly reason: string;
  readonly provenance?: ValidationProvenance;
  /**
   * Whether trying again could plausibly work.
   *
   * `false` for a schema violation or an unknown tool - repeating those is just
   * burning turns. `true` for an ambiguous or unavailable time, where a
   * clarifying question genuinely changes the answer.
   */
  readonly retryable: boolean;
  /** Extra context the model can use, e.g. the permitted tool names. */
  readonly data?: Record<string, unknown>;
}

export type ToolOutcome = ToolSuccess | ToolRejection;

export function toolSuccess(input: Omit<ToolSuccess, 'ok'>): ToolSuccess {
  return { ok: true, ...input };
}

export function toolRejection(input: Omit<ToolRejection, 'ok'>): ToolRejection {
  return { ok: false, ...input };
}

/**
 * The tool result as the model reads it.
 *
 * Deliberately small and stable: `ok`, a sentence, the facts, and on a refusal
 * the code and the reason. Internal ids that are not meant to be spoken (the
 * correlation id, provenance internals) are not here - they are in the audit
 * trail, where they belong.
 */
export function toModelPayload(outcome: ToolOutcome): Record<string, unknown> {
  if (outcome.ok) {
    return {
      ok: true,
      tool: outcome.toolName,
      summary: outcome.summary,
      ...outcome.data,
    };
  }
  return {
    ok: false,
    tool: outcome.toolName,
    error_code: outcome.code,
    reason: outcome.reason,
    retryable: outcome.retryable,
    ...(outcome.data ?? {}),
  };
}

/** The serialized tool result stored on the TOOL `ConversationTurn`. */
export function toModelPayloadJson(outcome: ToolOutcome): string {
  return stringifyJson(toModelPayload(outcome));
}
