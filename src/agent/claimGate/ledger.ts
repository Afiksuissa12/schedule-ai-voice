/**
 * THE AUTHORITATIVE ACTION LEDGER.
 *
 * WHAT IT IS
 * ---------------------------------------------------------------------------
 * Everything this system can actually show for itself, at the instant a sentence
 * is about to reach a customer:
 *
 *   - the EFFECTS that exist - from this turn's real `ToolOutcome` values and
 *     from the persisted rows of every earlier turn and earlier session;
 *   - the REFUSALS this turn produced, each with its `ValidationErrorCode` and
 *     the reason written to be acted on, because "what was refused and why" is
 *     part of the authoritative state and a model told only "that did not work"
 *     learns nothing;
 *   - the IDENTIFIERS the system has actually issued or shown, because an
 *     identifier in a sentence that is in no tool result and no row is an
 *     invented identifier.
 *
 * WHERE IT IS NOT ALLOWED TO COME FROM
 * ---------------------------------------------------------------------------
 * Model text. The assistant transcript. A summary. A memory. An earlier
 * assertion. Anything the model said is the thing under examination, and a
 * ledger built partly from it would verify the model against itself.
 *
 * Concretely: every effect below carries a `source` that is either a
 * `ToolOutcome` this turn produced or a row read through a repository, and there
 * is no third value. `docs/ARCHITECTURE.md` § 1's governing rule is what this
 * type exists to make checkable one layer further up than the chokepoint.
 *
 * WHY DURABLE ROWS AND NOT JUST THIS TURN
 * ---------------------------------------------------------------------------
 * Because "the meeting is confirmed for Thursday" is a TRUE sentence when the
 * meeting was booked three turns ago, or in last week's call. A gate that only
 * looked at this turn's tool outcomes would force a model to re-book something
 * that already exists in order to be allowed to mention it, which is a worse
 * failure than the one being fixed.
 */
import { DateTime } from 'luxon';

import type { Database } from '../../db/database.js';
import type { Contact } from '../../domain/entities.js';
import type { IsoUtcString } from '../../ports/clock.js';
import type { DayPartsPolicy } from '../../scheduling/policy.js';
import { DEFAULT_DAY_PARTS } from '../../scheduling/policy.js';
import type { ToolOutcome } from '../tools/results.js';

/** The kinds of effect this application can actually produce. */
export const LEDGER_EFFECT_KINDS = [
  'MEETING_SCHEDULED',
  'MEETING_RESCHEDULED',
  'MEETING_CANCELLED',
  'CALLBACK_SCHEDULED',
  'AVAILABILITY_CHECKED',
  'QUALIFICATION_RECORDED',
  'CALL_OUTCOME_RECORDED',
  'HUMAN_HANDOVER_REQUESTED',
] as const;

export type LedgerEffectKind = (typeof LEDGER_EFFECT_KINDS)[number];

/**
 * Effects that CHANGED something a contact can be told about.
 *
 * `AVAILABILITY_CHECKED` is deliberately outside this set. `check_availability`
 * books nothing - its own tool result says `booked: false` in so many words
 * (`src/agent/tools/handlers.ts`) - so a sentence asserting completion without
 * naming what completed is not satisfied by it.
 */
export const STATE_CHANGING_EFFECT_KINDS: readonly LedgerEffectKind[] = [
  'MEETING_SCHEDULED',
  'MEETING_RESCHEDULED',
  'MEETING_CANCELLED',
  'CALLBACK_SCHEDULED',
  'QUALIFICATION_RECORDED',
  'CALL_OUTCOME_RECORDED',
  'HUMAN_HANDOVER_REQUESTED',
];

/**
 * An instant as the CONTACT would experience it.
 *
 * Computed in `Contact.timezone` and nowhere else. A meeting agreed in a
 * different zone still has to be checked against the words the contact will
 * hear, and those words are in their own local time - which is what the prompt
 * clause `SPEAK_TIMES_IN_CONTACT_TIMEZONE` already asks the model for.
 */
export interface LedgerLocalTime {
  /** `yyyy-LL-dd HH:mm` in the contact's zone. For an audit detail. */
  readonly local: string;
  /** Luxon's numbering: 1 = Monday .. 7 = Sunday. */
  readonly isoWeekday: number;
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** The zone this was rendered in - always the contact's. */
  readonly timezone: string;
}

