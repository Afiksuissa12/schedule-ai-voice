/**
 * `DateTimeResolver` - turning whatever the LLM said into a concrete instant,
 * or refusing to.
 *
 * FOUNDER RULE THIS IMPLEMENTS
 * ---------------------------------------------------------------------------
 * "Any datetime an LLM proposes must be deterministically validated - parsed,
 * timezone-resolved, ... - before being persisted or acted on."
 *
 * This is the parse-and-timezone-resolve half. `SchedulingValidator` is the
 * policy half. Between them they produce the shared
 * `ValidationResult<ResolvedSlot>` with a complete, ordered receipt.
 *
 * PURITY
 * ---------------------------------------------------------------------------
 * This class reads NO wall clock, touches NO database and mutates NOTHING. It
 * is a pure function of (proposal, clock-supplied `now`, policy). Given the same
 * three inputs it returns the same answer forever, which is what makes a
 * recorded `ValidationProvenance` re-runnable by hand.
 *
 * ACCEPTED INPUT
 * ---------------------------------------------------------------------------
 *  - an ISO-8601 instant with an explicit offset - `2026-03-05T15:00:00Z`
 *  - an ISO-8601 LOCAL datetime with no offset  - `2026-03-05T15:00`
 *    (interpreted in the supplied zone, which is where DST bites)
 *  - a natural-language expression              - `tomorrow afternoon at 3`
 *    (see `naturalLanguage.ts` for the full grammar and its refusals)
 */
import { DateTime } from 'luxon';

import type { Clock, IsoUtcString } from '../ports/clock.js';
import type { ValidationResult } from '../ports/validation.js';
import { validationFailed, validationOk, ValidationErrorCode } from '../ports/validation.js';
import { isValidIanaTimezone } from '../shared/time.js';
import { buildProvenance, ValidationCheckLog } from './checkLog.js';
import type { DayPartName } from './policy.js';
import type { SchedulingPolicy } from './policy.js';
import {
  parseNaturalLanguageDateTime,
  type LexiconEvent,
  type LocalWallTimeTarget,
  type NaturalLanguageInterpretation,
} from './naturalLanguage.js';
import { formatOffset, resolveLocalWallTime } from './zoneMath.js';

export const DATETIME_RESOLVER_VERSION = 'datetime-resolver@1';

/** What the LLM proposed, verbatim, plus the zone it is to be read in. */
export interface DateTimeProposal {
  /** EXACTLY what the model produced. Stored verbatim in the receipt. */
  readonly raw: string;
  /** IANA zone. Normally `Contact.timezone`. */
  readonly timezone: string;
  /** Slot length. Falls back to the policy's default. */
  readonly durationMinutes?: number;
}

/** How the resolver got to its answer. Recorded in `ValidationProvenance.notes`. */
export interface SlotInterpretation {
  readonly source: 'ISO_INSTANT' | 'ISO_LOCAL_DATETIME' | 'NATURAL_LANGUAGE';
  /** Grammar/parse rules that fired, in order. */
  readonly matched: readonly string[];
  readonly dayAnchor?: string;
  readonly dayPart?: DayPartName;
  readonly timeAnchor?: string;
  /** Offset of the resolved instant in the target zone, e.g. `-05:00`. */
  readonly utcOffset: string;
  /**
   * Which locale lexicons the natural-language grammar matched against.
   *
   * Additive, and optional because the ISO paths have no locale to name. A
   * reader of a Hebrew booking can now see `['he']` rather than having to infer
   * from the raw text which vocabulary was consulted.
   */
  readonly locales?: readonly string[];
  /** Every grammar event, in order, each naming the locale that produced it. */
  readonly lexicon?: readonly LexiconEvent[];
  /** Carrier/filler tokens discarded BY RULE rather than by omission. */
  readonly carriers?: readonly string[];
}

/** A concrete, checked slot. The success payload of the whole pipeline. */
export interface ResolvedSlot {
  readonly startUtc: IsoUtcString;
  readonly endUtc: IsoUtcString;
  /** IANA zone the slot was agreed in. */
  readonly timezone: string;
  /** Wall-clock start in `timezone`, e.g. `2026-03-05T15:00`. */
  readonly startLocal: string;
  readonly endLocal: string;
  readonly durationMinutes: number;
  readonly interpretation: SlotInterpretation;
}

export interface ResolveOptions {
  /** Policy from the persisted `AgentConfiguration`. Never from the model. */
  readonly policy: SchedulingPolicy;
  /** Overrides `clock.nowUtc()` so a validator can share one `now` end to end. */
  readonly nowUtc?: IsoUtcString;
  /** Append to an existing ordered receipt instead of starting a new one. */
  readonly checks?: ValidationCheckLog;
  /** Recorded as `ValidationProvenance.validatorVersion`. */
  readonly validatorVersion?: string;
}

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:z|[+-]\d{2}:?\d{2})$/i;
const ISO_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[t ](\d{2}):(\d{2})(?::(\d{2}))?$/i;

