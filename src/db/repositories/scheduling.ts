/**
 * Repositories for the scheduling outcomes: CalendarConnection, Meeting,
 * FutureAction, Task.
 *
 * TWO INVARIANTS ARE ENFORCED HERE, NOT HOPED FOR:
 *
 *  1. A Meeting or a FutureAction CANNOT be created without a real
 *     `validationProvenanceJson`. The column is NOT NULL, the input type makes
 *     it required, and `requireProvenance` additionally rejects an empty
 *     string, unparseable JSON, or a structurally empty receipt. Application
 *     code validated the datetime, or the row does not exist.
 *
 *  2. FutureAction claiming is lease-based and crash-safe. A runner claims a
 *     row with a conditional update, so two runners can never both hold it; a
 *     runner that dies simply lets its lease lapse and the row becomes
 *     claimable again. Nothing about the schedule lives in memory.
 */
import { isValidProvenanceJson } from '../../domain/provenance.js';
import type { CalendarConnection, FutureAction, Meeting, Task } from '../../domain/entities.js';
import type {
  CalendarConnectionStatus,
  CalendarProviderKind,
  FutureActionStatus,
  FutureActionType,
  MeetingStatus,
  TaskStatus,
} from '../../domain/enums.js';
import { InvariantViolationError, NotFoundError } from '../../shared/errors.js';
import type { IsoUtcString } from '../../shared/time.js';
import { fromIsoUtc, fromIsoUtcOrNull } from '../../shared/time.js';
import { toCalendarConnection, toFutureAction, toMeeting, toTask } from '../mappers.js';
import { translatePrismaError } from '../prismaErrors.js';
import type { DbExecutor, PageOptions } from '../types.js';

/**
 * The gate on `validationProvenanceJson`.
 *
 * This is the enforcement point for "never trust an LLM-generated datetime
 * blindly": if application code cannot produce a receipt showing which checks
 * it ran against which `now`, the row is refused.
 */
function requireProvenance(json: string, field: string): string {
  if (json.trim().length === 0) {
    throw new InvariantViolationError(
      `${field} is required: a row that records a scheduling decision cannot exist without its ValidationProvenance`,
      { details: { field } },
    );
  }
  if (!isValidProvenanceJson(json)) {
    throw new InvariantViolationError(
      `${field} must be a serialized ValidationProvenance with at least one recorded check`,
      { details: { field, preview: json.slice(0, 200) } },
    );
  }
  return json;
}

// ---------------------------------------------------------------------------
// CalendarConnection
// ---------------------------------------------------------------------------

export interface CreateCalendarConnectionInput {
  readonly organizationId: string;
  readonly provider: CalendarProviderKind;
  /** Opaque, NON-SECRET account reference. Never a token. */
  readonly externalAccountRef?: string | null;
  readonly status?: CalendarConnectionStatus;
  readonly calendarRef: string;
}

export interface CalendarConnectionRepository {
  create(input: CreateCalendarConnectionInput): Promise<CalendarConnection>;
  findById(id: string): Promise<CalendarConnection | null>;
  requireById(id: string): Promise<CalendarConnection>;
  listByOrganization(
    organizationId: string,
    options?: PageOptions & { status?: CalendarConnectionStatus; provider?: CalendarProviderKind },
  ): Promise<CalendarConnection[]>;
  /** The connection to actually use: ACTIVE, else the TEST_DOUBLE. */
  findUsableByOrganization(organizationId: string): Promise<CalendarConnection | null>;
  updateStatus(id: string, status: CalendarConnectionStatus): Promise<CalendarConnection>;
}

