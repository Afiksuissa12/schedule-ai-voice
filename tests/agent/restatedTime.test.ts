/**
 * A day or a time RESTATED in a sentence with no booking wording must still agree
 * with the persisted effect. `detector.ts` (`appendRestatedTimes`), hosted-demo
 * safety fix.
 *
 * The production reply that motivated it, verbatim, is the first case: the first
 * sentence was checked against the saved 10:00 meeting, the second sentence told
 * the contact 11:00, and nothing read it.
 *
 * Every case runs detection -> union (with the semantic verdict shaped as the
 * hosted model returned it) -> reconciliation against persisted effects. A reply is
 * released only when every claim in it is supported.
 */
import { describe, expect, it } from 'vitest';

import { detectMaterialClaims, RESTATED_TIME_FORM } from '../../src/agent/claimGate/detector.js';
import type { ActionLedger, LedgerEffect } from '../../src/agent/claimGate/ledger.js';
import { unionClaims } from '../../src/agent/claimGate/semantic/union.js';
import { verifyClaims } from '../../src/agent/claimGate/verifier.js';
import type { SemanticClaim } from '../../src/ports/claimVerifier.js';
import type { IsoUtcString } from '../../src/ports/clock.js';
import { DEFAULT_DAY_PARTS } from '../../src/scheduling/policy.js';

/** Wednesday 4 March 2026, so `Friday` is 6 March. */
const NOW_UTC = '2026-03-04T15:00:00.000Z' as IsoUtcString;
const ZONE = 'America/New_York';

function local(hour: number) {
  return { local: `2026-03-06 ${String(hour).padStart(2, '0')}:00`, isoWeekday: 5, year: 2026, month: 3, day: 6, hour, minute: 0, timezone: ZONE };
}

/** Friday 6 March 2026, 10:00 America/New_York. */
const MEETING_FRIDAY_1000: LedgerEffect = {
  kind: 'MEETING_SCHEDULED',
  source: 'TOOL_OUTCOME',
  toolName: 'schedule_meeting',
  toolCallId: 'restate-call-1',
  entity: { type: 'MEETING', id: 'cmrestatemeeting00000000' },
  startUtc: '2026-03-06T15:00:00.000Z' as IsoUtcString,
  agreedTimezone: ZONE,
  localTime: local(10),
  status: 'SCHEDULED',
  title: 'Intro call - Northwind',
};

/** Friday 6 March 2026, 15:00 America/New_York. */
const CALLBACK_FRIDAY_1500: LedgerEffect = {
  kind: 'CALLBACK_SCHEDULED',
  source: 'TOOL_OUTCOME',
  toolName: 'schedule_followup',
  toolCallId: 'restate-call-2',
  entity: { type: 'FUTURE_ACTION', id: 'cmrestatefutureaction000' },
  startUtc: '2026-03-06T20:00:00.000Z' as IsoUtcString,
  agreedTimezone: ZONE,
  localTime: local(15),
  status: 'PENDING',
  title: 'CALLBACK',
};

function ledger(effects: readonly LedgerEffect[]): ActionLedger {
  return {
    conversationId: 'conv-restate',
    contactId: 'cmrestatecontact00000000',
    contactTimezone: ZONE,
    nowUtc: NOW_UTC,
    effects,
    refusals: [],
    identifiers: [{ value: 'cmrestatecontact00000000', kind: 'CONTACT', source: 'DURABLE_ROW' }],
    permittedToolNames: ['schedule_meeting', 'schedule_followup', 'check_availability'],
    dayParts: DEFAULT_DAY_PARTS,
  };
}

function claim(
  effectFamily: SemanticClaim['effectFamily'],
  status: SemanticClaim['status'],
  whenPhrase: string | null,
): SemanticClaim {
  return { assertsEffect: true, effectFamily, status, whenPhrase, identifier: null, confidence: 1 };
}

function gate(text: string, effects: readonly LedgerEffect[], semantic: readonly SemanticClaim[] = []) {
  const deterministic = detectMaterialClaims(text);
  const union = unionClaims({ text, deterministic, verdict: { kind: 'CLASSIFIED', claims: semantic, modelId: 'test-model' } });
  const verification = verifyClaims({ text, ledger: ledger(effects), claims: union.claims.map((entry) => entry.claim) });
  return {
    released: verification.unsupported.length === 0,
    reasons: verification.unsupported.map((entry) => entry.reason),
    restated: deterministic.filter((entry) => entry.matchedForm === RESTATED_TIME_FORM),
  };
}

const MEETING_TEN = 'The meeting is booked for Friday at 10:00 AM.';

