/**
 * The rolling summary: the only part of this subsystem that talks to a model.
 *
 * WHY THIS IS ALLOWED TO USE AN LLM AT ALL
 * ---------------------------------------------------------------------------
 * The Founder directive forbids scripted CUSTOMER-FACING dialogue. It says
 * nothing against a model doing what models are good at somewhere the customer
 * never hears. A recap of a conversation, written for another model to read, is
 * internal machinery - the same category as `explainScoring` or an audit
 * summary. Nothing this file produces is ever spoken; it is read back into a
 * later prompt as background, and the guardrail clause
 * `MEMORY_IS_BACKGROUND_NOT_TRUTH` tells the model exactly that.
 *
 * WHY IT RUNS AFTER THE TURN AND NOT DURING IT
 * ---------------------------------------------------------------------------
 * Three reasons, in order of how much they matter:
 *
 *  1. A SUMMARY MUST NEVER COST A CALLER A PAUSE. Compaction is a second
 *     provider round trip. On a local 7B that is seconds. Doing it on the path
 *     between a person finishing a sentence and the agent replying would be
 *     audible.
 *  2. A SUMMARY MUST NEVER BREAK A TURN. Every failure here - a provider that
 *     is down, a model that returns prose instead of JSON, a document that
 *     fails validation - resolves to "the memory is not refreshed this time",
 *     which costs a little context later and costs the live conversation
 *     nothing. `refresh` therefore does not throw. Ever. It returns a status.
 *  3. IT KEEPS ASSEMBLY DETERMINISTIC. Because the summary is written here and
 *     merely READ by `ConversationContextAssembler`, context assembly stays a
 *     pure function of the database. `npm run context:prove` can assert
 *     byte-identical output across two runs, which would be impossible if a
 *     turn generated its own summary on the way in.
 *
 * ATOMICITY, AND A DELIBERATE DIVERGENCE
 * ---------------------------------------------------------------------------
 * `docs/ARCHITECTURE.md` § 8 sets the rule that audit writes never fail
 * silently: they throw, and callers let it propagate, because an action nobody
 * can explain is an action we should not claim to have taken. This file
 * swallows its errors, so it has to earn that.
 *
 * It earns it by making the two writes ATOMIC. The summary row and the audit
 * events that explain it go through one `withTransaction`, so a failed audit
 * write rolls the summary back with it. The state after a swallowed error is
 * therefore always "nothing was written and nothing was claimed" - which is the
 * property the rule exists to protect, reached by a different route.
 */
import { z } from 'zod';

import type { Database } from '../db/database.js';
import type { ConversationTurn } from '../domain/entities.js';
import type { Clock, IsoUtcString } from '../ports/clock.js';
import type { LlmProvider } from '../ports/llm.js';
import { tryParseJson } from '../shared/json.js';
import {
  fromEnvelope,
  readConversationMemory,
  serializeConversationMemory,
  ConversationMemorySchema,
  MEMORY_LIMITS,
  type ConversationMemory,
  type DurableFact,
  type UnresolvedTopic,
} from './conversationMemory.js';

/** How many turns may accumulate beyond the last summary before one is due. */
export const DEFAULT_REFRESH_AFTER_TURNS = 10;
/** Turns left out of the summary because the live window still carries them. */
export const DEFAULT_KEEP_RECENT_TURNS = 8;
/** Upper bound on turns fed to one compaction call, oldest first. */
export const DEFAULT_MAX_TURNS_PER_REFRESH = 60;

export interface ConversationMemoryWriterOptions {
  readonly db: Database;
  readonly clock: Clock;
  /** Any `LlmProvider`. The local one in production; a scripted one in a proof. */
  readonly llm: LlmProvider;
  readonly refreshAfterTurns?: number;
  readonly keepRecentTurns?: number;
  readonly maxTurnsPerRefresh?: number;
}

export type MemoryRefreshStatus =
  /** Fewer new turns than the threshold. Nothing was called and nothing written. */
  | 'NOT_DUE'
  /** A summary was generated, validated and persisted. */
  | 'REFRESHED'
  /** Something went wrong. Nothing was written. The turn is unaffected. */
  | 'FAILED';

export interface MemoryRefreshResult {
  readonly status: MemoryRefreshStatus;
  readonly turnsCompacted: number;
  readonly coveredThroughTurnIndex: number;
  /** Populated only when `status` is `FAILED`. Never thrown, always inspectable. */
  readonly failureReason: string | null;
  /** Entries the content rules rejected, so a bad summariser is visible. */
  readonly dropped: readonly { readonly what: string; readonly why: string }[];
}

