/**
 * DST correctness, against real transition dates in both hemispheres.
 *
 * These are the cases every scheduling system gets wrong once. A library that
 * silently shifts 02:30 to 03:30 on a spring-forward morning, or silently picks
 * the first of two 01:30s on a fall-back morning, will book a call at a time
 * the contact did not agree to and nobody will notice until someone answers the
 * phone at the wrong hour.
 *
 * TRANSITIONS USED (verified against the tz database)
 *   America/New_York  2026-03-08  02:00 EST  -> 03:00 EDT   (gap:    02:00-02:59)
 *   America/New_York  2026-11-01  02:00 EDT  -> 01:00 EST   (repeat: 01:00-01:59)
 *   Australia/Sydney  2026-10-04  02:00 AEST -> 03:00 AEDT  (gap:    02:00-02:59)
 *   Australia/Sydney  2026-04-05  03:00 AEDT -> 02:00 AEST  (repeat: 02:00-02:59)
 */
import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../src/ports/clock.js';
import { DateTimeResolver } from '../../src/scheduling/dateTimeResolver.js';
import { schedulingPolicy } from '../../src/scheduling/policy.js';
import { resolveLocalWallTime } from '../../src/scheduling/zoneMath.js';

const NY = 'America/New_York';
const SYDNEY = 'Australia/Sydney';

// Well before every transition under test, so `in_the_future` never interferes.
const clock = new FixedClock('2026-01-05T12:00:00.000Z');
const resolver = new DateTimeResolver(clock);
const policy = schedulingPolicy();

function resolve(raw: string, timezone: string) {
  return resolver.resolve({ raw, timezone }, { policy });
}

