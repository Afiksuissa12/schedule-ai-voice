/**
 * `ConversationService` - the transcript lives in the database, full stop.
 *
 * THE LEGACY GAP THIS CLOSES
 * ---------------------------------------------------------------------------
 * The prototype this rebuild replaces held its conversation in a browser tab.
 * Close the tab and the conversation was gone: one call, no memory, no way to
 * resume, no way to audit, and no way for a background process to act on
 * anything that had been agreed. Everything the model "knew" was in a context
 * window nobody could inspect or replay.
 *
 * So the rule here is absolute and it is worth stating as a negative:
 *
 *   THIS CLASS HOLDS NO CONVERSATION STATE IN MEMORY. NONE.
 *
 * There is no cache, no message array, no session object, no `Map` keyed by
 * conversation id. Every turn is written to `ConversationTurn` as it happens,
 * and `buildMessages` reconstructs the LLM message array by READING THE
 * DATABASE, every single time. Two consequences follow, and both are tested:
 *
 *  - A conversation resumes correctly after the process, every object, and the
 *    Prisma client are thrown away and rebuilt from the same file.
 *    (`tests/agent/conversationService.test.ts`)
 *  - Two processes can serve alternating turns of one conversation without
 *    either of them being "the" owner, because neither holds anything the
 *    other lacks.
 *
 * It costs a query per turn. That is the correct price for business-critical
 * state not living in an LLM context window.
 *
 * TURN ORDER IS A DATABASE INVARIANT
 * ---------------------------------------------------------------------------
 * `@@unique([conversationId, index])` plus the repository's allocate-and-retry
 * append is what makes the transcript an ordered sequence rather than an array
 * whose ordering we hope nobody disturbed.
 */
import type { Database } from '../db/database.js';
import type { Conversation, ConversationTurn, ConversationWithTurns } from '../domain/entities.js';
import type { ConversationChannel } from '../domain/enums.js';
import type { AgentLlmMessage } from '../llm/agentMessage.js';
import type { Clock, IsoUtcString } from '../ports/clock.js';
import type { ToolCallRequest } from '../ports/llm.js';
import { InvariantViolationError } from '../shared/errors.js';
import { stringifyJson } from '../shared/json.js';
import { selectRecentTurns, type TurnWindow } from './contextWindow.js';
import { readConversationMemory, type ConversationMemory } from './conversationMemory.js';

export interface ConversationServiceOptions {
  readonly db: Database;
  /** The ONLY source of `now`. Turn timestamps come from here. */
  readonly clock: Clock;
}

export interface StartConversationInput {
  readonly organizationId: string;
  readonly contactId: string;
  readonly aiAgentId: string;
  /** Pin the policy in force. An unpinned conversation cannot be replayed. */
  readonly agentConfigurationId: string;
  readonly channel?: ConversationChannel;
  readonly startedAt?: IsoUtcString;
}

/** The persisted facts a turn needs, read together. */
export interface LoadedConversation {
  readonly conversation: Conversation;
  readonly turns: readonly ConversationTurn[];
}

export class ConversationService {
  private readonly db: Database;
  private readonly clock: Clock;