export function createCalendarConnectionRepository(db: DbExecutor): CalendarConnectionRepository {
  return {
    async create(input) {
      try {
        const row = await db.calendarConnection.create({
          data: {
            organizationId: input.organizationId,
            provider: input.provider,
            externalAccountRef: input.externalAccountRef ?? null,
            status: input.status ?? 'TEST_DOUBLE',
            calendarRef: input.calendarRef,
          },
        });
        return toCalendarConnection(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'CalendarConnection', operation: 'create' });
      }
    },

    async findById(id) {
      const row = await db.calendarConnection.findUnique({ where: { id } });
      return row ? toCalendarConnection(row) : null;
    },

    async requireById(id) {
      const found = await this.findById(id);
      if (!found) throw new NotFoundError('CalendarConnection', id);
      return found;
    },

    async listByOrganization(organizationId, options) {
      const rows = await db.calendarConnection.findMany({
        where: {
          organizationId,
          ...(options?.status ? { status: options.status } : {}),
          ...(options?.provider ? { provider: options.provider } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: options?.take,
        skip: options?.skip,
      });
      return rows.map(toCalendarConnection);
    },

    async findUsableByOrganization(organizationId) {
      const row = await db.calendarConnection.findFirst({
        where: { organizationId, status: { in: ['ACTIVE', 'TEST_DOUBLE'] } },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      });
      return row ? toCalendarConnection(row) : null;
    },

    async updateStatus(id, status) {
      try {
        const row = await db.calendarConnection.update({ where: { id }, data: { status } });
        return toCalendarConnection(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'CalendarConnection', operation: 'updateStatus' });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Meeting
// ---------------------------------------------------------------------------

export interface CreateMeetingInput {
  readonly organizationId: string;
  readonly contactId: string;
  readonly conversationId?: string | null;
  readonly calendarConnectionId?: string | null;
  readonly title: string;
  readonly description?: string | null;
  readonly startUtc: IsoUtcString;
  readonly endUtc: IsoUtcString;
  /** IANA zone the meeting was agreed in. */
  readonly timezone: string;
  readonly status?: MeetingStatus;
  readonly externalCalendarEventId?: string | null;
  readonly idempotencyKey?: string | null;
  /** REQUIRED. Serialized `ValidationProvenance`. */
  readonly validationProvenanceJson: string;
}

export interface UpdateMeetingInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly startUtc?: IsoUtcString;
  readonly endUtc?: IsoUtcString;
  readonly timezone?: string;
  readonly status?: MeetingStatus;
  readonly externalCalendarEventId?: string | null;
  readonly calendarConnectionId?: string | null;
  /** Supply a fresh receipt whenever the time changes. */
  readonly validationProvenanceJson?: string;
}

export interface MeetingRepository {
  create(input: CreateMeetingInput): Promise<Meeting>;
  findById(id: string): Promise<Meeting | null>;
  requireById(id: string): Promise<Meeting>;
  findByIdempotencyKey(idempotencyKey: string): Promise<Meeting | null>;
  listByContact(contactId: string, page?: PageOptions): Promise<Meeting[]>;
  listByConversation(conversationId: string, page?: PageOptions): Promise<Meeting[]>;
  /**
   * Meetings overlapping [fromUtc, toUtc) for an organization. Used to detect a
   * double-booking against meetings this system itself created - a check that
   * is independent of, and additional to, the AvailabilityProvider.
   */
  listOverlapping(
    organizationId: string,
    fromUtc: IsoUtcString,
    toUtc: IsoUtcString,
    options?: { excludeStatuses?: readonly MeetingStatus[] },
  ): Promise<Meeting[]>;
  update(id: string, patch: UpdateMeetingInput): Promise<Meeting>;
  updateStatus(id: string, status: MeetingStatus): Promise<Meeting>;
}

export function createMeetingRepository(db: DbExecutor): MeetingRepository {
  return {
    async create(input) {
      const startUtc = fromIsoUtc(input.startUtc);
      const endUtc = fromIsoUtc(input.endUtc);
      if (endUtc.getTime() <= startUtc.getTime()) {
        throw new InvariantViolationError('Meeting.endUtc must be strictly after Meeting.startUtc', {
          details: { startUtc: input.startUtc, endUtc: input.endUtc },
        });
      }

      try {
        const row = await db.meeting.create({
          data: {
            organizationId: input.organizationId,
            contactId: input.contactId,
            conversationId: input.conversationId ?? null,
            calendarConnectionId: input.calendarConnectionId ?? null,
            title: input.title,
            description: input.description ?? null,
            startUtc,
            endUtc,
            timezone: input.timezone,
            status: input.status ?? 'SCHEDULED',
            externalCalendarEventId: input.externalCalendarEventId ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
            validationProvenanceJson: requireProvenance(
              input.validationProvenanceJson,
              'Meeting.validationProvenanceJson',
            ),
          },
        });
        return toMeeting(row);
      } catch (error) {
        if (error instanceof InvariantViolationError) throw error;
        translatePrismaError(error, { entity: 'Meeting', operation: 'create' });
      }
    },

    async findById(id) {
      const row = await db.meeting.findUnique({ where: { id } });
      return row ? toMeeting(row) : null;
    },

    async requireById(id) {
      const found = await this.findById(id);
      if (!found) throw new NotFoundError('Meeting', id);
      return found;
    },

    async findByIdempotencyKey(idempotencyKey) {
      const row = await db.meeting.findUnique({ where: { idempotencyKey } });
      return row ? toMeeting(row) : null;
    },

    async listByContact(contactId, page) {
      const rows = await db.meeting.findMany({
        where: { contactId },
        orderBy: { startUtc: 'asc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toMeeting);
    },

    async listByConversation(conversationId, page) {
      const rows = await db.meeting.findMany({
        where: { conversationId },
        orderBy: { startUtc: 'asc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toMeeting);
    },

    async listOverlapping(organizationId, fromUtc, toUtc, options) {
      const excluded = options?.excludeStatuses ?? (['CANCELLED'] as const);
      const rows = await db.meeting.findMany({
        where: {
          organizationId,
          status: { notIn: [...excluded] },
          // Half-open overlap: existing.start < to AND existing.end > from.
          startUtc: { lt: fromIsoUtc(toUtc) },
          endUtc: { gt: fromIsoUtc(fromUtc) },
        },
        orderBy: { startUtc: 'asc' },
      });
      return rows.map(toMeeting);
    },

    async update(id, patch) {
      try {
        const row = await db.meeting.update({
          where: { id },
          data: {
            title: patch.title,
            description: patch.description,
            startUtc: patch.startUtc === undefined ? undefined : fromIsoUtc(patch.startUtc),
            endUtc: patch.endUtc === undefined ? undefined : fromIsoUtc(patch.endUtc),
            timezone: patch.timezone,
            status: patch.status,
            externalCalendarEventId: patch.externalCalendarEventId,
            calendarConnectionId: patch.calendarConnectionId,
            validationProvenanceJson:
              patch.validationProvenanceJson === undefined
                ? undefined
                : requireProvenance(patch.validationProvenanceJson, 'Meeting.validationProvenanceJson'),
          },
        });
        return toMeeting(row);
      } catch (error) {
        if (error instanceof InvariantViolationError) throw error;
        translatePrismaError(error, { entity: 'Meeting', operation: 'update' });
      }
    },

    async updateStatus(id, status) {
      return this.update(id, { status });
    },
  };
}

// ---------------------------------------------------------------------------
// FutureAction
// ---------------------------------------------------------------------------

export interface CreateFutureActionInput {
  readonly organizationId: string;
  readonly contactId: string;
  readonly conversationId?: string | null;
  readonly type: FutureActionType;
  readonly scheduledForUtc: IsoUtcString;
  /** IANA zone the follow-up was agreed in. */
  readonly timezone: string;
  readonly status?: FutureActionStatus;
  readonly maxAttempts?: number;
  /** Serialized, application-validated action payload. */
  readonly payloadJson: string;
  readonly idempotencyKey?: string | null;
  /** REQUIRED. Serialized `ValidationProvenance`. */
  readonly validationProvenanceJson: string;
}

export interface ClaimDueFutureActionsInput {
  /** `now`, from an injected Clock. */
  readonly nowUtc: IsoUtcString;
  /** Opaque runner identity, recorded on `leaseOwner`. */
  readonly leaseOwner: string;
  /** How long the claim is held before another runner may steal it. */
  readonly leaseMilliseconds: number;
  readonly limit?: number;
}

export interface FutureActionRepository {
  create(input: CreateFutureActionInput): Promise<FutureAction>;
  findById(id: string): Promise<FutureAction | null>;
  requireById(id: string): Promise<FutureAction>;
  findByIdempotencyKey(idempotencyKey: string): Promise<FutureAction | null>;
  listByContact(contactId: string, page?: PageOptions): Promise<FutureAction[]>;
  listByStatus(
    organizationId: string,
    status: FutureActionStatus,
    page?: PageOptions,
  ): Promise<FutureAction[]>;
  /** Read-only view of what is due. Does not claim anything. */
  listDue(nowUtc: IsoUtcString, options?: PageOptions): Promise<FutureAction[]>;
  /**
   * Atomically take the lease on up to `limit` due actions.
   *
   * Claimable = PENDING, or CLAIMED/IN_PROGRESS with an EXPIRED lease (the
   * crash-recovery path), and `attempts < maxAttempts`. Each claim increments
   * `attempts`, so a repeatedly-crashing action exhausts its budget instead of
   * looping forever.
   */
  claimDue(input: ClaimDueFutureActionsInput): Promise<FutureAction[]>;
  markInProgress(id: string): Promise<FutureAction>;
  markDone(id: string, completedAtUtc: IsoUtcString): Promise<FutureAction>;
  /**
   * Record a failed attempt. Goes terminal (`FAILED`) once the attempt budget
   * is exhausted, otherwise returns to `PENDING` for another runner.
   */
  markFailed(id: string, input: { error: string; terminal?: boolean }): Promise<FutureAction>;
  cancel(id: string): Promise<FutureAction>;
  /** Drop the lease without consuming anything else. */
  releaseLease(id: string): Promise<FutureAction>;
}

export function createFutureActionRepository(db: DbExecutor): FutureActionRepository {
  async function byId(id: string): Promise<FutureAction> {
    const row = await db.futureAction.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('FutureAction', id);
    return toFutureAction(row);
  }

  return {
    async create(input) {
      if (input.payloadJson.trim().length === 0) {
        throw new InvariantViolationError('FutureAction.payloadJson must not be empty');
      }
      const maxAttempts = input.maxAttempts ?? 3;
      if (maxAttempts < 1) {
        throw new InvariantViolationError('FutureAction.maxAttempts must be at least 1', {
          details: { maxAttempts },
        });
      }

      try {
        const row = await db.futureAction.create({
          data: {
            organizationId: input.organizationId,
            contactId: input.contactId,
            conversationId: input.conversationId ?? null,
            type: input.type,
            scheduledForUtc: fromIsoUtc(input.scheduledForUtc),
            timezone: input.timezone,
            status: input.status ?? 'PENDING',
            attempts: 0,
            maxAttempts,
            payloadJson: input.payloadJson,
            idempotencyKey: input.idempotencyKey ?? null,
            validationProvenanceJson: requireProvenance(
              input.validationProvenanceJson,
              'FutureAction.validationProvenanceJson',
            ),
          },
        });
        return toFutureAction(row);
      } catch (error) {
        if (error instanceof InvariantViolationError) throw error;
        translatePrismaError(error, { entity: 'FutureAction', operation: 'create' });
      }
    },

    async findById(id) {
      const row = await db.futureAction.findUnique({ where: { id } });
      return row ? toFutureAction(row) : null;
    },

    requireById: byId,

    async findByIdempotencyKey(idempotencyKey) {
      const row = await db.futureAction.findUnique({ where: { idempotencyKey } });
      return row ? toFutureAction(row) : null;
    },

    async listByContact(contactId, page) {
      const rows = await db.futureAction.findMany({
        where: { contactId },
        orderBy: { scheduledForUtc: 'asc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toFutureAction);
    },

    async listByStatus(organizationId, status, page) {
      const rows = await db.futureAction.findMany({
        where: { organizationId, status },
        orderBy: { scheduledForUtc: 'asc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toFutureAction);
    },

    async listDue(nowUtc, options) {
      const now = fromIsoUtc(nowUtc);
      const rows = await db.futureAction.findMany({
        where: { status: 'PENDING', scheduledForUtc: { lte: now } },
        orderBy: { scheduledForUtc: 'asc' },
        take: options?.take,
        skip: options?.skip,
      });
      return rows.map(toFutureAction);
    },

    async claimDue(input) {
      const now = fromIsoUtc(input.nowUtc);
      const leaseExpiresAt = new Date(now.getTime() + input.leaseMilliseconds);
      const limit = input.limit ?? 10;

      const candidates = await db.futureAction.findMany({
        where: {
          scheduledForUtc: { lte: now },
          OR: [
            { status: 'PENDING' },
            // Crash recovery: a lease that has lapsed is fair game.
            { status: { in: ['CLAIMED', 'IN_PROGRESS'] }, leaseExpiresAt: { lt: now } },
          ],
        },
        orderBy: { scheduledForUtc: 'asc' },
        take: limit * 2,
        select: { id: true, attempts: true, maxAttempts: true },
      });

      const claimed: FutureAction[] = [];

      for (const candidate of candidates) {
        if (claimed.length >= limit) break;
        // Prisma cannot compare two columns portably here, so the attempt
        // budget is checked in application code against the values just read.
        if (candidate.attempts >= candidate.maxAttempts) continue;

        // Conditional update: the WHERE re-asserts claimability, so if another
        // runner claimed this row between the read and the write, count === 0
        // and we simply move on.
        const result = await db.futureAction.updateMany({
          where: {
            id: candidate.id,
            OR: [
              { status: 'PENDING' },
              { status: { in: ['CLAIMED', 'IN_PROGRESS'] }, leaseExpiresAt: { lt: now } },
            ],
          },
          data: {
            status: 'CLAIMED',
            leaseOwner: input.leaseOwner,
            leaseExpiresAt,
            attempts: { increment: 1 },
          },
        });

        if (result.count === 1) {
          claimed.push(await byId(candidate.id));
        }
      }

      return claimed;
    },

    async markInProgress(id) {
      try {
        return toFutureAction(await db.futureAction.update({ where: { id }, data: { status: 'IN_PROGRESS' } }));
      } catch (error) {
        translatePrismaError(error, { entity: 'FutureAction', operation: 'markInProgress' });
      }
    },

    async markDone(id, completedAtUtc) {
      try {
        return toFutureAction(
          await db.futureAction.update({
            where: { id },
            data: {
              status: 'DONE',
              completedAt: fromIsoUtc(completedAtUtc),
              leaseOwner: null,
              leaseExpiresAt: null,
              lastError: null,
            },
          }),
        );
      } catch (error) {
        translatePrismaError(error, { entity: 'FutureAction', operation: 'markDone' });
      }
    },

    async markFailed(id, { error, terminal }) {
      const current = await byId(id);
      const isTerminal = terminal ?? current.attempts >= current.maxAttempts;
      try {
        return toFutureAction(
          await db.futureAction.update({
            where: { id },
            data: {
              status: isTerminal ? 'FAILED' : 'PENDING',
              lastError: error,
              leaseOwner: null,
              leaseExpiresAt: null,
            },
          }),
        );
      } catch (cause) {
        translatePrismaError(cause, { entity: 'FutureAction', operation: 'markFailed' });
      }
    },

    async cancel(id) {
      try {
        return toFutureAction(
          await db.futureAction.update({
            where: { id },
            data: { status: 'CANCELLED', leaseOwner: null, leaseExpiresAt: null },
          }),
        );
      } catch (error) {
        translatePrismaError(error, { entity: 'FutureAction', operation: 'cancel' });
      }
    },

    async releaseLease(id) {
      try {
        return toFutureAction(
          await db.futureAction.update({
            where: { id },
            data: { status: 'PENDING', leaseOwner: null, leaseExpiresAt: null },
          }),
        );
      } catch (error) {
        translatePrismaError(error, { entity: 'FutureAction', operation: 'releaseLease' });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  readonly organizationId: string;
  readonly contactId?: string | null;
  readonly conversationId?: string | null;
  readonly futureActionId?: string | null;
  readonly assignedToUserId?: string | null;
  readonly title: string;
  readonly description?: string | null;
  readonly status?: TaskStatus;
  readonly dueAtUtc?: IsoUtcString | null;
}

export interface UpdateTaskInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly status?: TaskStatus;
  readonly assignedToUserId?: string | null;
  readonly dueAtUtc?: IsoUtcString | null;
}

export interface TaskRepository {
  create(input: CreateTaskInput): Promise<Task>;
  findById(id: string): Promise<Task | null>;
  requireById(id: string): Promise<Task>;
  listByOrganization(organizationId: string, options?: PageOptions & { status?: TaskStatus }): Promise<Task[]>;
  listByContact(contactId: string, page?: PageOptions): Promise<Task[]>;
  update(id: string, patch: UpdateTaskInput): Promise<Task>;
}

export function createTaskRepository(db: DbExecutor): TaskRepository {
  return {
    async create(input) {
      try {
        const row = await db.task.create({
          data: {
            organizationId: input.organizationId,
            contactId: input.contactId ?? null,
            conversationId: input.conversationId ?? null,
            futureActionId: input.futureActionId ?? null,
            assignedToUserId: input.assignedToUserId ?? null,
            title: input.title,
            description: input.description ?? null,
            status: input.status ?? 'OPEN',
            dueAtUtc: fromIsoUtcOrNull(input.dueAtUtc),
          },
        });
        return toTask(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'Task', operation: 'create' });
      }
    },

    async findById(id) {
      const row = await db.task.findUnique({ where: { id } });
      return row ? toTask(row) : null;
    },

    async requireById(id) {
      const found = await this.findById(id);
      if (!found) throw new NotFoundError('Task', id);
      return found;
    },

    async listByOrganization(organizationId, options) {
      const rows = await db.task.findMany({
        where: { organizationId, ...(options?.status ? { status: options.status } : {}) },
        orderBy: { createdAt: 'asc' },
        take: options?.take,
        skip: options?.skip,
      });
      return rows.map(toTask);
    },

    async listByContact(contactId, page) {
      const rows = await db.task.findMany({
        where: { contactId },
        orderBy: { createdAt: 'asc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toTask);
    },

    async update(id, patch) {
      try {
        const row = await db.task.update({
          where: { id },
          data: {
            title: patch.title,
            description: patch.description,
            status: patch.status,
            assignedToUserId: patch.assignedToUserId,
            dueAtUtc: patch.dueAtUtc === undefined ? undefined : fromIsoUtcOrNull(patch.dueAtUtc),
          },
        });
        return toTask(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'Task', operation: 'update' });
      }
    },
  };
}
