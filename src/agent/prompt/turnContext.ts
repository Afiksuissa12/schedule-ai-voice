/**
 * The turn-scoped context message.
 *
 * WHY THIS IS NOT PART OF THE SYSTEM PROMPT
 * ---------------------------------------------------------------------------
 * The system prompt is versioned, cacheable, shared by every conversation, and
 * recorded by fingerprint on audit events. Per-contact facts belong nowhere
 * near it. They go here instead: a small, turn-scoped message carrying the
 * minimum the model needs to hold a competent conversation, and nothing more.
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------------------------------------------------------
 *  - The phone number. The model never dials; `DueActionRunner` does, from the
 *    payload. Putting a dialable number in a context window buys nothing and
 *    risks it being read out loud.
 *  - The email address. Application code adds the contact as a calendar
 *    attendee from the persisted row.
 *  - Notes, lead source, scores, history. If the model needs them it can call
 *    `get_contact_context`, and that call is audited - which is a better
 *    default than pushing the whole CRM record into every turn.
 *
 * WHAT IS PRESENT, AND WHY EACH EARNS ITS PLACE
 * ---------------------------------------------------------------------------
 *  - The contact id, because every tool call has to name a contact and the
 *    alternative is a model guessing at identifiers.
 *  - Their name, because using it is the difference between a conversation and
 *    an interrogation.
 *  - Their timezone and their CURRENT local time, because "tomorrow afternoon"
 *    is meaningless without them, and because the model is required to speak
 *    times back in their zone.
 *  - Whether they can sign, because it changes what the model should be trying
 *    to find out - and because the qualification cap will apply regardless.
 */
import { DateTime } from 'luxon';

import type { RenderedContext } from '../../conversation/contextAssembly.js';
import type { Contact, QualificationState } from '../../domain/entities.js';
import type { IsoUtcString } from '../../ports/clock.js';
import type { AgentLlmMessage } from '../../llm/agentMessage.js';

export interface TurnContextInput {
  readonly contact: Contact;
  /** `now`, from the injected Clock. Never a wall clock read here. */
  readonly nowUtc: IsoUtcString;
  /** Persisted qualification, when there is one. Read-only background. */
  readonly qualification?: QualificationState | null;
  /** The organization's zone, used only to label the business's own hours. */
  readonly organizationTimezone?: string;
  /**
   * MISSION 2, OPT-IN: the full assembled background from
   * `ConversationContextAssembler` - memory, continuity, commitments, loose
   * ends, open unknowns and business facts.
   *
   * ABSENT BY DEFAULT, AND THAT IS LOAD-BEARING. With this undefined, every
   * line below and every key in `disclosed` is exactly what Baseline V1
   * produced, byte for byte. The 500-test suite and the 601-scenario sweep
   * exercise that path and must keep seeing it unchanged, so the richer context
   * arrives as an argument rather than as a rewrite.
   *
   * When it IS present the legacy block is REPLACED rather than prefixed. The
   * assembled background already carries the contact's name, id, timezone and
   * local clock, and a 7B model handed the same four facts twice in two
   * different phrasings spends attention reconciling them instead of listening.
   */
  readonly background?: RenderedContext | null;
}

export interface BuiltTurnContext {
  readonly text: string;
  /** The facts included, for the audit detail: proof of what the model was told. */
  readonly disclosed: Record<string, unknown>;
}

export function buildTurnContext(input: TurnContextInput): BuiltTurnContext {
  const { contact, nowUtc } = input;
  const localNow = DateTime.fromMillis(Date.parse(nowUtc), { zone: contact.timezone });

  const disclosed: Record<string, unknown> = {
    contactId: contact.id,
    contactDisplayName: contact.fullName,
    contactTimezone: contact.timezone,
    // NO YEAR, DELIBERATELY. See docs/MISSION_2D_AYA_ROOT_CAUSE.md § 9.
    //
    // With the year this read `Wednesday 4 March 2026 at 10:00`, and
    // `day <month name> <year>` is byte-for-byte the shape that
    // `FABRICATION_PATTERNS` calls `day-month-name-with-year` and that the
    // fabricated-timestamp gate refuses in a time-bearing tool argument. So the
    // one absolute date in the window was a worked example of the single format
    // the same context window forbids twice, and `aya-expanse:8b` imitated it.
    //
    // Dropping the year removes the exemplar without removing the disclosure:
    // every one of the five fabrication patterns requires a 4-digit year, the
    // model still learns what day and what time it is for the contact, and
    // `Wednesday 4 March at 10:00` is not a resolvable absolute instant.
    contactLocalNow: localNow.toFormat("cccc d LLLL 'at' HH:mm"),
    isDecisionMaker: contact.isDecisionMaker,
    qualificationBand: input.qualification?.band ?? null,
    qualificationScore: input.qualification?.score ?? null,
  };

  // The assembled background supersedes this block entirely. The seven keys
  // above are still recorded, unchanged, so an audit query written against
  // Baseline V1 events keeps working across the switch; `background` is added
  // alongside as the complete record of everything else that was disclosed.
  if (input.background) {
    return {
      text: input.background.text,
      disclosed: {
        ...disclosed,
        // What the prompt says, and how it was labelled internally - kept apart
        // so that "every disclosed string is in the text" stays exactly true of
        // `background` rather than nearly true. See contextAssembly.ts.
        background: input.background.disclosed,
        backgroundMetadata: input.background.disclosureMetadata,
      },
    };
  }

  const lines = [
    '# This call',
    '',
    `You are speaking with ${contact.fullName}.`,
    `Their contact id is ${contact.id}. Use exactly this id in every tool call; never any other.`,
    `They are in ${contact.timezone}, where it is currently ${disclosed['contactLocalNow'] as string}.`,
    'Every time you say out loud must be their local time.',
    contact.isDecisionMaker
      ? 'Our record says they can make the buying decision themselves.'
      : 'Our record says they are NOT the decision maker. Find out who is, and note it - their qualification ' +
        'score is capped until we are talking to whoever signs.',
  ];

  if (input.qualification) {
    lines.push(
      `Qualification so far: ${input.qualification.band} (${input.qualification.score}/100, ` +
        `rubric ${input.qualification.rubricVersion}). Update it when you learn something new.`,
    );
  } else {
    lines.push('No qualification has been recorded for them yet.');
  }

  if (input.organizationTimezone && input.organizationTimezone !== contact.timezone) {
    lines.push(
      `Our own office runs on ${input.organizationTimezone}, so a time that suits them may be outside our ` +
        'hours. Do not try to work that out yourself - propose their time and let the booking tool answer.',
    );
  }

  return { text: lines.join('\n'), disclosed };
}

/** The context as the `system` message the turn prepends to the transcript. */
export function turnContextMessage(input: TurnContextInput): AgentLlmMessage {
  return { role: 'system', content: buildTurnContext(input).text };
}