export interface LedgerEffect {
  readonly kind: LedgerEffectKind;
  readonly source: 'TOOL_OUTCOME' | 'DURABLE_ROW';
  /** The tool that produced it, when this turn produced it. */
  readonly toolName: string | null;
  readonly toolCallId: string | null;
  /** The row it is, when it is a row. */
  readonly entity: { readonly type: string; readonly id: string } | null;
  readonly startUtc: IsoUtcString | null;
  /** The zone the effect was AGREED in, which may differ from the contact's. */
  readonly agreedTimezone: string | null;
  /** The same instant in the CONTACT's zone. Null when the effect has no instant. */
  readonly localTime: LedgerLocalTime | null;
  readonly status: string | null;
  readonly title: string | null;
}

export interface LedgerRefusal {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly code: string;
  /** Written to be handed straight back to the model. */
  readonly reason: string;
}

export const LEDGER_IDENTIFIER_KINDS = [
  'MEETING',
  'FUTURE_ACTION',
  'TASK',
  'CALL',
  'CALL_OUTCOME',
  'QUALIFICATION_STATE',
  'EXTERNAL_CALENDAR_EVENT',
  'CONTACT',
] as const;

export type LedgerIdentifierKind = (typeof LEDGER_IDENTIFIER_KINDS)[number];

export interface LedgerIdentifier {
  /** Exactly as the system issued it. Compared case-insensitively. */
  readonly value: string;
  readonly kind: LedgerIdentifierKind;
  readonly source: 'TOOL_OUTCOME' | 'DURABLE_ROW';
}

/** The whole authoritative snapshot one release is judged against. */
export interface ActionLedger {
  readonly conversationId: string;
  readonly contactId: string;
  /** From the persisted row. Never from the model. */
  readonly contactTimezone: string;
  /** The turn's pinned instant, so `tomorrow` means one thing all turn. */
  readonly nowUtc: IsoUtcString;
  readonly effects: readonly LedgerEffect[];
  readonly refusals: readonly LedgerRefusal[];
  readonly identifiers: readonly LedgerIdentifier[];
  /**
   * The tools this conversation is actually permitted, from
   * `AgentConfiguration.allowedToolsJson`.
   *
   * Here so a promise can be refused for the right reason: an email has no tool
   * at all, which is a different finding from a booking that was refused.
   */
  readonly permittedToolNames: readonly string[];
  /**
   * The day-part windows the SCHEDULER used this turn.
   *
   * Carried rather than re-derived so that "the afternoon" means the same span
   * to the gate as it did to `SchedulingValidator`. Two different answers to
   * "is 14:00 in the afternoon" is the sort of disagreement that turns a
   * correct booking into a blocked sentence.
   */
  readonly dayParts: DayPartsPolicy;
}

export interface BuildActionLedgerInput {
  readonly db: Database;
  readonly conversationId: string;
  readonly contact: Contact;
  readonly nowUtc: IsoUtcString;
  /** Every outcome this turn has produced SO FAR, successes and refusals. */
  readonly toolOutcomes: readonly ToolOutcome[];
  readonly permittedToolNames: readonly string[];
  readonly dayParts?: DayPartsPolicy;
  /** How many rows of each kind to read back. Bounded on purpose. */
  readonly durableRowLimit?: number;
}

/**
 * How far back the durable read goes.
 *
 * Twenty of each kind is far more than any real conversation refers to, and
 * bounding it means the gate's cost does not grow with the length of a contact's
 * history. A claim about something older than the last twenty meetings will be
 * treated as unsupported, which is the fail-safe direction.
 */
export const DEFAULT_DURABLE_ROW_LIMIT = 20;

/**
 * Build the ledger for one release.
 *
 * Reads rows every time it is called. There is no cache, for the same reason
 * `ConversationService` has none: a tool that ran two lines ago changed the
 * answer, and a stale ledger would either block a true sentence or pass a false
 * one.
 */