export class DateTimeResolver {
  constructor(private readonly clock: Clock) {}

  resolve(proposal: DateTimeProposal, options: ResolveOptions): ValidationResult<ResolvedSlot> {
    const checks = options.checks ?? new ValidationCheckLog();
    const nowUtc = options.nowUtc ?? this.clock.nowUtc();
    const validatorVersion = options.validatorVersion ?? DATETIME_RESOLVER_VERSION;
    const raw = proposal.raw ?? '';

    const fail = (
      code: (typeof ValidationErrorCode)[keyof typeof ValidationErrorCode],
      reason: string,
      notes?: Record<string, unknown>,
    ): ValidationResult<ResolvedSlot> =>
      validationFailed(
        code,
        reason,
        buildProvenance(
          {
            validatorVersion,
            nowUtc,
            rawProposedValue: raw,
            resolvedTimezone: proposal.timezone,
            ...(notes ? { notes } : {}),
          },
          checks,
        ),
      );

    // ---- 1. the timezone must be a real IANA zone --------------------------
    if (!isValidIanaTimezone(proposal.timezone)) {
      checks.fail(
        'timezone_is_iana',
        `"${String(proposal.timezone)}" is not an IANA zone name this runtime knows. ` +
          'UTC offsets are rejected on purpose: an offset carries no DST rule.',
      );
      return fail(
        ValidationErrorCode.UNKNOWN_TIMEZONE,
        `Unknown timezone "${String(proposal.timezone)}". Use an IANA zone name such as America/New_York.`,
      );
    }
    checks.pass('timezone_is_iana', `${proposal.timezone} is a known IANA zone`);

    const durationMinutes = proposal.durationMinutes ?? options.policy.defaultMeetingDurationMinutes;
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      checks.fail('parse_proposed_value', `Slot duration ${String(durationMinutes)} is not a positive whole number.`);
      return fail(
        ValidationErrorCode.INVALID_FORMAT,
        `Slot duration must be a positive whole number of minutes, got ${String(durationMinutes)}.`,
      );
    }

    const nowLocal = DateTime.fromISO(nowUtc, { zone: 'utc' }).setZone(proposal.timezone);
    if (!nowLocal.isValid) {
      checks.fail('parse_proposed_value', `Clock produced an unusable now: ${nowUtc}`);
      return fail(ValidationErrorCode.INVALID_FORMAT, `The injected clock produced an unparseable now: ${nowUtc}`);
    }

    // ---- 2. parse -----------------------------------------------------------
    const trimmed = raw.trim();

    if (ISO_INSTANT_RE.test(trimmed)) {
      return this.fromExplicitInstant(trimmed, proposal, durationMinutes, {
        checks,
        nowUtc,
        validatorVersion,
      });
    }

    const isoLocal = ISO_LOCAL_RE.exec(trimmed);
    if (isoLocal) {
      const target: LocalWallTimeTarget = {
        year: Number(isoLocal[1]),
        month: Number(isoLocal[2]),
        day: Number(isoLocal[3]),
        hour: Number(isoLocal[4]),
        minute: Number(isoLocal[5]),
      };
      if (!isRealCalendarTarget(target)) {
        checks.fail('parse_proposed_value', `"${trimmed}" is not a real calendar date and time.`);
        return fail(ValidationErrorCode.INVALID_FORMAT, `"${trimmed}" is not a real calendar date and time.`);
      }
      checks.pass('parse_proposed_value', `parsed "${trimmed}" as a local datetime in ${proposal.timezone}`);
      return this.fromLocalTarget(target, proposal, durationMinutes, {
        checks,
        nowUtc,
        validatorVersion,
        interpretation: { source: 'ISO_LOCAL_DATETIME', matched: ['iso_local_datetime'] },
      });
    }

    const parsed = parseNaturalLanguageDateTime(raw, { nowLocal, dayParts: options.policy.dayParts });
    if (!parsed.ok) {
      checks.fail('parse_proposed_value', parsed.reason);
      return fail(ValidationErrorCode.INVALID_FORMAT, parsed.reason, {
        interpretation: parsed.interpretation,
      });
    }

