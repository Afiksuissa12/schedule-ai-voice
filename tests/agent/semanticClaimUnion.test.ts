/**
 * THE UNION IS ADDITIVE. That is the property this whole layer rests on.
 *
 * The Founder's rule is that the semantic verifier may only ADD suspicion: it can
 * never clear, suppress or override something the deterministic layer flagged, and
 * its judgement is never evidence that an effect exists. `union.ts` is where that
 * is a mechanism rather than a promise, and this file is where the mechanism is
 * checked - for EVERY possible verdict, including the three that matter most:
 *
 *   - a verifier that says every claim is clean (`assertsEffect: false`);
 *   - a verifier that returns an empty claim list;
 *   - a verifier that fails, in each of its four ways, and the wiring seam where
 *     there is no verifier at all.
 *
 * The strong form is asserted: the same OBJECT IDENTITIES come out, in the same
 * order, at the front of the union. Deep equality would pass if a claim were
 * rebuilt with a field quietly changed; identity cannot.
 *
 * Nothing here calls a model, and nothing here reads a database.
 */
import { describe, expect, it } from 'vitest';

import { detectMaterialClaims, type DetectedClaim } from '../../src/agent/claimGate/detector.js';
import { unionClaims } from '../../src/agent/claimGate/semantic/union.js';
import type { SemanticClaim, SemanticClaimVerdict } from '../../src/ports/claimVerifier.js';
import { SEMANTIC_CLAIM_FAILURE_KINDS } from '../../src/ports/claimVerifier.js';

/** A text the deterministic detector really does flag. Two claims, in fact. */
const FLAGGED = 'Your meeting is booked for Thursday at 2pm. Your confirmation number is CONF123456.';

/**
 * QA-8 class A, the noun-possessive clitic: the wording the last independent QA
 * round drove end to end and watched leak.
 *
 * DELIBERATELY NOT ASSERTED TO BE A MISS ANYWHERE IN THIS FILE, and the reason is
 * worth stating because the obvious test is the wrong one. AUTO-DETERMINISTIC-LAYER
 * is closing this class in the same mission, with a general rule over the clitic
 * rather than a noun list. A test that asserted `detectMaterialClaims(...)` returns
 * nothing here would be a test that goes RED the moment the sibling fix lands -
 * and it would be red for a good thing happening, which is the worst kind of
 * failing test.
 *
 * So the semantic layer's behaviour is exercised by handing `unionClaims` the
 * deterministic list EXPLICITLY, which is what the gate does anyway. The property
 * this file is about - the union is a superset, whatever either layer says - holds
 * identically before and after that fix, and the last block below asserts it on
 * this very wording without caring which layer sees it.
 */
const QA8_CLITIC = "Your meeting's booked for Thursday at 2pm.";

/** A text nobody flags. */
const NEUTRAL = 'What time would suit you?';

function semanticClaim(overrides: Partial<SemanticClaim> = {}): SemanticClaim {
  return {
    assertsEffect: true,
    effectFamily: 'MEETING',
    status: 'COMPLETED',
    whenPhrase: null,
    identifier: null,
    confidence: 0.9,
    ...overrides,
  };
}

const classified = (claims: readonly SemanticClaim[]): SemanticClaimVerdict => ({
  kind: 'CLASSIFIED',
  claims,
  modelId: 'test-model',
});

/** Every verdict a verifier can produce, plus the no-verifier seam. */
function everyPossibleVerdict(): readonly { label: string; verdict: SemanticClaimVerdict | null }[] {
  return [
    { label: 'CLASSIFIED with nothing', verdict: classified([]) },
    { label: 'CLASSIFIED, wrongly clean', verdict: classified([semanticClaim({ assertsEffect: false })]) },
    { label: 'CLASSIFIED, NOT_CLAIMED', verdict: classified([semanticClaim({ status: 'NOT_CLAIMED' })]) },
    { label: 'CLASSIFIED, ATTEMPTED', verdict: classified([semanticClaim({ status: 'ATTEMPTED' })]) },
    { label: 'CLASSIFIED, one real claim', verdict: classified([semanticClaim({ effectFamily: 'CALLBACK' })]) },
    ...SEMANTIC_CLAIM_FAILURE_KINDS.map((kind) => ({
      label: `the ${kind} failure`,
      verdict: { kind, reason: 'for the test' } as SemanticClaimVerdict,
    })),
    { label: 'no verifier wired at all', verdict: null },
  ];
}