describe('a restated time must agree with the persisted effect', () => {
  it('the production reply, verbatim: saved meeting 10:00, restated 11:00 -> BLOCK', () => {
    const text =
      'The meeting is booked for Friday, March 6 at 10:00 AM (America/New_York). To help you remember to arrive ' +
      "early, just note that it's at 11:00 AM. Is there anything else you need?";
    const result = gate(text, [MEETING_FRIDAY_1000], [claim('MEETING', 'COMPLETED', 'Friday, March 6 at 10:00 AM (America/New_York)')]);
    expect(result.restated.length).toBe(1);
    expect(result.released).toBe(false);
    expect(result.reasons).toEqual(['WRONG_TIME']);
  });

  it('1. saved meeting 10:00 + reply restates 11:00 -> BLOCK', () => {
    const result = gate(`${MEETING_TEN} Just note that it's at 11:00 AM.`, [MEETING_FRIDAY_1000]);
    expect(result.released).toBe(false);
    expect(result.reasons).toContain('WRONG_TIME');
  });

  it('2. saved meeting 10:00 + reply restates 10:00 -> PASS', () => {
    const result = gate(`${MEETING_TEN} Just note that it's at 10:00 AM.`, [MEETING_FRIDAY_1000]);
    expect(result.restated.length).toBe(1);
    expect(result.reasons).toEqual([]);
    expect(result.released).toBe(true);
  });

  it('3. saved callback 15:00 + callback restated 16:00 -> BLOCK', () => {
    const text = "I've scheduled a callback for Friday at 3 PM. Just so you know, it's at 4 PM.";
    const result = gate(text, [CALLBACK_FRIDAY_1500]);
    expect(result.released).toBe(false);
    expect(result.reasons).toEqual(['WRONG_TIME']);
  });

  it('3b. saved callback 15:00 + callback restated 15:00 -> PASS', () => {
    const text = "I've scheduled a callback for Friday at 3 PM. Just so you know, it's at 3 PM.";
    expect(gate(text, [CALLBACK_FRIDAY_1500]).released).toBe(true);
  });

  it('4. a restated MEETING time is never validated by a saved callback -> BLOCK', () => {
    const text = "The meeting is booked for Friday at 3 PM. Remember, it's at 3 PM.";
    const result = gate(text, [CALLBACK_FRIDAY_1500]);
    expect(result.released).toBe(false);
    expect(new Set(result.reasons)).toEqual(new Set(['NO_MATCHING_EFFECT']));
  });

  it('5. a restated CALLBACK time is never validated by a saved meeting -> BLOCK', () => {
    const text = "I've scheduled a callback for Friday at 10 AM. Remember, it's at 10 AM.";
    const result = gate(text, [MEETING_FRIDAY_1000]);
    expect(result.released).toBe(false);
    expect(new Set(result.reasons)).toEqual(new Set(['NO_MATCHING_EFFECT']));
  });

  it('a correction phrased as a negation is not excused: "It\'s not at 10, it\'s at 11." -> BLOCK', () => {
    const result = gate(`${MEETING_TEN} It's not at 10, it's at 11 AM.`, [MEETING_FRIDAY_1000]);
    expect(result.released).toBe(false);
  });

  it('a restated DAY must agree too: saved Friday, restated Saturday -> BLOCK', () => {
    const result = gate(`${MEETING_TEN} See you on Saturday.`, [MEETING_FRIDAY_1000]);
    expect(result.released).toBe(false);
    expect(result.reasons).toContain('WRONG_DAY');
  });

  it('no persisted effect at all -> BLOCK', () => {
    const result = gate(`${MEETING_TEN} Just note that it's at 10:00 AM.`, []);
    expect(result.released).toBe(false);
    expect(result.reasons).toContain('NO_MATCHING_EFFECT');
  });
});

describe('the Founder\'s other wordings, through the semantic layer that reads them', () => {
  // Neither first sentence has a completion form, so the deterministic layer finds no
  // claim and no restatement has an anchor. The semantic layer reports the first
  // sentence as the meeting it describes; with no deterministic reading to borrow,
  // its time is unreadable and the reply fails closed.
  for (const [text, semantic] of [
    ["Your meeting is at 10 AM. Actually, it'll be at 11.", [claim('MEETING', 'COMPLETED', '10 AM'), claim('MEETING', 'COMPLETED', '11')]],
    ["We're set for Friday at 10. The time is 11 AM.", [claim('MEETING', 'COMPLETED', 'Friday at 10'), claim('MEETING', 'COMPLETED', '11 AM')]],
  ] as const) {
    it(`${text} -> BLOCK`, () => {
      const result = gate(text, [MEETING_FRIDAY_1000], semantic);
      expect(result.released).toBe(false);
    });
  }
});

describe('numbers that are not a day or a time are never restated times', () => {
  for (const [label, sentence] of [
    ['6. a product price', 'The plan costs $11.00 per month.'],
    ['7. a quantity', 'It covers 11 users.'],
    ['8. a phone number', 'Call us on 555-0111 if anything changes.'],
    ['9. a duration', 'It will take 11 minutes.'],
    ['9b. a hyphenated duration', "It's a 30-minute call."],
  ] as const) {
    it(`${label}: "${sentence}" -> no restated claim, and the true booking is released`, () => {
      const result = gate(`${MEETING_TEN} ${sentence}`, [MEETING_FRIDAY_1000]);
      expect(result.restated).toEqual([]);
      expect(result.released).toBe(true);
    });
  }

  it('8b. an identifier-like number is not a restated time (it is judged by the identifier rules instead)', () => {
    const result = gate(`${MEETING_TEN} Your ticket is 110011.`, [MEETING_FRIDAY_1000]);
    expect(result.restated).toEqual([]);
  });

  it('a question offering another time is not a restatement', () => {
    const result = gate(`${MEETING_TEN} Would 11 work better for you?`, [MEETING_FRIDAY_1000]);
    expect(result.restated).toEqual([]);
    expect(result.released).toBe(true);
  });

  it('with no scheduling claim in the reply, a time asserts nothing new (availability offers are untouched)', () => {
    expect(detectMaterialClaims('Friday at 10:00 AM is free for 30 minutes. We also have 11 AM.')).toEqual([]);
  });
});
