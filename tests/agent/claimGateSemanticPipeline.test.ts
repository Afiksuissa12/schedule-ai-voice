/**
 * THE LAYERED PIPELINE, through the real `ClaimGate.review`.
 *
 * The Founder's order, in order, for every customer-facing text INCLUDING every
 * regenerated attempt: deterministic detect, semantic classify, union,
 * deterministic reconcile against the ledger, release or block and regenerate.
 * This file asserts that shape - and, more importantly, the four things that could
 * silently not be true about it:
 *
 *  1. the verifier runs on EVERY attempt, not only the first;
 *  2. a verifier that says a flagged text is CLEAN still BLOCKS;
 *  3. every fail-closed variant blocks, regenerates and, at the bound, withholds;
 *  4. the ledger stays LAZY - read only when the union is non-empty or the second
 *     layer failed closed.
 *
 * Hand-written ledger, no database, no model: the same discipline
 * `tests/agent/claimGateVerifier.test.ts` keeps, and for the same reason - each
 * test states one thing about the world and asserts one decision.
 */
import { describe, expect, it } from 'vitest';

import { ClaimGate, type ClaimGateAuditRecord } from '../../src/agent/claimGate/claimGate.js';
import type { ActionLedger, LedgerEffect } from '../../src/agent/claimGate/ledger.js';
import {
  ScriptedSemanticClaimVerifier,
  RuleDrivenSemanticClaimVerifier,
  classifiedWithNoClaims,
} from '../../src/agent/claimGate/semantic/doubles.js';
import { LlmSemanticClaimVerifier } from '../../src/agent/claimGate/semantic/llmSemanticClaimVerifier.js';
import { SEMANTIC_VERIFIER_INSTRUCTION_REF } from '../../src/agent/claimGate/semantic/instruction.js';
import { detectMaterialClaims } from '../../src/agent/claimGate/detector.js';
import { SEMANTIC_CLAIM_FAILURE_KINDS, type SemanticClaimVerdict } from '../../src/ports/claimVerifier.js';
import type { CompleteTurnResult, LlmProvider } from '../../src/ports/llm.js';
import type { IsoUtcString } from '../../src/ports/clock.js';
import { DEFAULT_DAY_PARTS } from '../../src/scheduling/policy.js';

/**
 * The smallest provider a REAL `LlmSemanticClaimVerifier` can be built over.
 *
 * Used by one test, which is about the audit detail the gate writes and not
 * about classification, so the answer is the empty claim list. No network: this
 * never touches `LocalLlmProvider`.
 */
class AlwaysCleanStructuredProvider implements LlmProvider {
  name(): string {
    return 'always-clean-structured-provider';
  }

  supportsStructuredOutput(): boolean {
    return true;
  }

  async completeTurn(): Promise<CompleteTurnResult> {
    return { assistantText: '{"claims":[]}', toolCalls: [] };
  }
}

const NOW_UTC = '2026-03-04T15:00:00.000Z' as IsoUtcString;
const ZONE = 'America/New_York';

/** A text the deterministic detector flags. */
const FLAGGED = 'Your meeting is booked for Thursday at 2pm.';
/**
 * QA-8 class A, the noun-possessive clitic: the wording the last independent QA
 * round drove end to end and watched leak.
 *
 * Used because it is REALISTIC, not because these tests depend on it still leaking.
 * Every review that needs the deterministic layer to find nothing passes
 * `blindDeterministic: true`, which states that condition directly - see
 * `BLIND_TO_LEXICONS`.
 */
const QA8_CLITIC = "Your meeting's booked for Thursday at 2pm.";
/** A text neither layer has anything to say about. */
const NEUTRAL = 'What time would suit you?';

/** Thursday 2026-03-05 at 14:00 New York - a real booking. */
function thursdayAtTwo(): LedgerEffect {
  return {
    kind: 'MEETING_SCHEDULED',
    source: 'TOOL_OUTCOME',
    toolName: 'schedule_meeting',
    toolCallId: 'call-1',
    entity: { type: 'MEETING', id: 'm_real_1' },
    startUtc: '2026-03-05T19:00:00.000Z' as IsoUtcString,
    agreedTimezone: ZONE,
    localTime: {
      local: '2026-03-05 14:00',
      isoWeekday: 4,
      year: 2026,
      month: 3,
      day: 5,
      hour: 14,
      minute: 0,
      timezone: ZONE,
    },
    status: 'SCHEDULED',
    title: 'Intro call',
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
    permittedToolNames: ['schedule_meeting', 'schedule_followup', 'transfer_to_human'],
    dayParts: DEFAULT_DAY_PARTS,
    ...overrides,
  };
}