export async function buildActionLedger(input: BuildActionLedgerInput): Promise<ActionLedger> {
  const { db, contact } = input;
  const take = input.durableRowLimit ?? DEFAULT_DURABLE_ROW_LIMIT;
  const zone = contact.timezone;

  const effects: LedgerEffect[] = [];
  const identifiers: LedgerIdentifier[] = [];
  const refusals: LedgerRefusal[] = [];

  // ---- 1. what THIS turn actually did ------------------------------------
  // From ToolOutcome values only. `outcome.data` is the payload the handler
  // built out of the row it wrote; `outcome.persisted` is that row's primary
  // key. Neither has been near the model.
  for (const outcome of input.toolOutcomes) {
    if (!outcome.ok) {
      refusals.push({
        toolName: outcome.toolName,
        toolCallId: outcome.toolCallId,
        code: outcome.code,
        reason: outcome.reason,
      });
      continue;
    }

    const kind = effectKindForTool(outcome.toolName);
    if (kind === null) continue;

    const data = outcome.data;
    const startUtc = readStartUtcFromOutcome(kind, data);
    const agreedTimezone = typeof data['timezone'] === 'string' ? (data['timezone'] as string) : null;

    effects.push({
      kind,
      source: 'TOOL_OUTCOME',
      toolName: outcome.toolName,
      toolCallId: outcome.toolCallId,
      entity: outcome.persisted ? { type: outcome.persisted.type, id: outcome.persisted.id } : null,
      startUtc,
      agreedTimezone,
      localTime: startUtc === null ? null : localTimeOf(startUtc, zone),
      status: typeof data['status'] === 'string' ? (data['status'] as string) : null,
      title: typeof data['title'] === 'string' ? (data['title'] as string) : null,
    });

    for (const identifier of identifiersFromOutcomeData(data, outcome.persisted ?? null)) {
      identifiers.push({ ...identifier, source: 'TOOL_OUTCOME' });
    }
  }

  // ---- 2. what already existed -------------------------------------------
  const [meetings, futureActions, tasks, calls, qualification] = await Promise.all([
    db.meetings.listByContact(contact.id, { take }),
    db.futureActions.listByContact(contact.id, { take }),
    db.tasks.listByContact(contact.id, { take }),
    db.calls.listByContact(contact.id, { take }),
    db.qualificationStates.findByContactId(contact.id),
  ]);

  for (const meeting of meetings) {
    effects.push({
      kind:
        meeting.status === 'CANCELLED'
          ? 'MEETING_CANCELLED'
          : meeting.status === 'RESCHEDULED'
            ? 'MEETING_RESCHEDULED'
            : 'MEETING_SCHEDULED',
      source: 'DURABLE_ROW',
      toolName: null,
      toolCallId: null,
      entity: { type: 'MEETING', id: meeting.id },
      startUtc: meeting.startUtc,
      agreedTimezone: meeting.timezone,
      localTime: localTimeOf(meeting.startUtc, zone),
      status: meeting.status,
      title: meeting.title,
    });
    identifiers.push({ value: meeting.id, kind: 'MEETING', source: 'DURABLE_ROW' });
    if (meeting.externalCalendarEventId) {
      identifiers.push({
        value: meeting.externalCalendarEventId,
        kind: 'EXTERNAL_CALENDAR_EVENT',
        source: 'DURABLE_ROW',
      });
    }
  }

  for (const action of futureActions) {
    effects.push({
      kind: 'CALLBACK_SCHEDULED',
      source: 'DURABLE_ROW',
      toolName: null,
      toolCallId: null,
      entity: { type: 'FUTURE_ACTION', id: action.id },
      startUtc: action.scheduledForUtc,
      agreedTimezone: action.timezone,
      localTime: localTimeOf(action.scheduledForUtc, zone),
      status: action.status,
      title: action.type,
    });
    identifiers.push({ value: action.id, kind: 'FUTURE_ACTION', source: 'DURABLE_ROW' });
  }

  for (const task of tasks) {
    effects.push({
      kind: 'HUMAN_HANDOVER_REQUESTED',
      source: 'DURABLE_ROW',
      toolName: null,
      toolCallId: null,
      entity: { type: 'TASK', id: task.id },
      startUtc: null,
      agreedTimezone: null,
      localTime: null,
      status: task.status,
      title: task.title,
    });
    identifiers.push({ value: task.id, kind: 'TASK', source: 'DURABLE_ROW' });
  }

  for (const call of calls) {
    const outcome = await db.callOutcomes.findByCallId(call.id);
    identifiers.push({ value: call.id, kind: 'CALL', source: 'DURABLE_ROW' });
    if (!outcome) continue;
    effects.push({
      kind: 'CALL_OUTCOME_RECORDED',
      source: 'DURABLE_ROW',
      toolName: null,
      toolCallId: null,
      entity: { type: 'CALL_OUTCOME', id: outcome.id },
      startUtc: null,
      agreedTimezone: null,
      localTime: null,
      status: outcome.outcome,
      title: null,
    });
    identifiers.push({ value: outcome.id, kind: 'CALL_OUTCOME', source: 'DURABLE_ROW' });
  }

  if (qualification) {
    effects.push({
      kind: 'QUALIFICATION_RECORDED',
      source: 'DURABLE_ROW',
      toolName: null,
      toolCallId: null,
      entity: { type: 'QUALIFICATION_STATE', id: qualification.id },
      startUtc: null,
      agreedTimezone: null,
      localTime: null,
      status: qualification.band,
      title: null,
    });
    identifiers.push({ value: qualification.id, kind: 'QUALIFICATION_STATE', source: 'DURABLE_ROW' });
  }

  // The contact's own id. Not something the model may READ OUT - the prompt
  // forbids that and `hermes3:8b` doing it anyway is a separate finding in
  // § 6.5.4 - but it is unquestionably an identifier the system issued, so a
  // model repeating it is not INVENTING one, and this gate must not report it as
  // if it were. Saying which defect a mechanism does not cover beats implying it
  // covers both.
  identifiers.push({ value: contact.id, kind: 'CONTACT', source: 'DURABLE_ROW' });

  return {
    conversationId: input.conversationId,
    contactId: contact.id,
    contactTimezone: zone,
    nowUtc: input.nowUtc,
    effects: dedupeEffects(effects),
    refusals,
    identifiers: dedupeIdentifiers(identifiers),
    permittedToolNames: [...input.permittedToolNames],
    dayParts: input.dayParts ?? DEFAULT_DAY_PARTS,
  };
}

