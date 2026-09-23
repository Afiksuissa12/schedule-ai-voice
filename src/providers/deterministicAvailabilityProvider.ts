/**
 * `DeterministicAvailabilityProvider` - honest, reproducible availability.
 *
 * WHAT THIS REPLACES
 * ---------------------------------------------------------------------------
 * The legacy prototype invented availability on the fly, so no test could ever
 * prove that a conflict was detected rather than imagined. This provider is the
 * opposite: every busy interval it returns comes from something the test
 * WROTE DOWN - an explicit seeded interval, or a recurring local-time rule -
 * and identical inputs produce byte-identical output on every run, on every
 * machine, forever. There is no randomness here, seeded or otherwise.
 *
 * It implements `AvailabilityProvider` from `src/ports` and imports no vendor
 * SDK. Swapping it for Google Calendar or Microsoft Graph changes this file and
 * nothing else.
 */
import { DateTime } from 'luxon';

import type { AvailabilityProvider, BusyInterval, GetBusyIntervalsRequest } from '../ports/availability.js';
import { InvariantViolationError } from '../shared/errors.js';
import { isValidIanaTimezone } from '../shared/time.js';
import { resolveLocalWallTime } from '../scheduling/zoneMath.js';

/**
 * A recurring busy block expressed in LOCAL wall-clock time, e.g. "busy
 * 12:00-13:00 local every weekday".
 *
 * Local rather than UTC on purpose: a lunch break is a wall-clock fact and must
 * stay at noon across a DST transition, which is precisely the kind of thing a
 * synthetic-availability prototype gets wrong.
 */
export interface DailyLocalBusyRule {
  /** IANA zone the wall-clock times are expressed in. */
  readonly timezone: string;
  /** Inclusive start, `HH:mm`. */
  readonly startLocal: string;
  /** Exclusive end, `HH:mm`. Must be after `startLocal`. */
  readonly endLocal: string;
  /** ISO weekdays (1 = Monday .. 7 = Sunday) this applies to. Default: all. */
  readonly isoWeekdays?: readonly number[];
  /** Appears in diagnostics. */
  readonly label?: string;
}

export interface DeterministicCalendarAvailability {
  /** Fixed intervals, exactly as written. */
  readonly busyIntervals?: readonly BusyInterval[];
  readonly rules?: readonly DailyLocalBusyRule[];
}

export interface DeterministicAvailabilityProviderOptions {
  /** Provider identity recorded in audit events. */
  readonly name?: string;
  /** Applied to every `calendarRef` that has no specific entry. */
  readonly busyIntervals?: readonly BusyInterval[];
  readonly rules?: readonly DailyLocalBusyRule[];
  /** Per-calendar overrides, keyed by `CalendarConnection.calendarRef`. */
  readonly calendars?: Readonly<Record<string, DeterministicCalendarAvailability>>;
}

/** Refuses to expand a rule over an absurd window rather than hanging. */
const MAX_RULE_EXPANSION_DAYS = 400;

export class DeterministicAvailabilityProvider implements AvailabilityProvider {
  private readonly providerName: string;
  private readonly fallback: DeterministicCalendarAvailability;
  private readonly calendars: Readonly<Record<string, DeterministicCalendarAvailability>>;

  /** Every request made, in order. Lets a test assert what was consulted. */
  readonly requests: GetBusyIntervalsRequest[] = [];

  constructor(options: DeterministicAvailabilityProviderOptions = {}) {
    this.providerName = options.name ?? 'deterministic-test';
    this.fallback = {
      ...(options.busyIntervals ? { busyIntervals: options.busyIntervals } : {}),
      ...(options.rules ? { rules: options.rules } : {}),
    };
    this.calendars = options.calendars ?? {};

    for (const rule of [...(options.rules ?? []), ...Object.values(this.calendars).flatMap((c) => c.rules ?? [])]) {
      assertUsableRule(rule);
    }
  }

  name(): string {
    return this.providerName;
  }

