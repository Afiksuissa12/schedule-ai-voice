/**
 * The policy half of the gate: order, boundaries, and the exact edges.
 *
 * Boundary cases are written as triples - exactly on the edge, just inside,
 * just outside - because "outside business hours" is only a useful guarantee if
 * everyone agrees where the outside starts.
 */
import { describe, expect, it } from 'vitest';

import { weekdayBusinessHours } from '../../src/domain/businessHours.js';
import { FixedClock } from '../../src/ports/clock.js';
import type { ValidationResult } from '../../src/ports/validation.js';
import { DeterministicAvailabilityProvider } from '../../src/providers/deterministicAvailabilityProvider.js';
import { SCHEDULING_CHECK_NAMES } from '../../src/scheduling/checkLog.js';
import type { ResolvedSlot } from '../../src/scheduling/dateTimeResolver.js';
import { schedulingPolicy, type SchedulingPolicy } from '../../src/scheduling/policy.js';
import { SchedulingValidator } from '../../src/scheduling/schedulingValidator.js';
import { DEFAULT_TEST_NOW_UTC } from '../helpers/testDb.js';

const NY = 'America/New_York';
const CALENDAR = 'primary-test-calendar';

/** Wednesday 2026-03-04, 10:00 America/New_York. */
const clock = new FixedClock(DEFAULT_TEST_NOW_UTC);

function policyWith(overrides: Partial<SchedulingPolicy> = {}): SchedulingPolicy {
  return schedulingPolicy({
    businessHours: weekdayBusinessHours('09:00', '17:00'),
    defaultTimezone: NY,
    minLeadTimeMinutes: 30,
    maxSchedulingHorizonDays: 180,
    defaultMeetingDurationMinutes: 30,
    ...overrides,
  });
}

function validatorWith(provider = new DeterministicAvailabilityProvider()): SchedulingValidator {
  return new SchedulingValidator({ clock, availability: provider });
}

async function validate(
  raw: string,
  options: {
    policy?: SchedulingPolicy;
    provider?: DeterministicAvailabilityProvider;
    timezone?: string;
    durationMinutes?: number;
    calendarRef?: string | null;
  } = {},
): Promise<ValidationResult<ResolvedSlot>> {
  const provider = options.provider ?? new DeterministicAvailabilityProvider();
  return validatorWith(provider).validate({
    proposal: {
      raw,
      timezone: options.timezone ?? NY,
      ...(options.durationMinutes !== undefined ? { durationMinutes: options.durationMinutes } : {}),
    },
    policy: options.policy ?? policyWith(),
    ...(options.calendarRef === null ? {} : { calendarRef: options.calendarRef ?? CALENDAR }),
  });
}

function codeOf(result: ValidationResult<ResolvedSlot>): string | 'ok' {
  return result.ok ? 'ok' : result.code;
}

describe('the recorded check order', () => {
  it('runs every check, in the documented order, on a clean pass', async () => {
    const result = await validate('tomorrow afternoon at 3');
    expect(result.ok).toBe(true);
    expect(result.provenance.checks.map((check) => check.name)).toEqual([...SCHEDULING_CHECK_NAMES]);
    expect(result.provenance.checks.every((check) => check.passed)).toBe(true);
  });

  it('stops at the first failure and records everything up to it', async () => {
    const result = await validate('yesterday'); // unparseable
    expect(codeOf(result)).toBe('INVALID_FORMAT');
    expect(result.provenance.checks.map((check) => check.name)).toEqual([
      'timezone_is_iana',
      'parse_proposed_value',
    ]);
  });

  it('records the `now` it used, so the decision can be re-run by hand', async () => {
    const result = await validate('tomorrow at 2pm');
    expect(result.provenance.nowUtc).toBe(DEFAULT_TEST_NOW_UTC);
    expect(result.provenance.validatorVersion).toBe('scheduling-validator@1');
  });
});

describe('IN_THE_PAST and BELOW_MIN_LEAD_TIME', () => {
  it('rejects an instant before now', async () => {
    expect(codeOf(await validate('2026-03-04T14:00:00Z'))).toBe('IN_THE_PAST');
  });

  it('rejects an instant exactly equal to now', async () => {
    expect(codeOf(await validate(DEFAULT_TEST_NOW_UTC))).toBe('IN_THE_PAST');
  });

  it('accepts a lead time exactly equal to the configured minimum', async () => {
    // now + 30 min = 10:30 New York, a Wednesday inside business hours.
    expect(codeOf(await validate('2026-03-04T15:30:00Z'))).toBe('ok');
  });

  it('rejects a lead time one minute below the minimum', async () => {
    expect(codeOf(await validate('2026-03-04T15:29:00Z'))).toBe('BELOW_MIN_LEAD_TIME');
  });

  it('reads the minimum from the policy, not from a constant', async () => {
    const strict = policyWith({ minLeadTimeMinutes: 240 });
    expect(codeOf(await validate('2026-03-04T15:30:00Z', { policy: strict }))).toBe('BELOW_MIN_LEAD_TIME');
    expect(codeOf(await validate('2026-03-04T19:00:00Z', { policy: strict }))).toBe('ok');
  });
});