export interface RefreshMemoryInput {
  readonly conversationId: string;
  /** The turn's correlation id, so the compaction lands on the same audit chain. */
  readonly correlationId: string;
}

/**
 * What the summariser is asked to produce.
 *
 * Strict JSON, because a recap that has to be parsed out of prose is a recap
 * that will eventually fail to parse. The shape is deliberately the same as the
 * stored envelope's content, so there is no translation layer to get wrong.
 */
const SummaryDocumentSchema = z
  .object({
    narrative: z.string().max(4000).default(''),
    durable_facts: z
      .array(z.object({ id: z.string().max(80), fact: z.string().max(400) }).passthrough())
      .max(40)
      .default([]),
    unresolved_topics: z
      .array(
        z
          .object({
            id: z.string().max(80),
            topic: z.string().max(400),
            raised_by: z.string().max(20).optional(),
          })
          .passthrough(),
      )
      .max(40)
      .default([]),
  })
  .passthrough();

export class ConversationMemoryWriter {
  private readonly db: Database;
  private readonly clock: Clock;
  private readonly llm: LlmProvider;
  private readonly refreshAfterTurns: number;
  private readonly keepRecentTurns: number;
  private readonly maxTurnsPerRefresh: number;

  constructor(options: ConversationMemoryWriterOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.llm = options.llm;
    this.refreshAfterTurns = options.refreshAfterTurns ?? DEFAULT_REFRESH_AFTER_TURNS;
    this.keepRecentTurns = options.keepRecentTurns ?? DEFAULT_KEEP_RECENT_TURNS;
    this.maxTurnsPerRefresh = options.maxTurnsPerRefresh ?? DEFAULT_MAX_TURNS_PER_REFRESH;
  }

  /**
   * Refresh the rolling summary if enough has happened to justify one.
   *
   * NEVER THROWS. Every path returns a `MemoryRefreshResult`.
   */
  async refresh(input: RefreshMemoryInput): Promise<MemoryRefreshResult> {
    try {
      return await this.refreshUnsafe(input);
    } catch (error) {
      return {
        status: 'FAILED',
        turnsCompacted: 0,
        coveredThroughTurnIndex: -1,
        failureReason: error instanceof Error ? error.message : String(error),
        dropped: [],
      };
    }
  }

  // -------------------------------------------------------------------------

  private async refreshUnsafe(input: RefreshMemoryInput): Promise<MemoryRefreshResult> {
    const nowUtc = this.clock.nowUtc();
    const conversation = await this.db.conversations.findById(input.conversationId);
    if (!conversation) {
      return notDue(-1, 'Conversation no longer exists.');
    }

    const existing = readConversationMemory(conversation.summary);
    const turns = await this.db.conversationTurns.listByConversation(conversation.id);

    // What the live window will still be carrying is not worth compacting: it
    // would be in the prompt twice, once verbatim and once as a paraphrase.
    const compactable = turns
      .filter((turn) => turn.index > existing.coveredThroughTurnIndex)
      .slice(0, Math.max(0, turns.length - this.keepRecentTurns));

    if (compactable.length < this.refreshAfterTurns) {
      return notDue(existing.coveredThroughTurnIndex, null);
    }

    const batch = compactable.slice(0, this.maxTurnsPerRefresh);
    const lastIndex = batch[batch.length - 1]?.index ?? existing.coveredThroughTurnIndex;

    await this.db.audit.record({
      type: 'PROVIDER_INVOKED',
      organizationId: conversation.organizationId,
      correlationId: input.correlationId,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      subjectType: 'CONVERSATION',
      subjectId: conversation.id,
      summary: `LlmProvider ${this.llm.name()}.completeTurn (conversation memory compaction)`,
      detailJson: {
        provider: this.llm.name(),
        purpose: 'CONVERSATION_MEMORY_COMPACTION',
        turnsCompacted: batch.length,
        fromTurnIndex: batch[0]?.index ?? null,
        throughTurnIndex: lastIndex,
      },
      occurredAt: nowUtc,
    });

    const completion = await this.llm.completeTurn({
      systemPrompt: COMPACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: compactionRequest(existing, batch) }],
      tools: [],
    });

    const document = parseSummaryDocument(completion.assistantText);
    if (!document) {
      return {
        status: 'FAILED',
        turnsCompacted: 0,
        coveredThroughTurnIndex: existing.coveredThroughTurnIndex,
        failureReason: 'The summariser did not return a JSON document this code could read.',
        dropped: [],
      };
    }

    const merged = mergeMemory({
      existing,
      document,
      conversationId: conversation.id,
      coveredThroughTurnIndex: lastIndex,
      generatedBy: this.llm.name(),
      nowUtc,
    });

    // One transaction: the summary and the events explaining it commit or roll
    // back together. See the header on why that is what lets this file swallow.
    await this.db.withTransaction(async (tx) => {
      await tx.conversations.update(conversation.id, {
        summary: serializeConversationMemory({
          narrative: merged.narrative,
          durableFacts: merged.durableFacts,
          unresolvedTopics: merged.unresolvedTopics,
          coveredThroughTurnIndex: merged.coveredThroughTurnIndex,
          generatedBy: merged.generatedBy,
          generatedAtUtc: nowUtc,
        }),
      });

      await tx.audit.record({
        type: 'ENTITY_PERSISTED',
        organizationId: conversation.organizationId,
        correlationId: input.correlationId,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        subjectType: 'CONVERSATION',
        subjectId: conversation.id,
        summary:
          `Conversation memory refreshed through turn ${lastIndex}: ` +
          `${merged.durableFacts.length} durable fact(s), ${merged.unresolvedTopics.length} loose end(s).`,
        detailJson: {
          purpose: 'CONVERSATION_MEMORY_COMPACTION',
          generatedBy: merged.generatedBy,
          coveredThroughTurnIndex: merged.coveredThroughTurnIndex,
          turnsCompacted: batch.length,
          narrativeChars: merged.narrative.length,
          durableFactIds: merged.durableFacts.map((fact) => fact.id),
          unresolvedTopicIds: merged.unresolvedTopics.map((topic) => topic.id),
          droppedOnValidation: merged.dropped,
        },
        occurredAt: nowUtc,
      });
    });

    return {
      status: 'REFRESHED',
      turnsCompacted: batch.length,
      coveredThroughTurnIndex: merged.coveredThroughTurnIndex,
      failureReason: null,
      dropped: merged.dropped,
    };
  }
}