/**
 * THE DETERMINISTIC LAYER, MADE PROVABLY BLIND.
 *
 * `DetectClaimsOptions.lexicons` is the gate's existing test seam - the one
 * `tests/agent/claimGateDetector.test.ts` uses to register a synthetic locale - and
 * an EMPTY lexicon set makes `detectMaterialClaims` find no completion form in any
 * language.
 *
 * WHY THIS AND NOT A TEXT THE DETECTOR HAPPENS TO MISS. Because the interesting
 * cases below are "a claim ONLY the semantic layer saw", and the obvious way to
 * build one - use the wording the last QA round watched leak - would make these
 * tests go RED the moment AUTO-DETERMINISTIC-LAYER closes that class in this same
 * mission. Red for a good thing happening is the worst kind of failing test. The
 * blind seam states the condition directly instead of borrowing a leak, and it
 * cannot rot.
 *
 * It does NOT blind the identifier rules - identifier SHAPES are regexes in the
 * engine and no lexicon gates them - so a blind review must use a text with no
 * identifier-shaped token in it. Every blind fixture below does.
 */
const BLIND_TO_LEXICONS = { lexicons: [] } as const;

/** One review, with everything recorded. */
async function review(input: {
  text: string;
  verifier: ClaimGate['semanticVerifier'];
  snapshot?: ActionLedger;
  /** Texts the model produces on each regeneration, in order. */
  regenerations?: readonly (string | null)[];
  /** Make the deterministic layer find nothing, so a claim can be semantic-only. */
  blindDeterministic?: boolean;
}) {
  const gate = new ClaimGate({
    verifier: input.verifier,
    ...(input.blindDeterministic ? { detect: BLIND_TO_LEXICONS } : {}),
  });
  const events: ClaimGateAuditRecord[] = [];
  let ledgerReads = 0;
  let regenerationCalls = 0;
  const regenerations = [...(input.regenerations ?? [])];

  const decision = await gate.review({
    text: input.text,
    correlationId: 'corr-pipeline',
    loadLedger: async () => {
      ledgerReads += 1;
      return input.snapshot ?? ledger();
    },
    regenerate: async () => {
      regenerationCalls += 1;
      return regenerations.shift() ?? null;
    },
    record: async (event) => {
      events.push(event);
    },
  });

  return { decision, events, ledgerReads, regenerationCalls };
}

const typesOf = (events: readonly ClaimGateAuditRecord[]): string[] => events.map((event) => event.kind);

describe('the verifier runs on EVERY customer-facing text, including every regenerated one', () => {
  it('is asked once for a single-attempt turn that asserts nothing', async () => {
    const verifier = new ScriptedSemanticClaimVerifier();
    const ran = await review({ text: NEUTRAL, verifier });
    expect(ran.decision.outcome).toBe('NO_MATERIAL_CLAIM');
    expect(verifier.requests).toHaveLength(1);
  });

  it('is asked again for each regenerated attempt', async () => {
    // Three attempts: the original plus two regenerations at the standing bound.
    const verifier = new ScriptedSemanticClaimVerifier();
    const ran = await review({
      text: FLAGGED,
      verifier,
      regenerations: [FLAGGED, FLAGGED],
    });
    expect(ran.decision.outcome).toBe('WITHHELD_HANDED_OFF');
    expect(ran.decision.attempts).toHaveLength(3);
    expect(verifier.requests).toHaveLength(3);
  });

  it('and is handed the TEXT and the turn correlation id, and nothing else', async () => {
    // The request TYPE already makes a ledger unrepresentable. This asserts that
    // what is actually sent is only what it should be.
    const verifier = new ScriptedSemanticClaimVerifier();
    await review({ text: FLAGGED, verifier, snapshot: ledger({ effects: [thursdayAtTwo()] }) });
    expect(verifier.requests[0]).toEqual({ text: FLAGGED, correlationId: 'corr-pipeline' });
    expect(Object.keys(verifier.requests[0] ?? {}).sort()).toEqual(['correlationId', 'text']);
  });
});

