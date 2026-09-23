/**
 * The natural-language grammar, and the refusals that matter more than the
 * successes.
 *
 * Every case runs against a `FixedClock` at `DEFAULT_TEST_NOW_UTC`
 * (Wednesday 2026-03-04, 10:00 America/New_York) so the weekday arithmetic has
 * a known anchor. No wall clock, no network, no database.
 */
import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../src/ports/clock.js';
import { DateTimeResolver } from '../../src/scheduling/dateTimeResolver.js';
import { DEFAULT_DAY_PARTS, schedulingPolicy } from '../../src/scheduling/policy.js';
import { DEFAULT_TEST_NOW_UTC } from '../helpers/testDb.js';

const NY = 'America/New_York';
const clock = new FixedClock(DEFAULT_TEST_NOW_UTC);
const resolver = new DateTimeResolver(clock);
const policy = schedulingPolicy({ defaultTimezone: NY, defaultMeetingDurationMinutes: 30 });

function resolve(raw: string, timezone = NY, durationMinutes?: number) {
  return resolver.resolve(
    { raw, timezone, ...(durationMinutes !== undefined ? { durationMinutes } : {}) },
    { policy },
  );
}

/** The local wall-clock start, which is what a person actually agreed to. */
function localOf(raw: string, timezone = NY): string {
  const result = resolve(raw, timezone);
  if (!result.ok) {
    throw new Error(`expected "${raw}" to resolve, got ${result.code}: ${result.reason}`);
  }
  return result.value.startLocal;
}

describe('day anchors', () => {
  it('resolves today, tomorrow and the day after tomorrow', () => {
    expect(localOf('today at 3pm')).toBe('2026-03-04T15:00');
    expect(localOf('tomorrow at 3pm')).toBe('2026-03-05T15:00');
    expect(localOf('the day after tomorrow at 3pm')).toBe('2026-03-06T15:00');
  });

  it('never lets "day after tomorrow" collapse into "tomorrow"', () => {
    expect(localOf('day after tomorrow at 10am')).toBe('2026-03-06T10:00');
  });

  it('reads a bare weekday as the soonest FUTURE one, excluding today', () => {
    // now is Wednesday 2026-03-04.
    expect(localOf('thursday at 11am')).toBe('2026-03-05T11:00');
    expect(localOf('on friday at 11am')).toBe('2026-03-06T11:00');
    expect(localOf('tuesday at 11am')).toBe('2026-03-10T11:00');
    // "Wednesday", said on a Wednesday, means the NEXT one.
    expect(localOf('wednesday at 11am')).toBe('2026-03-11T11:00');
  });

  it('reads "next <weekday>" as the following ISO week', () => {
    expect(localOf('next thursday at 11am')).toBe('2026-03-12T11:00');
    expect(localOf('next tuesday at 2pm')).toBe('2026-03-10T14:00');
  });

  it('accepts weekday abbreviations without shadowing the long forms', () => {
    expect(localOf('thu at 11am')).toBe('2026-03-05T11:00');
    expect(localOf('thurs at 11am')).toBe('2026-03-05T11:00');
    expect(localOf('thursday at 11am')).toBe('2026-03-05T11:00');
  });

  it('reads "end of the week" as Friday of the current ISO week', () => {
    expect(localOf('end of the week at 2pm')).toBe('2026-03-06T14:00');
    expect(localOf('end of week at 2pm')).toBe('2026-03-06T14:00');
  });

  it('accepts an explicit calendar date as a day anchor', () => {
    expect(localOf('2026-04-17 at 2pm')).toBe('2026-04-17T14:00');
  });
});