  constructor(options: ConversationServiceOptions) {
    this.db = options.db;
    this.clock = options.clock;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(input: StartConversationInput): Promise<Conversation> {
    return this.db.conversations.create({
      organizationId: input.organizationId,
      contactId: input.contactId,
      aiAgentId: input.aiAgentId,
      agentConfigurationId: input.agentConfigurationId,
      channel: input.channel ?? 'VOICE',
      status: 'ACTIVE',
      startedAt: input.startedAt ?? this.clock.nowUtc(),
    });
  }

  /**
   * Find the open conversation for a contact, or start one.
   *
   * The "or start one" half is what makes an inbound call from a known number
   * continue a conversation rather than beginning a fresh one with amnesia.
   */
  async startOrResume(input: StartConversationInput): Promise<Conversation> {
    const existing = await this.db.conversations.findActiveByContact(input.contactId);
    if (existing) return existing;
    return this.start(input);
  }

  /** The conversation and its ordered turns, read fresh. */
  async load(conversationId: string): Promise<LoadedConversation> {
    const withTurns: ConversationWithTurns = await this.db.conversations.requireByIdWithTurns(conversationId);
    const { turns, ...conversation } = withTurns;
    return { conversation, turns };
  }

  async complete(conversationId: string, summary?: string | null): Promise<Conversation> {
    return this.db.conversations.complete(conversationId, this.clock.nowUtc(), summary ?? null);
  }

  // -------------------------------------------------------------------------
  // Appending. Every one of these hits the database before it returns.
  // -------------------------------------------------------------------------

  /** Something the contact said. */
  async appendContactUtterance(conversationId: string, text: string): Promise<ConversationTurn> {
    return this.db.conversationTurns.appendTurn({
      conversationId,
      role: 'CONTACT',
      text,
      createdAt: this.clock.nowUtc(),
    });
  }

  /** Something the agent said out loud. */
  async appendAgentText(conversationId: string, text: string): Promise<ConversationTurn> {
    return this.db.conversationTurns.appendTurn({
      conversationId,
      role: 'AGENT',
      text,
      createdAt: this.clock.nowUtc(),
    });
  }

  /**
   * A tool call the model PROPOSED.
   *
   * `rawPayloadJson` stores the arguments byte-for-byte as the model emitted
   * them, including when they are malformed. A cleaned-up version would be a
   * different thing from what happened.
   */
  async appendToolCall(conversationId: string, request: ToolCallRequest): Promise<ConversationTurn> {
    return this.db.conversationTurns.appendTurn({
      conversationId,
      role: 'AGENT',
      text: null,
      toolName: request.toolName,
      toolCallId: request.toolCallId,
      rawPayloadJson: request.argumentsJson,
      createdAt: this.clock.nowUtc(),
    });
  }

  /** What application code handed back for that call, success or refusal. */
  async appendToolResult(
    conversationId: string,
    result: { toolCallId: string; toolName: string; payload: Record<string, unknown> | string },
  ): Promise<ConversationTurn> {
    return this.db.conversationTurns.appendTurn({
      conversationId,
      role: 'TOOL',
      text: null,
      toolName: result.toolName,
      toolCallId: result.toolCallId,
      rawPayloadJson: typeof result.payload === 'string' ? result.payload : stringifyJson(result.payload),
      createdAt: this.clock.nowUtc(),
    });
  }

  /** A note from the system itself, e.g. a turn that hit the iteration cap. */
  async appendSystemNote(conversationId: string, text: string): Promise<ConversationTurn> {
    return this.db.conversationTurns.appendTurn({
      conversationId,
      role: 'SYSTEM',
      text,
      createdAt: this.clock.nowUtc(),
    });
  }

  // -------------------------------------------------------------------------
  // Reconstruction
  // -------------------------------------------------------------------------

  /**
   * Rebuild the LLM message array FROM THE DATABASE.
   *
   * Reads the turns and translates them; it does not consult anything held in
   * this object, because this object holds nothing. Given the same rows it
   * produces the same messages in the same order, forever.
   */
  async buildMessages(conversationId: string, options: BuildMessagesOptions = {}): Promise<AgentLlmMessage[]> {
    const turns = await this.db.conversationTurns.listByConversation(conversationId);
    return messagesFromTurns(turns, options);
  }

  /**
   * MISSION 2: the same rebuild, inside a bounded window.
   *
   * Same discipline as `buildMessages` - the rows ARE the transcript and they
   * are read fresh - with the addition that only the most recent stretch that
   * fits the local model's context length is turned into messages. What falls
   * outside is not lost: `conversationMemory.ts` carries it as a rolling
   * summary, and the assembled background puts that summary in the same prompt.
   *
   * Returns the window alongside the messages rather than just the messages,
   * because "what did the model NOT see this turn" is an audit question, and a
   * function that silently discarded the answer would make it unanswerable.
   */
  async buildWindowedMessages(
    conversationId: string,
    options: BuildWindowedMessagesOptions,
  ): Promise<{ messages: AgentLlmMessage[]; window: TurnWindow }> {
    const turns = await this.db.conversationTurns.listByConversation(conversationId);
    const window = selectRecentTurns(turns, { maxTurns: options.maxTurns, maxChars: options.maxChars });
    const messages = messagesFromTurns(window.turns, {
      ...(options.leadingMessages ? { leadingMessages: options.leadingMessages } : {}),
    });
    return { messages, window };
  }

  /** The durable memory in `Conversation.summary`, tolerant of legacy rows. */
  async readMemory(conversationId: string): Promise<ConversationMemory> {
    const conversation = await this.db.conversations.requireById(conversationId);
    return readConversationMemory(conversation.summary);
  }

  /** Turn count, for the loop cap and for audit detail. */
  async turnCount(conversationId: string): Promise<number> {
    return this.db.conversationTurns.countByConversation(conversationId);
  }
}

export interface BuildWindowedMessagesOptions {
  readonly maxTurns: number;
  readonly maxChars: number;
  readonly leadingMessages?: readonly AgentLlmMessage[];
}

export interface BuildMessagesOptions {
  /**
   * Keep only the most recent N turns.
   *
   * Absent by default: truncation loses history, and this slice's
   * conversations are short. When a real deployment needs it, it belongs HERE -
   * one place, applied to rows read from the database - rather than as an
   * in-memory window that silently diverges from what was persisted.
   */
  readonly maxTurns?: number;
  /** Prepended before the transcript, e.g. the per-turn context block. */
  readonly leadingMessages?: readonly AgentLlmMessage[];
}

/**
 * The turn -> message mapping, as a pure function.
 *
 * Exported separately from the service so a test can exercise the translation
 * without a database, and so the rules are readable in one place:
 *
 *   CONTACT                      -> user
 *   AGENT with text              -> assistant
 *   AGENT with toolName + id     -> assistant tool call (content = raw args)
 *   TOOL                         -> tool result, tagged with its call id
 *   SYSTEM                       -> system
 *
 * A TOOL turn with no `toolCallId` cannot be matched to its call and would be
 * rejected by a provider, so it is a loud error rather than a dropped message:
 * silently discarding a tool result would let the model believe an action
 * succeeded when the record says otherwise.
 */
export function messagesFromTurns(
  turns: readonly ConversationTurn[],
  options: BuildMessagesOptions = {},
): AgentLlmMessage[] {
  const selected = options.maxTurns !== undefined ? turns.slice(-options.maxTurns) : turns;
  const messages: AgentLlmMessage[] = [...(options.leadingMessages ?? [])];

  for (const turn of selected) {
    switch (turn.role) {
      case 'CONTACT':
        messages.push({ role: 'user', content: turn.text ?? '' });
        break;

      case 'SYSTEM':
        messages.push({ role: 'system', content: turn.text ?? '' });
        break;

      case 'AGENT':
        if (turn.toolName && turn.toolCallId) {
          messages.push({
            role: 'assistant',
            // The raw arguments, as the model produced them. Replaying its own
            // words back to it is the truthful reconstruction.
            content: turn.rawPayloadJson ?? '{}',
            toolCallId: turn.toolCallId,
            toolName: turn.toolName,
          });
        } else if (turn.text) {
          messages.push({ role: 'assistant', content: turn.text });
        }
        break;

      case 'TOOL': {
        if (!turn.toolCallId) {
          throw new InvariantViolationError(
            `ConversationTurn ${turn.id} is a TOOL result with no toolCallId, so it cannot be matched to ` +
              'the call it answers. A tool result must never be dropped: the model would be left believing ' +
              'an action it never got an answer for.',
            { details: { turnId: turn.id, conversationId: turn.conversationId, index: turn.index } },
          );
        }
        messages.push({
          role: 'tool',
          content: turn.rawPayloadJson ?? turn.text ?? '{}',
          toolCallId: turn.toolCallId,
          ...(turn.toolName ? { toolName: turn.toolName } : {}),
        });
        break;
      }

      default: {
        const exhaustive: never = turn.role;
        throw new InvariantViolationError(`Unknown ConversationTurn role: ${String(exhaustive)}`);
      }
    }
  }

  // An assistant tool-call message whose result turn is missing would make the
  // transcript illegal for a provider. That can only happen if a process died
  // between the two writes, so it is repaired here rather than sent: the model
  // is told the call has no recorded answer, which is true.
  return repairOrphanedToolCalls(messages);
}

function repairOrphanedToolCalls(messages: AgentLlmMessage[]): AgentLlmMessage[] {
  const answered = new Set(
    messages.filter((message) => message.role === 'tool' && message.toolCallId).map((message) => message.toolCallId),
  );

  const repaired: AgentLlmMessage[] = [];
  for (const message of messages) {
    repaired.push(message);
    if (message.role === 'assistant' && message.toolCallId && !answered.has(message.toolCallId)) {
      repaired.push({
        role: 'tool',
        toolCallId: message.toolCallId,
        ...(message.toolName ? { toolName: message.toolName } : {}),
        content: stringifyJson({
          ok: false,
          error_code: 'NO_RECORDED_RESULT',
          reason:
            'This call has no recorded result - the process stopped before one was written. Nothing was ' +
            'saved. Ask before trying it again.',
          retryable: true,
        }),
      });
    }
  }
  return repaired;
}
