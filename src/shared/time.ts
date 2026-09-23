/**
 * Pure instant <-> string conversion.
 *
 * SCOPE NOTE: this module converts between `Date` (what Prisma stores) and
 * ISO-8601 UTC strings (what crosses every port boundary). It deliberately
 * contains NO scheduling policy - no business hours, no lead time, no horizon,
 * no ambiguity resolution. That logic belongs to the scheduling layer and
 * produces a `ValidationResult` (src/ports/validation.ts).
 */
import { DateTime, IANAZone } from 'luxon';

import { InvariantViolationError } from './errors.js';

/** An ISO-8601 instant expressed in UTC, e.g. `2026-03-04T14:30:00.000Z`. */
export type IsoUtcString = string;

/** Convert a `Date` to the canonical ISO-8601 UTC string used across ports. */
export function toIsoUtc(value: Date): IsoUtcString {
  if (Number.isNaN(value.getTime())) {
    throw new InvariantViolationError('Cannot convert an Invalid Date to an ISO UTC string');
  }
  return value.toISOString();
}

/** Same as `toIsoUtc` but passes `null`/`undefined` through unchanged. */
export function toIsoUtcOrNull(value: Date | null | undefined): IsoUtcString | null {
  return value === null || value === undefined ? null : toIsoUtc(value);
}

/**
 * Parse any ISO-8601 instant into a `Date`.
 *
 * Accepts an explicit offset (`+02:00`) or `Z`; rejects a bare local datetime
 * with no offset, because "2026-03-04T14:30" is not an instant and guessing a
 * zone for it is exactly the class of bug this codebase exists to prevent.
 */
export function fromIsoUtc(value: string): Date {
  const parsed = DateTime.fromISO(value, { setZone: true });
  if (!parsed.isValid) {
    throw new InvariantViolationError(`Not a valid ISO-8601 instant: ${value}`, {
      details: { value, reason: parsed.invalidReason },
    });
  }
  if (!hasExplicitOffset(value)) {
    throw new InvariantViolationError(
      `ISO-8601 instant is missing a UTC offset (a bare local time is not an instant): ${value}`,
      { details: { value } },
    );
  }
  return parsed.toUTC().toJSDate();
}

/** Same as `fromIsoUtc` but passes `null`/`undefined` through unchanged. */
export function fromIsoUtcOrNull(value: string | null | undefined): Date | null {
  return value === null || value === undefined ? null : fromIsoUtc(value);
}

/** True when the string is a parseable ISO-8601 instant with an explicit offset. */
export function isIsoUtcString(value: unknown): value is IsoUtcString {
  if (typeof value !== 'string' || !hasExplicitOffset(value)) {
    return false;
  }
  return DateTime.fromISO(value, { setZone: true }).isValid;
}

/** Normalize any valid ISO-8601 instant to the canonical `...Z` form. */
export function normalizeIsoUtc(value: string): IsoUtcString {
  return toIsoUtc(fromIsoUtc(value));
}

/**
 * True when `value` is an IANA zone NAME that this runtime actually knows.
 *
 * Offset forms are rejected even though modern ICU accepts them as a
 * `timeZone`: `-05:00` resolves today but carries no DST rule, so a meeting
 * agreed "2pm next month" in `-05:00` silently drifts an hour once the zone it
 * was standing in changes offset. Only a named zone can survive that, so only a
 * named zone is allowed anywhere near a scheduling decision.
 */
export function isValidIanaTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  if (/^[+-]/.test(value) || /^(?:UTC|GMT)[+-]/i.test(value)) {
    return false;
  }
  return IANAZone.isValidZone(value);
}

function hasExplicitOffset(value: string): boolean {
  // `Z`, `+HH:MM`, `-HH:MM`, `+HHMM`, `-HHMM` after the time component.
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
}
