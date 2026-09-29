/**
 * Durable conversation memory, carried inside `Conversation.summary`.
 *
 * WHY IN A COLUMN THAT ALREADY EXISTS
 * ---------------------------------------------------------------------------
 * `prisma/schema.prisma` is frozen for this mission, so there is no
 * `ConversationMemory` table to add. `Conversation.summary` is a nullable
 * `String` that Baseline V1 already uses for exactly this purpose - a recap of
 * a finished conversation - so a versioned JSON envelope in it is a widening of
 * what is already there rather than a new idea smuggled into a spare column.
 *
 * The recommendation to promote this to real columns, and the specific reasons
 * a JSON envelope is the wrong long-term home, are written up in
 * `CONVERSATION_CONTEXT.md` § "Schema changes recommended but NOT made". That
 * recommendation is made, not taken: this mission does not touch the schema.
 *
 * LEGACY ROWS ARE THE NORMAL CASE, NOT THE EDGE CASE
 * ---------------------------------------------------------------------------
 * Baseline V1 rows contain a PLAIN STRING. `readConversationMemory` therefore
 * never throws and never returns null for a row it cannot parse:
 *
 *   - valid envelope        -> parsed, `source: 'ENVELOPE'`
 *   - plain text            -> `{ narrative: <the string> }`, `source: 'LEGACY_PLAIN_TEXT'`
 *   - JSON that is not an envelope, or an envelope that fails validation
 *                           -> the raw string as narrative, `source: 'UNREADABLE'`
 *   - null / empty          -> empty memory, `source: 'ABSENT'`
 *
 * A conversation whose memory cannot be read is a conversation with less
 * context, which is a worse conversation. A conversation whose memory THROWS is
 * a dropped call. Those are not close, so this module degrades every time.
 *
 * THE CONTENTS ARE UNTRUSTED
 * ---------------------------------------------------------------------------
 * A narrative and a fact list are, by design, written by a language model. So:
 *
 *   - every field is length- and count-clamped by the schema, because an
 *     unbounded "memory" is how a context window quietly stops fitting;
 *   - entries shaped like dialogue rather than like facts are DROPPED on read
 *     (`findDialogueShape`), so a summariser cannot smuggle a canned line into
 *     the next turn's prompt by calling it a memory;
 *   - nothing in here is ever consulted by validation. It is read-only
 *     background rendered into a prompt, and the renderer says so in the
 *     prompt itself. A remembered time is not a time: the scheduling tools take
 *     the contact's CURRENT words and application code resolves them.
 */
import { z } from 'zod';

import { findDialogueShape } from '../context/dialogueShape.js';
import type { IsoUtcString } from '../ports/clock.js';
import { tryParseJson } from '../shared/json.js';

/** Discriminator. Present so a plain legacy string can never be mistaken for one. */
export const CONVERSATION_MEMORY_KIND = 'schedule-ai-voice/conversation-memory';

/** Bumped when the envelope shape changes incompatibly. */
export const CONVERSATION_MEMORY_VERSION = 1;

/** Caps. Deliberately small: this rides in a prompt, every turn, forever. */
export const MEMORY_LIMITS = {
  narrativeChars: 1200,
  durableFacts: 12,
  durableFactChars: 220,
  unresolvedTopics: 8,
  unresolvedTopicChars: 200,
} as const;