describe('the union is a SUPERSET of the deterministic claim set, for every verdict', () => {
  const deterministic = detectMaterialClaims(FLAGGED);

  it('finds deterministic claims to be a superset OF, so nothing here is vacuous', () => {
    expect(deterministic.length).toBeGreaterThan(0);
  });

  for (const { label, verdict } of everyPossibleVerdict()) {
    it(`keeps every deterministic claim, by object identity and in order: ${label}`, () => {
      const union = unionClaims({ text: FLAGGED, deterministic, verdict });

      // The strong form. `toBe` inside the loop is identity, not equality.
      expect(union.claims.length).toBeGreaterThanOrEqual(deterministic.length);
      for (const [index, expected] of deterministic.entries()) {
        expect(union.claims[index]?.claim, `deterministic claim ${index} moved or was rebuilt`).toBe(expected);
      }
    });

    it(`never downgrades a deterministic claim's own fields: ${label}`, () => {
      const union = unionClaims({ text: FLAGGED, deterministic, verdict });
      for (const [index, expected] of deterministic.entries()) {
        const actual = union.claims[index]?.claim as DetectedClaim;
        expect(actual.family).toBe(expected.family);
        expect(actual.mode).toBe(expected.mode);
        expect(actual.locale).toBe(expected.locale);
        expect(actual.assertedDay).toBe(expected.assertedDay);
        expect(actual.assertedTime).toBe(expected.assertedTime);
        expect(actual.unreadTemporal).toEqual(expected.unreadTemporal);
        expect(actual.identifiers).toEqual(expected.identifiers);
      }
    });

    it(`tags every deterministic claim DETERMINISTIC or BOTH, never SEMANTIC: ${label}`, () => {
      const union = unionClaims({ text: FLAGGED, deterministic, verdict });
      for (const index of deterministic.keys()) {
        expect(union.claims[index]?.source).not.toBe('SEMANTIC');
      }
    });
  }
});

describe('a verifier that says a flagged text is clean changes NOTHING about it', () => {
  it('leaves the deterministic claims in the union and does not clear them', () => {
    const deterministic = detectMaterialClaims(FLAGGED);
    const union = unionClaims({
      text: FLAGGED,
      deterministic,
      // The hostile case: the model asserts, explicitly, that this text claims
      // nothing at all.
      verdict: classified([semanticClaim({ assertsEffect: false, status: 'NOT_CLAIMED' })]),
    });

    expect(union.claims.map((entry) => entry.claim)).toEqual([...deterministic]);
    expect(union.semanticContributingCount).toBe(0);
    expect(union.failClosed).toBe(false);
  });

  it('and an EMPTY claim list is the same story', () => {
    const deterministic = detectMaterialClaims(FLAGGED);
    const union = unionClaims({ text: FLAGGED, deterministic, verdict: classified([]) });
    expect(union.claims.map((entry) => entry.claim)).toEqual([...deterministic]);
  });
});

describe('a claim the deterministic layer did NOT report is added by the semantic one', () => {
  // `deterministic: []` is handed in explicitly rather than derived from a text the
  // detector happens to miss today. See the note on QA8_CLITIC: the property under
  // test is the union's, and tying it to a live leak class would make it fail when
  // that class is closed.
  it('adds the semantic claim, tagged SEMANTIC', () => {
    const union = unionClaims({
      text: QA8_CLITIC,
      deterministic: [],
      verdict: classified([semanticClaim({ whenPhrase: 'Thursday at 2pm' })]),
    });

    expect(union.claims).toHaveLength(1);
    expect(union.claims[0]?.source).toBe('SEMANTIC');
    expect(union.claims[0]?.claim.family).toBe('MEETING');
    expect(union.claims[0]?.claim.mode).toBe('COMPLETED');
  });

  it('and puts the quoted when-phrase on `unreadTemporal`, never on a parsed day', () => {
    // The authority boundary at its narrowest: the semantic layer may point at a
    // phrase and may NOT decide what day it names. `UNREADABLE_WHEN` is the
    // existing reconciliation path for exactly that.
    const union = unionClaims({
      text: QA8_CLITIC,
      deterministic: [],
      verdict: classified([semanticClaim({ whenPhrase: 'Thursday at 2pm' })]),
    });
    const claim = union.claims[0]?.claim;
    expect(claim?.assertedDay).toBeNull();
    expect(claim?.assertedTime).toBeNull();
    expect(claim?.unreadTemporal).toEqual(['Thursday at 2pm']);
  });

  it('and a claim naming no when-phrase carries NO unread temporal material', () => {
    // So `Your meeting's booked.` against a real meeting is SUPPORTED and released
    // byte-identical, with no regeneration. The `unreadTemporal` cost is paid only
    // by a claim that actually named a time.
    const union = unionClaims({
      text: "Your meeting's booked.",
      deterministic: [],
      verdict: classified([semanticClaim()]),
    });
    expect(union.claims[0]?.claim.unreadTemporal).toEqual([]);
  });

  it('and carries the quoted identifier through, so INVENTED_IDENTIFIER can still fire', () => {
    const union = unionClaims({
      text: "Your meeting's booked, reference CONF123456.",
      deterministic: [],
      verdict: classified([semanticClaim({ identifier: 'CONF123456' })]),
    });
    expect(union.claims[0]?.claim.identifiers).toEqual(['CONF123456']);
  });
});

