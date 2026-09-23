/**
 * `DueActionRunner` - the background execution mechanism.
 *
 * THIS IS THE PART THAT ENDS THE LEGACY PROTOTYPE'S BIGGEST GAP.
 * ---------------------------------------------------------------------------
 * There is no scheduler in memory, no timer holding a promise, and no LLM
 * context remembering anything. The DATABASE is the durable queue: a runner
 * asks "what is due?", takes a lease on a row, does the work, and writes the
 * result back. Kill the process at any point and a different process, on a
 * different machine, picks the work up and finishes it.
 *
 * NO EXTERNAL JOB QUEUE
 * ---------------------------------------------------------------------------
 * Deliberately no broker, no hosted scheduler, nothing paid. `FutureAction`
 * already carries `status`, `attempts`, `maxAttempts`, `leaseOwner` and
 * `leaseExpiresAt`, which is everything a durable queue needs.
 *
 * SAFETY PROPERTIES, AND WHERE EACH IS PROVED
 * ---------------------------------------------------------------------------
 *  - Two runners can never both claim one action. The claim is a conditional
 *    `updateMany` whose WHERE re-asserts claimability, so the loser sees
 *    `count === 0`. (`dueActionRunner.test.ts` runs two runners over one file.)
 *  - A crashed runner strands nothing. Its lease lapses and the row becomes
 *    claimable again. (Same file: expired-lease recovery.)
 *  - A poison action cannot loop forever. Each claim consumes an attempt; at
 *    `maxAttempts` the action goes terminally `FAILED`.
 *  - Retries back off. See `applyRetryBackoff` below for the one place this
 *    file reaches past the repositories, and why.
 *
 * DRIVING IT
 * ---------------------------------------------------------------------------
 * `runDueActions(nowUtc)` is ONE pass and returns a summary, so tests and the
 * integration slice drive it deterministically against a `FixedClock`. `start()`
 * is a thin loop wrapper for real operation and adds no logic of its own.
 */
import { createRepositories, type Repositories } from '../db/repositories/index.js';
import type { Database } from '../db/database.js';
import type { FutureAction } from '../domain/entities.js';
import type { CallOutcomeKind, CallStatus, FutureActionStatus } from '../domain/enums.js';
import type { Clock, IsoUtcString } from '../ports/clock.js';
import type { TelephonyCallStatus, TelephonyProvider } from '../ports/telephony.js';
import { describeError } from '../shared/errors.js';
import { parseCallContactPayload } from './payloads.js';

export interface BackoffPolicy {
  /** Delay before the FIRST retry. */
  readonly baseSeconds: number;
  /** Multiplier per attempt. `1` gives a fixed delay. */
  readonly factor: number;
  /** Ceiling, so a long-failing action still retries at a sane cadence. */
  readonly maxSeconds: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { baseSeconds: 300, factor: 2, maxSeconds: 3600 };

export interface DueActionRunnerOptions {
  readonly db: Database;
  /** The ONLY source of `now`. A `FixedClock` in tests. */
  readonly clock: Clock;
  readonly telephony: TelephonyProvider;
  /** Originating number used when a payload does not carry its own. */
  readonly fromE164: string;
  /** Recorded on `FutureAction.leaseOwner`. Defaults to a pid-derived id. */
  readonly runnerId?: string;
  /** How long a claim is held before another runner may steal it. Default 60s. */
  readonly leaseMilliseconds?: number;
  /** Maximum actions claimed per pass. Default 10. */
  readonly batchSize?: number;
  readonly backoff?: Partial<BackoffPolicy>;
}

export interface DueActionOutcome {
  readonly futureActionId: string;
  readonly status: FutureActionStatus;
  readonly callId: string | null;
  readonly providerCallId: string | null;
  readonly telephonyStatus: TelephonyCallStatus | null;
  readonly error: string | null;
  /** When the action will next become due, on a non-terminal failure. */
  readonly retryAtUtc: IsoUtcString | null;
}

export interface DueActionRunSummary {
  readonly nowUtc: IsoUtcString;
  readonly runnerId: string;
  readonly claimed: number;
  readonly executed: number;
  readonly retried: number;
  readonly failed: number;
  readonly outcomes: readonly DueActionOutcome[];
}

export interface StartOptions {
  /** Wall-clock milliseconds between passes. Default 15s. */
  readonly intervalMs?: number;
  /** Called with anything a pass threw. Passes never throw into the timer. */
  readonly onError?: (error: unknown) => void;
}

/**
 * How a reported telephony status is interpreted.
 *
 * `NO_ANSWER` is a RETRYABLE failure, not a success: the entire point of a
 * promised callback is to keep trying. `COMPLETED` is the only terminal
 * success. Non-terminal statuses (`QUEUED`, `RINGING`, `IN_PROGRESS`) mean the
 * vendor accepted the call but has not said how it ended; with no webhook
 * ingestion in this slice the runner leaves the action due again rather than
 * inventing an outcome it was never told.
 */
const TERMINAL_OUTCOME: Partial<Record<TelephonyCallStatus, { outcome: CallOutcomeKind; success: boolean }>> = {
  COMPLETED: { outcome: 'CONNECTED', success: true },
  NO_ANSWER: { outcome: 'NO_ANSWER', success: false },
  FAILED: { outcome: 'FAILED', success: false },
};

export class DueActionRunner {
  private readonly db: Database;
  private readonly clock: Clock;
  private readonly telephony: TelephonyProvider;
  private readonly fromE164: string;
  private readonly leaseMilliseconds: number;
  private readonly batchSize: number;
  private readonly backoff: BackoffPolicy;

