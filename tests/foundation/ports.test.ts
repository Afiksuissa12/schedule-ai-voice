/**
 * The port contract.
 *
 * Three sibling tasks compile against `src/ports`. These tests pin down the
 * parts of that contract a type signature alone cannot: the behaviour of the
 * two `Clock` implementations, and the fact that a hand-written double really
 * does satisfy each interface (which is how the scheduling and agent tasks will
 * build their test doubles).
 */
import { describe, expect, it } from 'vitest';

import {
  FixedClock,
  SystemClock,
  VALIDATION_ERROR_CODES,
  ValidationErrorCode,
  firstFailedCheck,
  isValidationFailure,
  isValidationSuccess,
  validationFailed,
  validationOk,
  type AvailabilityProvider,
  type CalendarProvider,
  type Clock,
  type LlmProvider,
  type TelephonyProvider,
  type ValidationProvenance,
  type ValidationResult,
} from '../../src/ports/index.js';

describe('Clock', () => {
  it('SystemClock returns a parseable ISO-8601 UTC instant', () => {
    const now = new SystemClock().nowUtc();
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(now))).toBe(false);
  });

  it('FixedClock does not move on its own', () => {
    const clock = new FixedClock('2026-03-04T15:00:00.000Z');
    expect(clock.nowUtc()).toBe('2026-03-04T15:00:00.000Z');
    expect(clock.nowUtc()).toBe('2026-03-04T15:00:00.000Z');
  });

  it('FixedClock normalizes any valid ISO instant to canonical UTC', () => {
    expect(new FixedClock('2026-03-04T10:00:00-05:00').nowUtc()).toBe('2026-03-04T15:00:00.000Z');
  });

  it('FixedClock advances by an explicit amount, forwards and backwards', () => {
    const clock = new FixedClock('2026-03-04T15:00:00.000Z');
    clock.advance(90_000);
    expect(clock.nowUtc()).toBe('2026-03-04T15:01:30.000Z');
    clock.advance(-30_000);
    expect(clock.nowUtc()).toBe('2026-03-04T15:01:00.000Z');
  });

  it('FixedClock can jump to an absolute instant', () => {
    const clock = new FixedClock('2026-03-04T15:00:00.000Z');
    clock.setTo('2026-03-11T18:00:00.000Z');
    expect(clock.nowUtc()).toBe('2026-03-11T18:00:00.000Z');
  });

  it('FixedClock refuses an unparseable instant rather than silently using now', () => {
    expect(() => new FixedClock('next tuesday')).toThrow(/valid ISO-8601 instant/);
    expect(() => new FixedClock('2026-03-04T15:00:00.000Z').advance(Number.NaN)).toThrow(/finite/);
  });

  it('is injectable: logic written against `Clock` accepts either implementation', () => {
    const readNow = (clock: Clock): string => clock.nowUtc();
    expect(readNow(new FixedClock('2026-03-04T15:00:00.000Z'))).toBe('2026-03-04T15:00:00.000Z');
    expect(typeof readNow(new SystemClock())).toBe('string');
  });
});

