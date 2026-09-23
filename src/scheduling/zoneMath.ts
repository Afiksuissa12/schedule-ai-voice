/**
 * The DST arithmetic, isolated so it can be reasoned about and tested on its own.
 *
 * WHY THIS IS NOT JUST `DateTime.fromObject({...}, { zone })`
 * ---------------------------------------------------------------------------
 * Luxon - like almost every date library - is deliberately lenient: asked for
 * 02:30 on a spring-forward morning it hands back 03:30, and asked for 01:30 on
 * a fall-back morning it silently picks the first of the two 01:30s. Both are
 * reasonable defaults for rendering. Both are unacceptable for scheduling a
 * phone call, because both turn "I could not tell when you meant" into a
 * confident, wrong instant.
 *
 * So the wall-clock time is resolved by brute force instead: take the two
 * offsets the zone uses on either side of the requested day, compute the
 * instant each one implies, and keep only those that round-trip. The count is
 * the answer:
 *
 *   0 instants -> the local time DOES NOT EXIST  (spring-forward gap)
 *   1 instant  -> unambiguous, use it
 *   2 instants -> the local time happens TWICE   (fall-back repeat)
 *
 * That is a property of the tz database, not of any library's rounding policy,
 * which is exactly why it is safe to schedule on.
 */
import { IANAZone } from 'luxon';

import type { LocalWallTimeTarget } from './naturalLanguage.js';

export interface UniqueLocalTime {
  readonly kind: 'UNIQUE';
  readonly epochMillis: number;
  /** Minutes east of UTC, e.g. -300 for EST. */
  readonly offsetMinutes: number;
}

export interface NonexistentLocalTime {
  readonly kind: 'NONEXISTENT';
  /** The offsets that were tried, for the audit receipt. */
  readonly offsetsConsidered: readonly number[];
}

export interface AmbiguousLocalTime {
  readonly kind: 'AMBIGUOUS';
  /** Both instants that render as this wall-clock time, earliest first. */
  readonly epochMillisCandidates: readonly number[];
  readonly offsetsConsidered: readonly number[];
}

export type LocalTimeResolution = UniqueLocalTime | NonexistentLocalTime | AmbiguousLocalTime;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve a wall-clock target in an IANA zone to zero, one or two instants.
 *
 * `zoneName` must already be known to be a valid IANA zone; callers run that
 * check first so they can report `UNKNOWN_TIMEZONE` separately.
 */
export function resolveLocalWallTime(target: LocalWallTimeTarget, zoneName: string): LocalTimeResolution {
  const zone = IANAZone.create(zoneName);

  // The wall-clock fields read AS IF they were UTC. Subtracting a candidate
  // offset from this turns them into the instant that offset implies.
  const asIfUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, 0, 0);

  const offsetsConsidered = [...new Set([zone.offset(asIfUtc - ONE_DAY_MS), zone.offset(asIfUtc + ONE_DAY_MS)])];

  const consistent: UniqueLocalTime[] = [];
  for (const offsetMinutes of offsetsConsidered) {
    const epochMillis = asIfUtc - offsetMinutes * 60_000;
    // Round-trip: does the zone really use this offset at that instant?
    if (zone.offset(epochMillis) === offsetMinutes) {
      if (!consistent.some((candidate) => candidate.epochMillis === epochMillis)) {
        consistent.push({ kind: 'UNIQUE', epochMillis, offsetMinutes });
      }
    }
  }

  const first = consistent[0];
  if (first === undefined) {
    return { kind: 'NONEXISTENT', offsetsConsidered };
  }
  if (consistent.length === 1) {
    return first;
  }

  return {
    kind: 'AMBIGUOUS',
    epochMillisCandidates: consistent.map((candidate) => candidate.epochMillis).sort((a, b) => a - b),
    offsetsConsidered,
  };
}

/** `-300` -> `-05:00`. For human-readable audit details. */
export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}
