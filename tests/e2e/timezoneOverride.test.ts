/**
 * THE BUSINESS-HOURS BYPASS, closed and kept closed.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------------------------------------------------------------
 * Every time-bearing tool exposes an OPTIONAL `timezone` argument the model
 * fills in. It exists for a real reason - "I'm in Denver this week" genuinely
 * changes which instant "10am" names - but it used to decide something else as
 * well: the wall-clock window the resulting instant was judged against. That
 * made the business-hours guardrail advisory. A model that wanted a New York
 * contact phoned at 23:30 did not have to ask for 23:30 and be refused; it asked
 * for a polite-sounding "10am" in Asia/Kolkata and every check, including
 * `business_hours`, recorded `passed: true`.
 *
 * The cases below are the ones an independent reviewer reproduced against the
 * real stack, re-run here through the same front door: `AgentTurnService` ->
 * `ToolDispatcher` -> `SchedulingValidator` -> the services -> SQLite, with a
 * scripted model in place of OpenAI.
 *
 * WHY THE CONTROLS MATTER AS MUCH AS THE REFUSALS
 * ---------------------------------------------------------------------------
 * A fix that refused everything would pass every "must be refused" assertion in
 * here and be useless. So each refusal is paired with a control: the same
 * mechanism, used honestly, still books. That is what distinguishes "the
 * guardrail was anchored" from "the override was broken".
 */
import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ToolOutcome } from '../../src/agent/tools/results.js';
import { ValidationProvenanceSchema } from '../../src/domain/provenance.js';
import { createSliceHarness, SLICE_NOW_UTC, type SliceHarness } from './support.js';

/** The seeded contact's persisted zone. Business hours are 09:00-17:00 weekdays. */
const CONTACT_ZONE = 'America/New_York';

let harness: SliceHarness;

beforeAll(async () => {
  harness = await createSliceHarness({ label: 'e2e-timezone-override' });
});

afterAll(async () => {
  await harness?.cleanup();
});

/**
 * Drive one tool call through the whole runtime and hand back its outcome.
 *
 * A fresh conversation each time, so the derived idempotency keys cannot collide
 * between cases and every turn owns its own audit chain.
 */
async function dispatch(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ outcome: ToolOutcome; correlationId: string }> {
  const conversation = await harness.startConversation();
  harness.llm.setScript([
    {
      assistantText: 'Let me sort that out.',
      toolCalls: [
        {
          toolCallId: `tz-${toolName}-${Object.values(args).join('-')}`,
          toolName,
          argumentsJson: JSON.stringify({ ...args, contact_id: harness.world.contact.id }),
        },
      ],
    },
  ]);

  const result = await harness.runtime.agent.handleTurn({
    conversationId: conversation.id,
    utterance: 'Could you set that up?',
  });

  const outcome = result.toolOutcomes[0];
  if (outcome === undefined) throw new Error('the scripted turn produced no tool outcome');
  return { outcome, correlationId: result.correlationId };
}

/** What a persisted instant reads as on the CONTACT'S own clock. */
function inContactZone(instantUtc: string): string {
  return DateTime.fromISO(instantUtc, { zone: CONTACT_ZONE }).toFormat('yyyy-LL-dd HH:mm');
}