describe('a claim BOTH layers found is counted once and keeps the deterministic reading', () => {
  const deterministic = detectMaterialClaims(FLAGGED);

  it('tags it BOTH rather than adding a second entry', () => {
    const meeting = deterministic.find((claim) => claim.family === 'MEETING');
    expect(meeting, 'the fixture must produce a MEETING claim').toBeDefined();

    const union = unionClaims({
      text: FLAGGED,
      deterministic,
      verdict: classified([
        semanticClaim({ effectFamily: 'MEETING', status: 'COMPLETED', whenPhrase: 'Thursday at 2pm' }),
      ]),
    });

    expect(union.claims).toHaveLength(deterministic.length);
    expect(union.claims.filter((entry) => entry.source === 'BOTH')).toHaveLength(1);
    expect(union.semanticContributingCount).toBe(0);
  });

  it('and the claim that travels on is the deterministic one, with its PARSED day', () => {
    // Substituting the semantic wrapper here would turn a readable day into an
    // unreadable phrase, which is the semantic layer making a deterministic
    // finding worse. It must not.
    const union = unionClaims({
      text: FLAGGED,
      deterministic,
      verdict: classified([
        semanticClaim({ effectFamily: 'MEETING', status: 'COMPLETED', whenPhrase: 'Thursday at 2pm' }),
      ]),
    });
    const both = union.claims.find((entry) => entry.source === 'BOTH');
    expect(both?.claim.assertedDay?.isoWeekday).toBe(4);
    expect(both?.claim.unreadTemporal).toEqual([]);
    expect(both?.claim.locale).not.toBe('semantic');
  });

  it('but a DIFFERENT family is a different claim and is added', () => {
    const union = unionClaims({
      text: FLAGGED,
      deterministic,
      verdict: classified([semanticClaim({ effectFamily: 'MESSAGE', status: 'COMMITTED' })]),
    });
    expect(union.claims.length).toBe(deterministic.length + 1);
    expect(union.claims.at(-1)?.source).toBe('SEMANTIC');
  });

  it('and a quoted identifier the deterministic claim does not list is a different claim too', () => {
    // Folding it in would lose the INVENTED_IDENTIFIER check on that token
    // entirely, which is the one check that catches a fabricated reference.
    const union = unionClaims({
      text: FLAGGED,
      deterministic,
      verdict: classified([
        semanticClaim({ effectFamily: 'MEETING', status: 'COMPLETED', identifier: 'CONF123456' }),
      ]),
    });
    // The deterministic MEETING claim's own `identifiers` does not carry the code
    // from the SECOND sentence, so the two do not coincide.
    const meeting = deterministic.find((claim) => claim.family === 'MEETING');
    expect(meeting?.identifiers).not.toContain('CONF123456');
    expect(union.claims.length).toBe(deterministic.length + 1);
  });
});

describe('a non-material semantic claim contributes nothing', () => {
  for (const status of ['ATTEMPTED', 'NOT_CLAIMED'] as const) {
    it(`${status} is dropped, because the mapping onto ClaimAssertionMode has no member for it`, () => {
      const union = unionClaims({
        text: QA8_CLITIC,
        deterministic: [],
        verdict: classified([semanticClaim({ status })]),
      });
      expect(union.claims).toHaveLength(0);
      expect(union.failClosed).toBe(false);
    });
  }

  it('and `assertsEffect: false` is dropped whatever its status says', () => {
    const union = unionClaims({
      text: QA8_CLITIC,
      deterministic: [],
      verdict: classified([semanticClaim({ assertsEffect: false, status: 'COMPLETED' })]),
    });
    expect(union.claims).toHaveLength(0);
  });
});

