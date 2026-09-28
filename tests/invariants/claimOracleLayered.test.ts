/**
 * THE ORACLE'S LAYERED HALF, AND THE PROOF THAT IT STAYS INDEPENDENT.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------------------------------------------------------------
 * `layeredPipelineFindings` is the second question the independent oracle asks:
 * not *was this sentence safe to say* - that is `unbackedDeclaredClaims` and it is
 * a question about an EFFECT - but *did this system run the check it says it runs*.
 * A turn can be perfectly safe and still have skipped the second layer, and a turn
 * that skipped it is a turn nobody classified.
 *
 * INV-19 is where it runs in anger, over 1,171 scenarios. This file is where each
 * of its findings is shown to fire on its own, because an invariant that reports
 * zero violations over a clean corpus has proved nothing about what it would do
 * with a dirty one - which is the whole lesson of
 * `tests/claimGate/claimGateNonVacuity.test.ts` and of
 * `src/context/antiScriptingSelfTest.ts` before it.
 *
 * AND THE RULE THAT MATTERS MORE THAN ANY OF THEM
 * ---------------------------------------------------------------------------
 * **THE ORACLE MUST NEVER TREAT THE VERIFIER'S VERDICT AS EVIDENCE OF ANYTHING.**
 * The verifier's judgement is never evidence that an effect exists, and an oracle
 * that read it would re-close the circle § 17.5 exists to break - worse than the
 * original circle, because the original one at least consulted deterministic code.
 *
 * The last block below is that property, asserted three ways: the signature makes
 * it unrepresentable, the effect-half's answer is invariant under every semantic
 * outcome there is, and the layered half is shown to be purely ADDITIVE.
 *
 * No database, no clock, no model. The facts are synthesised because the quantity
 * under test is the oracle's reasoning.
 */
import { describe, expect, it } from 'vitest';

import {
  KNOWN_SEMANTIC_LAYER_OUTCOMES,
  UNUSABLE_SEMANTIC_LAYER_OUTCOMES,
  assertsEffects,
  assertsNothing,
  attemptsTheSecondLayerAnswered,
  layeredPipelineFindings,
  unbackedDeclaredClaims,
  type LayeredAttemptFacts,
  type LayeredReleaseFacts,
  type ObservedStateForOracle,
} from './claimOracle.js';

/** A coherent attempt: the second layer answered, the union grew, nothing odd. */
function healthyAttempt(overrides: Partial<LayeredAttemptFacts> = {}): LayeredAttemptFacts {
  return {
    attempt: 1,
    semanticOutcome: 'CLASSIFIED',
    failClosed: false,
    deterministicClaimCount: 1,
    semanticClaimCount: 0,
    unionClaimCount: 1,
    sourceTags: ['DETERMINISTIC'],
    wasReleased: false,
    unsupportedReasons: ['NO_MATCHING_EFFECT'],
    ...overrides,
  };
}

function facts(overrides: Partial<LayeredReleaseFacts> = {}): LayeredReleaseFacts {
  return {
    iteration: 1,
    verifierWired: true,
    verifierName: 'a-double',
    releasedText: null,
    attempts: [healthyAttempt()],
    ...overrides,
  };
}

const reasonsOf = (input: LayeredReleaseFacts): string[] =>
  layeredPipelineFindings(input).map((finding) => finding.reason);

// ---------------------------------------------------------------------------
// 1. THE CLEAN CASE, SO EVERYTHING BELOW MEANS SOMETHING
// ---------------------------------------------------------------------------

