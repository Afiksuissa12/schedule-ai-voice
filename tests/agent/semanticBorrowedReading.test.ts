/**
 * A semantic claim may BORROW the detector's reading of its when-phrase - and
 * nothing else. `src/agent/claimGate/semantic/union.ts` (`borrowedReading`).
 *
 * Every case runs the real pipeline minus the model: `detectMaterialClaims` ->
 * `unionClaims` with a semantic verdict shaped like the ones the hosted model
 * produced -> `verifyClaims` against a hand-built ledger of PERSISTED effects. A
 * reply is released only when every claim is supported, so "released" below means
 * `unsupported` is empty.
 *
 * The first two blocks are the true confirmations the hosted demo withheld. The
 * rest are the adversarial ones: each must still be BLOCKED, and for the reason
 * named, so that a borrowed reading can never stand in for a persisted effect.
 */
import { describe, expect, it } from 'vitest';

import { detectMaterialClaims } from '../../src/agent/claimGate/detector.js';
import type { ActionLedger, LedgerEffect } from '../../src/agent/claimGate/ledger.js';
import { unionClaims } from '../../src/agent/claimGate/semantic/union.js';
import { verifyClaims } from '../../src/agent/claimGate/verifier.js';
import type { SemanticClaim } from '../../src/ports/claimVerifier.js';
import type { IsoUtcString } from '../../src/ports/clock.js';
import { DEFAULT_DAY_PARTS } from '../../src/scheduling/policy.js';

/** Wednesday 4 March 2026, so `Thursday` is 5 March. */
const NOW_UTC = '2026-03-04T15:00:00.000Z' as IsoUtcString;
const ZONE = 'America/New_York';
/** Thursday 5 March 2026, 15:00 America/New_York. */
const THURSDAY_1500_UTC = '2026-03-05T20:00:00.000Z' as IsoUtcString;

const LOCAL_THURSDAY_1500 = {
  local: '2026-03-05 15:00',
  isoWeekday: 4,
  year: 2026,
  month: 3,
  day: 5,
  hour: 15,
  minute: 0,
  timezone: ZONE,
};

const MEETING_THURSDAY_1500: LedgerEffect = {
  kind: 'MEETING_SCHEDULED',
  source: 'TOOL_OUTCOME',
  toolName: 'schedule_meeting',
  toolCallId: 'borrow-call-1',
  entity: { type: 'MEETING', id: 'cmborrowmeeting000000000' },
  startUtc: THURSDAY_1500_UTC,
  agreedTimezone: ZONE,
  localTime: LOCAL_THURSDAY_1500,
  status: 'SCHEDULED',
  title: 'Intro call - Northwind',
};

const CALLBACK_THURSDAY_1500: LedgerEffect = {
  kind: 'CALLBACK_SCHEDULED',
  source: 'TOOL_OUTCOME',
  toolName: 'schedule_followup',
  toolCallId: 'borrow-call-2',
  entity: { type: 'FUTURE_ACTION', id: 'cmborrowfutureaction0000' },
  startUtc: THURSDAY_1500_UTC,
  agreedTimezone: ZONE,
  localTime: LOCAL_THURSDAY_1500,
  status: 'PENDING',
  title: 'CALLBACK',
};