describe('a verifier saying a FLAGGED text asserts nothing still BLOCKS it', () => {
  // The single most important test in this file. The semantic layer may only ADD;
  // it must be structurally unable to clear.
  const wronglyClean: SemanticClaimVerdict = {
    kind: 'CLASSIFIED',
    claims: [
      {
        assertsEffect: false,
        effectFamily: 'MEETING',
        status: 'NOT_CLAIMED',
        whenPhrase: null,
        identifier: null,
        confidence: 1,
      },
    ],
    modelId: 'over-confident-test-model',
  };

  it('finds the deterministic layer really does flag it, so this is not vacuous', () => {
    expect(detectMaterialClaims(FLAGGED).length).toBeGreaterThan(0);
  });

  it('blocks and regenerates against an EMPTY ledger', async () => {
    const verifier = new ScriptedSemanticClaimVerifier({ script: [wronglyClean], onExhausted: wronglyClean });
    const ran = await review({ text: FLAGGED, verifier, regenerations: [NEUTRAL] });
    expect(ran.decision.outcome).toBe('CORRECTED_AFTER_REGENERATION');
    expect(ran.decision.releasedText).toBe(NEUTRAL);
    expect(ran.decision.attempts[0]?.unsupportedClaims.map((entry) => entry.reason)).toContain(
      'NO_MATCHING_EFFECT',
    );
  });

  it('and an empty CLASSIFIED list does not clear it either', async () => {
    const verifier = new ScriptedSemanticClaimVerifier({ onExhausted: classifiedWithNoClaims() });
    const ran = await review({ text: FLAGGED, verifier, regenerations: [NEUTRAL] });
    expect(ran.decision.outcome).toBe('CORRECTED_AFTER_REGENERATION');
  });

  it('and the deterministic claim is still tagged DETERMINISTIC in the layer report', async () => {
    const verifier = new ScriptedSemanticClaimVerifier({ onExhausted: wronglyClean });
    const ran = await review({ text: FLAGGED, verifier, regenerations: [NEUTRAL] });
    const layers = ran.decision.attempts[0]?.layers;
    expect(layers?.deterministicClaimCount).toBeGreaterThan(0);
    expect(layers?.semanticClaimCount).toBe(0);
    expect(layers?.sources).toContain('DETERMINISTIC');
    expect(layers?.sources).not.toContain('SEMANTIC');
  });
});

