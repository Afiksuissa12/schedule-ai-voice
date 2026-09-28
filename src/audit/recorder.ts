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
 * HOW LONG "TRY AGAIN" LASTS, AND WHY IT IS NOT A COUNT
 * ---------------------------------------------------------------------------
 * It used to be a fixed budget of 8 attempts, and that was a real defect rather
 * than a tuning choice: the number of retries a writer needs is a function of how
 * many writers are contending, not a constant. With N writers racing one
 * correlationId, the last one to win needs N attempts, so any fixed budget below
 * N turns contention into a thrown `AuditWriteError` - i.e. a dropped audit event,
 * which is the one failure this module exists to prevent. It surfaced as an
 * INTERMITTENT full-suite failure ("after 8 attempts") whose frequency depended on
 * host load; `docs/MISSION_2G_VERIFIER_ROUND.md` § 11 records the reproduction.
 *
 * The bound is now the PROGRESS INVARIANT stated inline in `record`: a lost race
 * necessarily advances the chain, so retrying is only correct while the chain is
 * advancing, and that condition is self-limiting because a chain can only advance
 * once per committed event. Raising a constant would have been the wrong fix; the
 * constant that remains is a liveness backstop and says so.
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

/**
 * A LIVENESS BACKSTOP, NOT A CONTENTION BUDGET. Read the note on `record`.
 *
 * The operative bound on retrying is "the chain must have advanced", which is
 * self-limiting. This constant exists only so that an unforeseen error class
 * cannot turn the loop into a hang; reaching it means the progress invariant
 * below is broken, which is a bug and is reported as one.
 */
const SEQUENCE_ALLOCATION_LIVENESS_CAP = 256;

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
    let previousMax = -1;

    for (let attempt = 1; attempt <= SEQUENCE_ALLOCATION_LIVENESS_CAP; attempt += 1) {
      const observedMax = await this.currentMaxSequence(event.correlationId);
      const sequence = observedMax + 1;

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

        if (!isUniqueConstraintViolation(error)) {
          throw new AuditWriteError(
            `Failed to record audit event ${event.type} for correlation ${event.correlationId}: ${describeError(error)}`,
            { cause: error, details: { type: event.type, correlationId: event.correlationId, sequence } },
          );
        }

        // WE LOST A RACE, AND THAT MEANS THE CHAIN MOVED.
        //
        // `@@unique([correlationId, sequence])` is the ONLY unique constraint on
        // this table, so a violation can only mean another writer committed the
        // slot we just tried. Therefore the chain's max is now at least the
        // sequence we attempted - strictly greater than the max we read. That is
        // the progress invariant, and it is what bounds this loop: the chain can
        // only advance as many times as there are events to commit, so a writer
        // retries at most once per writer ahead of it and then wins.
        //
        // If the max did NOT advance, the premise is false: something is failing
        // that is not a lost sequence race, and retrying would spin. Report it
        // instead of looping, and say which of the two it was.
        if (attempt > 1 && observedMax <= previousMax) {
          throw new AuditWriteError(
            `Audit sequence allocation for correlation ${event.correlationId} is not making progress: a unique ` +
              `constraint rejected sequence ${sequence} but the chain's highest sequence stayed at ${observedMax}. ` +
              'A lost race always advances the chain, so this is not contention.',
            {
              cause: error,
              details: {
                type: event.type,
                correlationId: event.correlationId,
                sequence,
                observedMax,
                attempt,
              },
            },
          );
        }
        previousMax = observedMax;
      }
    }

    // Unreachable while the progress invariant above holds: each iteration that
    // continues requires the chain to have grown by at least one, so reaching the
    // cap would mean this correlationId took 256 events while one writer waited.
    throw new AuditWriteError(
      `Audit sequence allocation for correlation ${event.correlationId} hit the ${SEQUENCE_ALLOCATION_LIVENESS_CAP}-` +
        'iteration liveness backstop. The chain advanced on every attempt, which should have let this writer win; ' +
        'treat this as a bug in the allocator rather than as contention.',
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
