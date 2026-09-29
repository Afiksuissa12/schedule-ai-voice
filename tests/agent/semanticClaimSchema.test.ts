/**
 * THE VERIFIER'S OUTPUT CONTRACT, AND THE FAIL-CLOSED RULE OVER IT.
 *
 * The premise of this whole layer is that a model's answer is untrusted input in
 * exactly the sense `ToolCallRequest.argumentsJson` is untrusted input. So this
 * file is the analogue of `tests/agent/toolContract.ts`'s strictness half: for
 * every way an answer can be wrong, it must be MALFORMED, and MALFORMED must be
 * UNSUPPORTED.
 *
 * Nothing here calls a model. Every input is a string this file wrote.
 */
import { describe, expect, it } from 'vitest';

import {
  SEMANTIC_CLAIM_EFFECT_FAMILIES,
  SEMANTIC_CLAIM_FAILURE_KINDS,
  SEMANTIC_CLAIM_STATUSES,
  SEMANTIC_CLAIM_VERDICT_KINDS,
  isSemanticClaimFailure,
} from '../../src/ports/claimVerifier.js';
import {
  MATERIAL_SEMANTIC_CLAIM_STATUSES,
  SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA,
  SemanticClaimSchema,
  SemanticVerifierOutputSchema,
  isGroundedInText,
  parseSemanticVerifierOutput,
} from '../../src/agent/claimGate/semantic/schema.js';
import type { ClaimAssertionMode, ClaimEffectFamily } from '../../src/agent/claimGate/lexicon/types.js';

/**
 * The lexicon's families, AS A VALUE, derived from the TYPE.
 *
 * `ClaimEffectFamily` is a union with no runtime array behind it, so there is
 * nothing in `src/` to compare the port's array against. A `Record<Family, true>`
 * is the next best thing and is a real guard rather than a restatement: adding a
 * member to `ClaimEffectFamily` makes this literal fail `npm run typecheck` with
 * "property is missing", and removing one makes it fail with "does not exist".
 * Either way the drift is caught before the assertions below even run.
 */
const CLAIM_EFFECT_FAMILIES_FOR_TEST = Object.keys({
  MEETING: true,
  RESCHEDULE: true,
  CANCELLATION: true,
  CALLBACK: true,
  MESSAGE: true,
  RECORD: true,
  HANDOVER: true,
  ANY: true,
} satisfies Record<ClaimEffectFamily, true>);

/** The same trick for `ClaimAssertionMode`. */
const CLAIM_MODES_FOR_TEST = Object.keys({
  COMPLETED: true,
  COMMITTED: true,
} satisfies Record<ClaimAssertionMode, true>);

/** The text every grounded fixture quotes out of. */
const TEXT = 'Your meeting is booked for Thursday at 2pm, reference CONF123456.';

/** A valid claim, as a JSON string, with one field overridable. */
function answer(claim: Record<string, unknown>): string {
  return JSON.stringify({ claims: [claim] });
}

const VALID_CLAIM = {
  assertsEffect: true,
  effectFamily: 'MEETING',
  status: 'COMPLETED',
  whenPhrase: 'Thursday at 2pm',
  identifier: 'CONF123456',
  confidence: 0.9,
} as const;

describe('the two enums are the EXISTING claim-gate ones, not a second copy', () => {
  // The compile-time assertions in `schema.ts` already make a drift a type error.
  // These are the runtime half, because a type assertion cannot be read by
  // somebody skimming a test report and because the ARRAYS - which is what the
  // JSON Schema is built from - are values rather than types.
  it('SEMANTIC_CLAIM_EFFECT_FAMILIES is exactly ClaimEffectFamily', () => {
    expect([...SEMANTIC_CLAIM_EFFECT_FAMILIES].sort()).toEqual([...CLAIM_EFFECT_FAMILIES_FOR_TEST].sort());
  });

  it('the MATERIAL statuses are exactly ClaimAssertionMode', () => {
    expect([...MATERIAL_SEMANTIC_CLAIM_STATUSES].sort()).toEqual([...CLAIM_MODES_FOR_TEST].sort());
  });

  it('and the two non-material statuses are the only extras', () => {
    const extras = SEMANTIC_CLAIM_STATUSES.filter(
      (status) => !MATERIAL_SEMANTIC_CLAIM_STATUSES.includes(status),
    );
    expect([...extras].sort()).toEqual(['ATTEMPTED', 'NOT_CLAIMED']);
  });
});