describe('a claim ONLY the semantic layer sees is blocked - the whole point of the layer', () => {
  const sawIt: SemanticClaimVerdict = {
    kind: 'CLASSIFIED',
    claims: [
      {
        assertsEffect: true,
        effectFamily: 'MEETING',
        status: 'COMPLETED',
        whenPhrase: 'Thursday at 2pm',
        identifier: null,
        confidence: 0.92,
      },
    ],
    modelId: 'test-model',
  };

  it('finds the deterministic layer really is blind here, so this block proves something', async () => {
    // Non-vacuity, stated directly rather than borrowed from a live leak class -
    // see `BLIND_TO_LEXICONS`. `QA8_CLITIC` is the wording the last independent QA
    // round watched leak and it is used below because it is realistic, not because
    // the test depends on it still leaking.
    expect(detectMaterialClaims(QA8_CLITIC, BLIND_TO_LEXICONS)).toHaveLength(0);
  });

  it('blocks it against an empty ledger, where the pre-2F gate released it', async () => {
    const verifier = new ScriptedSemanticClaimVerifier({ script: [sawIt] });
    const ran = await review({ text: QA8_CLITIC, verifier, blindDeterministic: true, regenerations: [NEUTRAL] });
    expect(ran.decision.outcome).toBe('CORRECTED_AFTER_REGENERATION');
    expect(ran.decision.releasedText).toBe(NEUTRAL);
    expect(ran.decision.attempts[0]?.unsupportedClaims.map((entry) => entry.reason)).toEqual([
      'NO_MATCHING_EFFECT',
    ]);
    expect(ran.decision.attempts[0]?.layers.sources).toEqual(['SEMANTIC']);
  });

  it('and the reconciliation that blocked it is the EXISTING one, naming an existing reason', async () => {
    // Not a second verdict invented by this layer: `NO_MATCHING_EFFECT` is one of
    // the seven ledger reasons `verifyClaims` already produced.
    const verifier = new ScriptedSemanticClaimVerifier({ script: [sawIt] });
    const ran = await review({ text: QA8_CLITIC, verifier, blindDeterministic: true, regenerations: [NEUTRAL] });
    const detail = ran.decision.attempts[0]?.unsupportedClaims[0]?.detail;
    expect(detail?.family).toBe('MEETING');
    expect(detail?.expectedEffectKinds).toContain('MEETING_SCHEDULED');
  });

  it('but the SAME claim over a ledger that supports it costs one regeneration for UNREADABLE_WHEN', async () => {
    // The documented precision cost, asserted rather than left to be discovered.
    // The semantic layer may not parse a day, so a quoted phrase becomes unread
    // temporal material and the existing § 20 rule answers it.
    const verifier = new ScriptedSemanticClaimVerifier({ script: [sawIt] });
    const ran = await review({
      text: QA8_CLITIC,
      verifier,
      blindDeterministic: true,
      snapshot: ledger({ effects: [thursdayAtTwo()] }),
      regenerations: [NEUTRAL],
    });
    expect(ran.decision.attempts[0]?.unsupportedClaims.map((entry) => entry.reason)).toEqual([
      'UNREADABLE_WHEN',
    ]);
    expect(ran.decision.outcome).toBe('CORRECTED_AFTER_REGENERATION');
  });

  it('while a semantic claim naming NO time is SUPPORTED and released byte-identical', async () => {
    const text = "Your meeting's booked.";
    const verifier = new ScriptedSemanticClaimVerifier({
      script: [
        {
          kind: 'CLASSIFIED',
          claims: [
            {
              assertsEffect: true,
              effectFamily: 'MEETING',
              status: 'COMPLETED',
              whenPhrase: null,
              identifier: null,
              confidence: 0.9,
            },
          ],
          modelId: null,
        },
      ],
    });
    const ran = await review({ text, verifier, snapshot: ledger({ effects: [thursdayAtTwo()] }) });
    expect(ran.decision.outcome).toBe('SUPPORTED');
    expect(ran.decision.releasedText).toBe(text);
    expect(ran.regenerationCalls).toBe(0);
  });
});

describe('every fail-closed variant blocks, regenerates, and withholds at the bound', () => {
  for (const kind of SEMANTIC_CLAIM_FAILURE_KINDS) {
    const failure = { kind, reason: 'for the test' } as SemanticClaimVerdict;

    it(`${kind} on a NEUTRAL text still blocks it - a failure is never clean`, async () => {
      // Deliberately the neutral text. Before this mission it would have been
      // released with no state read at all, and it must not be now: a failed
      // second layer means nobody knows what the text claimed.
      const verifier = new ScriptedSemanticClaimVerifier({ onExhausted: failure });
      const ran = await review({ text: NEUTRAL, verifier, regenerations: [NEUTRAL, NEUTRAL] });
      expect(ran.decision.outcome).toBe('WITHHELD_HANDED_OFF');
      expect(ran.decision.releasedText).toBeNull();
    });

    it(`${kind} produces the SEMANTIC_CHECK_UNAVAILABLE reason and names the variant`, async () => {
      const verifier = new ScriptedSemanticClaimVerifier({ onExhausted: failure });
      const ran = await review({ text: NEUTRAL, verifier, regenerations: [NEUTRAL, NEUTRAL] });
      const entry = ran.decision.attempts[0]?.unsupportedClaims.at(-1);
      expect(entry?.reason).toBe('SEMANTIC_CHECK_UNAVAILABLE');
      expect(entry?.detail.semanticLayer).toEqual({ outcome: kind, reason: 'for the test' });
    });

    it(`${kind} reads the ledger - a fail-closed turn is checked, not waved through`, async () => {
      const verifier = new ScriptedSemanticClaimVerifier({ onExhausted: failure });
      const ran = await review({ text: NEUTRAL, verifier, regenerations: [NEUTRAL, NEUTRAL] });
      expect(ran.ledgerReads).toBe(1);
    });

    it(`${kind} runs the EXISTING bounded regeneration - two of them, then stop`, async () => {
      const verifier = new ScriptedSemanticClaimVerifier({ onExhausted: failure });
      const ran = await review({ text: NEUTRAL, verifier, regenerations: [NEUTRAL, NEUTRAL] });
      expect(ran.regenerationCalls).toBe(2);
      expect(ran.decision.attempts).toHaveLength(3);
      expect(typesOf(ran.events).filter((kindName) => kindName === 'REGENERATION_REQUESTED')).toHaveLength(2);
      expect(typesOf(ran.events)).toContain('WITHHELD');
    });

    it(`${kind} recovers when the verifier comes back, on a later attempt`, async () => {
      // A transient outage. The turn is corrected in the model's own words rather
      // than handed off, which is the difference between fail-closed and broken.
      const verifier = new ScriptedSemanticClaimVerifier({
        script: [failure, classifiedWithNoClaims()],
        onExhausted: classifiedWithNoClaims(),
      });
      const ran = await review({ text: NEUTRAL, verifier, regenerations: [NEUTRAL] });
      expect(ran.decision.outcome).toBe('CORRECTED_AFTER_REGENERATION');
      expect(ran.decision.releasedText).toBe(NEUTRAL);
    });
  }

  it('and NO verifier at all is treated the same, as a declared TEST-ONLY seam', async () => {
    const ran = await review({ text: NEUTRAL, verifier: null, regenerations: [NEUTRAL, NEUTRAL] });
    expect(ran.decision.outcome).toBe('WITHHELD_HANDED_OFF');
    expect(ran.decision.attempts[0]?.layers.semanticOutcome).toBe('ABSENT');
    expect(ran.decision.attempts[0]?.layers.failClosed).toBe(true);
  });

  it('and a verifier that THROWS - which its contract forbids - is UNAVAILABLE, not an aborted turn', async () => {
    const throwing = {
      verifierName: 'throwing-test-verifier',
      classify: async () => {
        throw new Error('the double broke its own contract');
      },
    };
    const ran = await review({ text: NEUTRAL, verifier: throwing, regenerations: [NEUTRAL, NEUTRAL] });
    expect(ran.decision.outcome).toBe('WITHHELD_HANDED_OFF');
    expect(ran.decision.attempts[0]?.layers.semanticOutcome).toBe('UNAVAILABLE');
  });
});