describe('a coherent layered release produces no findings', () => {
  it('finds nothing wrong with a healthy attempt', () => {
    expect(layeredPipelineFindings(facts())).toEqual([]);
  });

  it('and nothing wrong with a released attempt that classified cleanly', () => {
    expect(
      layeredPipelineFindings(
        facts({
          releasedText: 'anything',
          attempts: [
            healthyAttempt({
              deterministicClaimCount: 0,
              unionClaimCount: 0,
              sourceTags: [],
              unsupportedReasons: [],
              wasReleased: true,
            }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('and a BOTH tag on a deterministic slot is fine - that is the only change allowed', () => {
    expect(
      layeredPipelineFindings(
        facts({
          attempts: [healthyAttempt({ semanticClaimCount: 1, sourceTags: ['BOTH'] })],
        }),
      ),
    ).toEqual([]);
  });

  it('and a union that GREW is fine, which is the whole point of the second layer', () => {
    expect(
      layeredPipelineFindings(
        facts({
          attempts: [
            healthyAttempt({
              deterministicClaimCount: 1,
              semanticClaimCount: 2,
              unionClaimCount: 3,
              sourceTags: ['DETERMINISTIC', 'SEMANTIC', 'SEMANTIC'],
            }),
          ],
        }),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. EVERY FINDING FIRES
// ---------------------------------------------------------------------------

describe('every layered finding is SEEN TO FIRE, so none of them is a label on nothing', () => {
  it('NO_VERIFIER_WIRED, which is a violation exactly as claimGate.enabled === false is', () => {
    const found = layeredPipelineFindings(facts({ verifierWired: false }));
    expect(found.map((entry) => entry.reason)).toContain('NO_VERIFIER_WIRED');
    expect(found[0]?.detail).toContain('offers no way to remove it');
  });

  it('VERIFIER_WIRING_NOT_REPORTED, because unstated is NOT the same as wired', () => {
    // `ClaimGateTurnReport.verifier` is optional so pre-2F callers keep compiling.
    // An absent field means NOBODY SAID, and defaulting an unknown to safe is the
    // exact silence § 17.5 exists to remove.
    const found = layeredPipelineFindings(facts({ verifierWired: null }));
    expect(found.map((entry) => entry.reason)).toContain('VERIFIER_WIRING_NOT_REPORTED');
    expect(found[0]?.detail).toContain('NOBODY SAID');
  });

  it('and the two are DIFFERENT findings, not one with two messages', () => {
    expect(reasonsOf(facts({ verifierWired: false }))).not.toEqual(reasonsOf(facts({ verifierWired: null })));
  });

  it('SEMANTIC_LAYER_ABSENT, when the declared test-only seam reaches a swept scenario', () => {
    const found = reasonsOf(
      facts({ attempts: [healthyAttempt({ semanticOutcome: 'ABSENT', failClosed: true, unsupportedReasons: ['SEMANTIC_CHECK_UNAVAILABLE'] })] }),
    );
    expect(found).toContain('SEMANTIC_LAYER_ABSENT');
  });

  it('UNKNOWN_SEMANTIC_OUTCOME, when the gate invents an outcome this list has never heard of', () => {
    // The same discipline as INV-18's UNKNOWN_FAMILY: a new outcome added to the
    // gate and not to the assurance layer cannot be judged, and a thing that
    // cannot be judged is a finding rather than a pass. This is exactly why the
    // outcome list is written out a second time instead of imported.
    const found = reasonsOf(facts({ attempts: [healthyAttempt({ semanticOutcome: 'PROBABLY_FINE' })] }));
    expect(found).toContain('UNKNOWN_SEMANTIC_OUTCOME');
  });

  it('RELEASED_WHILE_FAIL_CLOSED - the single most important one in the function', () => {
    const found = layeredPipelineFindings(
      facts({
        releasedText: 'a sentence nobody classified',
        attempts: [
          healthyAttempt({
            semanticOutcome: 'MALFORMED',
            failClosed: true,
            wasReleased: true,
            unsupportedReasons: ['SEMANTIC_CHECK_UNAVAILABLE'],
          }),
        ],
      }),
    );
    expect(found.map((entry) => entry.reason)).toContain('RELEASED_WHILE_FAIL_CLOSED');
    expect(found.find((entry) => entry.reason === 'RELEASED_WHILE_FAIL_CLOSED')?.detail).toContain(
      'a check that did not happen is not a check that passed',
    );
  });

  it('and it fires for EVERY unusable outcome, not only for MALFORMED', () => {
    for (const outcome of UNUSABLE_SEMANTIC_LAYER_OUTCOMES) {
      const found = reasonsOf(
        facts({
          releasedText: 'text',
          attempts: [
            healthyAttempt({
              semanticOutcome: outcome,
              failClosed: true,
              wasReleased: true,
              unsupportedReasons: ['SEMANTIC_CHECK_UNAVAILABLE'],
            }),
          ],
        }),
      );
      expect(found, `outcome ${outcome}`).toContain('RELEASED_WHILE_FAIL_CLOSED');
    }
  });

  it('FAIL_CLOSED_WITHOUT_ITS_REASON, when the flag and the outcome disagree', () => {
    // Two fields report the same fact and a mismatch means one of them is lying.
    expect(reasonsOf(facts({ attempts: [healthyAttempt({ failClosed: true })] }))).toContain(
      'FAIL_CLOSED_WITHOUT_ITS_REASON',
    );
    expect(
      reasonsOf(facts({ attempts: [healthyAttempt({ semanticOutcome: 'TIMED_OUT', failClosed: false })] })),
    ).toContain('FAIL_CLOSED_WITHOUT_ITS_REASON');
  });

  it('and when a fail-closed attempt records no SEMANTIC_CHECK_UNAVAILABLE', () => {
    // An operator reading a hand-off has to be able to tell a verifier outage from
    // a model that asserted something false; those have completely different fixes.
    const found = reasonsOf(
      facts({
        attempts: [
          healthyAttempt({ semanticOutcome: 'EMPTY', failClosed: true, unsupportedReasons: ['NO_MATCHING_EFFECT'] }),
        ],
      }),
    );
    expect(found).toContain('FAIL_CLOSED_WITHOUT_ITS_REASON');
  });

  it('UNION_SMALLER_THAN_DETERMINISTIC - the "may only ADD" rule as arithmetic', () => {
    const found = layeredPipelineFindings(
      facts({
        attempts: [
          healthyAttempt({ deterministicClaimCount: 3, unionClaimCount: 2, sourceTags: ['DETERMINISTIC', 'BOTH'] }),
        ],
      }),
    );
    expect(found.map((entry) => entry.reason)).toContain('UNION_SMALLER_THAN_DETERMINISTIC');
    expect(found.find((entry) => entry.reason === 'UNION_SMALLER_THAN_DETERMINISTIC')?.detail).toContain(
      'the one thing it may never do',
    );
  });

  it('SOURCE_TAGS_DO_NOT_COVER_THE_UNION', () => {
    expect(
      reasonsOf(facts({ attempts: [healthyAttempt({ unionClaimCount: 2, sourceTags: ['DETERMINISTIC'] })] })),
    ).toContain('SOURCE_TAGS_DO_NOT_COVER_THE_UNION');
  });

  it('DETERMINISTIC_CLAIM_LOST_ITS_TAG, when a deterministic slot is tagged SEMANTIC', () => {
    // The only change the second layer may make to a deterministic claim is
    // re-tagging it BOTH. A `SEMANTIC` tag in a deterministic slot would mean the
    // claim had been REPLACED rather than re-tagged, which is how an object-identity
    // guarantee gets lost without anybody noticing.
    expect(
      reasonsOf(
        facts({
          attempts: [
            healthyAttempt({ deterministicClaimCount: 2, unionClaimCount: 2, sourceTags: ['SEMANTIC', 'BOTH'] }),
          ],
        }),
      ),
    ).toContain('DETERMINISTIC_CLAIM_LOST_ITS_TAG');
  });

  it('NO_ATTEMPT_AT_ALL, for a release nobody classified', () => {
    const found = layeredPipelineFindings(facts({ attempts: [] }));
    expect(found.map((entry) => entry.reason)).toEqual(['NO_ATTEMPT_AT_ALL']);
  });

  it('and EVERY declared reason has now been seen to fire', () => {
    // THE NON-VACUITY GUARD ON THIS BLOCK. A reason nothing can produce is a label
    // on nothing, and the point of enumerating them is that a reader can act on
    // each one. Gathered by running every case above rather than by listing them
    // again, so the two cannot drift.
    const produced = new Set<string>([
      ...reasonsOf(facts({ verifierWired: false })),
      ...reasonsOf(facts({ verifierWired: null })),
      ...reasonsOf(facts({ attempts: [healthyAttempt({ semanticOutcome: 'ABSENT', failClosed: true, unsupportedReasons: ['SEMANTIC_CHECK_UNAVAILABLE'] })] })),
      ...reasonsOf(facts({ attempts: [healthyAttempt({ semanticOutcome: 'NONSENSE' })] })),
      ...reasonsOf(
        facts({
          releasedText: 't',
          attempts: [
            healthyAttempt({
              semanticOutcome: 'MALFORMED',
              failClosed: true,
              wasReleased: true,
              unsupportedReasons: ['SEMANTIC_CHECK_UNAVAILABLE'],
            }),
          ],
        }),
      ),
      ...reasonsOf(facts({ attempts: [healthyAttempt({ failClosed: true })] })),
      ...reasonsOf(facts({ attempts: [healthyAttempt({ deterministicClaimCount: 2, unionClaimCount: 1, sourceTags: ['BOTH'] })] })),
      ...reasonsOf(facts({ attempts: [healthyAttempt({ unionClaimCount: 3, sourceTags: ['DETERMINISTIC'] })] })),
      ...reasonsOf(
        facts({ attempts: [healthyAttempt({ deterministicClaimCount: 1, unionClaimCount: 1, sourceTags: ['SEMANTIC'] })] }),
      ),
      ...reasonsOf(facts({ attempts: [] })),
    ]);

    expect([...produced].sort()).toEqual([
      'DETERMINISTIC_CLAIM_LOST_ITS_TAG',
      'FAIL_CLOSED_WITHOUT_ITS_REASON',
      'NO_ATTEMPT_AT_ALL',
      'NO_VERIFIER_WIRED',
      'RELEASED_WHILE_FAIL_CLOSED',
      'SEMANTIC_LAYER_ABSENT',
      'SOURCE_TAGS_DO_NOT_COVER_THE_UNION',
      'UNION_SMALLER_THAN_DETERMINISTIC',
      'UNKNOWN_SEMANTIC_OUTCOME',
      'VERIFIER_WIRING_NOT_REPORTED',
    ]);
  });

  it('and every outcome the gate can really report is one this list KNOWS', () => {
    // The drift alarm in the safe direction. The list is written out a second time
    // on purpose, so it CAN disagree with the gate - but if it disagrees today that
    // is a finding rather than a design feature, and this is where it surfaces.
    for (const outcome of ['CLASSIFIED', 'MALFORMED', 'TIMED_OUT', 'UNAVAILABLE', 'EMPTY', 'ABSENT']) {
      expect(KNOWN_SEMANTIC_LAYER_OUTCOMES, `the gate reports ${outcome}`).toContain(outcome);
    }
    // And `CLASSIFIED` is the ONLY one that is not fail-closed.
    expect(
      KNOWN_SEMANTIC_LAYER_OUTCOMES.filter((outcome) => !UNUSABLE_SEMANTIC_LAYER_OUTCOMES.includes(outcome)),
    ).toEqual(['CLASSIFIED']);
  });
});

// ---------------------------------------------------------------------------
// 3. THE NON-VACUITY COUNTER COUNTS ANSWERS, NEVER CLAIMS
// ---------------------------------------------------------------------------

describe('attemptsTheSecondLayerAnswered', () => {
  it('counts the attempts on which the layer produced a classification', () => {
    expect(
      attemptsTheSecondLayerAnswered(
        facts({
          attempts: [
            healthyAttempt({ attempt: 1 }),
            healthyAttempt({ attempt: 2, semanticOutcome: 'TIMED_OUT', failClosed: true, unsupportedReasons: ['SEMANTIC_CHECK_UNAVAILABLE'] }),
            healthyAttempt({ attempt: 3 }),
          ],
        }),
      ),
    ).toBe(2);
  });

  it('and an answer of NO CLAIMS still counts as an answer, which is the distinction that matters', () => {
    // `CLASSIFIED` with an empty claim list is a VERDICT; `ABSENT` is not. The two
    // are different facts and the types keep them so. This counter is about
    // whether the layer ANSWERED, never about whether it cleared anything.
    expect(
      attemptsTheSecondLayerAnswered(
        facts({ attempts: [healthyAttempt({ deterministicClaimCount: 0, unionClaimCount: 0, sourceTags: [], semanticClaimCount: 0 })] }),
      ),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. THE ORACLE NEVER READS THE VERIFIER'S VERDICT AS EVIDENCE
// ---------------------------------------------------------------------------

describe('the verifier\'s judgement is never evidence that an effect exists', () => {
  // THE MOST IMPORTANT BLOCK IN THIS FILE. § 17.5 exists because INV-18 found its
  // claims with the gate's own detector, and a sentence the detector could not see
  // produced no claims, so the sweep printed zero leaks over a live defect - four
  // times. An oracle that consulted the VERIFIER would re-close that circle and
  // close it worse, because the original one at least consulted deterministic code.

  const state: ObservedStateForOracle = {
    effects: [],
    issuedIdentifiers: new Set<string>(),
    contactId: 'contact-1',
    refusals: [],
  };

  const declaresAMeeting = assertsEffects('A caller hearing this turns up on Thursday at 2pm.', [
    {
      family: 'MEETING',
      mode: 'COMPLETED',
      localDay: '2026-03-05',
      localHour: 14,
      localMinute: null,
      note: 'is booked, naming Thursday and 2pm',
    },
  ]);

  it('the EFFECT half has no parameter the semantic layer can reach - a fact about the TYPES', () => {
    // The strongest form of the guarantee, and it is structural rather than
    // behavioural: `unbackedDeclaredClaims(declaration, state)` takes a
    // `ClaimDeclaration` and an `ObservedStateForOracle`, and NEITHER TYPE HAS A
    // FIELD FOR A SEMANTIC OUTCOME, A CONFIDENCE, A CLAIM COUNT OR A VERDICT. So
    // there is nothing for a future edit to start reading, and this test is a
    // statement of that rather than a sample of it.
    expect(Object.keys(state).sort()).toEqual(['contactId', 'effects', 'issuedIdentifiers', 'refusals']);
    expect(Object.keys(declaresAMeeting).sort()).toEqual([
      'announcesAReference',
      'assertions',
      'assertsMaterialEffect',
      'identifiersReadOut',
      'why',
    ]);
  });

  it('and its answer is IDENTICAL under every semantic outcome there is', () => {
    // The behavioural half of the same claim, quantified over every outcome
    // including `CLASSIFIED`. A verifier that says a text is clean cannot make an
    // unbacked claim backed, and a verifier that says a text is full of claims
    // cannot make a backed claim unbacked.
    const baseline = unbackedDeclaredClaims(declaresAMeeting, state);
    expect(baseline.length, 'the fixture must actually produce a finding, or this proves nothing').toBe(1);

    for (const outcome of KNOWN_SEMANTIC_LAYER_OUTCOMES) {
      // The layered facts vary across every outcome; the effect-half's verdict does
      // not move, because it cannot see them.
      const layered = facts({
        attempts: [
          healthyAttempt({
            semanticOutcome: outcome,
            failClosed: UNUSABLE_SEMANTIC_LAYER_OUTCOMES.includes(outcome),
            unsupportedReasons: UNUSABLE_SEMANTIC_LAYER_OUTCOMES.includes(outcome)
              ? ['SEMANTIC_CHECK_UNAVAILABLE']
              : ['NO_MATCHING_EFFECT'],
          }),
        ],
      });
      // Both halves are computed, and the point is that the second cannot touch
      // the first.
      layeredPipelineFindings(layered);
      expect(unbackedDeclaredClaims(declaresAMeeting, state), `outcome ${outcome}`).toEqual(baseline);
    }
  });

  it('and the LAYERED half is purely ADDITIVE - there is no "all clear" it can return', () => {
    // `layeredPipelineFindings` returns findings. It has no return value meaning
    // "and therefore the text was fine", so nothing it produces can cancel a
    // finding from `unbackedDeclaredClaims`. The caller unions the two.
    const clean = layeredPipelineFindings(facts());
    expect(clean).toEqual([]);
    // An empty array is the ABSENCE of findings, not an assertion of safety - and
    // the sentence it was computed about is still unbacked.
    expect(unbackedDeclaredClaims(declaresAMeeting, state).length).toBe(1);
  });

  it('and a CLASSIFIED outcome with ten claims produces the same findings as one with none', () => {
    // The sharpest available form: the function does not ask what the verifier
    // THOUGHT, only whether it answered. If it ever started branching on the
    // content, these two would diverge.
    const withNone = reasonsOf(facts({ attempts: [healthyAttempt({ semanticClaimCount: 0 })] }));
    const withMany = reasonsOf(
      facts({
        attempts: [
          healthyAttempt({
            semanticClaimCount: 10,
            unionClaimCount: 11,
            sourceTags: ['DETERMINISTIC', ...Array.from({ length: 10 }, () => 'SEMANTIC')],
          }),
        ],
      }),
    );
    expect(withNone).toEqual([]);
    expect(withMany).toEqual([]);
  });

  it('and a high CONFIDENCE cannot appear here at all, because the facts carry no such field', () => {
    // `SemanticClaim.confidence` is recorded in the audit trail and nothing in the
    // gate branches on it - a threshold is a way for a model's own uncertainty to
    // clear a claim, and this layer may not clear anything. The assurance layer
    // does not get one either: there is no field for it on `LayeredAttemptFacts`.
    const attempt = healthyAttempt();
    expect(Object.keys(attempt)).not.toContain('confidence');
    expect(Object.keys(attempt).sort()).toEqual([
      'attempt',
      'deterministicClaimCount',
      'failClosed',
      'semanticClaimCount',
      'semanticOutcome',
      'sourceTags',
      'unionClaimCount',
      'unsupportedReasons',
      'wasReleased',
    ]);
  });

  it('and an honest sentence stays honest whatever the second layer said about it', () => {
    // The precision direction of the same property. A declaration saying "this
    // asserts nothing" is not overturned by a verifier claiming it asserts
    // everything - because the verifier's judgement is not evidence either way.
    const honest = assertsNothing('An offer to act, in the present. It names no effect and reads out no reference.');
    for (const outcome of KNOWN_SEMANTIC_LAYER_OUTCOMES) {
      layeredPipelineFindings(
        facts({
          attempts: [
            healthyAttempt({
              semanticOutcome: outcome,
              semanticClaimCount: 5,
              failClosed: UNUSABLE_SEMANTIC_LAYER_OUTCOMES.includes(outcome),
              unsupportedReasons: UNUSABLE_SEMANTIC_LAYER_OUTCOMES.includes(outcome)
                ? ['SEMANTIC_CHECK_UNAVAILABLE']
                : [],
              unionClaimCount: 6,
              sourceTags: ['DETERMINISTIC', 'SEMANTIC', 'SEMANTIC', 'SEMANTIC', 'SEMANTIC', 'SEMANTIC'],
            }),
          ],
        }),
      );
      expect(unbackedDeclaredClaims(honest, state), `outcome ${outcome}`).toEqual([]);
    }
  });
});
