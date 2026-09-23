/**
 * The reconciliation between the chokepoint's resolution and the service's.
 *
 * Threading `nowUtc` is what makes the two resolutions identical;
 * `assertResolutionsAgree` is what makes that a CHECKED property rather than a
 * comment. Because the first part works, the guard cannot be provoked through
 * the normal path any more - so it is exercised directly here, against a slot
 * deliberately forged to disagree. A guard nobody has ever seen fire is a guard
 * nobody knows is wired up.
 *
 * `tests/e2e/pinnedNow.test.ts` covers the other half: that the two agree in the
 * first place, against a clock that actually moves.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ResolvedSlot } from '../../src/scheduling/dateTimeResolver.js';
import { assertResolutionsAgree } from '../../src/scheduling/pinnedSlot.js';
import { InvariantViolationError } from '../../src/shared/errors.js';
import { createSchedulingHarness, ZERO_DOMAIN_ROWS, type SchedulingHarness } from './support.js';

const NOW_UTC = '2026-03-04T15:00:00.000Z';

/** "tomorrow afternoon at 3" for the New York fixture contact. */
const AGREED: ResolvedSlot = {
  startUtc: '2026-03-05T20:00:00.000Z',
  endUtc: '2026-03-05T20:30:00.000Z',
  timezone: 'America/New_York',
  startLocal: '2026-03-05T15:00',
  endLocal: '2026-03-05T15:30',
  durationMinutes: 30,
  interpretation: { source: 'ISO_INSTANT', matched: ['test'], utcOffset: '-05:00' },
};

/** The same phrase read a day later - the local-midnight failure, forged. */
const A_DAY_LATER: ResolvedSlot = {
  ...AGREED,
  startUtc: '2026-03-06T20:00:00.000Z',
  endUtc: '2026-03-06T20:30:00.000Z',
  startLocal: '2026-03-06T15:00',
  endLocal: '2026-03-06T15:30',
};

describe('assertResolutionsAgree', () => {
  it('passes when the two resolutions name the same instant', () => {
    expect(() => assertResolutionsAgree('schedule_meeting', AGREED, { ...AGREED }, NOW_UTC)).not.toThrow();
  });

  it('passes when there is no chokepoint resolution to reconcile against', () => {
    // A direct service call has pinned nothing. Nothing to check, and - the
    // point - nothing assumed either.
    expect(() => assertResolutionsAgree('schedule_meeting', undefined, AGREED, NOW_UTC)).not.toThrow();
  });

  it('refuses when the instants disagree, naming both', () => {
    let thrown: unknown;
    try {
      assertResolutionsAgree('schedule_followup', AGREED, A_DAY_LATER, NOW_UTC);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(InvariantViolationError);
    const error = thrown as InvariantViolationError;
    expect(error.message).toContain('2026-03-05T20:00:00.000Z');
    expect(error.message).toContain('2026-03-06T20:00:00.000Z');
    expect(error.details).toMatchObject({
      operation: 'schedule_followup',
      nowUtc: NOW_UTC,
      chokepointStartUtc: '2026-03-05T20:00:00.000Z',
      serviceStartUtc: '2026-03-06T20:00:00.000Z',
    });
  });

  it('refuses on a differing END even when the start agrees', () => {
    const sameStartLongerEnd: ResolvedSlot = { ...AGREED, endUtc: '2026-03-05T21:00:00.000Z', durationMinutes: 60 };
    expect(() => assertResolutionsAgree('schedule_meeting', AGREED, sameStartLongerEnd, NOW_UTC)).toThrow(
      InvariantViolationError,
    );
  });
});

describe('the services refuse rather than persist a disagreeing slot', () => {
  let harness: SchedulingHarness;

  beforeEach(async () => {
    harness = await createSchedulingHarness({ label: 'pinned-slot', nowUtc: NOW_UTC });
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it('FutureActionService: throws, and writes no domain row', async () => {
    await expect(
      harness.futureActions.schedule({
        organizationId: harness.fixtures.organization.id,
        contactId: harness.fixtures.contact.id,
        agentConfigurationId: harness.fixtures.agentConfiguration.id,
        proposal: { raw: 'tomorrow afternoon at 3' },
        correlationId: 'corr_disagree_followup',
        nowUtc: NOW_UTC,
        // What the service will actually resolve is AGREED. Hand it the other
        // one, exactly as a drifting `now` used to.
        validatedSlot: A_DAY_LATER,
      }),
    ).rejects.toThrow(InvariantViolationError);

    expect(await harness.counts()).toMatchObject(ZERO_DOMAIN_ROWS);
  });

  it('MeetingSchedulingService: throws, and writes no domain row', async () => {
    await expect(
      harness.meetings.schedule({
        organizationId: harness.fixtures.organization.id,
        contactId: harness.fixtures.contact.id,
        agentConfigurationId: harness.fixtures.agentConfiguration.id,
        proposal: { raw: 'tomorrow afternoon at 3' },
        title: 'Pricing walkthrough',
        correlationId: 'corr_disagree_meeting',
        nowUtc: NOW_UTC,
        validatedSlot: A_DAY_LATER,
      }),
    ).rejects.toThrow(InvariantViolationError);

    expect(await harness.counts()).toMatchObject(ZERO_DOMAIN_ROWS);
    // And nothing reached the calendar: the guard runs before the transaction,
    // and the provider is only touched after it commits.
    expect(harness.calendar.listEvents()).toHaveLength(0);
  });

  it('agrees - and persists - when the caller hands over the slot the service reaches', async () => {
    const result = await harness.futureActions.schedule({
      organizationId: harness.fixtures.organization.id,
      contactId: harness.fixtures.contact.id,
      agentConfigurationId: harness.fixtures.agentConfiguration.id,
      proposal: { raw: 'tomorrow afternoon at 3' },
      correlationId: 'corr_agree_followup',
      nowUtc: NOW_UTC,
      validatedSlot: AGREED,
    });

    expect(result.ok, result.ok ? '' : result.reason).toBe(true);
    if (!result.ok) return;
    expect(result.value.futureAction.scheduledForUtc).toBe(AGREED.startUtc);
    expect(result.provenance.nowUtc).toBe(NOW_UTC);
  });
});