describe('the ledger stays LAZY', () => {
  it('is not read when both layers find nothing and the verifier answered', async () => {
    const ran = await review({ text: NEUTRAL, verifier: new RuleDrivenSemanticClaimVerifier() });
    expect(ran.decision.outcome).toBe('NO_MATERIAL_CLAIM');
    expect(ran.ledgerReads).toBe(0);
    // And the audit detail still says so, which `tests/e2e/claimGate.test.ts` asserts.
    expect(ran.events.find((event) => event.kind === 'VERIFIED')?.detail['ledgerRead']).toBe(false);
  });

  it('is read once - not once per attempt - when there is something to check', async () => {
    const verifier = new ScriptedSemanticClaimVerifier();
    const ran = await review({ text: FLAGGED, verifier, regenerations: [FLAGGED, FLAGGED] });
    expect(ran.decision.attempts).toHaveLength(3);
    expect(ran.ledgerReads).toBe(1);
  });

  it('is read when the SEMANTIC layer alone found something', async () => {
    const verifier = new ScriptedSemanticClaimVerifier({
      script: [
        {
          kind: 'CLASSIFIED',
          claims: [
            {
              assertsEffect: true,
              effectFamily: 'CALLBACK',
              status: 'COMMITTED',
              whenPhrase: null,
              identifier: null,
              confidence: 0.8,
            },
          ],
          modelId: null,
        },
      ],
    });
    const ran = await review({ text: QA8_CLITIC, verifier, blindDeterministic: true, regenerations: [NEUTRAL] });
    expect(ran.ledgerReads).toBe(1);
  });

  it('is read when the second layer FAILED, even over a text neither layer flagged', async () => {
    const verifier = new ScriptedSemanticClaimVerifier({
      onExhausted: { kind: 'UNAVAILABLE', reason: 'down' },
    });
    const ran = await review({ text: NEUTRAL, verifier, regenerations: [NEUTRAL, NEUTRAL] });
    expect(ran.ledgerReads).toBe(1);
  });
});

