/**
 * The dimensions have to be TRUE, not just plausible.
 *
 * `dimensions.ts` makes factual claims in prose: that 2026-03-07T22:00Z is
 * hours before the US spring-forward, that 02:30 on 2026-03-08 never happens in
 * New York, that Asia/Kolkata has no DST. If any of those quietly stopped being
 * true - a tzdata update, a typo, a copied line - the sweep would still run and
 * still pass, while silently no longer covering the thing it claims to cover.
 * That is the worst possible failure for a QA harness: green, and meaningless.
 *
 * So every claim is re-derived here from Luxon on each run.
 */
import { DateTime, IANAZone } from 'luxon';
import { describe, expect, it } from 'vitest';

import {
  ASSERTED_TIMEZONES,
  AVAILABILITY_STATES,
  LEAD_TIME_BOUNDARY_CASES,
  LEAD_TIME_BOUNDARY_ZONE,
  NOW_INSTANTS,
  POLICIES,
  seededRandom,
  TIMEZONE_OVERRIDE_CASES,
  TIMEZONES,
} from './dimensions.js';

describe('timezone dimension', () => {
  it.each(TIMEZONES)('$zone is a real IANA zone', ({ zone }) => {
    expect(zone === 'UTC' || IANAZone.isValidZone(zone)).toBe(true);
  });

  it('covers a half-hour offset, both hemispheres, and a no-DST zone', () => {
    const zones = TIMEZONES.map((timezone) => timezone.zone);
    expect(zones).toContain('America/New_York');
    expect(zones).toContain('Europe/London');
    expect(zones).toContain('Australia/Sydney');
    expect(zones).toContain('Asia/Kolkata');
    expect(zones).toContain('UTC');

    // The half-hour offset is the whole reason Kolkata is in the matrix.
    const kolkataOffset = DateTime.fromISO('2026-03-04T15:00:00.000Z', { zone: 'Asia/Kolkata' }).offset;
    expect(kolkataOffset % 60, 'Asia/Kolkata must have a non-whole-hour offset').not.toBe(0);
  });

  it.each(TIMEZONES.filter((timezone) => timezone.observesDst))(
    '$zone: the declared DST gap local time really does not exist',
    ({ zone, dstGapLocal }) => {
      const requested = dstGapLocal as string;
      const resolved = DateTime.fromISO(requested, { zone });
      // Luxon pushes a non-existent local time forward across the gap, so the
      // wall clock it lands on differs from the one that was asked for.
      expect(
        resolved.toFormat("yyyy-LL-dd'T'HH:mm"),
        `${requested} in ${zone} was expected to fall inside a DST gap`,
      ).not.toBe(requested);
    },
  );

  it.each(TIMEZONES.filter((timezone) => timezone.observesDst))(
    '$zone: the declared DST-ambiguous local time really does happen twice',
    ({ zone, dstAmbiguousLocal }) => {
      const requested = dstAmbiguousLocal as string;
      const resolved = DateTime.fromISO(requested, { zone });

      // Which of the two occurrences Luxon picks is zone-dependent - it
      // resolves New York's repeated hour to the EARLIER instant and Sydney's
      // to the LATER one. So "ambiguous" is asserted the way it is actually
      // defined: some OTHER instant an hour away shares this wall-clock time
      // under a different offset.
      const twin = [resolved.plus({ hours: 1 }), resolved.minus({ hours: 1 })].find(
        (candidate) =>
          candidate.toFormat('HH:mm') === resolved.toFormat('HH:mm') && candidate.offset !== resolved.offset,
      );

      expect(
        twin === undefined ? null : twin.toISO(),
        `${requested} in ${zone} was expected to occur twice when the clocks go back, but no second ` +
          'instant shares that wall-clock time',
      ).not.toBeNull();
    },
  );

  it.each(TIMEZONES.filter((timezone) => !timezone.observesDst))(
    '$zone genuinely has no DST, so it declares no gap or fold',
    ({ zone, dstGapLocal, dstAmbiguousLocal }) => {
      expect(dstGapLocal).toBeUndefined();
      expect(dstAmbiguousLocal).toBeUndefined();
      const january = DateTime.fromISO('2026-01-15T12:00:00.000Z', { zone }).offset;
      const july = DateTime.fromISO('2026-07-15T12:00:00.000Z', { zone }).offset;
      expect(january, `${zone} changes offset between January and July`).toBe(july);
    },
  );
});