describe('a model-supplied timezone cannot move the business-hours window', () => {
  it('refuses the callback that reaches 23:30 contact-local through an asserted zone', async () => {
    // 10:00 Asia/Kolkata on 2026-03-05 is 04:30Z, which is 2026-03-04 23:30 in
    // New York. Reviewer's reproduction, verbatim.
    const before = await harness.countDomainRows();
    const { outcome } = await dispatch('schedule_followup', {
      when: 'tomorrow at 10am',
      timezone: 'Asia/Kolkata',
      reason: 'agreed callback',
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.code).toBe('OUTSIDE_BUSINESS_HOURS');
    // The refusal names the contact's own wall clock, not the asserted one.
    expect(outcome.ok ? '' : outcome.reason).toMatch(/23:30/);
    expect(await harness.countDomainRows()).toEqual(before);
  });

  it('refuses the midnight meeting that reaches 00:00 contact-local the same way', async () => {
    // 14:00 Asia/Tokyo on 2026-03-06 is 05:00Z = 2026-03-06 00:00 New York.
    const before = await harness.countDomainRows();
    const { outcome } = await dispatch('schedule_meeting', {
      when: '2026-03-06T14:00',
      timezone: 'Asia/Tokyo',
      title: 'Intro call',
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.code).toBe('OUTSIDE_BUSINESS_HOURS');
    expect(await harness.countDomainRows()).toEqual(before);
  });

  it('refuses it identically whether the harmful time is asked for plainly or through a zone', async () => {
    // THE CONTROL PAIR. Asking for 23:30 outright was already refused before this
    // fix; asking for the same INSTANT through an asserted zone was not. Both
    // must now come back with the same code.
    const plainly = await dispatch('schedule_followup', {
      when: 'today at 11:30pm',
      reason: 'agreed callback',
    });
    const throughAZone = await dispatch('schedule_followup', {
      when: 'tomorrow at 10am',
      timezone: 'Asia/Kolkata',
      reason: 'agreed callback',
    });

    expect(plainly.outcome.ok).toBe(false);
    expect(throughAZone.outcome.ok).toBe(false);
    expect(plainly.outcome.ok ? '' : plainly.outcome.code).toBe(
      throughAZone.outcome.ok ? '' : throughAZone.outcome.code,
    );
  });

  it('still honours an override that names a real instant inside the contact\'s hours', async () => {
    // THE CONTROL. 10:00 America/Denver is 12:00 New York, comfortably inside
    // 09:00-17:00 - so the travelling contact is still served, the slot is stored
    // in the zone it was agreed in, and nothing about the override was "fixed"
    // by disabling it.
    const { outcome } = await dispatch('schedule_followup', {
      when: '2026-03-05T10:00',
      timezone: 'America/Denver',
      reason: 'they are in Denver this week',
    });

    expect(outcome.ok, outcome.ok ? '' : `refused with ${outcome.code}: ${outcome.reason}`).toBe(true);

    const actions = await harness.db.futureActions.listByContact(harness.world.contact.id);
    const denver = actions.find((action) => action.timezone === 'America/Denver');
    expect(denver, 'the override slot should have been persisted').toBeDefined();
    expect(denver?.scheduledForUtc).toBe('2026-03-05T17:00:00.000Z');
    // And the persisted instant sits inside business hours on the CONTACT'S
    // clock, which is the property the guardrail is actually for.
    expect(inContactZone(denver?.scheduledForUtc as string)).toBe('2026-03-05 12:00');
  });

  it('records which zone the gate was applied in, and that the model asserted another', async () => {
    const { outcome } = await dispatch('schedule_followup', {
      when: '2026-03-05T11:00',
      timezone: 'America/Denver',
      reason: 'Denver again',
    });
    expect(outcome.ok).toBe(true);

    const actions = await harness.db.futureActions.listByContact(harness.world.contact.id);
    const row = actions.find((action) => action.scheduledForUtc === '2026-03-05T18:00:00.000Z');
    expect(row, 'expected the 11:00 Denver callback to be persisted').toBeDefined();

    const provenance = ValidationProvenanceSchema.parse(JSON.parse(row?.validationProvenanceJson as string));
    expect(provenance.notes?.businessHours).toMatchObject({
      anchorTimezone: CONTACT_ZONE,
      anchorSource: 'contact',
      persistedContactTimezone: CONTACT_ZONE,
      slotTimezone: 'America/Denver',
      // The fact a reviewer wants surfaced, in as many words.
      slotTimezoneWasOverridden: true,
      startLocalInAnchorZone: '2026-03-05T13:00',
    });
  });
});

describe('the minimum lead time is compared exactly, and reported exactly', () => {
  it('refuses a shortfall of half a minute, and persists nothing', async () => {
    // `now` is 30 seconds past the minute, the target is 30 minutes past it: a
    // true lead of 29.5 minutes against a configured minimum of 30. Rounding to
    // the nearest minute let this through, and then wrote "30 min >= 30 min"
    // into the audit trail.
    harness.clock.setTo('2026-03-04T14:00:30.000Z');
    try {
      const before = await harness.countDomainRows();
      const { outcome } = await dispatch('schedule_followup', {
        when: '2026-03-04T09:30',
        reason: 'as soon as you can',
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? '' : outcome.code).toBe('BELOW_MIN_LEAD_TIME');
      expect(outcome.ok ? '' : outcome.reason).toContain('lead time 29.5 min');
      expect(await harness.countDomainRows()).toEqual(before);
    } finally {
      harness.clock.setTo(SLICE_NOW_UTC);
    }
  });

  it('accepts the same request 31 seconds later and records the true lead, not a tidy one', async () => {
    // THE CONTROL: 30.5 minutes clears a 30-minute minimum, and the receipt says
    // 30.5 - the number a reader re-running the arithmetic by hand will get.
    harness.clock.setTo('2026-03-04T13:59:30.000Z');
    try {
      const { outcome } = await dispatch('schedule_followup', {
        when: '2026-03-04T09:30',
        reason: 'shortly',
      });
      expect(outcome.ok).toBe(true);

      const actions = await harness.db.futureActions.listByContact(harness.world.contact.id);
      const row = actions.find((action) => action.scheduledForUtc === '2026-03-04T14:30:00.000Z');
      expect(row, 'expected the 09:30 callback to be persisted').toBeDefined();

      const provenance = ValidationProvenanceSchema.parse(JSON.parse(row?.validationProvenanceJson as string));
      expect(provenance.checks.find((check) => check.name === 'min_lead_time')?.detail).toBe(
        'lead time 30.5 min >= 30 min',
      );
    } finally {
      harness.clock.setTo(SLICE_NOW_UTC);
    }
  });
});