describe('day parts', () => {
  it('uses the documented preferred hour when no clock time is given', () => {
    expect(DEFAULT_DAY_PARTS.morning.preferredLocal).toBe('09:00');
    expect(DEFAULT_DAY_PARTS.afternoon.preferredLocal).toBe('14:00');
    expect(DEFAULT_DAY_PARTS.evening.preferredLocal).toBe('18:00');

    expect(localOf('tomorrow morning')).toBe('2026-03-05T09:00');
    expect(localOf('tomorrow afternoon')).toBe('2026-03-05T14:00');
    expect(localOf('tomorrow evening')).toBe('2026-03-05T18:00');
  });

  it('disambiguates a bare 12-hour time using the day part', () => {
    // The mission's worked example.
    expect(localOf('call me back tomorrow afternoon at 3')).toBe('2026-03-05T15:00');
    expect(localOf('tomorrow morning at 9')).toBe('2026-03-05T09:00');
    expect(localOf('tomorrow evening at 7')).toBe('2026-03-05T19:00');
    expect(localOf('next tuesday morning at 11')).toBe('2026-03-10T11:00');
  });

  it('treats "tonight" as this evening', () => {
    expect(localOf('tonight at 8')).toBe('2026-03-04T20:00');
    expect(localOf('tonight')).toBe('2026-03-04T18:00');
  });

  it('honours day-part windows configured on the AgentConfiguration', () => {
    const lateAfternoon = schedulingPolicy({
      dayParts: {
        ...DEFAULT_DAY_PARTS,
        afternoon: { startLocal: '13:00', endLocal: '19:00', preferredLocal: '16:00' },
      },
    });
    const result = resolver.resolve({ raw: 'tomorrow afternoon', timezone: NY }, { policy: lateAfternoon });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.startLocal).toBe('2026-03-05T16:00');
  });
});

describe('clock times', () => {
  it('accepts explicit meridiems, including the 12am/12pm traps', () => {
    expect(localOf('tomorrow at 12pm')).toBe('2026-03-05T12:00');
    expect(localOf('tomorrow at 12am')).toBe('2026-03-05T00:00');
    expect(localOf('tomorrow at 12:30pm')).toBe('2026-03-05T12:30');
  });

  it('accepts 24-hour times without a meridiem', () => {
    expect(localOf('tomorrow at 15:30')).toBe('2026-03-05T15:30');
    expect(localOf('tomorrow 16:45')).toBe('2026-03-05T16:45');
  });

  it('accepts named times', () => {
    expect(localOf('noon tomorrow')).toBe('2026-03-05T12:00');
    expect(localOf('tomorrow at midnight')).toBe('2026-03-05T00:00');
  });

  it('tolerates punctuation and "o\'clock"', () => {
    expect(localOf('tomorrow at 3 p.m.')).toBe('2026-03-05T15:00');
    expect(localOf("tomorrow afternoon at 3 o'clock")).toBe('2026-03-05T15:00');
  });

  it('reads a bare time with no day as TODAY, and does not roll it forward', () => {
    // 09:00 local is in the past at 10:00 local; the grammar resolves it
    // honestly and lets the validator say IN_THE_PAST.
    expect(localOf('at 9am')).toBe('2026-03-04T09:00');
  });
});

describe('relative offsets', () => {
  it('resolves elapsed minutes and hours', () => {
    expect(localOf('in 30 minutes')).toBe('2026-03-04T10:30');
    expect(localOf('in 2 hours')).toBe('2026-03-04T12:00');
    expect(localOf('in an hour')).toBe('2026-03-04T11:00');
    expect(localOf('half an hour')).toBe('2026-03-04T10:30');
  });

  it('resolves the legacy "in a couple of hours" phrasing', () => {
    expect(localOf('in a couple of hours')).toBe('2026-03-04T12:00');
    expect(localOf('in a few hours')).toBe('2026-03-04T13:00');
  });

  it('keeps the wall-clock time of day for a day offset', () => {
    expect(localOf('in 3 days')).toBe('2026-03-07T10:00');
    expect(localOf('in 2 days at 2pm')).toBe('2026-03-06T14:00');
  });

  it('marks an elapsed offset as needing no DST disambiguation', () => {
    const result = resolve('in 2 hours');
    expect(result.ok).toBe(true);
    const exists = result.provenance.checks.find((check) => check.name === 'local_time_exists');
    expect(exists?.passed).toBe(true);
    expect(exists?.detail).toContain('not applicable');
  });
});