describe('the audit trail explains a blocked turn and says which layer caught it', () => {
  it('records the verifier being asked, answering, and the layering, in sequence', async () => {
    const verifier = new ScriptedSemanticClaimVerifier();
    const ran = await review({ text: NEUTRAL, verifier });
    const kinds = typesOf(ran.events);
    expect(kinds.indexOf('SEMANTIC_REQUESTED')).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('SEMANTIC_REQUESTED')).toBeLessThan(kinds.indexOf('SEMANTIC_CLASSIFIED'));
    expect(kinds.indexOf('SEMANTIC_CLASSIFIED')).toBeLessThan(kinds.indexOf('LAYERED'));
    expect(kinds.indexOf('LAYERED')).toBeLessThan(kinds.indexOf('VERIFIED'));
  });

  it('records the request fields as an OBSERVATION of the object that was sent', async () => {
    // `requestFields` is read off the very object handed to `classify`, not
    // written down beside it. The assertion pairs the audit line with what the
    // verifier actually received, so a field added to the request without being
    // audited fails here rather than being described by a literal that stayed
    // accidentally true.
    const verifier = new ScriptedSemanticClaimVerifier();
    const ran = await review({ text: NEUTRAL, verifier });
    const requested = ran.events.find((event) => event.kind === 'SEMANTIC_REQUESTED');
    const sent = verifier.requests[0];
    expect(sent).toBeDefined();
    expect(requested?.detail['requestFields']).toEqual(Object.keys(sent as object).sort());
    // And it is still the short list the authority boundary depends on: no
    // ledger, no state, no attempt history.
    expect(requested?.detail['requestFields']).toEqual(['correlationId', 'text']);
  });

  it('pins the INSTRUCTION VERSION on the chain, and says null when there is none to pin', async () => {
    // `SEMANTIC_VERIFIER_INSTRUCTION_REF` is documented as "recorded in the audit
    // detail so a chain pins the exact instruction used", and for a while nothing
    // read it - the id existed and no event carried it, so a chain pinned the
    // class and not the words. A double has no model-facing instruction at all,
    // so it records `null`: "nothing to pin" and "forgot to pin it" are different
    // facts and must not share a representation.
    const double = await review({ text: NEUTRAL, verifier: new ScriptedSemanticClaimVerifier() });
    expect(double.events.find((e) => e.kind === 'SEMANTIC_REQUESTED')?.detail['instructionRef']).toBeNull();

    const real = await review({
      text: NEUTRAL,
      verifier: new LlmSemanticClaimVerifier({ llm: new AlwaysCleanStructuredProvider() }),
    });
    expect(real.events.find((e) => e.kind === 'SEMANTIC_REQUESTED')?.detail['instructionRef']).toBe(
      SEMANTIC_VERIFIER_INSTRUCTION_REF,
    );
  });

  it('records SEMANTIC_FAILED instead of SEMANTIC_CLASSIFIED on a failure, with the consequence named', async () => {
    const verifier = new ScriptedSemanticClaimVerifier({
      onExhausted: { kind: 'MALFORMED', reason: 'not JSON' },
    });
    const ran = await review({ text: NEUTRAL, verifier, regenerations: [NEUTRAL, NEUTRAL] });
    const failed = ran.events.find((event) => event.kind === 'SEMANTIC_FAILED');
    expect(failed?.detail['outcome']).toBe('MALFORMED');
    expect(failed?.detail['reason']).toBe('not JSON');
    expect(String(failed?.detail['consequence'])).toContain('hands off');
    expect(typesOf(ran.events)).not.toContain('SEMANTIC_CLASSIFIED');
  });

  it('records the STRUCTURED OUTPUT verbatim when the verifier classified something', async () => {
    const claim = {
      assertsEffect: true,
      effectFamily: 'MEETING',
      status: 'COMPLETED',
      whenPhrase: 'Thursday at 2pm',
      identifier: null,
      confidence: 0.92,
    } as const;
    const verifier = new ScriptedSemanticClaimVerifier({
      script: [{ kind: 'CLASSIFIED', claims: [claim], modelId: 'test-model' }],
    });
    const ran = await review({ text: QA8_CLITIC, verifier, blindDeterministic: true, regenerations: [NEUTRAL] });
    const classified = ran.events.find((event) => event.kind === 'SEMANTIC_CLASSIFIED');
    expect(classified?.detail['claims']).toEqual([claim]);
    expect(classified?.detail['modelId']).toBe('test-model');
  });

  it('tags WHICH LAYER caught each claim, per claim, on the LAYERED event', async () => {
    const verifier = new ScriptedSemanticClaimVerifier({
      script: [
        {
          kind: 'CLASSIFIED',
          claims: [
            {
              assertsEffect: true,
              effectFamily: 'MESSAGE',
              status: 'COMMITTED',
              whenPhrase: null,
              identifier: null,
              confidence: 0.8,
            },
          ],
          modelId: null,
        },
      ],
    });
    const ran = await review({ text: FLAGGED, verifier, regenerations: [NEUTRAL] });
    const layered = ran.events.find((event) => event.kind === 'LAYERED');
    const claims = layered?.detail['claims'] as { source: string; family: string }[];
    expect(claims.some((entry) => entry.source === 'DETERMINISTIC' && entry.family === 'MEETING')).toBe(true);
    expect(claims.some((entry) => entry.source === 'SEMANTIC' && entry.family === 'MESSAGE')).toBe(true);
  });

  it('and the REJECTION event carries the layer report, which is where an auditor looks first', async () => {
    const verifier = new ScriptedSemanticClaimVerifier();
    const ran = await review({ text: FLAGGED, verifier, regenerations: [NEUTRAL] });
    const rejected = ran.events.find((event) => event.kind === 'REJECTED');
    expect(rejected?.detail['layers']).toMatchObject({ semanticOutcome: 'CLASSIFIED', failClosed: false });
    expect(rejected?.detail['attemptText']).toBe(FLAGGED);
  });
});