  async getBusyIntervals(req: GetBusyIntervalsRequest): Promise<BusyInterval[]> {
    this.requests.push(req);

    const fromMillis = Date.parse(req.fromUtc);
    const toMillis = Date.parse(req.toUtc);
    if (Number.isNaN(fromMillis) || Number.isNaN(toMillis)) {
      throw new InvariantViolationError('getBusyIntervals requires ISO-8601 UTC instants', {
        details: { fromUtc: req.fromUtc, toUtc: req.toUtc },
      });
    }

    const source = this.calendars[req.calendarRef] ?? this.fallback;

    const candidates: BusyInterval[] = [
      ...(source.busyIntervals ?? []),
      ...(source.rules ?? []).flatMap((rule) => expandRule(rule, fromMillis, toMillis)),
    ];

    return candidates
      .filter((interval) => Date.parse(interval.startUtc) < toMillis && Date.parse(interval.endUtc) > fromMillis)
      .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc) || Date.parse(a.endUtc) - Date.parse(b.endUtc));
  }
}

function assertUsableRule(rule: DailyLocalBusyRule): void {
  if (!isValidIanaTimezone(rule.timezone)) {
    throw new InvariantViolationError(`Busy rule has an unusable timezone: ${rule.timezone}`, {
      details: { rule },
    });
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rule.startLocal) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rule.endLocal)) {
    throw new InvariantViolationError('Busy rule times must be 24-hour HH:mm', { details: { rule } });
  }
  if (rule.startLocal >= rule.endLocal) {
    throw new InvariantViolationError('Busy rule startLocal must be before endLocal', { details: { rule } });
  }
}

/**
 * Turn a recurring local rule into concrete UTC intervals covering the window.
 *
 * DST handling is explicit rather than incidental:
 *  - a local start that does not exist that day (spring-forward gap) is SKIPPED,
 *    because the block genuinely did not happen;
 *  - a local start that happens twice (fall-back) uses the EARLIER instant.
 * Both are deterministic, and both are stated here so a surprising test result
 * has a documented explanation.
 */
function expandRule(rule: DailyLocalBusyRule, fromMillis: number, toMillis: number): BusyInterval[] {
  const zone = rule.timezone;
  const first = DateTime.fromMillis(fromMillis, { zone }).startOf('day').minus({ days: 1 });
  const last = DateTime.fromMillis(toMillis, { zone }).startOf('day').plus({ days: 1 });

  const dayCount = Math.round(last.diff(first, 'days').days);
  if (dayCount > MAX_RULE_EXPANSION_DAYS) {
    throw new InvariantViolationError(
      `Refusing to expand a busy rule over ${dayCount} days (limit ${MAX_RULE_EXPANSION_DAYS}). ` +
        'Query a narrower window.',
      { details: { fromMillis, toMillis, rule } },
    );
  }

  const [startHour, startMinute] = rule.startLocal.split(':').map(Number);
  const [endHour, endMinute] = rule.endLocal.split(':').map(Number);
  const intervals: BusyInterval[] = [];

  for (let offset = 0; offset <= dayCount; offset += 1) {
    const day = first.plus({ days: offset });
    if (rule.isoWeekdays && !rule.isoWeekdays.includes(day.weekday)) {
      continue;
    }

    const start = instantFor(day, startHour ?? 0, startMinute ?? 0, zone);
    const end = instantFor(day, endHour ?? 0, endMinute ?? 0, zone);
    if (start === undefined || end === undefined || end <= start) {
      continue;
    }

    intervals.push({ startUtc: new Date(start).toISOString(), endUtc: new Date(end).toISOString() });
  }

  return intervals;
}

function instantFor(day: DateTime, hour: number, minute: number, zone: string): number | undefined {
  const resolution = resolveLocalWallTime(
    { year: day.year, month: day.month, day: day.day, hour, minute },
    zone,
  );
  if (resolution.kind === 'NONEXISTENT') {
    return undefined;
  }
  if (resolution.kind === 'AMBIGUOUS') {
    return resolution.epochMillisCandidates[0];
  }
  return resolution.epochMillis;
}