  readonly runnerId: string;

  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(options: DueActionRunnerOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.telephony = options.telephony;
    this.fromE164 = options.fromE164;
    this.runnerId = options.runnerId ?? `runner-${process.pid}`;
    this.leaseMilliseconds = options.leaseMilliseconds ?? 60_000;
    this.batchSize = options.batchSize ?? 10;
    this.backoff = { ...DEFAULT_BACKOFF, ...(options.backoff ?? {}) };
  }

  /**
   * One deterministic pass: claim what is due, execute it, write the results.
   *
   * Never throws because of a single action - a poison row must not stop the
   * queue. Each action's fate is in the returned summary.
   */
  async runDueActions(nowUtc: IsoUtcString = this.clock.nowUtc()): Promise<DueActionRunSummary> {
    const claimedActions = await this.db.futureActions.claimDue({
      nowUtc,
      leaseOwner: this.runnerId,
      leaseMilliseconds: this.leaseMilliseconds,
      limit: this.batchSize,
    });

    const outcomes: DueActionOutcome[] = [];
    for (const action of claimedActions) {
      outcomes.push(await this.execute(action, nowUtc));
    }

    return {
      nowUtc,
      runnerId: this.runnerId,
      claimed: claimedActions.length,
      executed: outcomes.filter((outcome) => outcome.status === 'DONE').length,
      retried: outcomes.filter((outcome) => outcome.status === 'PENDING').length,
      failed: outcomes.filter((outcome) => outcome.status === 'FAILED').length,
      outcomes,
    };
  }