describe('the regeneration instruction reports a fail-closed layer honestly', () => {
  it('does not tell the model it asserted something it may not have', async () => {
    // Reporting a synthetic placeholder claim in the "you asserted X" shape would
    // hand the model a false premise about its own previous turn, and a model
    // handed a false premise argues with it.
    const verifier = new ScriptedSemanticClaimVerifier({
      onExhausted: { kind: 'TIMED_OUT', reason: 'the verifier did not answer within 20000 ms' },
    });
    const ran = await review({ text: NEUTRAL, verifier, regenerations: [NEUTRAL, NEUTRAL] });
    const instruction = String(
      ran.events.find((event) => event.kind === 'REGENERATION_REQUESTED')?.detail['instruction'] ?? '',
    );
    expect(instruction).toContain('the independent second check on the previous version did not complete');
    expect(instruction).toContain('TIMED_OUT');
    expect(instruction).not.toContain('asserted ANY COMPLETED');
  });

  it('and carries no customer-facing sentence, including the text under review', async () => {
    const verifier = new ScriptedSemanticClaimVerifier({
      onExhausted: { kind: 'UNAVAILABLE', reason: 'down' },
    });
    const ran = await review({ text: FLAGGED, verifier, regenerations: [FLAGGED, FLAGGED] });
    const instruction = String(
      ran.events.find((event) => event.kind === 'REGENERATION_REQUESTED')?.detail['instruction'] ?? '',
    );
    expect(instruction).not.toContain(FLAGGED);
  });
});

describe('the offline double adds nothing, which is what keeps the rest of the suite honest', () => {
  it('a rule-less RuleDrivenSemanticClaimVerifier classifies every text as carrying no claim', async () => {
    const verifier = new RuleDrivenSemanticClaimVerifier();
    expect(verifier.ruleCount).toBe(0);
    const verdict = await verifier.classify({ text: FLAGGED, correlationId: 'c' });
    expect(verdict).toEqual({ kind: 'CLASSIFIED', claims: [], modelId: null });
  });

  it('so a supported turn is still released byte-identical with no regeneration', async () => {
    const text = 'Your meeting is booked for Thursday at 2pm.';
    const ran = await review({
      text,
      verifier: new RuleDrivenSemanticClaimVerifier(),
      snapshot: ledger({ effects: [thursdayAtTwo()] }),
    });
    expect(ran.decision.outcome).toBe('SUPPORTED');
    expect(ran.decision.releasedText).toBe(text);
    expect(ran.regenerationCalls).toBe(0);
  });

  it('and a rule-driven double CAN be made to see something, when a test wants it to', async () => {
    const verifier = new RuleDrivenSemanticClaimVerifier({
      rules: [{ needle: "meeting's booked", effectFamily: 'MEETING', status: 'COMPLETED' }],
    });
    const ran = await review({ text: QA8_CLITIC, verifier, blindDeterministic: true, regenerations: [NEUTRAL] });
    expect(ran.decision.attempts[0]?.layers.sources).toEqual(['SEMANTIC']);
  });
});
