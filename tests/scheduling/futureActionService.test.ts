/**
 * `FutureActionService`: the promise becomes a row, or it does not exist.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseValidationProvenance } from '../../src/domain/provenance.js';
import { parseCallContactPayload } from '../../src/followup/payloads.js';
import { DEFAULT_TEST_NOW_UTC } from '../helpers/testDb.js';
import { createSchedulingHarness, ZERO_DOMAIN_ROWS, type SchedulingHarness } from './support.js';

describe('FutureActionService.schedule', () => {
  let harness: SchedulingHarness;

  beforeEach(async () => {
    harness = await createSchedulingHarness({
      label: 'future-action',
      availability: {
        busyIntervals: [{ startUtc: '2026-03-05T19:00:00.000Z', endUtc: '2026-03-05T21:00:00.000Z' }],
      },
    });
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  const input = (raw: string, overrides: Record<string, unknown> = {}) => ({
    organizationId: harness.fixtures.organization.id,
    contactId: harness.fixtures.contact.id,
    agentConfigurationId: harness.fixtures.agentConfiguration.id,
    proposal: { raw },
    reason: 'contact asked for a callback',
    correlationId: 'corr_followup',
    ...overrides,
  });

  it('persists a PENDING CALL_CONTACT at the validated instant', async () => {
    const result = await harness.futureActions.schedule(input('call me back tomorrow afternoon at 3'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const action = result.value.futureAction;
    expect(action.type).toBe('CALL_CONTACT');
    expect(action.status).toBe('PENDING');
    expect(action.scheduledForUtc).toBe('2026-03-05T20:00:00.000Z');
    expect(action.timezone).toBe('America/New_York');
    expect(action.attempts).toBe(0);
    expect(action.maxAttempts).toBe(3);
    expect(await harness.counts()).toMatchObject({ futureActions: 1, meetings: 0 });
  });

  it('writes a self-sufficient payload the runner can use with no LLM context', async () => {
    const result = await harness.futureActions.schedule(input('tomorrow afternoon at 3'));
    if (!result.ok) throw new Error(result.reason);

    const payload = parseCallContactPayload(result.value.futureAction.payloadJson);
    expect(payload.version).toBe(1);
    expect(payload.toE164).toBe(harness.fixtures.contact.primaryPhoneE164);
    expect(payload.correlationId).toBe('corr_followup');
    expect(payload.reason).toBe('contact asked for a callback');
    expect(payload.scheduledForLocal).toBe('2026-03-05T15:00');
  });

  it('writes a complete receipt into validationProvenanceJson', async () => {
    const result = await harness.futureActions.schedule(input('tomorrow afternoon at 3'));
    if (!result.ok) throw new Error(result.reason);

    const stored = parseValidationProvenance(result.value.futureAction.validationProvenanceJson);
    expect(stored.nowUtc).toBe(DEFAULT_TEST_NOW_UTC);
    expect(stored.rawProposedValue).toBe('tomorrow afternoon at 3');
    expect(stored.resolvedStartUtc).toBe('2026-03-05T20:00:00.000Z');
    expect(stored.checks.map((check) => check.name)).toEqual([
      'contact_exists',
      'agent_configuration_loaded',
      'timezone_is_iana',
      'parse_proposed_value',
      'local_time_exists',
      'local_time_unambiguous',
      'in_the_future',
      'min_lead_time',
      'within_horizon',
      'business_hours',
    ]);
    // The busy-interval check did not run, and the receipt says so plainly.
    expect(stored.notes?.skippedChecks).toEqual(['no_busy_conflict']);
  });

  it('records FUTURE_ACTION_SCHEDULED on the agent turn correlation chain', async () => {
    const result = await harness.futureActions.schedule(input('tomorrow afternoon at 3'));
    if (!result.ok) throw new Error(result.reason);

    const chain = await harness.db.audit.listByCorrelationId('corr_followup');
    expect(chain.map((event) => event.type)).toEqual(['FUTURE_ACTION_SCHEDULED']);
    expect(chain[0]?.subjectType).toBe('FUTURE_ACTION');
    expect(chain[0]?.subjectId).toBe(result.value.futureAction.id);
  });

  it('does NOT refuse a callback just because the calendar is busy', async () => {
    // 15:00 New York sits inside the seeded 14:00-16:00 busy block. A meeting
    // there would be refused; a phone call is not a calendar booking.
    const result = await harness.futureActions.schedule(input('tomorrow afternoon at 3'));
    expect(result.ok).toBe(true);
    expect(harness.availability.requests).toHaveLength(0);
  });

  it('DOES check availability when asked to', async () => {
    const result = await harness.futureActions.schedule(
      input('tomorrow afternoon at 3', {
        checkAvailability: true,
        calendarRef: harness.fixtures.calendarConnection.calendarRef,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CONFLICT_WITH_BUSY_INTERVAL');
    expect(await harness.counts()).toEqual(ZERO_DOMAIN_ROWS);
  });

  it('enforces business hours by default, and can be told not to', async () => {
    const refused = await harness.futureActions.schedule(input('tomorrow at 20:00'));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('OUTSIDE_BUSINESS_HOURS');

    const allowed = await harness.futureActions.schedule(
      input('tomorrow at 20:00', { checkBusinessHours: false, idempotencyKey: 'after-hours' }),
    );
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(
        parseValidationProvenance(allowed.value.futureAction.validationProvenanceJson).notes?.skippedChecks,
      ).toEqual(['business_hours', 'no_busy_conflict']);
    }
  });

  interface RejectionCase {
    readonly code: string;
    readonly raw: string;
    readonly overrides?: Record<string, unknown>;
    readonly why: string;
  }

  const rejections: RejectionCase[] = [
    {
      code: 'UNKNOWN_CONTACT',
      raw: 'tomorrow at 2pm',
      overrides: { contactId: 'nope' },
      why: 'contact not in this organization',
    },
    {
      code: 'UNKNOWN_TIMEZONE',
      raw: 'tomorrow at 2pm',
      overrides: { proposal: { raw: 'tomorrow at 2pm', timezone: 'Nowhere/Nothing' } },
      why: 'not an IANA zone',
    },
    { code: 'INVALID_FORMAT', raw: 'call me back whenever', why: 'too vague' },
    { code: 'NONEXISTENT_LOCAL_TIME', raw: '2026-03-08T02:30', why: 'spring-forward gap' },
    { code: 'AMBIGUOUS_LOCAL_TIME', raw: '2026-11-01T01:30', why: 'fall-back repeat' },
    { code: 'IN_THE_PAST', raw: '2026-03-04T14:00:00Z', why: 'before now' },
    { code: 'BELOW_MIN_LEAD_TIME', raw: '2026-03-04T15:29:00Z', why: 'inside the 30-minute lead time' },
    { code: 'BEYOND_HORIZON', raw: '2027-06-01T15:00:00Z', why: 'past the 180-day horizon' },
    { code: 'OUTSIDE_BUSINESS_HOURS', raw: '2026-03-07T10:00', why: 'a Saturday' },
    {
      code: 'POLICY_VIOLATION',
      raw: 'tomorrow at 2pm',
      overrides: { type: 'SEND_FOLLOWUP_MESSAGE' },
      why: 'no dispatcher for that type in this slice',
    },
  ];

  it.each(rejections)('refuses with $code ($why) and writes no domain row', async (testCase) => {
    const correlationId = `corr_fa_${testCase.code}`;
    const result = await harness.futureActions.schedule(
      input(testCase.raw, { correlationId, ...(testCase.overrides ?? {}) }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    expect(result.code).toBe(testCase.code);

    expect(await harness.counts()).toEqual(ZERO_DOMAIN_ROWS);
    expect(harness.telephony.placedCalls).toHaveLength(0);

    const chain = await harness.db.audit.listByCorrelationId(correlationId);
    expect(chain.map((event) => event.type)).toEqual(['VALIDATION_REJECTED']);
  });

  it('returns the existing action for a repeated idempotency key', async () => {
    const first = await harness.futureActions.schedule(
      input('tomorrow afternoon at 3', { idempotencyKey: 'tool-call-xyz', correlationId: 'corr_a' }),
    );
    const second = await harness.futureActions.schedule(
      input('tomorrow afternoon at 3', { idempotencyKey: 'tool-call-xyz', correlationId: 'corr_b' }),
    );

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(second.value.futureAction.id).toBe(first.value.futureAction.id);
    expect(second.value.reusedExisting).toBe(true);
    expect(await harness.counts()).toMatchObject({ futureActions: 1 });
    expect(await harness.db.audit.listByCorrelationId('corr_b')).toEqual([]);
  });

  it('honours an explicit maxAttempts', async () => {
    const result = await harness.futureActions.schedule(input('tomorrow afternoon at 3', { maxAttempts: 5 }));
    expect(result.ok && result.value.futureAction.maxAttempts).toBe(5);
  });
});