function ledger(effects: readonly LedgerEffect[]): ActionLedger {
  return {
    conversationId: 'conv-borrow',
    contactId: 'cmborrowcontact0000000000',
    contactTimezone: ZONE,
    nowUtc: NOW_UTC,
    effects,
    refusals: [],
    identifiers: [{ value: 'cmborrowcontact0000000000', kind: 'CONTACT', source: 'DURABLE_ROW' }],
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

/** The gate's pipeline without the model: both layers, then reconciliation. */
function gate(text: string, semantic: readonly SemanticClaim[], effects: readonly LedgerEffect[]) {
  const union = unionClaims({
    text,
    deterministic: detectMaterialClaims(text),
    verdict: { kind: 'CLASSIFIED', claims: semantic, modelId: 'test-model' },
  });
  const verification = verifyClaims({ text, ledger: ledger(effects), claims: union.claims.map((entry) => entry.claim) });
  return {
    union,
    released: verification.unsupported.length === 0,
    reasons: verification.unsupported.map((entry) => entry.reason),
    supported: verification.supported,
  };
}

const CALLBACK_THEN = "I've scheduled a callback for Thursday at 3 PM. I'll give you a call then.";
const CALLBACK_THEN_SEMANTIC = [claim('CALLBACK', 'COMMITTED', 'Thursday at 3 PM'), claim('CALLBACK', 'COMMITTED', 'then')];

const MEETING_ALL_SET = 'The meeting is all set for Thursday, March 5th at 3:00 PM.';
const MEETING_ALL_SET_SEMANTIC = [claim('MEETING', 'COMPLETED', 'Thursday, March 5th at 3:00 PM')];

describe('true confirmations the hosted demo withheld are now released', () => {
  it('a callback, then "I\'ll give you a call then", against the persisted callback', () => {
    const result = gate(CALLBACK_THEN, CALLBACK_THEN_SEMANTIC, [CALLBACK_THURSDAY_1500]);
    expect(result.reasons).toEqual([]);
    expect(result.released).toBe(true);
    // Every claim was matched to the CALLBACK row - nothing was waved through.
    expect(result.supported.length).toBeGreaterThanOrEqual(3);
    for (const entry of result.supported) expect(entry.matchedEffect?.kind).toBe('CALLBACK_SCHEDULED');
  });

  it('the same when the semantic layer agrees on the mode of the first claim', () => {
    const semantic = [claim('CALLBACK', 'COMPLETED', 'Thursday at 3 PM'), claim('CALLBACK', 'COMMITTED', 'then')];
    expect(gate(CALLBACK_THEN, semantic, [CALLBACK_THURSDAY_1500]).released).toBe(true);
  });

  it('a persisted meeting the detector files as ANY ("all set") and the semantic layer as MEETING', () => {
    const deterministic = detectMaterialClaims(MEETING_ALL_SET);
    expect(deterministic.map((entry) => entry.family)).toEqual(['ANY']);
    const result = gate(MEETING_ALL_SET, MEETING_ALL_SET_SEMANTIC, [MEETING_THURSDAY_1500]);
    expect(result.reasons).toEqual([]);
    expect(result.released).toBe(true);
    // The semantic claim kept its OWN family and was matched to the MEETING row.
    const semantic = result.supported.find((entry) => entry.claim.locale === 'semantic');
    expect(semantic?.claim.family).toBe('MEETING');
    expect(semantic?.matchedEffect?.kind).toBe('MEETING_SCHEDULED');
  });
});

describe('a borrowed reading never stands in for a persisted effect', () => {
  it('"then" with no earlier claim to refer to -> BLOCK', () => {
    const result = gate("Sounds good. I'll give you a call then.", [claim('CALLBACK', 'COMMITTED', 'then')], [
      CALLBACK_THURSDAY_1500,
    ]);
    expect(result.released).toBe(false);
    expect(result.reasons).toContain('UNREADABLE_WHEN');
  });

  it('"then" after a claim of a DIFFERENT effect type -> BLOCK, even with both rows persisted', () => {
    const text = "Your meeting is booked for Thursday at 3 PM. I'll give you a call then.";
    const semantic = [claim('MEETING', 'COMPLETED', 'Thursday at 3 PM'), claim('CALLBACK', 'COMMITTED', 'then')];
    const result = gate(text, semantic, [MEETING_THURSDAY_1500, CALLBACK_THURSDAY_1500]);
    expect(result.released).toBe(false);
    expect(result.reasons).toEqual(['UNREADABLE_WHEN']);
  });

  it('"then" referring to an UNVERIFIED claim (wrong time) -> BLOCK', () => {
    const text = "I've scheduled a callback for Thursday at 4 PM. I'll give you a call then.";
    const semantic = [claim('CALLBACK', 'COMMITTED', 'Thursday at 4 PM'), claim('CALLBACK', 'COMMITTED', 'then')];
    const result = gate(text, semantic, [CALLBACK_THURSDAY_1500]);
    expect(result.released).toBe(false);
    expect(result.reasons).toContain('WRONG_TIME');
  });

  it('"then" standing BEFORE the time it would refer to -> BLOCK', () => {
    const text = "Talk to you then. I've scheduled a callback for Thursday at 3 PM.";
    const semantic = [claim('CALLBACK', 'COMMITTED', 'then'), claim('CALLBACK', 'COMPLETED', 'Thursday at 3 PM')];
    const result = gate(text, semantic, [CALLBACK_THURSDAY_1500]);
    expect(result.released).toBe(false);
    expect(result.reasons).toEqual(['UNREADABLE_WHEN']);
  });

  it('callback claim when only a MEETING is persisted -> BLOCK', () => {
    const result = gate(CALLBACK_THEN, CALLBACK_THEN_SEMANTIC, [MEETING_THURSDAY_1500]);
    expect(result.released).toBe(false);
    expect(result.reasons).toContain('NO_MATCHING_EFFECT');
  });

  it('meeting claim when only a CALLBACK is persisted -> BLOCK', () => {
    const result = gate(MEETING_ALL_SET, MEETING_ALL_SET_SEMANTIC, [CALLBACK_THURSDAY_1500]);
    expect(result.released).toBe(false);
    expect(result.reasons).toEqual(['NO_MATCHING_EFFECT']);
  });

  it('the right effect on the wrong DAY -> BLOCK', () => {
    const text = 'The meeting is all set for Friday, March 6th at 3:00 PM.';
    const result = gate(text, [claim('MEETING', 'COMPLETED', 'Friday, March 6th at 3:00 PM')], [MEETING_THURSDAY_1500]);
    expect(result.released).toBe(false);
    expect(result.reasons).toContain('WRONG_DAY');
  });

  it('the right effect at the wrong TIME -> BLOCK', () => {
    const text = "I've scheduled a callback for Thursday at 5 PM. I'll give you a call then.";
    const semantic = [claim('CALLBACK', 'COMMITTED', 'Thursday at 5 PM'), claim('CALLBACK', 'COMMITTED', 'then')];
    const result = gate(text, semantic, [CALLBACK_THURSDAY_1500]);
    expect(result.released).toBe(false);
    expect(new Set(result.reasons)).toEqual(new Set(['WRONG_TIME']));
  });

  it('no persisted effect at all -> BLOCK, for both confirmations', () => {
    for (const [text, semantic] of [
      [CALLBACK_THEN, CALLBACK_THEN_SEMANTIC],
      [MEETING_ALL_SET, MEETING_ALL_SET_SEMANTIC],
    ] as const) {
      const result = gate(text, semantic, []);
      expect(result.released, text).toBe(false);
      expect(result.reasons, text).toContain('NO_MATCHING_EFFECT');
    }
  });

  it('a when-phrase the sentence does not contain borrows nothing -> BLOCK', () => {
    // The semantic layer quotes a time the text never wrote; the detector's reading
    // of the real time must not be lent to it.
    const result = gate(MEETING_ALL_SET, [claim('MEETING', 'COMPLETED', 'Friday at 3 PM')], [MEETING_THURSDAY_1500]);
    expect(result.released).toBe(false);
    expect(result.reasons).toEqual(['UNREADABLE_WHEN']);
  });

  it('the union still only grows: every deterministic claim comes out first, unchanged', () => {
    const deterministic = detectMaterialClaims(CALLBACK_THEN);
    const union = unionClaims({
      text: CALLBACK_THEN,
      deterministic,
      verdict: { kind: 'CLASSIFIED', claims: CALLBACK_THEN_SEMANTIC, modelId: 'test-model' },
    });
    deterministic.forEach((entry, index) => expect(union.claims[index]?.claim).toBe(entry));
    expect(union.claims.length).toBe(deterministic.length + CALLBACK_THEN_SEMANTIC.length);
  });
});
