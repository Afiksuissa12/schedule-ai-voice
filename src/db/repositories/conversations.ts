/**
 * Repositories for durable conversation state: Conversation, ConversationTurn.
 *
 * This is the direct replacement for the legacy prototype's browser-held
 * conversation. Two properties matter:
 *
 *  - The transcript lives in the database, so it survives a process restart and
 *    the LLM context window can be rebuilt from it.
 *  - Turn ORDER is a database invariant (`@@unique([conversationId, index])`),
 *    not an array position. `appendTurn` allocates the next index and retries
 *    if a concurrent writer takes it, so the ordering cannot silently corrupt.
 */
import type { Conversation, ConversationTurn, ConversationWithTurns } from '../../domain/entities.js';
import type { ConversationChannel, ConversationStatus, ConversationTurnRole } from '../../domain/enums.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import type { IsoUtcString } from '../../shared/time.js';
import { fromIsoUtc, fromIsoUtcOrNull } from '../../shared/time.js';
import { toConversation, toConversationTurn } from '../mappers.js';
import { isUniqueConstraintViolation, translatePrismaError } from '../prismaErrors.js';
import type { DbExecutor, PageOptions } from '../types.js';

const MAX_TURN_INDEX_ALLOCATION_ATTEMPTS = 8;

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export interface CreateConversationInput {
  readonly organizationId: string;
  readonly contactId: string;
  readonly aiAgentId: string;
  /** Pin the policy version in force, so an audit replay uses the right one. */
  readonly agentConfigurationId?: string | null;
  readonly channel?: ConversationChannel;
  readonly status?: ConversationStatus;
  readonly startedAt?: IsoUtcString;
}

export interface UpdateConversationInput {
  readonly status?: ConversationStatus;
  readonly endedAt?: IsoUtcString | null;
  readonly summary?: string | null;
  readonly agentConfigurationId?: string | null;
}

export interface ConversationRepository {
  create(input: CreateConversationInput): Promise<Conversation>;
  findById(id: string): Promise<Conversation | null>;
  requireById(id: string): Promise<Conversation>;
  /** The conversation plus its turns in index order - the rebuildable transcript. */
  findByIdWithTurns(id: string): Promise<ConversationWithTurns | null>;
  requireByIdWithTurns(id: string): Promise<ConversationWithTurns>;
  listByContact(contactId: string, page?: PageOptions): Promise<Conversation[]>;
  listByOrganization(
    organizationId: string,
    options?: PageOptions & { status?: ConversationStatus },
  ): Promise<Conversation[]>;
  /** The newest ACTIVE conversation for a contact, if one is open. */
  findActiveByContact(contactId: string): Promise<Conversation | null>;
  update(id: string, patch: UpdateConversationInput): Promise<Conversation>;
  /** Close a conversation: sets the status and stamps `endedAt`. */
  complete(id: string, endedAt: IsoUtcString, summary?: string | null): Promise<Conversation>;
}