// ---------------------------------------------------------------------------
// The compaction request
// ---------------------------------------------------------------------------

/**
 * The summariser's instructions.
 *
 * Note what is NOT asked for: no advice on what to do next, no suggested
 * questions, no opening line for the following call. Asking a model to plan the
 * next conversation here would reintroduce a script through the back door, one
 * that is written fresh each time and therefore harder to notice. It is asked
 * for a record, and a record only.
 */
const COMPACTION_SYSTEM_PROMPT = [
  '# Conversation compaction',
  '',
  'You are compacting part of a sales conversation transcript into a durable record. Nothing you produce',
  'is ever spoken to anybody: it is read back later as background by another model.',
  '',
  'Return ONE JSON object and nothing else. No prose before it, no prose after it, no code fences.',
  '',
  '{',
  '  "narrative": "a recap in the third person, under 900 characters",',
  '  "durable_facts": [{ "id": "short_snake_case_id", "fact": "one thing that is true about this contact" }],',
  '  "unresolved_topics": [{ "id": "short_snake_case_id", "topic": "a subject left unsettled",',
  '                          "raised_by": "CONTACT" }]',
  '}',
  '',
  '## What belongs in each field',
  '',
  'narrative: what happened and what it amounted to. Third person, past tense, factual.',
  '',
  'durable_facts: things that will still be true next month - their role, their company size, the system',
  'they use today, a constraint they named, a preference they stated. Not opinions about how the call felt.',
  'Nothing you inferred; only what was actually stated.',
  '',
  'unresolved_topics: subjects raised and never settled. Use raised_by CONTACT for a question they asked',
  'that went unanswered, and AGENT for a question we asked that they never answered. A subject, not a',
  'question to put to them later.',
  '',
  '## Rules',
  '',
  '1. Invent nothing. Every item must trace to something in the transcript.',
  '2. No advice, no next steps, no suggested wording, no plan for the next call.',
  '3. No phone numbers, no email addresses, no card details, no passwords.',
  '4. Prefer fewer, sharper items. An empty list is a correct answer.',
  '5. Carry forward anything from the previous record that is still true, with the same id.',
].join('\n');

function compactionRequest(existing: ConversationMemory, turns: readonly ConversationTurn[]): string {
  const previous = existing.narrative
    ? ['## The record so far', '', existing.narrative, '', '### Facts already recorded', '', ...existing.durableFacts.map((fact) => `- ${fact.id}: ${fact.fact}`), '']
    : ['## The record so far', '', 'There is no previous record for this conversation.', ''];

  return [
    ...previous,
    '## Transcript to fold in',
    '',
    ...turns.map((turn) => renderTurnForCompaction(turn)),
    '',
    'Return the updated JSON object now.',
  ].join('\n');
}