describe('ValidationResult', () => {
  const provenance: ValidationProvenance = {
    validatorVersion: 'datetime-validator@1',
    nowUtc: '2026-03-04T15:00:00.000Z',
    rawProposedValue: 'next Wednesday at 2pm',
    resolvedTimezone: 'America/New_York',
    resolvedStartUtc: '2026-03-11T18:00:00.000Z',
    resolvedEndUtc: '2026-03-11T18:30:00.000Z',
    checks: [
      { name: 'parse_iso', passed: true },
      { name: 'business_hours', passed: false, detail: 'Wed 03:00 outside 09:00-17:00' },
    ],
  };

  it('narrows to the success arm', () => {
    const result: ValidationResult<string> = validationOk('2026-03-11T18:00:00.000Z', provenance);
    expect(isValidationSuccess(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('2026-03-11T18:00:00.000Z');
    }
  });

  it('narrows to the failure arm, and a failure carries provenance too', () => {
    const result: ValidationResult<string> = validationFailed(
      ValidationErrorCode.OUTSIDE_BUSINESS_HOURS,
      '03:00 is outside business hours',
      provenance,
    );

    expect(isValidationFailure(result)).toBe(true);
    if (!result.ok) {
      expect(result.code).toBe('OUTSIDE_BUSINESS_HOURS');
      // A rejection has to be as explainable as an acceptance.
      expect(result.provenance.nowUtc).toBe('2026-03-04T15:00:00.000Z');
      expect(result.provenance.rawProposedValue).toBe('next Wednesday at 2pm');
    }
  });

  it('surfaces the check that caused the rejection', () => {
    expect(firstFailedCheck(provenance)?.name).toBe('business_hours');
  });

  it('declares every error code the mission requires', () => {
    expect([...VALIDATION_ERROR_CODES]).toEqual(
      expect.arrayContaining([
        'INVALID_FORMAT',
        'UNKNOWN_TIMEZONE',
        'AMBIGUOUS_LOCAL_TIME',
        'NONEXISTENT_LOCAL_TIME',
        'IN_THE_PAST',
        'BELOW_MIN_LEAD_TIME',
        'BEYOND_HORIZON',
        'OUTSIDE_BUSINESS_HOURS',
        'CONFLICT_WITH_BUSY_INTERVAL',
        'UNKNOWN_CONTACT',
        'UNSUPPORTED_TOOL',
        'SCHEMA_VIOLATION',
        'POLICY_VIOLATION',
      ]),
    );
  });
});

describe('provider interfaces are implementable by a plain in-memory double', () => {
  it('AvailabilityProvider', async () => {
    const provider: AvailabilityProvider = {
      name: () => 'deterministic-test',
      getBusyIntervals: async ({ calendarRef }) =>
        calendarRef === 'busy-calendar'
          ? [{ startUtc: '2026-03-11T18:00:00.000Z', endUtc: '2026-03-11T19:00:00.000Z' }]
          : [],
    };

    expect(provider.name()).toBe('deterministic-test');
    expect(
      await provider.getBusyIntervals({
        calendarRef: 'busy-calendar',
        fromUtc: '2026-03-11T00:00:00.000Z',
        toUtc: '2026-03-12T00:00:00.000Z',
      }),
    ).toHaveLength(1);
  });

  it('CalendarProvider', async () => {
    const created: string[] = [];
    const provider: CalendarProvider = {
      name: () => 'deterministic-test',
      capabilities: () => ({ canWrite: true, canInvite: false }),
      createEvent: async (req) => {
        created.push(req.idempotencyKey);
        return { externalEventId: `evt-${req.idempotencyKey}` };
      },
      updateEvent: async (req) => ({ externalEventId: req.externalEventId }),
      cancelEvent: async () => undefined,
    };

    const event = await provider.createEvent({
      calendarRef: 'primary-test-calendar',
      title: 'Intro call',
      startUtc: '2026-03-11T18:00:00.000Z',
      endUtc: '2026-03-11T18:30:00.000Z',
      timezone: 'America/New_York',
      attendees: [{ email: 'jordan@prospect.test' }],
      idempotencyKey: 'key-1',
    });

    expect(event.externalEventId).toBe('evt-key-1');
    expect(provider.capabilities().canWrite).toBe(true);
    expect(created).toEqual(['key-1']);
  });

  it('TelephonyProvider - and no real number is ever dialled by a double', async () => {
    const provider: TelephonyProvider = {
      name: () => 'deterministic-test',
      capabilities: () => ({ canPlaceCalls: true, canSendSms: false }),
      placeCall: async (req) => ({ providerCallId: `call-${req.correlationId}`, status: 'QUEUED' }),
      endCall: async () => undefined,
    };

    const call = await provider.placeCall({
      toE164: '+12125550147',
      fromE164: '+12125550100',
      correlationId: 'corr-1',
    });

    expect(call).toEqual({ providerCallId: 'call-corr-1', status: 'QUEUED' });
  });

  it('LlmProvider - returns text and PROPOSED tool calls, nothing executed', async () => {
    const provider: LlmProvider = {
      name: () => 'scripted-test',
      completeTurn: async () => ({
        assistantText: null,
        toolCalls: [
          {
            toolCallId: 'tool_1',
            toolName: 'schedule_meeting',
            // Raw and untrusted: application code parses and validates this.
            argumentsJson: '{"when":"next Wednesday at 2pm"}',
          },
        ],
      }),
    };

    const result = await provider.completeTurn({
      systemPrompt: 'You are a scheduling agent.',
      messages: [{ role: 'user', content: 'Can we meet next Wednesday at 2pm?' }],
      tools: [{ name: 'schedule_meeting', description: 'Book a meeting', parametersJsonSchema: {} }],
    });

    expect(result.assistantText).toBeNull();
    expect(result.toolCalls[0]?.toolName).toBe('schedule_meeting');
    expect(typeof result.toolCalls[0]?.argumentsJson).toBe('string');
  });
});