describe('ISO input', () => {
  it('accepts an explicit instant and renders it in the contact zone', () => {
    const result = resolve('2026-03-05T19:00:00Z');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startUtc).toBe('2026-03-05T19:00:00.000Z');
      expect(result.value.startLocal).toBe('2026-03-05T14:00');
      expect(result.value.interpretation.source).toBe('ISO_INSTANT');
    }
  });

  it('accepts a local datetime and interprets it in the contact zone', () => {
    const result = resolve('2026-03-05T14:00');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startUtc).toBe('2026-03-05T19:00:00.000Z');
      expect(result.value.interpretation.source).toBe('ISO_LOCAL_DATETIME');
    }
  });

  it('rejects a local datetime that is not a real calendar date', () => {
    const result = resolve('2026-02-30T14:00');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_FORMAT');
  });
});

describe('refusals - the whole point', () => {
  const refused = (raw: string) => {
    const result = resolve(raw);
    expect(result.ok, `expected "${raw}" to be refused`).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('INVALID_FORMAT');
    return result;
  };

  it('refuses a bare 12-hour time with nothing to settle am vs pm', () => {
    const result = refused('tomorrow at 3');
    expect(result.reason).toMatch(/03:00 or 15:00/);
    expect(result.reason).toMatch(/am or pm/);
  });

  it('refuses a meridiem that contradicts the day part', () => {
    expect(refused('tomorrow morning at 3pm').reason).toMatch(/not in the morning/);
    expect(refused('tomorrow evening at 9am').reason).toMatch(/not in the evening/);
  });

  it('refuses a relative offset mixed with an absolute time', () => {
    expect(refused('tomorrow in two hours').reason).toMatch(/mixes a relative offset/);
  });

  it('refuses vague intent even when other tokens would parse', () => {
    refused('call me back sometime tomorrow');
    refused('give me a ring later');
    refused('call me soon');
    refused('whenever suits you');
    refused('call me back asap');
  });

  it('refuses a period rather than a moment', () => {
    refused('next week');
    refused('some time next month');
    refused('in the new year');
  });

  it('refuses a day with no time at all', () => {
    expect(refused('end of the week').reason).toMatch(/no time/);
    expect(refused('next tuesday').reason).toMatch(/no time/);
  });

  it('refuses a number it cannot account for', () => {
    // "the 15th" is a date form this grammar does not implement. Guessing
    // 15:00 would be a silently wrong callback.
    expect(refused('tomorrow at 3pm on the 15th').reason).toMatch(/could not interpret/);
  });

  it('refuses text with nothing schedulable in it', () => {
    refused('that sounds good');
    refused('');
  });

  it('rejects a timezone that is not a real IANA zone', () => {
    for (const zone of ['Mars/Olympus_Mons', '-05:00', 'UTC-5', '']) {
      const result = resolve('tomorrow at 2pm', zone);
      expect(result.ok, `expected zone "${zone}" to be rejected`).toBe(false);
      if (!result.ok) expect(result.code).toBe('UNKNOWN_TIMEZONE');
    }
  });
});

describe('determinism and provenance', () => {
  it('returns byte-identical results for identical inputs', () => {
    const a = resolve('call me back tomorrow afternoon at 3');
    const b = resolve('call me back tomorrow afternoon at 3');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('records the raw proposal verbatim, typos and all', () => {
    const raw = '  ToMorrow AfTernoon at 3  ';
    const result = resolve(raw);
    expect(result.provenance.rawProposedValue).toBe(raw);
  });

  it('records the ordered checks it ran, even on a refusal', () => {
    const ok = resolve('tomorrow afternoon at 3');
    expect(ok.provenance.checks.map((check) => check.name)).toEqual([
      'timezone_is_iana',
      'parse_proposed_value',
      'local_time_exists',
      'local_time_unambiguous',
    ]);

    const bad = resolve('tomorrow at 3');
    expect(bad.provenance.checks.map((check) => check.name)).toEqual(['timezone_is_iana', 'parse_proposed_value']);
    expect(bad.provenance.checks.at(-1)?.passed).toBe(false);
  });

  it('is relative to the injected clock, not the wall clock', () => {
    const laterResolver = new DateTimeResolver(new FixedClock('2026-06-15T13:00:00.000Z'));
    const result = laterResolver.resolve({ raw: 'tomorrow at 2pm', timezone: NY }, { policy });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.startLocal).toBe('2026-06-16T14:00');
  });
});