const Slug = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .transform((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
  .pipe(z.string().min(1));

export const DurableFactSchema = z
  .object({
    id: Slug,
    fact: z.string().trim().min(3).max(MEMORY_LIMITS.durableFactChars),
    /** Which conversation this was learned in, when the writer knew. */
    learnedInConversationId: z.string().trim().max(60).optional(),
  })
  .strict();

export const UnresolvedTopicSchema = z
  .object({
    id: Slug,
    /** The subject, as a noun phrase. Never a question to put to the contact. */
    topic: z.string().trim().min(3).max(MEMORY_LIMITS.unresolvedTopicChars),
    /** Who left it hanging: they asked us, or we asked them. */
    raisedBy: z.enum(['CONTACT', 'AGENT']),
  })
  .strict();

export const ConversationMemorySchema = z
  .object({
    kind: z.literal(CONVERSATION_MEMORY_KIND),
    v: z.literal(CONVERSATION_MEMORY_VERSION),
    /** The rolling recap of everything older than the live window. */
    narrative: z.string().trim().max(MEMORY_LIMITS.narrativeChars).default(''),
    durableFacts: z.array(DurableFactSchema).max(MEMORY_LIMITS.durableFacts).default([]),
    unresolvedTopics: z.array(UnresolvedTopicSchema).max(MEMORY_LIMITS.unresolvedTopics).default([]),
    /**
     * The highest `ConversationTurn.index` this narrative accounts for.
     *
     * This is what makes the summary ROLLING rather than repeated work: the
     * writer only ever has to read turns above this line, and the assembler can
     * tell whether the narrative and the live window overlap or leave a gap.
     */
    coveredThroughTurnIndex: z.number().int().min(-1).default(-1),
    /** `LlmProvider.name()` of whatever wrote this, or a non-model source. */
    generatedBy: z.string().trim().max(80).default('unknown'),
    /** From the injected Clock at write time. Never a wall-clock read. */
    generatedAtUtc: z.string().trim().max(40).optional(),
  })
  .strict();

export type ConversationMemoryEnvelope = z.infer<typeof ConversationMemorySchema>;
export type DurableFact = z.infer<typeof DurableFactSchema>;
export type UnresolvedTopic = z.infer<typeof UnresolvedTopicSchema>;

/** How the memory we are holding came to be, so a reader can weigh it. */
export type ConversationMemorySource = 'ENVELOPE' | 'LEGACY_PLAIN_TEXT' | 'UNREADABLE' | 'ABSENT';

export interface ConversationMemory {
  readonly narrative: string;
  readonly durableFacts: readonly DurableFact[];
  readonly unresolvedTopics: readonly UnresolvedTopic[];
  readonly coveredThroughTurnIndex: number;
  readonly generatedBy: string;
  readonly generatedAtUtc: string | null;
  readonly source: ConversationMemorySource;
  /**
   * Entries dropped on read, with the reason.
   *
   * Surfaced rather than swallowed: a summariser that keeps producing scripted
   * lines is a problem somebody should be able to see, and a silent filter is
   * indistinguishable from a filter that is not running.
   */
  readonly dropped: readonly { readonly what: string; readonly why: string }[];
}

export const EMPTY_CONVERSATION_MEMORY: ConversationMemory = {
  narrative: '',
  durableFacts: [],
  unresolvedTopics: [],
  coveredThroughTurnIndex: -1,
  generatedBy: 'none',
  generatedAtUtc: null,
  source: 'ABSENT',
  dropped: [],
};

/**
 * Read whatever is in `Conversation.summary`. NEVER THROWS.
 *
 * See the header: legacy plain strings are the normal case, not an error, and
 * an unreadable envelope still yields its raw text as a narrative rather than
 * nothing at all.
 */
export function readConversationMemory(summary: string | null | undefined): ConversationMemory {
  const raw = summary?.trim();
  if (!raw) return EMPTY_CONVERSATION_MEMORY;

  // Cheap discriminator first. A plain recap written by Baseline V1 does not
  // start with `{`, so it never reaches the parser at all.
  if (!raw.startsWith('{')) {
    return { ...EMPTY_CONVERSATION_MEMORY, narrative: clamp(raw, MEMORY_LIMITS.narrativeChars), source: 'LEGACY_PLAIN_TEXT' };
  }

  const parsed = tryParseJson<unknown>(raw);
  if (!parsed.ok) {
    return { ...EMPTY_CONVERSATION_MEMORY, narrative: clamp(raw, MEMORY_LIMITS.narrativeChars), source: 'UNREADABLE' };
  }

  const envelope = ConversationMemorySchema.safeParse(parsed.value);
  if (!envelope.success) {
    return { ...EMPTY_CONVERSATION_MEMORY, narrative: clamp(raw, MEMORY_LIMITS.narrativeChars), source: 'UNREADABLE' };
  }

  return fromEnvelope(envelope.data, 'ENVELOPE');
}

/**
 * Apply the content rules to a validated envelope.
 *
 * Shared by `readConversationMemory` and by the writer, so a fact that would be
 * dropped on read is dropped before it is ever written - the alternative is a
 * stored envelope whose contents silently never appear.
 */
export function fromEnvelope(
  envelope: ConversationMemoryEnvelope,
  source: ConversationMemorySource,
): ConversationMemory {
  const dropped: { what: string; why: string }[] = [];

  const durableFacts = dedupeById(
    envelope.durableFacts.filter((entry) => {
      const finding = findDialogueShape(entry.fact);
      if (finding) {
        dropped.push({ what: `durableFact:${entry.id}`, why: `${finding.ruleId} matched "${finding.matched}"` });
        return false;
      }
      return true;
    }),
  );

  const unresolvedTopics = dedupeById(
    envelope.unresolvedTopics.filter((entry) => {
      const finding = findDialogueShape(entry.topic);
      if (finding) {
        dropped.push({ what: `unresolvedTopic:${entry.id}`, why: `${finding.ruleId} matched "${finding.matched}"` });
        return false;
      }
      return true;
    }),
  );

  return {
    narrative: envelope.narrative,
    durableFacts,
    unresolvedTopics,
    coveredThroughTurnIndex: envelope.coveredThroughTurnIndex,
    generatedBy: envelope.generatedBy,
    generatedAtUtc: envelope.generatedAtUtc ?? null,
    source,
    dropped,
  };
}

/** The envelope as it is stored. Deterministic key order, so two equal memories serialize identically. */
export function serializeConversationMemory(
  memory: Omit<ConversationMemory, 'source' | 'dropped'> & { readonly generatedAtUtc?: IsoUtcString | null },
): string {
  const envelope: ConversationMemoryEnvelope = {
    kind: CONVERSATION_MEMORY_KIND,
    v: CONVERSATION_MEMORY_VERSION,
    narrative: clamp(memory.narrative, MEMORY_LIMITS.narrativeChars),
    durableFacts: memory.durableFacts.slice(0, MEMORY_LIMITS.durableFacts).map((entry) => ({
      id: entry.id,
      fact: clamp(entry.fact, MEMORY_LIMITS.durableFactChars),
      ...(entry.learnedInConversationId ? { learnedInConversationId: entry.learnedInConversationId } : {}),
    })),
    unresolvedTopics: memory.unresolvedTopics.slice(0, MEMORY_LIMITS.unresolvedTopics).map((entry) => ({
      id: entry.id,
      topic: clamp(entry.topic, MEMORY_LIMITS.unresolvedTopicChars),
      raisedBy: entry.raisedBy,
    })),
    coveredThroughTurnIndex: memory.coveredThroughTurnIndex,
    generatedBy: memory.generatedBy,
    ...(memory.generatedAtUtc ? { generatedAtUtc: memory.generatedAtUtc } : {}),
  };

  // Key order is fixed by the literal above, and JSON.stringify preserves
  // insertion order, so this is stable across runs and processes. That matters:
  // a proof asserts byte-identical context for a fixed database.
  return JSON.stringify(envelope);
}

/** True when the stored string is one of our envelopes rather than a legacy recap. */
export function isMemoryEnvelope(summary: string | null | undefined): boolean {
  return readConversationMemory(summary).source === 'ENVELOPE';
}

// ---------------------------------------------------------------------------

function dedupeById<T extends { id: string }>(entries: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}