describe('the JSON Schema handed to the model cannot drift from the Zod schema', () => {
  // `schema.ts` argues why the JSON Schema is hand-written rather than generated
  // (the authority-boundary test forbids importing `src/agent/tools`). This is the
  // drift guard that argument promises.
  const root = SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA as {
    additionalProperties?: boolean;
    required?: string[];
    properties?: { claims?: { items?: {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, { enum?: string[] }>;
    } } };
  };
  const items = root.properties?.claims?.items;

  it('finds the shape it is guarding, so it cannot pass vacuously', () => {
    expect(items, 'the claims/items node has moved').toBeDefined();
    expect(Object.keys(items?.properties ?? {}).length).toBeGreaterThan(0);
  });

  it('declares exactly the keys the Zod claim schema declares', () => {
    const zodKeys = Object.keys(SemanticClaimSchema.shape).sort();
    expect(Object.keys(items?.properties ?? {}).sort()).toEqual(zodKeys);
    expect([...(items?.required ?? [])].sort()).toEqual(zodKeys);
  });

  it('declares exactly the keys the Zod output schema declares, at the root', () => {
    expect(Object.keys(SemanticVerifierOutputSchema.shape)).toEqual(['claims']);
    expect(Object.keys(root.properties ?? {})).toEqual(['claims']);
    expect(root.required).toEqual(['claims']);
  });

  it('forbids additional properties at BOTH levels, like the .strict() it mirrors', () => {
    expect(root.additionalProperties).toBe(false);
    expect(items?.additionalProperties).toBe(false);
  });

  it('carries the exported enum arrays and not hand-copied members', () => {
    expect(items?.properties?.['effectFamily']?.enum).toEqual([...SEMANTIC_CLAIM_EFFECT_FAMILIES]);
    expect(items?.properties?.['status']?.enum).toEqual([...SEMANTIC_CLAIM_STATUSES]);
  });
});

describe('a well-formed, grounded answer', () => {
  it('parses, and the claim comes through unchanged', () => {
    const parsed = parseSemanticVerifierOutput(answer(VALID_CLAIM), TEXT);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.claims).toEqual([VALID_CLAIM]);
  });

  it('accepts an EMPTY claim list, which is a real answer and not a failure', () => {
    const parsed = parseSemanticVerifierOutput('{"claims":[]}', TEXT);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.claims).toEqual([]);
  });

  it('accepts nulls where the text names no day and no reference', () => {
    const parsed = parseSemanticVerifierOutput(
      answer({ ...VALID_CLAIM, whenPhrase: null, identifier: null }),
      TEXT,
    );
    expect(parsed.ok).toBe(true);
  });
});

describe('every way an answer can be wrong is MALFORMED', () => {
  // One `it` per failure mode, named as the mode, because the point of this block
  // is that a reader can check the list against the brief.
  const rejected = (raw: string): string => {
    const parsed = parseSemanticVerifierOutput(raw, TEXT);
    expect(parsed.ok, `expected this to be refused: ${raw}`).toBe(false);
    return parsed.ok ? '' : parsed.reason;
  };

  it('not JSON at all', () => {
    expect(rejected('the meeting is booked')).toContain('not JSON');
  });

  it('JSON, but not an object - an array at the root', () => {
    expect(rejected('[]')).toContain('schema validation');
  });

  it('an empty body', () => {
    expect(rejected('   ')).toContain('empty');
  });

  it('a MISSING field', () => {
    const { confidence: _dropped, ...withoutConfidence } = VALID_CLAIM;
    expect(rejected(answer(withoutConfidence))).toContain('confidence');
  });

  it('a missing `claims` key at the root', () => {
    expect(rejected('{}')).toContain('claims');
  });

  it('an OUT-OF-ENUM effect family', () => {
    expect(rejected(answer({ ...VALID_CLAIM, effectFamily: 'EMAIL' }))).toContain('effectFamily');
  });

  it('an OUT-OF-ENUM status', () => {
    expect(rejected(answer({ ...VALID_CLAIM, status: 'DONE' }))).toContain('status');
  });

  it('an EXTRA key nobody declared', () => {
    expect(rejected(answer({ ...VALID_CLAIM, supported: true }))).toContain('unrecognized');
  });

  it('an extra key at the ROOT - including one that looks like a verdict', () => {
    expect(rejected('{"claims":[],"clean":true}')).toContain('unrecognized');
  });

  it('a NON-NUMERIC confidence', () => {
    expect(rejected(answer({ ...VALID_CLAIM, confidence: 'high' }))).toContain('confidence');
  });

  it('a confidence ABOVE the range', () => {
    expect(rejected(answer({ ...VALID_CLAIM, confidence: 1.5 }))).toContain('confidence');
  });

  it('a confidence BELOW the range', () => {
    expect(rejected(answer({ ...VALID_CLAIM, confidence: -0.1 }))).toContain('confidence');
  });

  it('a wrong type on assertsEffect', () => {
    expect(rejected(answer({ ...VALID_CLAIM, assertsEffect: 'yes' }))).toContain('assertsEffect');
  });

  it('a wrong type on whenPhrase - a number where a phrase belongs', () => {
    expect(rejected(answer({ ...VALID_CLAIM, whenPhrase: 1400 }))).toContain('whenPhrase');
  });

  it('a wrong type on claims - an object where a list belongs', () => {
    expect(rejected('{"claims":{}}')).toContain('claims');
  });

  it('a quoted WHEN-PHRASE that does not occur in the text', () => {
    expect(rejected(answer({ ...VALID_CLAIM, whenPhrase: 'Friday at 4pm' }))).toContain(
      'whenPhrase does not occur in the text',
    );
  });

  it('a quoted IDENTIFIER that does not occur in the text', () => {
    expect(rejected(answer({ ...VALID_CLAIM, identifier: 'CONF999999' }))).toContain(
      'identifier does not occur in the text',
    );
  });

  it('an EMPTY STRING quotation, which is not the same as null', () => {
    expect(rejected(answer({ ...VALID_CLAIM, whenPhrase: '' }))).toContain('does not occur');
  });

  it('and the FIRST bad claim in a list of otherwise good ones fails the WHOLE answer', () => {
    // No partial acceptance. A schema that took the claims it liked would be a
    // schema a model could get half past.
    const raw = JSON.stringify({
      claims: [VALID_CLAIM, { ...VALID_CLAIM, whenPhrase: 'next Tuesday' }],
    });
    expect(rejected(raw)).toContain('claims[1]');
  });
});

