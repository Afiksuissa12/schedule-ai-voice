/**
 * Creating the handover `Task`, in ONE place.
 *
 * WHY IT IS EXTRACTED
 * ---------------------------------------------------------------------------
 * Two things in this layer ask for a person: the `transfer_to_human` tool, when
 * the model decides to hand over, and the claim gate, when a turn's text cannot
 * be made truthful within its bound (`src/agent/claimGate/handoff.ts`). They
 * differ only in what the task SAYS. The row, the transaction and the pair of
 * audit events they write are identical, and two copies of "create the row and
 * emit `HUMAN_TRANSFER_REQUESTED` then `ENTITY_PERSISTED` on the same
 * transaction" would be two places for the ordering to drift.
 *
 * The extraction is behaviour-preserving by construction: every string the tool
 * path used to build is now passed IN by the tool path, so its audit summaries
 * and its `detailJson` are byte-for-byte what they were before.
 *
 * WHY THE GATE DOES NOT GO THROUGH `ToolDispatcher`
 * ---------------------------------------------------------------------------
 * Because it would have to lie. `dispatch` opens with `TOOL_CALL_REQUESTED`
 * summarised as "Model proposed transfer_to_human", and the model proposed
 * nothing - application code decided. An audit trail that records a fabricated
 * model intent to satisfy a code path is worse than a second entry point, so the
 * gate writes its own events with `toolCallId: null` and a summary that says who
 * actually asked.
 */
import type { Database } from '../../db/database.js';
import type { Task } from '../../domain/entities.js';
import type { IsoUtcString } from '../../ports/clock.js';
import type { StructuredPayload } from '../../shared/json.js';

export interface CreateHandoverTaskInput {
  readonly db: Database;
  readonly organizationId: string;
  readonly correlationId: string;
  readonly conversationId: string;
  readonly contactId: string;
  /** The tool call that asked, or `null` when application code did. */
  readonly toolCallId: string | null;
  readonly title: string;
  readonly description: string;
  readonly dueAtUtc: IsoUtcString;
  /** The turn's pinned instant. Every event lands on it. */
  readonly nowUtc: IsoUtcString;
  /** Summary for `HUMAN_TRANSFER_REQUESTED`. */
  readonly requestedSummary: string;
  /** Detail for `HUMAN_TRANSFER_REQUESTED`. The task id is added for you. */
  readonly requestedDetail: StructuredPayload;
}

/**
 * Create the task and record both events on one transaction.
 *
 * `HUMAN_TRANSFER_REQUESTED` first and `ENTITY_PERSISTED` second, which is the
 * order `AGENT_CONTRACT.md` § 5 documents and the order the chain for a handover
 * has always had.
 */
export async function createHandoverTask(input: CreateHandoverTaskInput): Promise<Task> {
  return input.db.withTransaction(async (tx) => {
    const row = await tx.tasks.create({
      organizationId: input.organizationId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      title: input.title,
      description: input.description,
      status: 'OPEN',
      dueAtUtc: input.dueAtUtc,
    });

    await tx.audit.record({
      type: 'HUMAN_TRANSFER_REQUESTED',
      organizationId: input.organizationId,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      toolCallId: input.toolCallId,
      subjectType: 'TASK',
      subjectId: row.id,
      summary: input.requestedSummary,
      detailJson: { ...input.requestedDetail, taskId: row.id },
      occurredAt: input.nowUtc,
    });

    await tx.audit.record({
      type: 'ENTITY_PERSISTED',
      organizationId: input.organizationId,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      toolCallId: input.toolCallId,
      subjectType: 'TASK',
      subjectId: row.id,
      summary: `Handover task ${row.id} created`,
      detailJson: { taskId: row.id, status: row.status, dueAtUtc: row.dueAtUtc },
      occurredAt: input.nowUtc,
    });

    return row;
  });
}