    if (parsed.kind === 'ELAPSED_FROM_NOW') {
      checks.pass(
        'parse_proposed_value',
        `parsed "${raw}" as an elapsed offset from ${nowUtc} (${parsed.interpretation.matched.join(', ')})`,
      );
      const instant = DateTime.fromMillis(parsed.epochMillis, { zone: proposal.timezone });
      checks.pass('local_time_exists', 'not applicable: an elapsed offset determines the instant directly');
      checks.pass('local_time_unambiguous', 'not applicable: an elapsed offset determines the instant directly');
      const slot = this.buildSlot(instant, proposal.timezone, durationMinutes, {
        ...naturalLanguageInterpretation(parsed.interpretation),
        utcOffset: formatOffset(instant.offset),
      });
      return validationOk(
        slot,
        buildProvenance(
          {
            validatorVersion,
            nowUtc,
            rawProposedValue: raw,
            resolvedTimezone: proposal.timezone,
            resolvedStartUtc: slot.startUtc,
            resolvedEndUtc: slot.endUtc,
            notes: { interpretation: parsed.interpretation },
          },
          checks,
        ),
      );
    }

    checks.pass(
      'parse_proposed_value',
      `parsed "${raw}" as ${formatTarget(parsed.target)} local (${parsed.interpretation.matched.join(', ')})`,
    );
    return this.fromLocalTarget(parsed.target, proposal, durationMinutes, {
      checks,
      nowUtc,
      validatorVersion,
      interpretation: naturalLanguageInterpretation(parsed.interpretation),
      notes: { interpretation: parsed.interpretation },
    });
  }

  // -------------------------------------------------------------------------

  private fromExplicitInstant(
    trimmed: string,
    proposal: DateTimeProposal,
    durationMinutes: number,
    ctx: { checks: ValidationCheckLog; nowUtc: IsoUtcString; validatorVersion: string },
  ): ValidationResult<ResolvedSlot> {
    const parsed = DateTime.fromISO(trimmed.replace(' ', 'T'), { setZone: true });
    if (!parsed.isValid) {
      ctx.checks.fail('parse_proposed_value', `"${trimmed}" is not a valid ISO-8601 instant.`);
      return validationFailed(
        ValidationErrorCode.INVALID_FORMAT,
        `"${trimmed}" is not a valid ISO-8601 instant.`,
        buildProvenance(
          {
            validatorVersion: ctx.validatorVersion,
            nowUtc: ctx.nowUtc,
            rawProposedValue: proposal.raw,
            resolvedTimezone: proposal.timezone,
          },
          ctx.checks,
        ),
      );
    }

    const instant = parsed.setZone(proposal.timezone);
    ctx.checks.pass(
      'parse_proposed_value',
      `parsed "${trimmed}" as an explicit instant; rendered in ${proposal.timezone} as ${instant.toFormat("yyyy-LL-dd'T'HH:mm")}`,
    );
    // An explicit instant is already a point on the timeline. There is no
    // wall-clock ambiguity to resolve, so these two checks are recorded as
    // inapplicable rather than silently omitted - the receipt keeps its shape.
    ctx.checks.pass('local_time_exists', 'not applicable: the input was an explicit instant');
    ctx.checks.pass('local_time_unambiguous', 'not applicable: the input was an explicit instant');

    const slot = this.buildSlot(instant, proposal.timezone, durationMinutes, {
      source: 'ISO_INSTANT',
      matched: ['iso_instant'],
      utcOffset: formatOffset(instant.offset),
    });

    return validationOk(
      slot,
      buildProvenance(
        {
          validatorVersion: ctx.validatorVersion,
          nowUtc: ctx.nowUtc,
          rawProposedValue: proposal.raw,
          resolvedTimezone: proposal.timezone,
          resolvedStartUtc: slot.startUtc,
          resolvedEndUtc: slot.endUtc,
        },
        ctx.checks,
      ),
    );
  }

  private fromLocalTarget(
    target: LocalWallTimeTarget,
    proposal: DateTimeProposal,
    durationMinutes: number,
    ctx: {
      checks: ValidationCheckLog;
      nowUtc: IsoUtcString;
      validatorVersion: string;
      interpretation: Omit<SlotInterpretation, 'utcOffset'>;
      notes?: Record<string, unknown>;
    },
  ): ValidationResult<ResolvedSlot> {
    const provenanceFor = (extra?: Record<string, unknown>) =>
      buildProvenance(
        {
          validatorVersion: ctx.validatorVersion,
          nowUtc: ctx.nowUtc,
          rawProposedValue: proposal.raw,
          resolvedTimezone: proposal.timezone,
          ...(ctx.notes || extra ? { notes: { ...(ctx.notes ?? {}), ...(extra ?? {}) } } : {}),
        },
        ctx.checks,
      );

    const resolution = resolveLocalWallTime(target, proposal.timezone);
    const wall = formatTarget(target);

    if (resolution.kind === 'NONEXISTENT') {
      const detail =
        `${wall} does not exist in ${proposal.timezone}: the clocks jump forward across it ` +
        `(offsets tried: ${resolution.offsetsConsidered.map(formatOffset).join(', ')}).`;
      ctx.checks.fail('local_time_exists', detail);
      return validationFailed(
        ValidationErrorCode.NONEXISTENT_LOCAL_TIME,
        `${detail} Ask the contact for a different time.`,
        provenanceFor({ offsetsConsidered: resolution.offsetsConsidered }),
      );
    }
    ctx.checks.pass('local_time_exists', `${wall} exists in ${proposal.timezone}`);

    if (resolution.kind === 'AMBIGUOUS') {
      const renderings = resolution.epochMillisCandidates.map((millis) =>
        DateTime.fromMillis(millis, { zone: proposal.timezone }).toISO(),
      );
      const detail =
        `${wall} happens twice in ${proposal.timezone}: the clocks go back across it ` +
        `(candidates: ${renderings.join(' and ')}).`;
      ctx.checks.fail('local_time_unambiguous', detail);
      return validationFailed(
        ValidationErrorCode.AMBIGUOUS_LOCAL_TIME,
        `${detail} Ask the contact which one they mean, or use an explicit UTC offset.`,
        provenanceFor({
          ambiguousCandidatesUtc: resolution.epochMillisCandidates.map((millis) =>
            new Date(millis).toISOString(),
          ),
        }),
      );
    }
    ctx.checks.pass(
      'local_time_unambiguous',
      `${wall} maps to exactly one instant at ${formatOffset(resolution.offsetMinutes)}`,
    );

    const instant = DateTime.fromMillis(resolution.epochMillis, { zone: proposal.timezone });
    const slot = this.buildSlot(instant, proposal.timezone, durationMinutes, {
      ...ctx.interpretation,
      utcOffset: formatOffset(resolution.offsetMinutes),
    });

    return validationOk(
      slot,
      buildProvenance(
        {
          validatorVersion: ctx.validatorVersion,
          nowUtc: ctx.nowUtc,
          rawProposedValue: proposal.raw,
          resolvedTimezone: proposal.timezone,
          resolvedStartUtc: slot.startUtc,
          resolvedEndUtc: slot.endUtc,
          ...(ctx.notes ? { notes: ctx.notes } : {}),
        },
        ctx.checks,
      ),
    );
  }

  private buildSlot(
    start: DateTime,
    timezone: string,
    durationMinutes: number,
    interpretation: SlotInterpretation,
  ): ResolvedSlot {
    const end = start.plus({ minutes: durationMinutes });
    return {
      startUtc: new Date(start.toMillis()).toISOString(),
      endUtc: new Date(end.toMillis()).toISOString(),
      timezone,
      startLocal: start.toFormat("yyyy-LL-dd'T'HH:mm"),
      endLocal: end.toFormat("yyyy-LL-dd'T'HH:mm"),
      durationMinutes,
      interpretation,
    };
  }
}