  /** Thin loop wrapper for real operation. Adds no logic of its own. */
  start(options: StartOptions = {}): void {
    if (this.running) return;
    this.running = true;
    const intervalMs = options.intervalMs ?? 15_000;

    const tick = async (): Promise<void> => {
      try {
        await this.runDueActions();
      } catch (error) {
        options.onError?.(error);
      } finally {
        if (this.running) {
          this.timer = setTimeout(() => void tick(), intervalMs);
          // Never hold the process open just to poll a queue.
          this.timer.unref?.();
        }
      }
    };

    void tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  // -------------------------------------------------------------------------

  private async execute(action: FutureAction, nowUtc: IsoUtcString): Promise<DueActionOutcome> {
    const correlationId = this.correlationIdFor(action);

    await this.audit(this.db, {
      type: 'FUTURE_ACTION_CLAIMED',
      action,
      correlationId,
      summary: `Runner ${this.runnerId} claimed ${action.type} ${action.id} (attempt ${action.attempts}/${action.maxAttempts})`,
      detail: {
        runnerId: this.runnerId,
        attempts: action.attempts,
        maxAttempts: action.maxAttempts,
        scheduledForUtc: action.scheduledForUtc,
        leaseMilliseconds: this.leaseMilliseconds,
      },
      occurredAt: nowUtc,
    });

    if (action.type !== 'CALL_CONTACT') {
      return this.failAttempt(
        action,
        correlationId,
        nowUtc,
        `FutureAction type ${action.type} has no dispatcher in this slice.`,
        { terminal: true },
      );
    }

    let payload;
    try {
      payload = parseCallContactPayload(action.payloadJson);
    } catch (error) {
      // A malformed payload will never become well-formed by waiting.
      return this.failAttempt(action, correlationId, nowUtc, describeError(error), { terminal: true });
    }

    await this.db.futureActions.markInProgress(action.id);

    // The Call row is written BEFORE dispatch on purpose: if the process dies
    // mid-dial, a QUEUED row records that we did try, which is the truth.
    const call = await this.db.calls.create({
      organizationId: action.organizationId,
      contactId: action.contactId,
      conversationId: action.conversationId,
      direction: 'OUTBOUND',
      providerName: this.telephony.name(),
      status: 'QUEUED',
      startedAt: nowUtc,
    });

    let telephonyStatus: TelephonyCallStatus;
    let providerCallId: string;
    try {
      const result = await this.telephony.placeCall({
        toE164: payload.toE164,
        fromE164: payload.fromE164 ?? this.fromE164,
        correlationId: payload.correlationId,
        // Per ATTEMPT, not per action: a retry really is a new call, and must
        // not be deduplicated away by the provider's idempotency.
        idempotencyKey: `future-action:${action.id}:attempt:${action.attempts}`,
      });
      telephonyStatus = result.status;
      providerCallId = result.providerCallId;
    } catch (error) {
      await this.db.calls.update(call.id, { status: 'FAILED', endedAt: nowUtc });
      await this.db.callOutcomes.upsertForCall({
        callId: call.id,
        outcome: 'FAILED',
        notes: describeError(error),
      });
      return this.failAttempt(action, correlationId, nowUtc, describeError(error), { callId: call.id });
    }

    const interpretation = TERMINAL_OUTCOME[telephonyStatus];

    if (interpretation === undefined) {
      // Dispatched but not yet resolved. Leave it due again; webhook-driven
      // completion is the real answer and is out of this slice.
      await this.db.calls.update(call.id, { status: telephonyStatus as CallStatus, providerCallId });
      return this.failAttempt(
        action,
        correlationId,
        nowUtc,
        `Telephony provider reported non-terminal status ${telephonyStatus}; no outcome yet.`,
        { callId: call.id, providerCallId, telephonyStatus },
      );
    }

    await this.db.calls.update(call.id, {
      status: telephonyStatus as CallStatus,
      providerCallId,
      endedAt: nowUtc,
    });
    const outcomeRow = await this.db.callOutcomes.upsertForCall({
      callId: call.id,
      outcome: interpretation.outcome,
      notes: payload.reason ?? null,
    });

    if (!interpretation.success) {
      return this.failAttempt(
        action,
        correlationId,
        nowUtc,
        `Call ${telephonyStatus.toLowerCase().replace('_', ' ')} (outcome ${interpretation.outcome}).`,
        { callId: call.id, providerCallId, telephonyStatus },
      );
    }

    // ---- success: transition and explain, atomically ------------------------
    const done = await this.db.withTransaction(async (tx) => {
      const row = await tx.futureActions.markDone(action.id, nowUtc);
      await tx.audit.record({
        type: 'FUTURE_ACTION_EXECUTED',
        organizationId: action.organizationId,
        correlationId,
        conversationId: action.conversationId,
        contactId: action.contactId,
        toolCallId: payload.toolCallId ?? null,
        subjectType: 'FUTURE_ACTION',
        subjectId: action.id,
        summary: `CALL_CONTACT ${action.id} completed via ${this.telephony.name()} (${providerCallId})`,
        detailJson: {
          runnerId: this.runnerId,
          attempts: action.attempts,
          callId: call.id,
          callOutcomeId: outcomeRow.id,
          providerName: this.telephony.name(),
          providerCallId,
          telephonyStatus,
          outcome: interpretation.outcome,
        },
        occurredAt: nowUtc,
      });
      return row;
    });

    return {
      futureActionId: done.id,
      status: done.status,
      callId: call.id,
      providerCallId,
      telephonyStatus,
      error: null,
      retryAtUtc: null,
    };
  }

  /**
   * Record a failed attempt: back to PENDING with backoff, or terminally FAILED.
   *
   * `attempts` was already incremented by `claimDue`, so `attempts >=
   * maxAttempts` here means this was the last one.
   *
   * ---------------------------------------------------------------------------
   * DECLARED DIVERGENCE (announced to MISSION-48d6ff04-AUTO-FOUNDATION)
   * ---------------------------------------------------------------------------
   * This is the ONE place in this task's code that reaches past the repository
   * layer, and only for one column. `FutureActionRepository.markFailed` returns
   * an action to PENDING but leaves `scheduledForUtc` alone, so the very next
   * pass re-claims it immediately - that is retry, not backoff, and it would
   * burn the whole attempt budget in a single pass.
   *
   * The requested fix is additive: `markFailed(id, { error, terminal,
   * retryAtUtc })`. Until it lands, the whole transition is written here in ONE
   * `$transaction` alongside the `FUTURE_ACTION_FAILED` audit event via
   * `createRepositories(tx)`, so atomicity and the "never act without an
   * explanation" invariant are both preserved. When the repository method
   * exists, only this method changes.
   */
  private async failAttempt(
    action: FutureAction,
    correlationId: string,
    nowUtc: IsoUtcString,
    error: string,
    extra: {
      terminal?: boolean;
      callId?: string;
      providerCallId?: string;
      telephonyStatus?: TelephonyCallStatus;
    } = {},
  ): Promise<DueActionOutcome> {
    const terminal = extra.terminal ?? action.attempts >= action.maxAttempts;
    const retryAtUtc = terminal
      ? null
      : new Date(Date.parse(nowUtc) + this.backoffMilliseconds(action.attempts)).toISOString();
    const status: FutureActionStatus = terminal ? 'FAILED' : 'PENDING';

    await this.db.prisma.$transaction(async (txClient) => {
      await txClient.futureAction.update({
        where: { id: action.id },
        data: {
          status,
          lastError: error,
          leaseOwner: null,
          leaseExpiresAt: null,
          ...(retryAtUtc ? { scheduledForUtc: new Date(retryAtUtc) } : {}),
        },
      });

      const tx: Repositories = createRepositories(txClient, { clock: this.clock });
      await tx.audit.record({
        type: 'FUTURE_ACTION_FAILED',
        organizationId: action.organizationId,
        correlationId,
        conversationId: action.conversationId,
        contactId: action.contactId,
        subjectType: 'FUTURE_ACTION',
        subjectId: action.id,
        summary: terminal
          ? `CALL_CONTACT ${action.id} FAILED terminally after ${action.attempts}/${action.maxAttempts} attempts: ${error}`
          : `CALL_CONTACT ${action.id} attempt ${action.attempts}/${action.maxAttempts} failed, retrying at ${retryAtUtc}: ${error}`,
        detailJson: {
          runnerId: this.runnerId,
          attempts: action.attempts,
          maxAttempts: action.maxAttempts,
          terminal,
          retryAtUtc,
          error,
          callId: extra.callId ?? null,
          providerCallId: extra.providerCallId ?? null,
          telephonyStatus: extra.telephonyStatus ?? null,
        },
        occurredAt: nowUtc,
      });
    });

    return {
      futureActionId: action.id,
      status,
      callId: extra.callId ?? null,
      providerCallId: extra.providerCallId ?? null,
      telephonyStatus: extra.telephonyStatus ?? null,
      error,
      retryAtUtc,
    };
  }

  /** `base * factor^(attempts-1)`, capped. Attempt 1 waits `baseSeconds`. */
  private backoffMilliseconds(attempts: number): number {
    const exponent = Math.max(0, attempts - 1);
    const seconds = Math.min(this.backoff.maxSeconds, this.backoff.baseSeconds * this.backoff.factor ** exponent);
    return Math.round(seconds * 1000);
  }

  /**
   * The chain this action belongs to.
   *
   * Normally the `correlationId` of the agent turn that promised the callback,
   * carried in the payload - that is what lets an auditor walk from "the model
   * said it would call back" to "the call happened". A synthetic id is used
   * only when the payload is unreadable, so an audit event is never dropped for
   * want of one.
   */
  private correlationIdFor(action: FutureAction): string {
    try {
      return parseCallContactPayload(action.payloadJson).correlationId;
    } catch {
      return `future-action:${action.id}`;
    }
  }

  private async audit(
    repositories: Repositories,
    event: {
      type: 'FUTURE_ACTION_CLAIMED';
      action: FutureAction;
      correlationId: string;
      summary: string;
      detail: Record<string, unknown>;
      occurredAt: IsoUtcString;
    },
  ): Promise<void> {
    await repositories.audit.record({
      type: event.type,
      organizationId: event.action.organizationId,
      correlationId: event.correlationId,
      conversationId: event.action.conversationId,
      contactId: event.action.contactId,
      subjectType: 'FUTURE_ACTION',
      subjectId: event.action.id,
      summary: event.summary,
      detailJson: event.detail,
      occurredAt: event.occurredAt,
    });
  }
}

/** Convenience for the integration slice: build a runner from parts. */
export function createDueActionRunner(options: DueActionRunnerOptions): DueActionRunner {
  return new DueActionRunner(options);
}
