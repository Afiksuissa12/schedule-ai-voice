/**
 * THE DESIGNED EXHAUSTION OUTCOME: nothing is said, and a person is asked for.
 *
 * WHAT HAPPENS WHEN EVERY BOUNDED ATTEMPT IS STILL UNSUPPORTED
 * ---------------------------------------------------------------------------
 *  1. NO text is released. Not the unsupported version, and not a replacement
 *     this code wrote - the Founder directive forbids canned customer-facing
 *     wording, and a gate that answered a model's dishonesty with a hardcoded
 *     apology would be the scripted conversation the whole architecture exists
 *     to prevent. `AgentTurnResult.assistantText` is therefore `null`, and every
 *     caller of `handleTurn` in this repository already handles that.
 *  2. A `Task` is created and `HUMAN_TRANSFER_REQUESTED` is emitted, through the
 *     same code path the `transfer_to_human` tool uses
 *     (`src/agent/tools/handoverTask.ts`).
 *  3. A SYSTEM note goes on the conversation, so the durable transcript records
 *     that the turn produced no words and why. The note is not customer-facing:
 *     it is a `SYSTEM` role turn, the same mechanism the iteration cap already
 *     uses.
 *  4. The turn ends with `stopReason: 'CLAIM_GATE_WITHHELD'`.
 *
 * WHY A TASK, AND NOT SILENCE ALONE
 * ---------------------------------------------------------------------------
 * Because the alternative has nobody accountable. The conversation has reached a
 * state where the model asserts something the records do not support and will not
 * stop asserting it; on a live call the contact is now waiting, and the only
 * thing that resolves that is a human being. A `Task` with a deadline is how this
 * system already expresses "a person must pick this up", it is already rendered
 * by `src/app/auditReport.ts`, and it is already the thing an operator's queue
 * reads. Recording the withholding only in the audit trail would make it
 * explainable afterwards and actionable by nobody.
 *
 * It is worth stating the consequence plainly rather than burying it: THIS PATH
 * WRITES ONE ROW - a `Task`. It writes no `Meeting`, no `FutureAction`, no
 * `QualificationState`, no `Call` and no `CallOutcome`; in particular it never
 * creates the effect the model falsely claimed, which is the property that
 * matters. `tests/e2e/claimGateExhaustion.test.ts` asserts exactly that split.
 * The handover is marked URGENT, because a caller is on the line.
 */
import type { Database } from '../../db/database.js';
import type { Contact } from '../../domain/entities.js';
import type { IsoUtcString } from '../../ports/clock.js';
import type { Task } from '../../domain/entities.js';
import { createHandoverTask } from '../tools/handoverTask.js';
import type { ClaimGateDecision } from './claimGate.js';

export interface ClaimGateHandoffInput {
  readonly db: Database;
  readonly organizationId: string;
  readonly correlationId: string;
  readonly conversationId: string;
  readonly contact: Contact;
  readonly nowUtc: IsoUtcString;
  readonly decision: ClaimGateDecision;
}

/**
 * The reason recorded on the handover task and the audit event.
 *
 * Written for an OPERATOR, in the vocabulary of the system - claim families,
 * reason codes, attempt counts. Deliberately not something anybody could read
 * out to a contact.
 */
function handoverReason(decision: ClaimGateDecision): string {
  const last = decision.attempts.at(-1);
  const reasons = (last?.unsupportedClaims ?? []).map((entry) => `${entry.claim.family}/${entry.reason}`);
  return (
    `The agent could not produce a truthful version of this turn within ${decision.attempts.length} attempt(s). ` +
    `Unsupported claims: ${reasons.length > 0 ? reasons.join(', ') : 'none recorded'}. ` +
    'No text was released to the contact and no scheduling row was written. A person must take this conversation over.'
  );
}

export async function handOffAfterClaimGateExhaustion(input: ClaimGateHandoffInput): Promise<Task> {
  const reason = handoverReason(input.decision);

  return createHandoverTask({
    db: input.db,
    organizationId: input.organizationId,
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    contactId: input.contact.id,
    // Application code asked for this, not a model-proposed tool call. Recording
    // a tool call id here would invent one.
    toolCallId: null,
    title: `[URGENT] Claim gate handover: ${input.contact.fullName}`,
    description: [
      reason,
      ...input.decision.attempts.map(
        (attempt) =>
          `attempt ${attempt.attempt}: ` +
          (attempt.unsupportedClaims.length === 0
            ? 'no unsupported claim recorded'
            : attempt.unsupportedClaims.map((entry) => `${entry.reason} (${entry.claim.matchedForm})`).join('; ')),
      ),
    ].join('\n\n'),
    // A caller is waiting. Due now.
    dueAtUtc: input.nowUtc,
    nowUtc: input.nowUtc,
    requestedSummary: `Handover to a human requested (URGENT): claim gate withheld this turn's text`,
    requestedDetail: {
      urgency: 'URGENT',
      requestedBy: 'CLAIM_GATE',
      reason,
      attemptCount: input.decision.attempts.length,
      unsupportedReasons: (input.decision.attempts.at(-1)?.unsupportedClaims ?? []).map((entry) => entry.reason),
    },
  });
}