/**
 * Carry the grammar's own account of itself into the slot's interpretation.
 *
 * Additive: `matched`, `dayAnchor`, `dayPart` and `timeAnchor` are exactly what
 * they always were. What is new is `locales`, `lexicon` and `carriers`, so a
 * reader of a receipt can see WHICH lexicon understood the phrase and which
 * words were discarded on purpose. The full interpretation, including the
 * leftover tokens on a refusal, also rides in `provenance.notes.interpretation`.
 */
function naturalLanguageInterpretation(
  interpretation: NaturalLanguageInterpretation,
): Omit<SlotInterpretation, 'utcOffset'> {
  return {
    source: 'NATURAL_LANGUAGE',
    matched: interpretation.matched,
    ...(interpretation.dayAnchor ? { dayAnchor: interpretation.dayAnchor } : {}),
    ...(interpretation.dayPart ? { dayPart: interpretation.dayPart } : {}),
    ...(interpretation.timeAnchor ? { timeAnchor: interpretation.timeAnchor } : {}),
    locales: interpretation.locales,
    lexicon: interpretation.lexicon,
    carriers: interpretation.carriers,
  };
}

function formatTarget(target: LocalWallTimeTarget): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(target.year, 4)}-${pad(target.month)}-${pad(target.day)}T${pad(target.hour)}:${pad(target.minute)}`;
}

/** Guards against `2026-02-30T10:00`, which the regex happily accepts. */
function isRealCalendarTarget(target: LocalWallTimeTarget): boolean {
  if (target.month < 1 || target.month > 12 || target.day < 1 || target.hour > 23 || target.minute > 59) {
    return false;
  }
  const probe = new Date(Date.UTC(target.year, target.month - 1, target.day));
  return probe.getUTCMonth() === target.month - 1 && probe.getUTCDate() === target.day;
}