describe('BEYOND_HORIZON', () => {
  const horizon = policyWith({ maxSchedulingHorizonDays: 7 });

  it('accepts a slot exactly on the horizon', async () => {
    // now + 7 days = 2026-03-11T15:00Z = 11:00 EDT Wednesday, inside hours.
    expect(codeOf(await validate('2026-03-11T15:00:00Z', { policy: horizon }))).toBe('ok');
  });

  it('rejects a slot one minute beyond the horizon', async () => {
    expect(codeOf(await validate('2026-03-11T15:01:00Z', { policy: horizon }))).toBe('BEYOND_HORIZON');
  });

  it('measures the horizon in fixed 24-hour days, not calendar days', async () => {
    const result = await validate('2026-03-11T15:00:00Z', { policy: horizon });
    const check = result.provenance.checks.find((c) => c.name === 'within_horizon');
    expect(check?.detail).toContain('7.00 days out <= 7 day horizon');
  });
});

describe('OUTSIDE_BUSINESS_HOURS', () => {
  it('accepts a slot starting exactly at open', async () => {
    expect(codeOf(await validate('2026-03-05T09:00'))).toBe('ok');
  });

  it('rejects a slot starting one minute before open', async () => {
    expect(codeOf(await validate('2026-03-05T08:59'))).toBe('OUTSIDE_BUSINESS_HOURS');
  });

  it('accepts a slot ENDING exactly at close', async () => {
    expect(codeOf(await validate('2026-03-05T16:30'))).toBe('ok');
  });

  it('rejects a slot that would run one minute past close', async () => {
    expect(codeOf(await validate('2026-03-05T16:31'))).toBe('OUTSIDE_BUSINESS_HOURS');
  });

  it('rejects a slot starting exactly at close', async () => {
    expect(codeOf(await validate('2026-03-05T17:00'))).toBe('OUTSIDE_BUSINESS_HOURS');
  });

  it('rejects a weekend', async () => {
    // 2026-03-07 is a Saturday.
    const result = await validate('2026-03-07T10:00');
    expect(codeOf(result)).toBe('OUTSIDE_BUSINESS_HOURS');
    expect(result.ok ? '' : result.reason).toMatch(/Saturday is not a configured business day/);
  });

  it('rejects a configured holiday', async () => {
    const withHoliday = policyWith({
      businessHours: { ...weekdayBusinessHours('09:00', '17:00'), holidayDatesLocal: ['2026-03-05'] },
    });
    const result = await validate('2026-03-05T10:00', { policy: withHoliday });
    expect(codeOf(result)).toBe('OUTSIDE_BUSINESS_HOURS');
    expect(result.ok ? '' : result.reason).toMatch(/configured holiday/);
  });

  it('evaluates business hours in the LOCAL zone of the contact', async () => {
    // 15:00 UTC on a weekday is 10:00 in New York (inside 09:00-17:00) but
    // 02:00 the next day in Sydney (outside). Same instant, different verdict.
    expect(codeOf(await validate('2026-03-05T15:00:00Z', { timezone: NY }))).toBe('ok');
    expect(codeOf(await validate('2026-03-05T15:00:00Z', { timezone: 'Australia/Sydney' }))).toBe(
      'OUTSIDE_BUSINESS_HOURS',
    );
  });

  it('honours a policy that pins its own timezone', async () => {
    // Business hours are New York's; the contact is in Sydney. 09:30 New York
    // is inside the window even though it is the middle of the Sydney night.
    const pinned = policyWith({ businessHours: weekdayBusinessHours('09:00', '17:00', NY) });
    expect(codeOf(await validate('2026-03-05T14:30:00Z', { policy: pinned, timezone: 'Australia/Sydney' }))).toBe(
      'ok',
    );
  });

  it('can be skipped explicitly, and says so in the receipt', async () => {
    const result = await validatorWith().validate({
      proposal: { raw: '2026-03-05T17:00', timezone: NY },
      policy: policyWith(),
      checkBusinessHours: false,
      checkAvailability: false,
    });
    expect(result.ok).toBe(true);
    expect(result.provenance.notes?.skippedChecks).toEqual(['business_hours', 'no_busy_conflict']);
    expect(result.provenance.checks.map((c) => c.name)).not.toContain('business_hours');
  });
});