describe('every failure, and the missing-verifier seam, is failClosed', () => {
  for (const kind of SEMANTIC_CLAIM_FAILURE_KINDS) {
    it(`${kind} sets failClosed and reports the outcome by name`, () => {
      const union = unionClaims({
        text: NEUTRAL,
        deterministic: [],
        verdict: { kind, reason: 'the provider was unplugged' } as SemanticClaimVerdict,
      });
      expect(union.failClosed).toBe(true);
      expect(union.semanticOutcome).toBe(kind);
      expect(union.semanticFailureReason).toBe('the provider was unplugged');
      // And it is NOT dressed up as a classification with no claims.
      expect(union.claims).toHaveLength(0);
    });
  }

  it('a missing verifier is ABSENT and failClosed, and is not confusable with CLASSIFIED', () => {
    const union = unionClaims({ text: NEUTRAL, deterministic: [], verdict: null });
    expect(union.semanticOutcome).toBe('ABSENT');
    expect(union.failClosed).toBe(true);
    expect(union.semanticFailureReason).toContain('no semantic claim verifier');
  });

  it('whereas CLASSIFIED with no claims is NOT failClosed - the two are different facts', () => {
    const union = unionClaims({ text: NEUTRAL, deterministic: [], verdict: classified([]) });
    expect(union.semanticOutcome).toBe('CLASSIFIED');
    expect(union.failClosed).toBe(false);
    expect(union.semanticFailureReason).toBeNull();
  });
});

describe('the counts the per-turn report is built from', () => {
  it('state both layers separately, so a reader can tell which one saw a claim', () => {
    const deterministic = detectMaterialClaims(FLAGGED);
    const union = unionClaims({
      text: FLAGGED,
      deterministic,
      verdict: classified([semanticClaim({ effectFamily: 'CALLBACK', status: 'COMMITTED' })]),
    });
    expect(union.deterministicCount).toBe(deterministic.length);
    expect(union.semanticContributingCount).toBe(1);
    expect(union.claims).toHaveLength(deterministic.length + 1);
    expect(union.claims.map((entry) => entry.source).filter((source) => source === 'SEMANTIC')).toHaveLength(1);
  });
});

describe('the QA-8 clitic wording, whichever layer sees it', () => {
  // The one block that names the last independent QA finding directly, written so
  // it is CORRECT BOTH BEFORE AND AFTER AUTO-DETERMINISTIC-LAYER closes the class.
  // It asserts the property that has to hold either way - the union covers it - and
  // asserts nothing about which layer got there first.
  const deterministic = detectMaterialClaims(QA8_CLITIC);

  it('is covered by the union when the SEMANTIC layer sees it', () => {
    const union = unionClaims({
      text: QA8_CLITIC,
      deterministic,
      verdict: classified([semanticClaim({ whenPhrase: 'Thursday at 2pm' })]),
    });
    expect(union.claims.length).toBeGreaterThan(0);
    expect(union.claims.some((entry) => entry.claim.family === 'MEETING')).toBe(true);
    // Superset, whatever the detector currently returns for this wording.
    expect(union.claims.length).toBeGreaterThanOrEqual(deterministic.length);
  });

  it('and is covered when the semantic layer says it is clean, IF the detector sees it', () => {
    const union = unionClaims({
      text: QA8_CLITIC,
      deterministic,
      verdict: classified([semanticClaim({ assertsEffect: false, status: 'NOT_CLAIMED' })]),
    });
    expect(union.claims.length).toBe(deterministic.length);
    for (const [index, expected] of deterministic.entries()) {
      expect(union.claims[index]?.claim).toBe(expected);
    }
  });

  it('and a fail-closed verifier covers it whether or not either layer saw a claim', () => {
    // The case that needs no detector and no classification at all: nothing usable
    // came back from the second layer, so the attempt is UNSUPPORTED regardless.
    const union = unionClaims({
      text: QA8_CLITIC,
      deterministic,
      verdict: { kind: 'UNAVAILABLE', reason: 'down' },
    });
    expect(union.failClosed).toBe(true);
  });
});
