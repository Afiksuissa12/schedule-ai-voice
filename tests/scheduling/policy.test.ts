/**
 * Policy comes from the PERSISTED AgentConfiguration row.
 *
 * The mission is explicit that business hours, minimum lead time, the
 * scheduling horizon and the day-part windows must be read from the pinned
 * configuration, never hardcoded at a call site and never taken from the model.
 * This file proves it by CHANGING the row and watching the verdict change,
 * which is the only assertion that cannot be satisfied by a constant.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { weekdayBusinessHours } from '../../src/domain/businessHours.js';
import { stringifyJson } from '../../src/shared/json.js';
import {
  DEFAULT_DAY_PARTS,
  DEFAULT_MEETING_DURATION_MINUTES,
  schedulingPolicyFromAgentConfiguration,
} from '../../src/scheduling/policy.js';
import { createSchedulingHarness, type SchedulingHarness } from './support.js';

let harness: SchedulingHarness | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

const scheduleWith = async (current: SchedulingHarness, raw: string, correlationId: string) =>
  current.meetings.schedule({
    organizationId: current.fixtures.organization.id,
    contactId: current.fixtures.contact.id,
    agentConfigurationId: current.fixtures.agentConfiguration.id,
    proposal: { raw },
    title: 'Discovery call',
    correlationId,
  });

describe('schedulingPolicyFromAgentConfiguration', () => {
  it('reads the foundation\'s BusinessHoursPolicy unchanged', async () => {
    harness = await createSchedulingHarness({ label: 'policy-read' });
    const policy = schedulingPolicyFromAgentConfiguration(harness.fixtures.agentConfiguration);

    expect(policy.businessHours.windows).toHaveLength(5);
    expect(policy.businessHours.windows[0]).toEqual({ isoWeekday: 1, startLocal: '09:00', endLocal: '17:00' });
    expect(policy.minLeadTimeMinutes).toBe(30);
    expect(policy.maxSchedulingHorizonDays).toBe(180);
    expect(policy.agentConfigurationId).toBe(harness.fixtures.agentConfiguration.id);
    expect(policy.agentConfigurationVersion).toBe(1);
  });

  it('supplies the documented day-part defaults when the row does not override them', async () => {
    harness = await createSchedulingHarness({ label: 'policy-defaults' });
    const policy = schedulingPolicyFromAgentConfiguration(harness.fixtures.agentConfiguration);

    expect(policy.dayParts).toEqual(DEFAULT_DAY_PARTS);
    expect(policy.defaultMeetingDurationMinutes).toBe(DEFAULT_MEETING_DURATION_MINUTES);
  });

  it('refuses a configuration it cannot interpret rather than defaulting around it', async () => {
    harness = await createSchedulingHarness({ label: 'policy-corrupt' });
    expect(() =>
      schedulingPolicyFromAgentConfiguration({
        ...harness!.fixtures.agentConfiguration,
        businessHoursJson: '{"windows":"not-an-array"}',
      }),
    ).toThrow(/does not match its schema/);
  });
});

describe('the persisted row actually drives the verdict', () => {
  it('changes the business-hours answer when the row changes', async () => {
    harness = await createSchedulingHarness({
      label: 'policy-hours',
      seed: { businessHoursStartLocal: '09:00', businessHoursEndLocal: '12:00' },
    });

    // 15:00 New York is inside the default 09:00-17:00 but outside this row's
    // 09:00-12:00. Nothing in the call site changed - only the database did.
    const result = await scheduleWith(harness, 'tomorrow afternoon at 3', 'corr_hours');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OUTSIDE_BUSINESS_HOURS');

    const morning = await scheduleWith(harness, 'tomorrow morning at 10', 'corr_hours_ok');
    expect(morning.ok).toBe(true);
  });

  it('changes the lead-time and horizon answers when the row changes', async () => {
    harness = await createSchedulingHarness({
      label: 'policy-limits',
      seed: { minLeadTimeMinutes: 24 * 60, maxSchedulingHorizonDays: 3 },
    });

    // Tomorrow at 15:00 local is ~29 hours out: fine for a 24-hour lead time.
    expect((await scheduleWith(harness, 'tomorrow afternoon at 3', 'corr_a')).ok).toBe(true);

    // Today at 15:00 local is 5 hours out: below it.
    const tooSoon = await scheduleWith(harness, 'today at 3pm', 'corr_b');
    expect(tooSoon.ok).toBe(false);
    if (!tooSoon.ok) expect(tooSoon.code).toBe('BELOW_MIN_LEAD_TIME');

    // Next Tuesday is six days out: beyond a three-day horizon.
    const tooFar = await scheduleWith(harness, 'next tuesday at 2pm', 'corr_c');
    expect(tooFar.ok).toBe(false);
    if (!tooFar.ok) expect(tooFar.code).toBe('BEYOND_HORIZON');
  });

  it('lets the row redefine what "afternoon" means', async () => {
    harness = await createSchedulingHarness({ label: 'policy-dayparts' });

    // Write day-part windows alongside the business hours, which is where an
    // AgentConfiguration carries them.
    const configuration = await harness.db.agentConfigurations.create({
      aiAgentId: harness.fixtures.aiAgent.id,
      version: 2,
      systemPromptRef: 'sales-scheduler@v1',
      businessHoursJson: stringifyJson({
        ...weekdayBusinessHours('09:00', '17:00'),
        dayParts: {
          ...DEFAULT_DAY_PARTS,
          // A shop where "afternoon" starts after a late lunch.
          afternoon: { startLocal: '14:00', endLocal: '17:00', preferredLocal: '15:30' },
        },
        defaultMeetingDurationMinutes: 45,
      }),
      defaultTimezone: 'America/New_York',
      minLeadTimeMinutes: 30,
      maxSchedulingHorizonDays: 180,
      allowedToolsJson: stringifyJson(['schedule_meeting']),
    });

    const policy = schedulingPolicyFromAgentConfiguration(configuration);
    expect(policy.dayParts.afternoon).toEqual({
      startLocal: '14:00',
      endLocal: '17:00',
      preferredLocal: '15:30',
    });
    expect(policy.defaultMeetingDurationMinutes).toBe(45);

    // "tomorrow afternoon" now means 15:30, and the slot is 45 minutes long.
    const result = await harness.meetings.schedule({
      organizationId: harness.fixtures.organization.id,
      contactId: harness.fixtures.contact.id,
      agentConfigurationId: configuration.id,
      proposal: { raw: 'tomorrow afternoon' },
      title: 'Discovery call',
      correlationId: 'corr_dayparts',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.slot.startLocal).toBe('2026-03-05T15:30');
    expect(result.value.slot.durationMinutes).toBe(45);
    expect(result.value.meeting.endUtc).toBe('2026-03-05T21:15:00.000Z');

    // And "afternoon at 3" is now a contradiction, because 15:00 is still in
    // this shop's afternoon window... but "afternoon at 1" is not.
    const one = await harness.meetings.schedule({
      organizationId: harness.fixtures.organization.id,
      contactId: harness.fixtures.contact.id,
      agentConfigurationId: configuration.id,
      proposal: { raw: 'tomorrow afternoon at 1' },
      title: 'Discovery call',
      correlationId: 'corr_dayparts_one',
    });
    expect(one.ok).toBe(false);
    if (!one.ok) {
      expect(one.code).toBe('INVALID_FORMAT');
      expect(one.reason).toMatch(/14:00-17:00/);
    }
  });

  it('keeps the foundation\'s own parse path working with the extra keys present', async () => {
    // The extra scheduling keys must not break anything that reads the same
    // column with the foundation's BusinessHoursPolicySchema, which strips them.
    const { BusinessHoursPolicySchema } = await import('../../src/domain/businessHours.js');
    const withExtras = {
      ...weekdayBusinessHours('09:00', '17:00'),
      dayParts: DEFAULT_DAY_PARTS,
      defaultMeetingDurationMinutes: 45,
    };
    const parsed = BusinessHoursPolicySchema.parse(withExtras);
    expect(parsed.windows).toHaveLength(5);
    expect(parsed).not.toHaveProperty('dayParts');
    expect(parsed).not.toHaveProperty('defaultMeetingDurationMinutes');
  });
});