describe('CONFLICT_WITH_BUSY_INTERVAL', () => {
  // 14:00-15:00 New York on Thursday 2026-03-05.
  const busy = new DeterministicAvailabilityProvider({
    busyIntervals: [{ startUtc: '2026-03-05T19:00:00.000Z', endUtc: '2026-03-05T20:00:00.000Z' }],
  });

  it('rejects a slot that overlaps a busy interval', async () => {
    const result = await validate('2026-03-05T19:30:00Z', { provider: busy });
    expect(codeOf(result)).toBe('CONFLICT_WITH_BUSY_INTERVAL');
    expect(result.ok ? '' : result.reason).toMatch(/already taken/);
  });

  it('rejects a slot that merely straddles the start of a busy interval', async () => {
    expect(codeOf(await validate('2026-03-05T18:45:00Z', { provider: busy }))).toBe('CONFLICT_WITH_BUSY_INTERVAL');
  });

  it('accepts a slot that ends exactly when the busy interval starts', async () => {
    expect(codeOf(await validate('2026-03-05T18:30:00Z', { provider: busy }))).toBe('ok');
  });

  it('accepts a slot that starts exactly when the busy interval ends', async () => {
    expect(codeOf(await validate('2026-03-05T20:00:00Z', { provider: busy }))).toBe('ok');
  });

  it('records the provider and the intervals it consulted', async () => {
    const conflicting = await validate('2026-03-05T19:30:00Z', { provider: busy });
    expect(conflicting.provenance.notes?.availabilityProvider).toBe('deterministic-test');
    expect(conflicting.provenance.notes?.busyIntervalsConsulted).toEqual([
      { startUtc: '2026-03-05T19:00:00.000Z', endUtc: '2026-03-05T20:00:00.000Z' },
    ]);

    // The window queried is the SLOT, so a non-overlapping busy block is not
    // even returned - and the receipt says plainly that zero were consulted.
    const clear = await validate('2026-03-05T18:30:00Z', { provider: busy });
    expect(clear.provenance.notes?.busyIntervalsConsulted).toEqual([]);
    expect(clear.provenance.checks.find((c) => c.name === 'no_busy_conflict')?.detail).toContain(
      '0 busy interval(s)',
    );
  });

  it('queries exactly the proposed slot window', async () => {
    const provider = new DeterministicAvailabilityProvider();
    await validate('2026-03-05T14:00', { provider });
    expect(provider.requests).toEqual([
      {
        calendarRef: CALENDAR,
        fromUtc: '2026-03-05T19:00:00.000Z',
        toUtc: '2026-03-05T19:30:00.000Z',
      },
    ]);
  });

  it('applies a recurring local busy rule', async () => {
    const lunch = new DeterministicAvailabilityProvider({
      rules: [{ timezone: NY, startLocal: '12:00', endLocal: '13:00', label: 'lunch' }],
    });
    expect(codeOf(await validate('2026-03-05T12:30', { provider: lunch }))).toBe('CONFLICT_WITH_BUSY_INTERVAL');
    expect(codeOf(await validate('2026-03-05T13:00', { provider: lunch }))).toBe('ok');
    expect(codeOf(await validate('2026-03-05T11:30', { provider: lunch }))).toBe('ok');
  });

  it('refuses to claim availability was checked when no calendar was supplied', async () => {
    const result = await validatorWith().validate({
      proposal: { raw: '2026-03-05T14:00', timezone: NY },
      policy: policyWith(),
      checkAvailability: true,
    });
    expect(codeOf(result)).toBe('POLICY_VIOLATION');
  });

  it('does not consult the provider at all when the proposal never parsed', async () => {
    const provider = new DeterministicAvailabilityProvider();
    await validate('sometime next week', { provider });
    expect(provider.requests).toHaveLength(0);
  });
});

describe('determinism', () => {
  it('returns identical results for identical inputs', async () => {
    const provider = () =>
      new DeterministicAvailabilityProvider({
        rules: [{ timezone: NY, startLocal: '12:00', endLocal: '13:00' }],
      });
    const a = await validate('tomorrow afternoon at 3', { provider: provider() });
    const b = await validate('tomorrow afternoon at 3', { provider: provider() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
