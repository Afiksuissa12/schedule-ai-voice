/**
 * The audit event store: implementation.
 *
 * SEQUENCING
 * ---------------------------------------------------------------------------
 * `sequence` is a per-correlationId counter starting at 1, and
 * `@@unique([correlationId, sequence])` enforces it in the database. Allocation
 * is "read the current max, insert max+1, and if someone beat us to it, try
 * again". The unique constraint is the referee, so two concurrent writers can
 * never both take the same slot and one can never silently overwrite the other.
 *
 * FAILURE POLICY
 * ---------------------------------------------------------------------------
 * Audit writes never fail silently. Every failure path here throws
 * `AuditWriteError` with the cause attached. An action the system cannot
 * explain is an action it should not claim to have taken.
 */
import type { DbExecutor } from '../db/types.js';
import { isUniqueConstraintViolation } from '../db/prismaErrors.js';
import { toAuditEvent } from '../db/mappers.js';
import type { Clock } from '../ports/clock.js';
import { SystemClock } from '../ports/clock.js';
import { AuditWriteError, describeError } from '../shared/errors.js';
import { stringifyJson } from '../shared/json.js';
import type { AuditEvent, AuditEventInput, AuditRecorder, AuditSubjectType } from './types.js';

/** How many times to retry when another writer takes our sequence slot. */
const MAX_SEQUENCE_ALLOCATION_ATTEMPTS = 8;

export interface CreateAuditRecorderOptions {
  /** Supplies `occurredAt` when the caller does not. Defaults to `SystemClock`. */
  clock?: Clock;
}

/**
 * Prisma-backed `AuditRecorder`.
 *
 * Pass a transaction client as `db` to write audit events in the SAME
 * transaction as the domain row they describe - `Repositories.withTransaction`
 * does exactly that.
 */
export class PrismaAuditRecorder implements AuditRecorder {
  private readonly clock: Clock;

  constructor(
    private readonly db: DbExecutor,
    options: CreateAuditRecorderOptions = {},
  ) {
    this.clock = options.clock ?? new SystemClock();
  }

  async record(event: AuditEventInput): Promise<AuditEvent> {
    const detailJson = typeof event.detailJson === 'string' ? event.detailJson : stringifyJson(event.detailJson);
    const occurredAt = new Date(event.occurredAt ?? this.clock.nowUtc());

    if (Number.isNaN(occurredAt.getTime())) {
      throw new AuditWriteError(`Audit event has an unparseable occurredAt: ${String(event.occurredAt)}`, {
        details: { type: event.type, correlationId: event.correlationId },
      });
    }
    if (!event.correlationId) {
      throw new AuditWriteError('Audit event is missing a correlationId', { details: { type: event.type } });
    }
    if (!event.organizationId) {
      throw new AuditWriteError('Audit event is missing an organizationId', { details: { type: event.type } });
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_SEQUENCE_ALLOCATION_ATTEMPTS; attempt += 1) {
      const sequence = (await this.currentMaxSequence(event.correlationId)) + 1;

      try {
        const row = await this.db.auditEvent.create({
          data: {
            organizationId: event.organizationId,
            correlationId: event.correlationId,
            sequence,
            type: event.type,
            conversationId: event.conversationId ?? null,
            contactId: event.contactId ?? null,
            toolCallId: event.toolCallId ?? null,
            subjectType: event.subjectType ?? null,
            subjectId: event.subjectId ?? null,
            summary: event.summary,
            detailJson,
            occurredAt,
          },
        });
        return toAuditEvent(row);
      } catch (error) {
        lastError = error;
        // Someone else took this sequence slot: re-read the max and try again.
        if (isUniqueConstraintViolation(error)) {
          continue;
        }
        throw new AuditWriteError(
          `Failed to record audit event ${event.type} for correlation ${event.correlationId}: ${describeError(error)}`,
          { cause: error, details: { type: event.type, correlationId: event.correlationId, sequence } },
        );
      }
    }

    throw new AuditWriteError(
      `Failed to allocate an audit sequence for correlation ${event.correlationId} after ` +
        `${MAX_SEQUENCE_ALLOCATION_ATTEMPTS} attempts`,
      { cause: lastError, details: { type: event.type, correlationId: event.correlationId } },
    );
  }

  async listByCorrelationId(correlationId: string): Promise<AuditEvent[]> {
    try {
      const rows = await this.db.auditEvent.findMany({
        where: { correlationId },
        orderBy: { sequence: 'asc' },
      });
      return rows.map(toAuditEvent);
    } catch (error) {
      throw new AuditWriteError(`Failed to read the audit chain for correlation ${correlationId}`, {
        cause: error,
        details: { correlationId },
      });
    }
  }

  async listBySubject(subjectType: AuditSubjectType, subjectId: string): Promise<AuditEvent[]> {
    try {
      const rows = await this.db.auditEvent.findMany({
        where: { subjectType, subjectId },
        orderBy: [{ occurredAt: 'asc' }, { sequence: 'asc' }],
      });
      return rows.map(toAuditEvent);
    } catch (error) {
      throw new AuditWriteError(`Failed to read the audit trail for ${subjectType} ${subjectId}`, {
        cause: error,
        details: { subjectType, subjectId },
      });
    }
  }

  private async currentMaxSequence(correlationId: string): Promise<number> {
    try {
      const latest = await this.db.auditEvent.findFirst({
        where: { correlationId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      return latest?.sequence ?? 0;
    } catch (error) {
      throw new AuditWriteError(`Failed to read the current audit sequence for correlation ${correlationId}`, {
        cause: error,
        details: { correlationId },
      });
    }
  }
}

export function createAuditRecorder(db: DbExecutor, options: CreateAuditRecorderOptions = {}): AuditRecorder {
  return new PrismaAuditRecorder(db, options);
}
