/**
 * Repositories for telephony records: Call, CallOutcome.
 *
 * The legacy prototype had a one-call-only lifecycle. Here a Contact may have
 * any number of Calls across any number of Conversations, and every call ends
 * with a recorded outcome that the follow-up engine can reason about.
 */
import type { Call, CallOutcome } from '../../domain/entities.js';
import type { CallDirection, CallOutcomeKind, CallStatus } from '../../domain/enums.js';
import { NotFoundError } from '../../shared/errors.js';
import type { IsoUtcString } from '../../shared/time.js';
import { fromIsoUtcOrNull } from '../../shared/time.js';
import { toCall, toCallOutcome } from '../mappers.js';
import { translatePrismaError } from '../prismaErrors.js';
import type { DbExecutor, PageOptions } from '../types.js';

// ---------------------------------------------------------------------------
// Call
// ---------------------------------------------------------------------------

export interface CreateCallInput {
  readonly organizationId: string;
  readonly contactId: string;
  readonly conversationId?: string | null;
  readonly direction: CallDirection;
  /** From `TelephonyProvider.name()`. The only vendor trace in the database. */
  readonly providerName: string;
  readonly providerCallId?: string | null;
  readonly status?: CallStatus;
  readonly startedAt?: IsoUtcString | null;
  readonly endedAt?: IsoUtcString | null;
  readonly durationSeconds?: number | null;
}

export interface UpdateCallInput {
  readonly providerCallId?: string | null;
  readonly status?: CallStatus;
  readonly startedAt?: IsoUtcString | null;
  readonly endedAt?: IsoUtcString | null;
  readonly durationSeconds?: number | null;
  readonly conversationId?: string | null;
}

export interface CallRepository {
  create(input: CreateCallInput): Promise<Call>;
  findById(id: string): Promise<Call | null>;
  requireById(id: string): Promise<Call>;
  findByProviderCallId(providerName: string, providerCallId: string): Promise<Call | null>;
  listByContact(contactId: string, page?: PageOptions): Promise<Call[]>;
  listByConversation(conversationId: string, page?: PageOptions): Promise<Call[]>;
  update(id: string, patch: UpdateCallInput): Promise<Call>;
}

export function createCallRepository(db: DbExecutor): CallRepository {
  return {
    async create(input) {
      try {
        const row = await db.call.create({
          data: {
            organizationId: input.organizationId,
            contactId: input.contactId,
            conversationId: input.conversationId ?? null,
            direction: input.direction,
            providerName: input.providerName,
            providerCallId: input.providerCallId ?? null,
            status: input.status ?? 'QUEUED',
            startedAt: fromIsoUtcOrNull(input.startedAt),
            endedAt: fromIsoUtcOrNull(input.endedAt),
            durationSeconds: input.durationSeconds ?? null,
          },
        });
        return toCall(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'Call', operation: 'create' });
      }
    },

    async findById(id) {
      const row = await db.call.findUnique({ where: { id } });
      return row ? toCall(row) : null;
    },

    async requireById(id) {
      const found = await this.findById(id);
      if (!found) throw new NotFoundError('Call', id);
      return found;
    },

    async findByProviderCallId(providerName, providerCallId) {
      const row = await db.call.findFirst({ where: { providerName, providerCallId } });
      return row ? toCall(row) : null;
    },

    async listByContact(contactId, page) {
      const rows = await db.call.findMany({
        where: { contactId },
        orderBy: { createdAt: 'desc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toCall);
    },

    async listByConversation(conversationId, page) {
      const rows = await db.call.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toCall);
    },

    async update(id, patch) {
      try {
        const row = await db.call.update({
          where: { id },
          data: {
            providerCallId: patch.providerCallId,
            status: patch.status,
            startedAt: patch.startedAt === undefined ? undefined : fromIsoUtcOrNull(patch.startedAt),
            endedAt: patch.endedAt === undefined ? undefined : fromIsoUtcOrNull(patch.endedAt),
            durationSeconds: patch.durationSeconds,
            conversationId: patch.conversationId,
          },
        });
        return toCall(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'Call', operation: 'update' });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// CallOutcome
// ---------------------------------------------------------------------------

export interface UpsertCallOutcomeInput {
  readonly callId: string;
  readonly outcome: CallOutcomeKind;
  readonly notes?: string | null;
  /** The validated tool call that recorded this, tying it to the audit chain. */
  readonly recordedByToolCallId?: string | null;
}

export interface CallOutcomeRepository {
  /** One outcome per call, so writing is always an upsert. */
  upsertForCall(input: UpsertCallOutcomeInput): Promise<CallOutcome>;
  findByCallId(callId: string): Promise<CallOutcome | null>;
  requireByCallId(callId: string): Promise<CallOutcome>;
}

export function createCallOutcomeRepository(db: DbExecutor): CallOutcomeRepository {
  return {
    async upsertForCall(input) {
      const payload = {
        outcome: input.outcome,
        notes: input.notes ?? null,
        recordedByToolCallId: input.recordedByToolCallId ?? null,
      };
      try {
        const row = await db.callOutcome.upsert({
          where: { callId: input.callId },
          create: { callId: input.callId, ...payload },
          update: payload,
        });
        return toCallOutcome(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'CallOutcome', operation: 'upsertForCall' });
      }
    },

    async findByCallId(callId) {
      const row = await db.callOutcome.findUnique({ where: { callId } });
      return row ? toCallOutcome(row) : null;
    },

    async requireByCallId(callId) {
      const found = await this.findByCallId(callId);
      if (!found) throw new NotFoundError('CallOutcome for Call', callId);
      return found;
    },
  };
}
