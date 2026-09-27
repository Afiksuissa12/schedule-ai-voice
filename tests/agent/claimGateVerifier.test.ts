/**
 * The verifier: text plus a ledger snapshot, in; supported and unsupported
 * claims, out.
 *
 * Pure, so the ledger here is written by hand. That is deliberate rather than
 * lazy: a hand-written ledger lets each test state exactly one thing about the
 * world and then assert exactly one verdict, which is how the WRONG-DAY and
 * WRONG-TIME rules get pinned without a database in the way.
 * `tests/agent/claimGateLedger.test.ts` covers the other half - that a ledger
 * built from real tool outcomes and real rows says what these literals say.
 */
import { describe, expect, it } from 'vitest';

import type { ActionLedger, LedgerEffect } from '../../src/agent/claimGate/ledger.js';
import { verifyClaims } from '../../src/agent/claimGate/verifier.js';
import { DEFAULT_DAY_PARTS } from '../../src/scheduling/policy.js';
import type { IsoUtcString } from '../../src/ports/clock.js';

/** Wednesday 2026-03-04, 10:00 America/New_York - the suite-wide instant. */
const NOW_UTC = '2026-03-04T15:00:00.000Z' as IsoUtcString;
const ZONE = 'America/New_York';

/** Thursday 2026-03-05 at 15:00 New York. "tomorrow afternoon at 3". */
function tomorrowAtThree(kind: LedgerEffect['kind'] = 'CALLBACK_SCHEDULED'): LedgerEffect {
  return {
    kind,
    source: 'TOOL_OUTCOME',
    toolName: 'schedule_followup',
    toolCallId: 'call-1',
    entity: { type: 'FUTURE_ACTION', id: 'fa_real_1' },
    startUtc: '2026-03-05T20:00:00.000Z' as IsoUtcString,
    agreedTimezone: ZONE,
    localTime: {
      local: '2026-03-05 15:00',
      isoWeekday: 4,
      year: 2026,
      month: 3,
      day: 5,
      hour: 15,
      minute: 0,
      timezone: ZONE,
    },
    status: 'PENDING',
    title: 'CALL_CONTACT',
  };
}

function ledger(overrides: Partial<ActionLedger> = {}): ActionLedger {
  return {
    conversationId: 'conv_1',
    contactId: 'contact_1',
    contactTimezone: ZONE,
    nowUtc: NOW_UTC,
    effects: [],
    refusals: [],
    identifiers: [{ value: 'contact_1', kind: 'CONTACT', source: 'DURABLE_ROW' }],
    permittedToolNames: ['schedule_followup', 'schedule_meeting', 'transfer_to_human'],
    dayParts: DEFAULT_DAY_PARTS,
    ...overrides,
  };
}

const reasonsFor = (text: string, snapshot: ActionLedger): string[] =>
  verifyClaims({ text, ledger: snapshot }).unsupported.map((entry) => entry.reason);

describe('a claim with nothing behind it', () => {
  it('is NO_MATCHING_EFFECT when no tool ran at all', () => {
    expect(reasonsFor("I've booked the callback for 3pm on your local time.", ledger())).toContain(
      'NO_MATCHING_EFFECT',
    );
  });

  it('is EFFECT_WAS_REFUSED when the tool ran and was refused, and carries the code', () => {
    const snapshot = ledger({
      refusals: [
        {
          toolName: 'schedule_followup',
          toolCallId: 'call-1',
          code: 'OUTSIDE_BUSINESS_HOURS',
          reason: 'tomorrow at 6am is outside 09:00-17:00.',
        },
      ],
    });
    const verification = verifyClaims({ text: "I've booked the callback.", ledger: snapshot });
    expect(verification.unsupported[0]?.reason).toBe('EFFECT_WAS_REFUSED');
    expect(verification.unsupported[0]?.detail.refusal?.code).toBe('OUTSIDE_BUSINESS_HOURS');
  });

  it('is NO_TOOL_FOR_PROMISE for an email, because no tool in this system sends one', () => {
    expect(reasonsFor('I will email you a confirmation.', ledger({ effects: [tomorrowAtThree()] }))).toEqual([
      'NO_TOOL_FOR_PROMISE',
    ]);
    expect(reasonsFor('אשלח לך אישור בדוא"ל.', ledger({ effects: [tomorrowAtThree()] }))).toEqual([
      'NO_TOOL_FOR_PROMISE',
    ]);
  });

  it('is INVENTED_IDENTIFIER for a reference the system never issued', () => {
    const verification = verifyClaims({
      text: 'The confirmation number for this callback is CONF123456.',
      ledger: ledger({ effects: [tomorrowAtThree()] }),
    });
    expect(verification.unsupported.map((entry) => entry.reason)).toContain('INVENTED_IDENTIFIER');
    expect(verification.unsupported[0]?.detail.invalidIdentifier).toBe('conf123456');
  });

  it('is not INVENTED_IDENTIFIER when the identifier really was issued', () => {
    const snapshot = ledger({
      effects: [tomorrowAtThree()],
      identifiers: [
        { value: 'contact_1', kind: 'CONTACT', source: 'DURABLE_ROW' },
        { value: 'fa_real_1', kind: 'FUTURE_ACTION', source: 'TOOL_OUTCOME' },
      ],
    });
    expect(reasonsFor('The reference is fa_real_1.', snapshot)).toEqual([]);
  });

  it('refuses a promised confirmation number even with no identifier-shaped token beside it', () => {
    expect(reasonsFor('Your confirmation number is on its way.', ledger())).toEqual(['NO_MATCHING_EFFECT']);
  });
});