function renderTurnForCompaction(turn: ConversationTurn): string {
  switch (turn.role) {
    case 'CONTACT':
      return `[${turn.index}] CONTACT: ${turn.text ?? ''}`;
    case 'AGENT':
      return turn.toolName
        ? `[${turn.index}] AGENT requested ${turn.toolName}`
        : `[${turn.index}] AGENT: ${turn.text ?? ''}`;
    case 'TOOL':
      return `[${turn.index}] RESULT of ${turn.toolName ?? 'a tool'}: ${truncate(turn.rawPayloadJson ?? '', 300)}`;
    case 'SYSTEM':
      return `[${turn.index}] SYSTEM NOTE: ${turn.text ?? ''}`;
    default:
      return `[${turn.index}] ${String(turn.role)}`;
  }
}

// ---------------------------------------------------------------------------
// Reading what came back
// ---------------------------------------------------------------------------

/**
 * Find and validate the JSON the summariser was asked for.
 *
 * Tolerant in exactly two ways and no further: a leading code fence is stripped,
 * and the first balanced-looking `{...}` span is taken. Anything beyond that -
 * repairing broken JSON, coaxing a second attempt - would make a failed
 * compaction expensive, and a failed compaction is supposed to be cheap.
 */
export function parseSummaryDocument(text: string | null): z.infer<typeof SummaryDocumentSchema> | null {
  if (!text) return null;

  const withoutFence = text.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  const parsed = tryParseJson<unknown>(withoutFence.slice(start, end + 1));
  if (!parsed.ok) return null;

  const document = SummaryDocumentSchema.safeParse(parsed.value);
  return document.success ? document.data : null;
}

interface MergeInput {
  readonly existing: ConversationMemory;
  readonly document: z.infer<typeof SummaryDocumentSchema>;
  readonly conversationId: string;
  readonly coveredThroughTurnIndex: number;
  readonly generatedBy: string;
  readonly nowUtc: IsoUtcString;
}

/**
 * Fold a fresh summary into what was already remembered.
 *
 * The new document wins on a collision, because it was written with more of the
 * conversation in front of it. Everything then goes back through
 * `ConversationMemorySchema` and `fromEnvelope` - the same validation and the
 * same dialogue-shape filter the READ path applies - so nothing can be stored
 * that would be silently dropped when it is read back.
 */
export function mergeMemory(input: MergeInput): ConversationMemory {
  const facts = new Map<string, DurableFact>();
  for (const fact of input.existing.durableFacts) facts.set(fact.id, fact);
  for (const fact of input.document.durable_facts) {
    const id = slugify(fact.id);
    if (!id || !fact.fact?.trim()) continue;
    facts.set(id, { id, fact: fact.fact.trim(), learnedInConversationId: input.conversationId });
  }

  const topics = new Map<string, UnresolvedTopic>();
  for (const topic of input.existing.unresolvedTopics) topics.set(topic.id, topic);
  for (const topic of input.document.unresolved_topics) {
    const id = slugify(topic.id);
    if (!id || !topic.topic?.trim()) continue;
    topics.set(id, {
      id,
      topic: topic.topic.trim(),
      raisedBy: topic.raised_by?.toUpperCase() === 'AGENT' ? 'AGENT' : 'CONTACT',
    });
  }

  const candidate = ConversationMemorySchema.safeParse({
    kind: 'schedule-ai-voice/conversation-memory',
    v: 1,
    narrative: (input.document.narrative || input.existing.narrative).slice(0, MEMORY_LIMITS.narrativeChars),
    durableFacts: [...facts.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, MEMORY_LIMITS.durableFacts)
      .map((fact) => ({ ...fact, fact: fact.fact.slice(0, MEMORY_LIMITS.durableFactChars) })),
    unresolvedTopics: [...topics.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, MEMORY_LIMITS.unresolvedTopics)
      .map((topic) => ({ ...topic, topic: topic.topic.slice(0, MEMORY_LIMITS.unresolvedTopicChars) })),
    coveredThroughTurnIndex: input.coveredThroughTurnIndex,
    generatedBy: input.generatedBy,
    generatedAtUtc: input.nowUtc,
  });

  if (!candidate.success) {
    // The merge produced something the schema refuses. Keep what we had and
    // move the coverage line anyway: re-reading these turns on the next refresh
    // would keep hitting the same failure forever.
    return { ...input.existing, coveredThroughTurnIndex: input.coveredThroughTurnIndex };
  }

  return fromEnvelope(candidate.data, 'ENVELOPE');
}

// ---------------------------------------------------------------------------

function notDue(coveredThroughTurnIndex: number, reason: string | null): MemoryRefreshResult {
  return { status: 'NOT_DUE', turnsCompacted: 0, coveredThroughTurnIndex, failureReason: reason, dropped: [] };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