// ---------------------------------------------------------------------------

/** Which effect a successful tool produced. `null` = it changes nothing. */
function effectKindForTool(toolName: string): LedgerEffectKind | null {
  switch (toolName) {
    case 'schedule_meeting':
      return 'MEETING_SCHEDULED';
    case 'reschedule_meeting':
      return 'MEETING_RESCHEDULED';
    case 'cancel_meeting':
      return 'MEETING_CANCELLED';
    case 'schedule_followup':
      return 'CALLBACK_SCHEDULED';
    case 'check_availability':
      return 'AVAILABILITY_CHECKED';
    case 'update_qualification':
      return 'QUALIFICATION_RECORDED';
    case 'record_call_outcome':
      return 'CALL_OUTCOME_RECORDED';
    case 'transfer_to_human':
      return 'HUMAN_HANDOVER_REQUESTED';
    // `get_contact_context` reads and changes nothing, so it is not an effect.
    default:
      return null;
  }
}

/**
 * The instant a successful time-bearing tool committed to.
 *
 * Every one of them reports the local time it resolved to in `start_local`
 * together with the `timezone` it is in, which is what the evaluation harness
 * already reads (`src/eval/runner/runScenario.ts`). Reconstructing the UTC
 * instant from those two is exact: `start_local` is the validated slot's own
 * rendering, not a re-parse of the model's phrase.
 */
function readStartUtcFromOutcome(kind: LedgerEffectKind, data: Record<string, unknown>): IsoUtcString | null {
  if (kind === 'QUALIFICATION_RECORDED' || kind === 'CALL_OUTCOME_RECORDED' || kind === 'HUMAN_HANDOVER_REQUESTED') {
    return null;
  }
  const startLocal = data['start_local'];
  const timezone = data['timezone'];
  if (typeof startLocal !== 'string' || typeof timezone !== 'string') return null;
  const parsed = DateTime.fromISO(startLocal, { zone: timezone });
  if (!parsed.isValid) return null;
  return parsed.toUTC().toISO() as IsoUtcString;
}