describe('now-instant dimension', () => {
  it.each(NOW_INSTANTS)('$key is a valid UTC instant', ({ nowUtc }) => {
    expect(DateTime.fromISO(nowUtc, { zone: 'utc' }).isValid).toBe(true);
    expect(nowUtc).toMatch(/Z$/);
  });

  it('includes a Saturday, so "tomorrow" can land on a non-business day', () => {
    const weekend = NOW_INSTANTS.find((instant) => instant.key === 'n02-weekend');
    expect(DateTime.fromISO(weekend?.nowUtc as string, { zone: 'America/New_York' }).weekdayLong).toBe('Saturday');
  });

  it('includes a Friday afternoon in the contact zone', () => {
    const friday = NOW_INSTANTS.find((instant) => instant.key === 'n05-friday-pm-pre-eu-dst');
    const local = DateTime.fromISO(friday?.nowUtc as string, { zone: 'America/New_York' });
    expect(local.weekdayLong).toBe('Friday');
    expect(local.hour, 'must be an afternoon, not a morning').toBeGreaterThanOrEqual(12);
  });

  it('straddles the US spring-forward', () => {
    const before = NOW_INSTANTS.find((instant) => instant.key === 'n03-pre-us-dst')?.nowUtc as string;
    const after = NOW_INSTANTS.find((instant) => instant.key === 'n04-post-us-dst')?.nowUtc as string;
    const zone = 'America/New_York';
    expect(DateTime.fromISO(before, { zone }).isInDST, 'n03 should still be on standard time').toBe(false);
    expect(DateTime.fromISO(after, { zone }).isInDST, 'n04 should be on daylight time').toBe(true);
  });

  it('straddles the EU transition, on a different date from the US one', () => {
    const before = NOW_INSTANTS.find((instant) => instant.key === 'n05-friday-pm-pre-eu-dst')?.nowUtc as string;
    const after = NOW_INSTANTS.find((instant) => instant.key === 'n06-post-eu-dst')?.nowUtc as string;
    const zone = 'Europe/London';
    expect(DateTime.fromISO(before, { zone }).isInDST).toBe(false);
    expect(DateTime.fromISO(after, { zone }).isInDST).toBe(true);
    // And on that same pair New York has ALREADY transitioned - which is the
    // asymmetry a single hard-coded transition date would get wrong.
    expect(DateTime.fromISO(before, { zone: 'America/New_York' }).isInDST).toBe(true);
  });

  it('straddles the southern-hemisphere transition, in the other direction', () => {
    const before = NOW_INSTANTS.find((instant) => instant.key === 'n07-pre-au-dst-end')?.nowUtc as string;
    const after = NOW_INSTANTS.find((instant) => instant.key === 'n08-post-au-dst-end')?.nowUtc as string;
    const zone = 'Australia/Sydney';
    expect(DateTime.fromISO(before, { zone }).isInDST, 'AEDT before the April end').toBe(true);
    expect(DateTime.fromISO(after, { zone }).isInDST, 'AEST after it').toBe(false);
  });

  it('includes instants where "tomorrow" crosses a month boundary', () => {
    for (const key of ['n09-month-boundary-jan', 'n10-month-boundary-jun']) {
      const instant = NOW_INSTANTS.find((candidate) => candidate.key === key)?.nowUtc as string;
      const local = DateTime.fromISO(instant, { zone: 'America/New_York' });
      const inAWeek = local.plus({ days: 7 });
      expect(inAWeek.month, `${key}: a week ahead should be in the next month`).not.toBe(local.month);
    }
  });
});

describe('policy and availability dimensions', () => {
  it('spans genuinely different policies rather than four near-copies', () => {
    expect(new Set(POLICIES.map((policy) => policy.minLeadTimeMinutes)).size).toBeGreaterThan(2);
    expect(new Set(POLICIES.map((policy) => policy.maxSchedulingHorizonDays)).size).toBeGreaterThan(2);
    expect(new Set(POLICIES.map((policy) => policy.businessHoursStartLocal)).size).toBeGreaterThan(1);
    // Exactly one policy withholds tools, and it withholds schedule_meeting.
    const restricted = POLICIES.filter((policy) => policy.allowedTools !== undefined);
    expect(restricted).toHaveLength(1);
    expect(restricted[0]?.allowedTools).not.toContain('schedule_meeting');
  });

  it('describes free, exact, partial and adjacent relative to a 14:00-15:00 slot', () => {
    const named = Object.fromEntries(AVAILABILITY_STATES.map((state) => [state.key, state.window]));
    expect(named['a1-free']).toBeNull();
    expect(named['a2-exact-conflict']).toEqual({ startLocal: '14:00', endLocal: '15:00' });
    // Overlapping the back half, not the front - a start-time-only comparison
    // would miss this one.
    expect(named['a3-partial-overlap']).toEqual({ startLocal: '14:30', endLocal: '15:30' });
    // Starts exactly where the slot ends: half-open, so NOT a conflict.
    expect(named['a4-adjacent']).toEqual({ startLocal: '15:00', endLocal: '16:00' });
  });
});