export function createConversationRepository(db: DbExecutor): ConversationRepository {
  return {
    async create(input) {
      try {
        const row = await db.conversation.create({
          data: {
            organizationId: input.organizationId,
            contactId: input.contactId,
            aiAgentId: input.aiAgentId,
            agentConfigurationId: input.agentConfigurationId ?? null,
            channel: input.channel ?? 'VOICE',
            status: input.status ?? 'ACTIVE',
            ...(input.startedAt ? { startedAt: fromIsoUtc(input.startedAt) } : {}),
          },
        });
        return toConversation(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'Conversation', operation: 'create' });
      }
    },

    async findById(id) {
      const row = await db.conversation.findUnique({ where: { id } });
      return row ? toConversation(row) : null;
    },

    async requireById(id) {
      const found = await this.findById(id);
      if (!found) throw new NotFoundError('Conversation', id);
      return found;
    },

    async findByIdWithTurns(id) {
      const row = await db.conversation.findUnique({
        where: { id },
        include: { turns: { orderBy: { index: 'asc' } } },
      });
      if (!row) return null;
      return { ...toConversation(row), turns: row.turns.map(toConversationTurn) };
    },

    async requireByIdWithTurns(id) {
      const found = await this.findByIdWithTurns(id);
      if (!found) throw new NotFoundError('Conversation', id);
      return found;
    },

    async listByContact(contactId, page) {
      const rows = await db.conversation.findMany({
        where: { contactId },
        orderBy: { startedAt: 'desc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toConversation);
    },

    async listByOrganization(organizationId, options) {
      const rows = await db.conversation.findMany({
        where: { organizationId, ...(options?.status ? { status: options.status } : {}) },
        orderBy: { startedAt: 'desc' },
        take: options?.take,
        skip: options?.skip,
      });
      return rows.map(toConversation);
    },

    async findActiveByContact(contactId) {
      const row = await db.conversation.findFirst({
        where: { contactId, status: 'ACTIVE' },
        orderBy: { startedAt: 'desc' },
      });
      return row ? toConversation(row) : null;
    },

    async update(id, patch) {
      try {
        const row = await db.conversation.update({
          where: { id },
          data: {
            status: patch.status,
            endedAt: patch.endedAt === undefined ? undefined : fromIsoUtcOrNull(patch.endedAt),
            summary: patch.summary,
            agentConfigurationId: patch.agentConfigurationId,
          },
        });
        return toConversation(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'Conversation', operation: 'update' });
      }
    },

    async complete(id, endedAt, summary) {
      return this.update(id, { status: 'COMPLETED', endedAt, ...(summary === undefined ? {} : { summary }) });
    },
  };
}

// ---------------------------------------------------------------------------
// ConversationTurn
// ---------------------------------------------------------------------------

export interface AppendConversationTurnInput {
  readonly conversationId: string;
  readonly role: ConversationTurnRole;
  /** NULL for pure tool turns. */
  readonly text?: string | null;
  readonly toolName?: string | null;
  readonly toolCallId?: string | null;
  /** Raw payload, stored verbatim - what the model actually produced. */
  readonly rawPayloadJson?: string | null;
  readonly createdAt?: IsoUtcString;
}

export interface CreateConversationTurnInput extends AppendConversationTurnInput {
  /** Explicit position. Use `appendTurn` unless you are replaying a transcript. */
  readonly index: number;
}

export interface ConversationTurnRepository {
  /** Append at the next free index, retrying if a concurrent writer wins the race. */
  appendTurn(input: AppendConversationTurnInput): Promise<ConversationTurn>;
  /** Insert at an explicit index. Throws `ConflictError` if the index is taken. */
  createAtIndex(input: CreateConversationTurnInput): Promise<ConversationTurn>;
  findById(id: string): Promise<ConversationTurn | null>;
  listByConversation(conversationId: string, page?: PageOptions): Promise<ConversationTurn[]>;
  findByToolCallId(toolCallId: string): Promise<ConversationTurn[]>;
  countByConversation(conversationId: string): Promise<number>;
  /** The highest index currently used, or -1 when the conversation has no turns. */
  maxIndex(conversationId: string): Promise<number>;
}

export function createConversationTurnRepository(db: DbExecutor): ConversationTurnRepository {
  async function currentMaxIndex(conversationId: string): Promise<number> {
    const latest = await db.conversationTurn.findFirst({
      where: { conversationId },
      orderBy: { index: 'desc' },
      select: { index: true },
    });
    return latest?.index ?? -1;
  }

  function toData(input: AppendConversationTurnInput, index: number) {
    return {
      conversationId: input.conversationId,
      index,
      role: input.role,
      text: input.text ?? null,
      toolName: input.toolName ?? null,
      toolCallId: input.toolCallId ?? null,
      rawPayloadJson: input.rawPayloadJson ?? null,
      ...(input.createdAt ? { createdAt: fromIsoUtc(input.createdAt) } : {}),
    };
  }

  return {
    async appendTurn(input) {
      let lastError: unknown;

      for (let attempt = 1; attempt <= MAX_TURN_INDEX_ALLOCATION_ATTEMPTS; attempt += 1) {
        const index = (await currentMaxIndex(input.conversationId)) + 1;
        try {
          return toConversationTurn(await db.conversationTurn.create({ data: toData(input, index) }));
        } catch (error) {
          lastError = error;
          if (isUniqueConstraintViolation(error)) {
            continue;
          }
          translatePrismaError(error, { entity: 'ConversationTurn', operation: 'appendTurn' });
        }
      }

      throw new ConflictError(
        `Could not allocate a turn index for conversation ${input.conversationId} after ` +
          `${MAX_TURN_INDEX_ALLOCATION_ATTEMPTS} attempts`,
        { cause: lastError, details: { conversationId: input.conversationId } },
      );
    },

    async createAtIndex(input) {
      try {
        return toConversationTurn(await db.conversationTurn.create({ data: toData(input, input.index) }));
      } catch (error) {
        translatePrismaError(error, { entity: 'ConversationTurn', operation: 'createAtIndex' });
      }
    },

    async findById(id) {
      const row = await db.conversationTurn.findUnique({ where: { id } });
      return row ? toConversationTurn(row) : null;
    },

    async listByConversation(conversationId, page) {
      const rows = await db.conversationTurn.findMany({
        where: { conversationId },
        orderBy: { index: 'asc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toConversationTurn);
    },

    async findByToolCallId(toolCallId) {
      const rows = await db.conversationTurn.findMany({
        where: { toolCallId },
        orderBy: { index: 'asc' },
      });
      return rows.map(toConversationTurn);
    },

    async countByConversation(conversationId) {
      return db.conversationTurn.count({ where: { conversationId } });
    },

    maxIndex: currentMaxIndex,
  };
}