describe('zoneMath: the primitive', () => {
  it('reports a spring-forward gap as NONEXISTENT', () => {
    expect(resolveLocalWallTime({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NY).kind).toBe('NONEXISTENT');
    expect(resolveLocalWallTime({ year: 2026, month: 10, day: 4, hour: 2, minute: 30 }, SYDNEY).kind).toBe(
      'NONEXISTENT',
    );
  });

  it('reports a fall-back repeat as AMBIGUOUS, with both instants', () => {
    const newYork = resolveLocalWallTime({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NY);
    expect(newYork.kind).toBe('AMBIGUOUS');
    if (newYork.kind === 'AMBIGUOUS') {
      expect(newYork.epochMillisCandidates.map((ms) => new Date(ms).toISOString())).toEqual([
        '2026-11-01T05:30:00.000Z', // 01:30 EDT (-04:00)
        '2026-11-01T06:30:00.000Z', // 01:30 EST (-05:00)
      ]);
    }

    const sydney = resolveLocalWallTime({ year: 2026, month: 4, day: 5, hour: 2, minute: 30 }, SYDNEY);
    expect(sydney.kind).toBe('AMBIGUOUS');
    if (sydney.kind === 'AMBIGUOUS') {
      expect(sydney.epochMillisCandidates.map((ms) => new Date(ms).toISOString())).toEqual([
        '2026-04-04T15:30:00.000Z', // 02:30 AEDT (+11:00)
        '2026-04-04T16:30:00.000Z', // 02:30 AEST (+10:00)
      ]);
    }
  });

  it('resolves an ordinary local time to exactly one instant', () => {
    const result = resolveLocalWallTime({ year: 2026, month: 3, day: 5, hour: 14, minute: 0 }, NY);
    expect(result.kind).toBe('UNIQUE');
    if (result.kind === 'UNIQUE') {
      expect(new Date(result.epochMillis).toISOString()).toBe('2026-03-05T19:00:00.000Z');
      expect(result.offsetMinutes).toBe(-300);
    }
  });
});

describe('America/New_York', () => {
  it('refuses a time inside the spring-forward gap', () => {
    const result = resolve('2026-03-08T02:30', NY);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('NONEXISTENT_LOCAL_TIME');
    expect(result.reason).toMatch(/does not exist/);
    expect(result.provenance.checks.find((c) => c.name === 'local_time_exists')?.passed).toBe(false);
  });

  it('refuses a time inside the fall-back repeat', () => {
    const result = resolve('2026-11-01T01:30', NY);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('AMBIGUOUS_LOCAL_TIME');
    expect(result.reason).toMatch(/happens twice/);
    expect(result.provenance.checks.find((c) => c.name === 'local_time_unambiguous')?.passed).toBe(false);
    expect(result.provenance.notes?.ambiguousCandidatesUtc).toEqual([
      '2026-11-01T05:30:00.000Z',
      '2026-11-01T06:30:00.000Z',
    ]);
  });

  it('accepts the instants either side of each transition', () => {
    // 01:30 EST on the gap morning, and 03:30 EDT just after it.
    expect(resolve('2026-03-08T01:30', NY)).toMatchObject({ ok: true });
    expect(resolve('2026-03-08T03:30', NY)).toMatchObject({ ok: true });
    // 00:30 EDT before the repeat, and 03:00 EST after it.
    expect(resolve('2026-11-01T00:30', NY)).toMatchObject({ ok: true });
    expect(resolve('2026-11-01T03:00', NY)).toMatchObject({ ok: true });
  });

  it('keeps the WALL-CLOCK meaning of a time across the transition', () => {
    // "2pm" is 19:00Z in EST and 18:00Z in EDT. The instant has to move so
    // that the wall-clock time the contact agreed to does not.
    const before = resolve('2026-03-05T14:00', NY);
    const after = resolve('2026-03-12T14:00', NY);
    expect(before.ok && before.value.startUtc).toBe('2026-03-05T19:00:00.000Z');
    expect(after.ok && after.value.startUtc).toBe('2026-03-12T18:00:00.000Z');
    expect(before.ok && before.value.interpretation.utcOffset).toBe('-05:00');
    expect(after.ok && after.value.interpretation.utcOffset).toBe('-04:00');
  });

  it('applies the same checks to a natural-language proposal', () => {
    const result = resolve('2026-03-08 at 2:30am', NY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NONEXISTENT_LOCAL_TIME');
  });
});

describe('Australia/Sydney (southern hemisphere)', () => {
  it('refuses a time inside the October spring-forward gap', () => {
    const result = resolve('2026-10-04T02:30', SYDNEY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NONEXISTENT_LOCAL_TIME');
  });

  it('refuses a time inside the April fall-back repeat', () => {
    const result = resolve('2026-04-05T02:30', SYDNEY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('AMBIGUOUS_LOCAL_TIME');
  });

  it('accepts the instants either side of each transition', () => {
    expect(resolve('2026-10-04T01:30', SYDNEY)).toMatchObject({ ok: true });
    expect(resolve('2026-10-04T03:30', SYDNEY)).toMatchObject({ ok: true });
    expect(resolve('2026-04-05T01:30', SYDNEY)).toMatchObject({ ok: true });
    expect(resolve('2026-04-05T03:30', SYDNEY)).toMatchObject({ ok: true });
  });

  it('moves the offset the OPPOSITE way to the northern hemisphere', () => {
    // Sydney leaves DST in April (+11 -> +10) while New York enters it in March.
    const march = resolve('2026-03-05T14:00', SYDNEY);
    const may = resolve('2026-05-05T14:00', SYDNEY);
    expect(march.ok && march.value.interpretation.utcOffset).toBe('+11:00');
    expect(may.ok && may.value.interpretation.utcOffset).toBe('+10:00');
    expect(march.ok && march.value.startUtc).toBe('2026-03-05T03:00:00.000Z');
    expect(may.ok && may.value.startUtc).toBe('2026-05-05T04:00:00.000Z');
  });

  it('resolves natural language in the southern-hemisphere zone', () => {
    const sydneyClock = new FixedClock('2026-04-01T02:00:00.000Z'); // 13:00 Sydney, Wed 1 Apr
    const sydneyResolver = new DateTimeResolver(sydneyClock);
    const result = sydneyResolver.resolve({ raw: 'tomorrow afternoon at 3', timezone: SYDNEY }, { policy });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startLocal).toBe('2026-04-02T15:00');
      expect(result.value.startUtc).toBe('2026-04-02T04:00:00.000Z'); // +11:00, still AEDT
    }
  });
});