describe('the timezone-override dimension', () => {
  it('asserts zones the contact is NOT in, so the axis is genuinely crossed', () => {
    const contactZones = new Set(TIMEZONES.map((timezone) => timezone.zone));
    const differing = ASSERTED_TIMEZONES.filter((zone) => !contactZones.has(zone));
    expect(
      differing.length,
      'at least one asserted zone must appear nowhere in the contact-zone axis, or every scenario could ' +
        'be asserting the zone the contact is already in',
    ).toBeGreaterThan(0);
    for (const zone of ASSERTED_TIMEZONES) {
      expect(zone === 'UTC' || IANAZone.isValidZone(zone), `${zone} is not a real IANA zone`).toBe(true);
    }
  });

  // The whole point of the committed cases is a claim about the CONTACT'S clock,
  // and that claim is a pure tzdata fact. Re-derived here so a tzdata update
  // cannot leave a stale expectation sitting in `dimensions.ts` looking correct.
  it.each(TIMEZONE_OVERRIDE_CASES)(
    '$key: $whenLocal in $assertedZone really is $contactLocalWallClock in $contactZone',
    ({ whenLocal, assertedZone, contactZone, contactLocalWallClock }) => {
      const asserted = DateTime.fromISO(whenLocal, { zone: assertedZone });
      expect(asserted.isValid, `${whenLocal} is not a valid local time in ${assertedZone}`).toBe(true);
      expect(asserted.setZone(contactZone).toFormat('yyyy-LL-dd HH:mm')).toBe(contactLocalWallClock);
    },
  );

  // And the DIRECTION follows from the policy window rather than from an author's
  // memory. `p1-default` is 09:00-17:00 Monday-Friday, windows are half-open, and
  // the default slot is 30 minutes.
  it.each(TIMEZONE_OVERRIDE_CASES)(
    '$key: the declared direction follows from where that lands in the p1 window',
    ({ contactLocalWallClock, direction }) => {
      const policy = POLICIES.find((candidate) => candidate.key === 'p1-default');
      const open = Number(policy?.businessHoursStartLocal.slice(0, 2)) * 60;
      const close = Number(policy?.businessHoursEndLocal.slice(0, 2)) * 60;
      const local = DateTime.fromFormat(contactLocalWallClock, 'yyyy-LL-dd HH:mm', { zone: 'UTC' });
      const minutes = local.hour * 60 + local.minute;
      const isBusinessDay = local.weekday <= 5;
      const inside = isBusinessDay && minutes >= open && minutes + 30 <= close;
      expect(inside ? 'ACCEPT' : 'REJECT').toBe(direction);
    },
  );
});

describe('the lead-time boundary dimension', () => {
  it('carries SECONDS, which is the whole reason it exists alongside NOW_INSTANTS', () => {
    for (const instant of NOW_INSTANTS) {
      expect(
        DateTime.fromISO(instant.nowUtc, { zone: 'utc' }).second,
        `${instant.key} is on a whole minute, so it can never probe a sub-minute rounding bug`,
      ).toBe(0);
    }
    const withSeconds = LEAD_TIME_BOUNDARY_CASES.filter(
      (boundary) => DateTime.fromISO(boundary.nowUtc, { zone: 'utc' }).second !== 0,
    );
    expect(withSeconds.length, 'the boundary family must include instants that are NOT on a whole minute')
      .toBeGreaterThan(2);
  });

  it.each(LEAD_TIME_BOUNDARY_CASES)(
    '$key: the true lead really is $leadSeconds seconds, and the direction follows from the 30-minute minimum',
    ({ nowUtc, whenLocal, leadSeconds, direction }) => {
      const minimumMinutes = POLICIES.find((policy) => policy.key === 'p1-default')?.minLeadTimeMinutes as number;
      const start = DateTime.fromISO(whenLocal, { zone: LEAD_TIME_BOUNDARY_ZONE });
      expect(start.isValid, `${whenLocal} is not valid in ${LEAD_TIME_BOUNDARY_ZONE}`).toBe(true);

      const actual = (start.toMillis() - DateTime.fromISO(nowUtc, { zone: 'utc' }).toMillis()) / 1000;
      expect(actual, 'the declared lead must be the real one').toBe(leadSeconds);
      expect(actual >= minimumMinutes * 60 ? 'ACCEPT' : 'REJECT').toBe(direction);
    },
  );
});

describe('the seeded PRNG', () => {
  it('produces the same stream for the same seed, and a different one otherwise', () => {
    const a = seededRandom(20260923);
    const b = seededRandom(20260923);
    const c = seededRandom(20260924);
    const streamA = Array.from({ length: 8 }, () => a());
    const streamB = Array.from({ length: 8 }, () => b());
    const streamC = Array.from({ length: 8 }, () => c());
    expect(streamA).toEqual(streamB);
    expect(streamA).not.toEqual(streamC);
    for (const value of streamA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