/** Every identifier a successful tool result actually showed. */
function identifiersFromOutcomeData(
  data: Record<string, unknown>,
  persisted: { readonly type: string; readonly id: string } | null,
): readonly Omit<LedgerIdentifier, 'source'>[] {
  const out: Omit<LedgerIdentifier, 'source'>[] = [];

  const push = (value: unknown, kind: LedgerIdentifierKind): void => {
    if (typeof value === 'string' && value.trim().length > 0) out.push({ value, kind });
  };

  push(data['meeting_id'], 'MEETING');
  push(data['future_action_id'], 'FUTURE_ACTION');
  push(data['task_id'], 'TASK');
  push(data['call_id'], 'CALL');
  push(data['call_outcome_id'], 'CALL_OUTCOME');
  push(data['contact_id'], 'CONTACT');

  // `get_contact_context` hands back lists, and everything in them has been
  // SHOWN to the model, so repeating one is quoting rather than inventing.
  for (const entry of asArray(data['upcoming_meetings'])) push(entry['meeting_id'], 'MEETING');
  for (const entry of asArray(data['promised_callbacks'])) push(entry['future_action_id'], 'FUTURE_ACTION');

  if (persisted) {
    const kind = (LEDGER_IDENTIFIER_KINDS as readonly string[]).includes(persisted.type)
      ? (persisted.type as LedgerIdentifierKind)
      : 'MEETING';
    out.push({ value: persisted.id, kind });
  }

  return out;
}

function asArray(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? (value.filter((entry) => entry !== null && typeof entry === 'object') as Record<string, unknown>[]) : [];
}

function localTimeOf(startUtc: IsoUtcString, zone: string): LedgerLocalTime | null {
  const at = DateTime.fromMillis(Date.parse(startUtc), { zone });
  if (!at.isValid) return null;
  return {
    local: at.toFormat('yyyy-LL-dd HH:mm'),
    isoWeekday: at.weekday,
    year: at.year,
    month: at.month,
    day: at.day,
    hour: at.hour,
    minute: at.minute,
    timezone: zone,
  };
}

/**
 * One effect per row, with the two views of it MERGED rather than one dropped.
 *
 * A row written by this turn is read back by the durable query as well, so
 * without this the same booking appears twice. Which copy to keep is not
 * obvious, because each knows something the other does not: the `ToolOutcome`
 * carries the tool call id an auditor wants, and the row carries fields the
 * tool result does not repeat - `cancel_meeting` reports no `start_local` at
 * all, so keeping only its outcome would lose the instant and make "the meeting
 * on Thursday is cancelled" unverifiable against a day.
 *
 * So the outcome wins on identity and provenance, and every field it left null
 * is filled from the row.
 */
function dedupeEffects(effects: readonly LedgerEffect[]): readonly LedgerEffect[] {
  const byEntity = new Map<string, LedgerEffect>();
  const keyless: LedgerEffect[] = [];

  for (const effect of effects) {
    if (!effect.entity) {
      keyless.push(effect);
      continue;
    }
    const key = `${effect.entity.type}:${effect.entity.id}`;
    const existing = byEntity.get(key);
    if (existing === undefined) {
      byEntity.set(key, effect);
      continue;
    }
    const [primary, secondary] =
      existing.source === 'TOOL_OUTCOME' ? [existing, effect] : [effect, existing];
    byEntity.set(key, {
      ...primary,
      startUtc: primary.startUtc ?? secondary.startUtc,
      agreedTimezone: primary.agreedTimezone ?? secondary.agreedTimezone,
      localTime: primary.localTime ?? secondary.localTime,
      status: primary.status ?? secondary.status,
      title: primary.title ?? secondary.title,
    });
  }

  return [...byEntity.values(), ...keyless];
}

function dedupeIdentifiers(identifiers: readonly LedgerIdentifier[]): readonly LedgerIdentifier[] {
  const seen = new Map<string, LedgerIdentifier>();
  for (const identifier of identifiers) {
    const key = identifier.value.toLowerCase();
    if (!seen.has(key)) seen.set(key, identifier);
  }
  return [...seen.values()];
}

/** Every identifier value the system has issued, lower-cased for lookup. */
export function issuedIdentifierSet(ledger: ActionLedger): ReadonlySet<string> {
  return new Set(ledger.identifiers.map((identifier) => identifier.value.toLowerCase()));
}