describe('grounding: raw containment first, script normalisation as the ONLY fallback', () => {
  // The choice `schema.ts` documents, made a test. If somebody changes the rule,
  // one of these fails and says which direction it moved in.
  it('accepts a phrase that is a raw byte-for-byte substring', () => {
    expect(isGroundedInText('Thursday at 2pm', TEXT)).toBe(true);
  });

  it('accepts a Hebrew phrase whose niqqud normalizeScript strips', () => {
    // The real case: a model quoting Hebrew back will not reproduce vowel points.
    // Without the fallback this would be MALFORMED on ordinary Hebrew traffic.
    const withNiqqud = 'הפגישה נִקְבְּעָה ליום חמישי.';
    expect(withNiqqud.includes('נקבעה'), 'the fixture must NOT contain the bare form raw').toBe(false);
    expect(isGroundedInText('נקבעה', withNiqqud)).toBe(true);
  });

  it('accepts a phrase the text spells with a bidi control INSIDE it', () => {
    // A right-to-left mark sitting inside a word, which is what a mixed
    // Hebrew-English reply really contains. The model quotes the letters; the
    // text carries an invisible character between two of them.
    const withBidi = 'Your meeting is booked for Thu‏rsday at 2pm.';
    expect(withBidi.includes('Thursday'), 'the fixture must NOT contain the phrase raw').toBe(false);
    expect(isGroundedInText('Thursday at 2pm', withBidi)).toBe(true);
  });

  it('accepts a phrase the MODEL spells with a zero-width character the text does not have', () => {
    // The same forgiveness in the other direction, because normalisation runs on
    // both sides rather than only on the haystack.
    expect(isGroundedInText('Thurs​day at 2pm', TEXT)).toBe(true);
  });

  it('forgives CASE, which is the one forgiveness that is not script normalisation', () => {
    // Stated in `schema.ts` rather than hidden: `thursday` for `Thursday` is a
    // casing difference and not a different day.
    expect(isGroundedInText('thursday at 2pm', TEXT)).toBe(true);
  });

  it('REFUSES a paraphrase, which is the whole point of the rule', () => {
    expect(isGroundedInText('Thursday afternoon', TEXT)).toBe(false);
    expect(isGroundedInText('2 in the afternoon', TEXT)).toBe(false);
  });

  it('REFUSES a phrase assembled across a gap in the text', () => {
    // The fallback normalises; it does not tokenise, stem or match across a gap.
    expect(isGroundedInText('meeting Thursday', TEXT)).toBe(false);
  });

  it('REFUSES an empty or whitespace phrase', () => {
    expect(isGroundedInText('', TEXT)).toBe(false);
    expect(isGroundedInText('   ', TEXT)).toBe(false);
  });

  it('REFUSES a translated day name, which is the failure the fallback must not forgive', () => {
    expect(isGroundedInText('יום חמישי', TEXT)).toBe(false);
  });
});

describe('the verdict union makes "clean" unrepresentable as a failure', () => {
  it('names exactly one success kind and four failure kinds', () => {
    expect(SEMANTIC_CLAIM_VERDICT_KINDS).toContain('CLASSIFIED');
    expect([...SEMANTIC_CLAIM_FAILURE_KINDS].sort()).toEqual(['EMPTY', 'MALFORMED', 'TIMED_OUT', 'UNAVAILABLE']);
    expect(SEMANTIC_CLAIM_VERDICT_KINDS.filter((kind) => kind !== 'CLASSIFIED').sort()).toEqual(
      [...SEMANTIC_CLAIM_FAILURE_KINDS].sort(),
    );
  });

  it('and the failure guard narrows away the claim list', () => {
    for (const kind of SEMANTIC_CLAIM_FAILURE_KINDS) {
      expect(isSemanticClaimFailure({ kind, reason: 'x' })).toBe(true);
    }
    expect(isSemanticClaimFailure({ kind: 'CLASSIFIED', claims: [], modelId: null })).toBe(false);
  });
});