describe('a claim about the wrong day or the wrong time, when a real effect exists', () => {
  const withCallback = ledger({ effects: [tomorrowAtThree()] });

  it('passes when the day and the time both agree', () => {
    expect(
      reasonsFor(
        "You're all set - I'll ring you tomorrow, Thursday the 5th, at 3 in the afternoon your time.",
        withCallback,
      ),
    ).toEqual([]);
  });

  it('is WRONG_DAY for the wrong weekday', () => {
    expect(reasonsFor("I'll call you on Friday at 3 in the afternoon.", withCallback)).toEqual(['WRONG_DAY']);
  });

  it('is WRONG_DAY for the wrong relative anchor, resolved against the turn pinned now', () => {
    expect(reasonsFor("I'll call you today at 3 in the afternoon.", withCallback)).toEqual(['WRONG_DAY']);
  });

  it('is WRONG_DAY for the wrong day of the month', () => {
    expect(reasonsFor("I'll call you on the 6th at 3 in the afternoon.", withCallback)).toEqual(['WRONG_DAY']);
  });

  it('is WRONG_TIME for the wrong clock time', () => {
    expect(reasonsFor("I'll ring you tomorrow at 4pm.", withCallback)).toEqual(['WRONG_TIME']);
  });

  it('is WRONG_TIME for the wrong day part', () => {
    expect(reasonsFor("I'll ring you tomorrow in the morning.", withCallback)).toEqual(['WRONG_TIME']);
  });

  it('accepts a bare 12-hour reading, because that is how a person says 15:00', () => {
    expect(reasonsFor("I'll ring you tomorrow at 3.", withCallback)).toEqual([]);
  });

  it('reports the wrong DAY ahead of the wrong time when both are wrong', () => {
    expect(reasonsFor("I'll ring you on Monday at 9 in the morning.", withCallback)).toEqual(['WRONG_DAY']);
  });

  it('records both the asserted and the recorded local time, for the audit trail', () => {
    const verification = verifyClaims({ text: "I'll ring you tomorrow at 4pm.", ledger: withCallback });
    expect(verification.unsupported[0]?.detail.recordedLocal).toBe('2026-03-05 15:00 America/New_York');
    expect(verification.unsupported[0]?.detail.assertedLocal).toContain('4pm');
  });

  it('is supported when ANY of several effects agrees', () => {
    const second: LedgerEffect = {
      ...tomorrowAtThree('MEETING_SCHEDULED'),
      entity: { type: 'MEETING', id: 'm_2' },
      localTime: {
        local: '2026-03-06 10:00',
        isoWeekday: 5,
        year: 2026,
        month: 3,
        day: 6,
        hour: 10,
        minute: 0,
        timezone: ZONE,
      },
    };
    const snapshot = ledger({ effects: [tomorrowAtThree('MEETING_SCHEDULED'), second] });
    expect(reasonsFor('The meeting is booked for Friday at 10 in the morning.', snapshot)).toEqual([]);
  });
});

describe('what satisfies an unnamed completion', () => {
  it('a state-changing effect does', () => {
    expect(reasonsFor("You're all set.", ledger({ effects: [tomorrowAtThree()] }))).toEqual([]);
  });

  it('an availability check does NOT, because it books nothing', () => {
    const check: LedgerEffect = {
      ...tomorrowAtThree('AVAILABILITY_CHECKED'),
      toolName: 'check_availability',
      entity: null,
    };
    expect(reasonsFor("You're all set.", ledger({ effects: [check] }))).toEqual(['NO_MATCHING_EFFECT']);
  });

  it('and a handover Task satisfies a handover promise but not a callback promise', () => {
    const handover: LedgerEffect = {
      kind: 'HUMAN_HANDOVER_REQUESTED',
      source: 'TOOL_OUTCOME',
      toolName: 'transfer_to_human',
      toolCallId: 'call-9',
      entity: { type: 'TASK', id: 'task_1' },
      startUtc: null,
      agreedTimezone: null,
      localTime: null,
      status: 'OPEN',
      title: 'handover',
    };
    const snapshot = ledger({ effects: [handover] });
    expect(reasonsFor('A colleague will get back to you.', snapshot)).toEqual([]);
    expect(reasonsFor('I will call you tomorrow at 3.', snapshot)).toEqual(['NO_MATCHING_EFFECT']);
  });
});

describe('fail-safe: an effect with no instant cannot confirm a day', () => {
  it('so a day named against a recorded outcome is unsupported rather than assumed', () => {
    const recorded: LedgerEffect = {
      kind: 'CALL_OUTCOME_RECORDED',
      source: 'TOOL_OUTCOME',
      toolName: 'record_call_outcome',
      toolCallId: 'call-3',
      entity: { type: 'CALL_OUTCOME', id: 'co_1' },
      startUtc: null,
      agreedTimezone: null,
      localTime: null,
      status: 'CONNECTED',
      title: null,
    };
    expect(reasonsFor('That is recorded for Thursday at 3pm.', ledger({ effects: [recorded] }))).toEqual([
      'WRONG_DAY',
    ]);
  });
});
