/**
 * `MeetingSchedulingService`: validate, then persist - and on a rejection,
 * persist NOTHING.
 *
 * The rejection table below is the heart of the file. Every error code this
 * task implements gets a row, and every row asserts that the domain row counts
 * are untouched. That is the difference between "we return an error" and "we
 * cannot be talked into writing a bad meeting".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseValidationProvenance } from '../../src/domain/provenance.js';
import { SCHEDULING_CHECK_NAMES } from '../../src/scheduling/checkLog.js';
import { DEFAULT_TEST_NOW_UTC } from '../helpers/testDb.js';
import { createSchedulingHarness, ZERO_DOMAIN_ROWS, type SchedulingHarness } from './support.js';

const CORRELATION = 'corr_meeting_test';

describe('MeetingSchedulingService.schedule - the happy path', () => {
  let harness: SchedulingHarness;

  beforeEach(async () => {
    harness = await createSchedulingHarness({ label: 'meeting-schedule' });
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  const scheduleInput = (raw: string, overrides: Record<string, unknown> = {}) => ({
    organizationId: harness.fixtures.organization.id,
    contactId: harness.fixtures.contact.id,
    agentConfigurationId: harness.fixtures.agentConfiguration.id,
    proposal: { raw },
    title: 'Discovery call',
    correlationId: CORRELATION,
    ...overrides,
  });

  it('persists a meeting at the validated instant, in the contact timezone', async () => {
    const result = await harness.meetings.schedule(scheduleInput('call me back tomorrow afternoon at 3'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    // Thursday 2026-03-05, 15:00 America/New_York (EST) = 20:00 UTC.
    expect(result.value.meeting.startUtc).toBe('2026-03-05T20:00:00.000Z');
    expect(result.value.meeting.endUtc).toBe('2026-03-05T20:30:00.000Z');
    expect(result.value.meeting.timezone).toBe('America/New_York');
    expect(result.value.slot.startLocal).toBe('2026-03-05T15:00');
    expect(result.value.meeting.status).toBe('SCHEDULED');
    expect(result.value.reusedExisting).toBe(false);

    expect(await harness.counts()).toMatchObject({ meetings: 1 });
  });

  it('writes a complete, re-runnable receipt into validationProvenanceJson', async () => {
    const result = await harness.meetings.schedule(scheduleInput('tomorrow afternoon at 3'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const stored = parseValidationProvenance(result.value.meeting.validationProvenanceJson);
    expect(stored.rawProposedValue).toBe('tomorrow afternoon at 3');
    expect(stored.nowUtc).toBe(DEFAULT_TEST_NOW_UTC);
    expect(stored.resolvedTimezone).toBe('America/New_York');
    expect(stored.resolvedStartUtc).toBe('2026-03-05T20:00:00.000Z');
    expect(stored.validatorVersion).toBe('scheduling-validator@1');

    // Service preconditions first, then the full datetime pipeline in order.
    expect(stored.checks.map((check) => check.name)).toEqual([
      'contact_exists',
      'agent_configuration_loaded',
      'calendar_connection_resolved',
      ...SCHEDULING_CHECK_NAMES,
    ]);
    expect(stored.checks.every((check) => check.passed)).toBe(true);
  });

  it('records the audit chain that explains the meeting', async () => {
    const result = await harness.meetings.schedule(scheduleInput('tomorrow afternoon at 3'));
    expect(result.ok).toBe(true);

    const chain = await harness.db.audit.listByCorrelationId(CORRELATION);
    expect(chain.map((event) => event.type)).toEqual([
      'TOOL_CALL_VALIDATED',
      'ENTITY_PERSISTED',
      'PROVIDER_INVOKED',
    ]);
    expect(chain.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(chain.every((event) => event.subjectType === 'MEETING')).toBe(true);

    if (!result.ok) throw new Error('unreachable');
    const bySubject = await harness.db.audit.listBySubject('MEETING', result.value.meeting.id);
    expect(bySubject).toHaveLength(3);
  });

  it('creates the calendar event and stores its external id', async () => {
    const result = await harness.meetings.schedule(scheduleInput('tomorrow afternoon at 3'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    expect(harness.calendar.eventCount).toBe(1);
    const external = result.value.externalCalendarEventId;
    expect(external).toMatch(/^det-evt-/);
    expect(result.value.meeting.externalCalendarEventId).toBe(external);

    const event = harness.calendar.findEvent(external ?? '');
    expect(event?.calendarRef).toBe(harness.fixtures.calendarConnection.calendarRef);
    expect(event?.startUtc).toBe('2026-03-05T20:00:00.000Z');
    expect(event?.attendees.map((a) => a.email)).toContain(harness.fixtures.contact.email);

    // And the row on disk carries it too, not just the in-memory result.
    const reread = await harness.db.meetings.requireById(result.value.meeting.id);
    expect(reread.externalCalendarEventId).toBe(external);
  });
});

describe('MeetingSchedulingService.schedule - rejections persist nothing', () => {
  let harness: SchedulingHarness;

  beforeEach(async () => {
    harness = await createSchedulingHarness({
      label: 'meeting-reject',
      availability: {
        // 14:00-15:00 America/New_York on Thursday 2026-03-05.
        busyIntervals: [{ startUtc: '2026-03-05T19:00:00.000Z', endUtc: '2026-03-05T20:00:00.000Z' }],
      },
    });
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  interface RejectionCase {
    readonly code: string;
    readonly raw: string;
    readonly timezone?: string;
    readonly contactId?: string;
    readonly calendarConnectionId?: string;
    readonly why: string;
  }

  const cases: RejectionCase[] = [
    {
      code: 'UNKNOWN_CONTACT',
      raw: 'tomorrow at 2pm',
      contactId: 'contact-that-does-not-exist',
      why: 'the contact is not in this organization',
    },
    {
      code: 'UNKNOWN_TIMEZONE',
      raw: 'tomorrow at 2pm',
      timezone: 'Mars/Olympus_Mons',
      why: 'not an IANA zone',
    },
    { code: 'INVALID_FORMAT', raw: 'sometime next week', why: 'too vague to resolve' },
    { code: 'NONEXISTENT_LOCAL_TIME', raw: '2026-03-08T02:30', why: 'inside the US spring-forward gap' },
    { code: 'AMBIGUOUS_LOCAL_TIME', raw: '2026-11-01T01:30', why: 'inside the US fall-back repeat' },
    { code: 'IN_THE_PAST', raw: '2026-03-04T14:00:00Z', why: 'an hour before now' },
    { code: 'BELOW_MIN_LEAD_TIME', raw: '2026-03-04T15:29:00Z', why: '29 minutes out, minimum is 30' },
    { code: 'BEYOND_HORIZON', raw: '2027-06-01T15:00:00Z', why: 'further out than 180 days' },
    { code: 'OUTSIDE_BUSINESS_HOURS', raw: '2026-03-07T10:00', why: 'a Saturday' },
    { code: 'CONFLICT_WITH_BUSY_INTERVAL', raw: '2026-03-05T14:30', why: 'overlaps a seeded busy interval' },
    {
      code: 'POLICY_VIOLATION',
      raw: 'tomorrow at 2pm',
      calendarConnectionId: 'calendar-connection-that-does-not-exist',
      why: 'no calendar to check availability against',
    },
  ];

  it.each(cases)('refuses with $code ($why) and writes no domain row', async (testCase) => {
    const before = await harness.counts();
    expect(before).toEqual(ZERO_DOMAIN_ROWS);

    const correlationId = `corr_${testCase.code}`;
    const result = await harness.meetings.schedule({
      organizationId: harness.fixtures.organization.id,
      contactId: testCase.contactId ?? harness.fixtures.contact.id,
      agentConfigurationId: harness.fixtures.agentConfiguration.id,
      proposal: { raw: testCase.raw, ...(testCase.timezone ? { timezone: testCase.timezone } : {}) },
      title: 'Discovery call',
      correlationId,
      ...(testCase.calendarConnectionId ? { calendarConnectionId: testCase.calendarConnectionId } : {}),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    expect(result.code).toBe(testCase.code);
    expect(result.reason.length).toBeGreaterThan(0);

    // NOTHING was written, and no external system was touched.
    expect(await harness.counts()).toEqual(ZERO_DOMAIN_ROWS);
    expect(harness.calendar.eventCount).toBe(0);
    expect(harness.telephony.placedCalls).toHaveLength(0);

    // But the refusal itself IS explained.
    const chain = await harness.db.audit.listByCorrelationId(correlationId);
    expect(chain.map((event) => event.type)).toEqual(['VALIDATION_REJECTED']);
    const detail = JSON.parse(chain[0]?.detailJson ?? '{}');
    expect(detail.code).toBe(testCase.code);
    expect(detail.provenance.checks.length).toBeGreaterThan(0);
    expect(detail.provenance.checks.at(-1).passed).toBe(false);
  });

  it('accepts a slot that is merely ADJACENT to a busy interval', async () => {
    const result = await harness.meetings.schedule({
      organizationId: harness.fixtures.organization.id,
      contactId: harness.fixtures.contact.id,
      agentConfigurationId: harness.fixtures.agentConfiguration.id,
      // 15:00-15:30 New York: starts exactly when the busy block ends.
      proposal: { raw: '2026-03-05T15:00' },
      title: 'Discovery call',
      correlationId: 'corr_adjacent',
    });
    expect(result.ok).toBe(true);
    expect(await harness.counts()).toMatchObject({ meetings: 1 });
  });
});

describe('MeetingSchedulingService - idempotency', () => {
  let harness: SchedulingHarness;

  beforeEach(async () => {
    harness = await createSchedulingHarness({ label: 'meeting-idempotent' });
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  const input = (correlationId: string) => ({
    organizationId: harness.fixtures.organization.id,
    contactId: harness.fixtures.contact.id,
    agentConfigurationId: harness.fixtures.agentConfiguration.id,
    proposal: { raw: 'tomorrow afternoon at 3' },
    title: 'Discovery call',
    idempotencyKey: 'tool-call-abc',
    correlationId,
  });

  it('returns the existing meeting rather than creating a duplicate', async () => {
    const first = await harness.meetings.schedule(input('corr_1'));
    const second = await harness.meetings.schedule(input('corr_2'));

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('unreachable');

    expect(second.value.meeting.id).toBe(first.value.meeting.id);
    expect(second.value.reusedExisting).toBe(true);
    expect(await harness.counts()).toMatchObject({ meetings: 1 });
    expect(harness.calendar.eventCount).toBe(1);

    // The replay wrote no new audit events either.
    expect(await harness.db.audit.listByCorrelationId('corr_2')).toEqual([]);
  });

  it('survives two concurrent attempts with the same key', async () => {
    const [a, b] = await Promise.all([harness.meetings.schedule(input('corr_a')), harness.meetings.schedule(input('corr_b'))]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error('unreachable');
    expect(a.value.meeting.id).toBe(b.value.meeting.id);
    expect(await harness.counts()).toMatchObject({ meetings: 1 });
  });

  it('still creates separate meetings for different keys', async () => {
    await harness.meetings.schedule({ ...input('corr_x'), idempotencyKey: 'key-1' });
    await harness.meetings.schedule({
      ...input('corr_y'),
      idempotencyKey: 'key-2',
      proposal: { raw: 'tomorrow morning at 10' },
    });
    expect(await harness.counts()).toMatchObject({ meetings: 2 });
  });
});

describe('MeetingSchedulingService - reschedule and cancel', () => {
  let harness: SchedulingHarness;

  beforeEach(async () => {
    harness = await createSchedulingHarness({ label: 'meeting-lifecycle' });
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  async function scheduleOne() {
    const result = await harness.meetings.schedule({
      organizationId: harness.fixtures.organization.id,
      contactId: harness.fixtures.contact.id,
      agentConfigurationId: harness.fixtures.agentConfiguration.id,
      proposal: { raw: 'tomorrow afternoon at 3' },
      title: 'Discovery call',
      correlationId: 'corr_create',
    });
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  }

  it('reschedules with the same validate-then-persist discipline', async () => {
    const { meeting } = await scheduleOne();

    const result = await harness.meetings.reschedule({
      meetingId: meeting.id,
      agentConfigurationId: harness.fixtures.agentConfiguration.id,
      proposal: { raw: 'next tuesday at 2pm' },
      correlationId: 'corr_reschedule',
      reason: 'contact asked to move it',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    // Tuesday 2026-03-10 14:00 New York is EDT (-04:00) - the DST change
    // between the two dates has to move the instant, not the wall clock.
    expect(result.value.meeting.startUtc).toBe('2026-03-10T18:00:00.000Z');
    expect(result.value.meeting.status).toBe('RESCHEDULED');
    expect(await harness.counts()).toMatchObject({ meetings: 1 });

    const fresh = parseValidationProvenance(result.value.meeting.validationProvenanceJson);
    expect(fresh.rawProposedValue).toBe('next tuesday at 2pm');

    const chain = await harness.db.audit.listByCorrelationId('corr_reschedule');
    expect(chain.map((event) => event.type)).toEqual([
      'TOOL_CALL_VALIDATED',
      'ENTITY_PERSISTED',
      'PROVIDER_INVOKED',
    ]);

    // The calendar was moved, not duplicated.
    expect(harness.calendar.eventCount).toBe(1);
    expect(harness.calendar.findEvent(meeting.externalCalendarEventId ?? '')?.startUtc).toBe(
      '2026-03-10T18:00:00.000Z',
    );
  });

  it('refuses an invalid reschedule and leaves the meeting exactly as it was', async () => {
    const { meeting } = await scheduleOne();

    const result = await harness.meetings.reschedule({
      meetingId: meeting.id,
      agentConfigurationId: harness.fixtures.agentConfiguration.id,
      proposal: { raw: '2026-03-07T10:00' }, // Saturday
      correlationId: 'corr_bad_reschedule',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('OUTSIDE_BUSINESS_HOURS');

    const unchanged = await harness.db.meetings.requireById(meeting.id);
    expect(unchanged.startUtc).toBe(meeting.startUtc);
    expect(unchanged.status).toBe('SCHEDULED');
    expect(unchanged.validationProvenanceJson).toBe(meeting.validationProvenanceJson);

    const chain = await harness.db.audit.listByCorrelationId('corr_bad_reschedule');
    expect(chain.map((event) => event.type)).toEqual(['VALIDATION_REJECTED']);
  });

  it('cancels, cancels the calendar event, and is idempotent', async () => {
    const { meeting } = await scheduleOne();

    const first = await harness.meetings.cancel({
      meetingId: meeting.id,
      correlationId: 'corr_cancel',
      reason: 'contact no longer interested',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.reason);
    expect(first.value.meeting.status).toBe('CANCELLED');
    expect(harness.calendar.findEvent(meeting.externalCalendarEventId ?? '')?.status).toBe('CANCELLED');

    const second = await harness.meetings.cancel({ meetingId: meeting.id, correlationId: 'corr_cancel_again' });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('unreachable');
    expect(second.value.reusedExisting).toBe(true);
    expect(await harness.db.audit.listByCorrelationId('corr_cancel_again')).toEqual([]);
    expect(harness.calendar.findEvent(meeting.externalCalendarEventId ?? '')?.cancelCalls).toBe(1);
  });

  it('refuses to reschedule a cancelled meeting', async () => {
    const { meeting } = await scheduleOne();
    await harness.meetings.cancel({ meetingId: meeting.id, correlationId: 'corr_c' });

    const result = await harness.meetings.reschedule({
      meetingId: meeting.id,
      agentConfigurationId: harness.fixtures.agentConfiguration.id,
      proposal: { raw: 'next tuesday at 2pm' },
      correlationId: 'corr_r',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('POLICY_VIOLATION');
  });
});
