/**
 * The deterministic test doubles, and the registry that is the only place
 * allowed to name an implementation.
 */
import { describe, expect, it } from 'vitest';

import {
  createAvailabilityProvider,
  createCalendarProvider,
  createProviderRegistry,
  createTelephonyProvider,
  DeterministicAvailabilityProvider,
  DeterministicCalendarProvider,
  DeterministicTelephonyProvider,
} from '../../src/providers/index.js';

const NY = 'America/New_York';
const CALENDAR = 'primary-test-calendar';

describe('DeterministicAvailabilityProvider', () => {
  it('returns identical results for identical inputs', async () => {
    const build = () =>
      new DeterministicAvailabilityProvider({
        busyIntervals: [{ startUtc: '2026-03-05T19:00:00.000Z', endUtc: '2026-03-05T20:00:00.000Z' }],
        rules: [{ timezone: NY, startLocal: '12:00', endLocal: '13:00', label: 'lunch' }],
      });
    const request = { calendarRef: CALENDAR, fromUtc: '2026-03-02T00:00:00.000Z', toUtc: '2026-03-09T00:00:00.000Z' };

    const first = await build().getBusyIntervals(request);
    const second = await build().getBusyIntervals(request);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('returns intervals sorted by start', async () => {
    const provider = new DeterministicAvailabilityProvider({
      busyIntervals: [
        { startUtc: '2026-03-05T21:00:00.000Z', endUtc: '2026-03-05T22:00:00.000Z' },
        { startUtc: '2026-03-05T19:00:00.000Z', endUtc: '2026-03-05T20:00:00.000Z' },
      ],
    });
    const result = await provider.getBusyIntervals({
      calendarRef: CALENDAR,
      fromUtc: '2026-03-05T00:00:00.000Z',
      toUtc: '2026-03-06T00:00:00.000Z',
    });
    expect(result.map((i) => i.startUtc)).toEqual(['2026-03-05T19:00:00.000Z', '2026-03-05T21:00:00.000Z']);
  });

  it('returns only intervals overlapping the requested window', async () => {
    const provider = new DeterministicAvailabilityProvider({
      busyIntervals: [{ startUtc: '2026-03-05T19:00:00.000Z', endUtc: '2026-03-05T20:00:00.000Z' }],
    });
    const before = await provider.getBusyIntervals({
      calendarRef: CALENDAR,
      fromUtc: '2026-03-05T18:00:00.000Z',
      toUtc: '2026-03-05T19:00:00.000Z',
    });
    expect(before).toEqual([]);
  });

  it('keeps a recurring local rule at the same WALL-CLOCK time across a DST change', async () => {
    const provider = new DeterministicAvailabilityProvider({
      rules: [{ timezone: NY, startLocal: '12:00', endLocal: '13:00' }],
    });
    // 2026-03-08 is the US spring-forward date: noon is 17:00Z before and 16:00Z after.
    const week = await provider.getBusyIntervals({
      calendarRef: CALENDAR,
      fromUtc: '2026-03-06T00:00:00.000Z',
      toUtc: '2026-03-11T00:00:00.000Z',
    });
    expect(week).toContainEqual({ startUtc: '2026-03-06T17:00:00.000Z', endUtc: '2026-03-06T18:00:00.000Z' });
    expect(week).toContainEqual({ startUtc: '2026-03-10T16:00:00.000Z', endUtc: '2026-03-10T17:00:00.000Z' });
  });

  it('restricts a rule to the configured weekdays', async () => {
    const provider = new DeterministicAvailabilityProvider({
      rules: [{ timezone: NY, startLocal: '12:00', endLocal: '13:00', isoWeekdays: [1, 2, 3, 4, 5] }],
    });
    // 2026-03-07 is a Saturday, 2026-03-08 a Sunday.
    const weekend = await provider.getBusyIntervals({
      calendarRef: CALENDAR,
      fromUtc: '2026-03-07T00:00:00.000Z',
      toUtc: '2026-03-09T00:00:00.000Z',
    });
    expect(weekend).toEqual([]);
  });

  it('supports per-calendar availability', async () => {
    const provider = new DeterministicAvailabilityProvider({
      busyIntervals: [{ startUtc: '2026-03-05T19:00:00.000Z', endUtc: '2026-03-05T20:00:00.000Z' }],
      calendars: { 'other-calendar': { busyIntervals: [] } },
    });
    const window = { fromUtc: '2026-03-05T00:00:00.000Z', toUtc: '2026-03-06T00:00:00.000Z' };
    expect(await provider.getBusyIntervals({ calendarRef: CALENDAR, ...window })).toHaveLength(1);
    expect(await provider.getBusyIntervals({ calendarRef: 'other-calendar', ...window })).toHaveLength(0);
  });

  it('records every request it was asked', async () => {
    const provider = new DeterministicAvailabilityProvider();
    const request = { calendarRef: CALENDAR, fromUtc: '2026-03-05T00:00:00.000Z', toUtc: '2026-03-06T00:00:00.000Z' };
    await provider.getBusyIntervals(request);
    expect(provider.requests).toEqual([request]);
  });

  it('refuses an unusable rule at construction time', () => {
    expect(() => new DeterministicAvailabilityProvider({ rules: [{ timezone: '-05:00', startLocal: '12:00', endLocal: '13:00' }] })).toThrow(
      /unusable timezone/,
    );
    expect(() => new DeterministicAvailabilityProvider({ rules: [{ timezone: NY, startLocal: '13:00', endLocal: '12:00' }] })).toThrow(
      /before endLocal/,
    );
  });
});

describe('DeterministicCalendarProvider', () => {
  const event = {
    calendarRef: CALENDAR,
    title: 'Discovery call',
    startUtc: '2026-03-05T19:00:00.000Z',
    endUtc: '2026-03-05T19:30:00.000Z',
    timezone: NY,
    attendees: [{ email: 'jordan@prospect.test' }],
  };

  it('honours idempotencyKey: same key, same id, no second event', async () => {
    const provider = new DeterministicCalendarProvider();
    const first = await provider.createEvent({ ...event, idempotencyKey: 'tool-call-1' });
    const second = await provider.createEvent({ ...event, title: 'Different title', idempotencyKey: 'tool-call-1' });

    expect(second.externalEventId).toBe(first.externalEventId);
    expect(provider.eventCount).toBe(1);
    expect(provider.findEvent(first.externalEventId)?.title).toBe('Discovery call');
    expect(provider.findEvent(first.externalEventId)?.createCalls).toBe(2);
  });

  it('derives a STABLE external id, not a counter', async () => {
    const a = await new DeterministicCalendarProvider().createEvent({ ...event, idempotencyKey: 'stable' });
    const b = await new DeterministicCalendarProvider().createEvent({ ...event, idempotencyKey: 'stable' });
    expect(a.externalEventId).toBe(b.externalEventId);
    expect(a.externalEventId).toMatch(/^det-evt-[0-9a-f]{24}$/);
  });

  it('scopes the key to the calendar', async () => {
    const provider = new DeterministicCalendarProvider();
    const a = await provider.createEvent({ ...event, idempotencyKey: 'k' });
    const b = await provider.createEvent({ ...event, calendarRef: 'other', idempotencyKey: 'k' });
    expect(a.externalEventId).not.toBe(b.externalEventId);
    expect(provider.eventCount).toBe(2);
  });

  it('updates and cancels, and replays a repeated mutation as a no-op', async () => {
    const provider = new DeterministicCalendarProvider();
    const { externalEventId } = await provider.createEvent({ ...event, idempotencyKey: 'k' });

    await provider.updateEvent({
      calendarRef: CALENDAR,
      externalEventId,
      startUtc: '2026-03-06T19:00:00.000Z',
      idempotencyKey: 'move-1',
    });
    await provider.updateEvent({
      calendarRef: CALENDAR,
      externalEventId,
      startUtc: '2026-03-07T19:00:00.000Z',
      idempotencyKey: 'move-1',
    });
    expect(provider.findEvent(externalEventId)?.startUtc).toBe('2026-03-06T19:00:00.000Z');
    expect(provider.findEvent(externalEventId)?.updateCalls).toBe(1);

    await provider.cancelEvent({ calendarRef: CALENDAR, externalEventId, idempotencyKey: 'cancel-1' });
    await provider.cancelEvent({ calendarRef: CALENDAR, externalEventId, idempotencyKey: 'cancel-1' });
    expect(provider.findEvent(externalEventId)?.status).toBe('CANCELLED');
    expect(provider.findEvent(externalEventId)?.cancelCalls).toBe(1);
  });

  it('refuses to mutate an event that does not exist, or one on another calendar', async () => {
    const provider = new DeterministicCalendarProvider();
    const { externalEventId } = await provider.createEvent({ ...event, idempotencyKey: 'k' });
    await expect(
      provider.updateEvent({ calendarRef: CALENDAR, externalEventId: 'nope', idempotencyKey: 'x' }),
    ).rejects.toThrow(/CalendarEvent not found/);
    await expect(
      provider.cancelEvent({ calendarRef: 'other', externalEventId, idempotencyKey: 'x' }),
    ).rejects.toThrow(/does not belong to the supplied calendarRef/);
  });

  it('reports capabilities truthfully: it writes, but it invites nobody', () => {
    expect(new DeterministicCalendarProvider().capabilities()).toEqual({ canWrite: true, canInvite: false });
    expect(new DeterministicCalendarProvider({ canInvite: true }).capabilities().canInvite).toBe(true);
  });

  it('refuses to write when it says it cannot write', async () => {
    const readOnly = new DeterministicCalendarProvider({ canWrite: false });
    await expect(readOnly.createEvent({ ...event, idempotencyKey: 'k' })).rejects.toThrow(/not writable/);
  });
});

describe('DeterministicTelephonyProvider', () => {
  const request = { toE164: '+12125550147', fromE164: '+12125550100', correlationId: 'corr-1' };

  it('derives a deterministic providerCallId from the idempotency key', async () => {
    const a = await new DeterministicTelephonyProvider().placeCall({ ...request, idempotencyKey: 'attempt-1' });
    const b = await new DeterministicTelephonyProvider().placeCall({ ...request, idempotencyKey: 'attempt-1' });
    expect(a.providerCallId).toBe(b.providerCallId);
    expect(a.providerCallId).toMatch(/^det-call-[0-9a-f]{24}$/);
  });

  it('falls back to the correlation id when no idempotency key is given', async () => {
    const a = await new DeterministicTelephonyProvider().placeCall(request);
    const b = await new DeterministicTelephonyProvider().placeCall(request);
    expect(a.providerCallId).toBe(b.providerCallId);
  });

  it('replays a repeated idempotency key instead of dialling again', async () => {
    const provider = new DeterministicTelephonyProvider({ script: [{ status: 'NO_ANSWER' }, { status: 'COMPLETED' }] });
    const first = await provider.placeCall({ ...request, idempotencyKey: 'same' });
    const second = await provider.placeCall({ ...request, idempotencyKey: 'same' });
    expect(second).toEqual(first);
    expect(second.status).toBe('NO_ANSWER'); // the COMPLETED step was NOT consumed
    expect(provider.placedCalls).toHaveLength(1);
  });

  it('follows a script and then repeats the default status', async () => {
    const provider = new DeterministicTelephonyProvider({
      script: [{ status: 'NO_ANSWER' }, { status: 'FAILED' }],
      defaultStatus: 'COMPLETED',
    });
    expect((await provider.placeCall({ ...request, idempotencyKey: '1' })).status).toBe('NO_ANSWER');
    expect((await provider.placeCall({ ...request, idempotencyKey: '2' })).status).toBe('FAILED');
    expect((await provider.placeCall({ ...request, idempotencyKey: '3' })).status).toBe('COMPLETED');
    expect((await provider.placeCall({ ...request, idempotencyKey: '4' })).status).toBe('COMPLETED');
  });

  it('can be scripted to throw, and still records the attempt', async () => {
    const provider = new DeterministicTelephonyProvider({ script: [{ error: 'carrier unreachable' }] });
    await expect(provider.placeCall({ ...request, idempotencyKey: '1' })).rejects.toThrow(/carrier unreachable/);
    expect(provider.placedCalls).toHaveLength(1);
    expect(provider.placedCalls[0]?.error).toBe('carrier unreachable');
  });

  it('records every call placed, and every call ended', async () => {
    const provider = new DeterministicTelephonyProvider();
    const { providerCallId } = await provider.placeCall({ ...request, idempotencyKey: '1' });
    await provider.endCall(providerCallId);
    expect(provider.callsTo('+12125550147')).toHaveLength(1);
    expect(provider.endedCalls).toEqual([providerCallId]);
  });

  it('refuses a call with no correlation id, so no call escapes the audit chain', async () => {
    await expect(
      new DeterministicTelephonyProvider().placeCall({ ...request, correlationId: '' }),
    ).rejects.toThrow(/requires a correlationId/);
  });
});

describe('the provider registry', () => {
  it('wires the deterministic implementations by default', () => {
    const registry = createProviderRegistry();
    expect(registry.availability.name()).toBe('deterministic-test');
    expect(registry.calendar.name()).toBe('deterministic-test');
    expect(registry.telephony.name()).toBe('deterministic-test');
    expect(registry.kinds).toEqual({
      availability: 'DETERMINISTIC_TEST',
      calendar: 'DETERMINISTIC_TEST',
      telephony: 'DETERMINISTIC_TEST',
    });
  });

  it('passes options through to the doubles', async () => {
    const registry = createProviderRegistry({
      availability: {
        options: { busyIntervals: [{ startUtc: '2026-03-05T19:00:00.000Z', endUtc: '2026-03-05T20:00:00.000Z' }] },
      },
      telephony: { options: { defaultStatus: 'NO_ANSWER' } },
    });
    expect(
      await registry.availability.getBusyIntervals({
        calendarRef: CALENDAR,
        fromUtc: '2026-03-05T00:00:00.000Z',
        toUtc: '2026-03-06T00:00:00.000Z',
      }),
    ).toHaveLength(1);
    expect(
      (await registry.telephony.placeCall({ toE164: '+12125550147', fromE164: '+12125550100', correlationId: 'c' }))
        .status,
    ).toBe('NO_ANSWER');
  });

  it('REFUSES every vendor kind rather than silently falling back to a double', () => {
    for (const kind of ['GOOGLE', 'MICROSOFT_GRAPH'] as const) {
      expect(() => createCalendarProvider(kind)).toThrow(/NOT implemented or authorized in this mission/);
      expect(() => createAvailabilityProvider(kind)).toThrow(/NOT implemented or authorized/);
    }
    for (const kind of ['TWILIO', 'TELNYX', 'VONAGE', 'VAPI', 'RETELL'] as const) {
      expect(() => createTelephonyProvider(kind)).toThrow(/NOT implemented or authorized/);
    }
    expect(() => createProviderRegistry({ telephony: { kind: 'TWILIO' } })).toThrow(
      /no paid external service without explicit Founder approval/,
    );
  });
});
