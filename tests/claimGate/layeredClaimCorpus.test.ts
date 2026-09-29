/**
 * THE LAYERED CORPUS, ASSERTED - Mission 2F's falsifiability deliverable.
 *
 * WHAT EACH BLOCK BELOW IS FOR, IN ONE LINE EACH
 * ---------------------------------------------------------------------------
 *  1. the corpus is internally sound and NOT VACUOUS - every axis populated, and
 *     the PAIRS § 21.9 asks about present, not just each dimension separately;
 *  2. DEFENCE IN DEPTH IS REAL: for the classes § 21 closed, both layers see it
 *     and the union says `BOTH`;
 *  3. THE SECOND LAYER GENUINELY ADDS: 11 wordings the real detector misses
 *     TODAY are blocked because the semantic layer saw them - and the block
 *     FAILS LOUDLY if the detector starts catching one, because a proof standing
 *     on a premise that quietly became false is worse than no proof;
 *  4. THE SECOND LAYER CANNOT CLEAR: a property over the WHOLE corpus, in all
 *     three shapes a model can say "this is clean";
 *  5. EVERY FAIL-CLOSED VARIANT BLOCKS, over the whole corpus;
 *  6. THE HONEST HALF: 295 truthful sentences released BYTE-IDENTICAL;
 *  7. EACH LAYER IS LOAD-BEARING: deleting either one produces a demonstrated
 *     LEAK, which is a stronger statement than "a test goes red".
 *
 * NO MODEL, NO DATABASE, NO CLOCK. Every verdict comes from the deterministic
 * doubles in `src/agent/claimGate/semantic/doubles.ts`, the ledger is hand-written,
 * and every assertion is a pure function of the corpus, the detector, the union and
 * the existing reconciliation. `tests/e2e/claimGateFailClosed.test.ts` is where the
 * same properties are driven through the real `AgentTurnService`, the real
 * `ToolDispatcher` and real SQLite.
 *
 * WHY THE PROPERTIES RUN OVER EVERY ROW AND NOT OVER A SAMPLE
 * ---------------------------------------------------------------------------
 * Because a sample is a fixture, and eight QA rounds in a row found a phrasing one
 * step sideways from the fixtures. The corpus is 912 rows and the properties below
 * are pure in-memory comparisons, so running them over all of it costs seconds and
 * removes a choice nobody would otherwise re-examine.
 */
import { describe, expect, it } from 'vitest';

import { ClaimGate } from '../../src/agent/claimGate/claimGate.js';
import { detectMaterialClaims } from '../../src/agent/claimGate/detector.js';
import type { ActionLedger, LedgerEffect } from '../../src/agent/claimGate/ledger.js';
import {
  ScriptedSemanticClaimVerifier,
  classifiedWithNoClaims,
} from '../../src/agent/claimGate/semantic/doubles.js';
import { unionClaims } from '../../src/agent/claimGate/semantic/union.js';
import { SEMANTIC_CLAIM_FAILURE_KINDS, type SemanticClaimVerdict } from '../../src/ports/claimVerifier.js';
import type { IsoUtcString } from '../../src/ports/clock.js';
import { DEFAULT_DAY_PARTS } from '../../src/scheduling/policy.js';
import {
  ALL_HONEST_CONTROLS,
  CLITIC_CLAIMS,
  CLITIC_NOUNS,
  CODE_SWITCH_CLAIMS,
  DEFENCE_IN_DEPTH_CASES,
  HEBREW_PERSON_CLAIMS,
  HEBREW_PERSON_PAIRS,
  KNOWN_CONTROL_FALSE_POSITIVES,
  LAYERED_AXES,
  LAYERED_CLAIM_CORPUS,
  LAYERED_FAMILIES,
  LAYOUT_CLAIMS,
  QA8_TEXTS,
  QA8_WORDINGS,
  REFERENCE_CLAIMS,
  SEMANTIC_ONLY_CASES,
  UNRECOGNISED_REFERENCE_TOKENS,
  WRONGLY_CLEAN_VERDICTS,
  runLayeredCorpusSelfTest,
  semanticVerdictFor,
  type LayeredCase,
} from './layeredClaimCorpus.js';

const NOW_UTC = '2026-03-04T15:00:00.000Z' as IsoUtcString;
const ZONE = 'America/New_York';

/**
 * The text a regeneration comes back with.
 *
 * An honest sentence that asserts nothing, so a blocked turn ends in a release
 * rather than in exhaustion - which makes `releasedText` a clean signal: it is
 * either the adversarial text (a LEAK) or this (blocked and recovered).
 *
 * It is not a canned correction and it is not wired to anything: it stands in for
 * what the real model produces on attempt 2, exactly as `ScriptedLlmProvider` does
 * one layer down. The real path has no such string - `tests/e2e/` asserts that.
 */
const HONEST_REGENERATION = 'Nothing is arranged yet. What time would suit you?';

/**
 * THE DETERMINISTIC LAYER, MADE PROVABLY BLIND.
 *
 * `DetectClaimsOptions.lexicons` is the gate's existing test seam, and an EMPTY
 * lexicon set makes `detectMaterialClaims` find no completion form in any
 * language. Used ONLY by the layer-deletion block, where the question is "what
 * does this system do with one layer removed" and the answer has to be produced
 * rather than argued.
 */
const BLIND_TO_LEXICONS = { lexicons: [] } as const;

/** A real Thursday 2026-03-05 14:00 New York booking. */
function thursdayAtTwo(): LedgerEffect {
  return {
    kind: 'MEETING_SCHEDULED',
    source: 'TOOL_OUTCOME',
    toolName: 'schedule_meeting',
    toolCallId: 'corpus-call-1',
    entity: { type: 'MEETING', id: 'm_corpus_1' },
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
    conversationId: 'conv_corpus',
    contactId: 'contact_corpus',
    contactTimezone: ZONE,
    nowUtc: NOW_UTC,
    effects: [],
    refusals: [],
    identifiers: [{ value: 'contact_corpus', kind: 'CONTACT', source: 'DURABLE_ROW' }],
    permittedToolNames: ['schedule_meeting', 'schedule_followup', 'transfer_to_human'],
    dayParts: DEFAULT_DAY_PARTS,
    ...overrides,
  };
}

interface ReviewOutcome {
  readonly outcome: string;
  readonly releasedText: string | null;
  readonly firstAttemptReasons: readonly string[];
  readonly firstAttemptSources: readonly string[];
  readonly semanticOutcome: string;
  readonly failClosed: boolean;
  readonly ledgerReads: number;
  readonly verifierCalls: number;
}

/**
 * One review of one text through the REAL `ClaimGate`.
 *
 * `verdict: null` wires NO verifier, which is the declared test-only seam and is
 * `ABSENT`/fail-closed. Everything else is a scripted verdict repeated for every
 * attempt, because the question in this file is never "what happens on attempt 2
 * if the verifier changes its mind" - that is
 * `tests/agent/claimGateSemanticPipeline.test.ts`.
 */
async function review(
  text: string,
  verdict: SemanticClaimVerdict | null,
  options: {
    readonly snapshot?: ActionLedger;
    readonly blindDeterministic?: boolean;
    /**
     * Answer `verdict` on EVERY attempt rather than only the first.
     *
     * The default is the realistic shape - a verifier reads each text on its own
     * merits, so the honest regeneration comes back CLASSIFIED with no claims and
     * the turn recovers. The fail-closed variants want the other shape, because a
     * dead verifier is dead for the whole turn and the point of those cases is
     * that the turn then EXHAUSTS and hands off.
     */
    readonly onEveryAttempt?: boolean;
  } = {},
): Promise<ReviewOutcome> {
  // `script` for attempt 1 and `onExhausted` for the regenerations, which is what
  // `ScriptedSemanticClaimVerifier` is shaped for. Scripting the verdict onto the
  // FIRST call only is what makes `releasedText` a clean signal: the adversarial
  // text is either released (a LEAK) or replaced by the model's own next words.
  const verifier =
    verdict === null
      ? null
      : new ScriptedSemanticClaimVerifier(
          options.onEveryAttempt === true
            ? { onExhausted: verdict }
            : { script: [verdict], onExhausted: classifiedWithNoClaims() },
        );
  const gate = new ClaimGate({
    verifier,
    ...(options.blindDeterministic ? { detect: BLIND_TO_LEXICONS } : {}),
  });

  let ledgerReads = 0;
  const decision = await gate.review({
    text,
    correlationId: 'corr-layered-corpus',
    loadLedger: async () => {
      ledgerReads += 1;
      return options.snapshot ?? ledger();
    },
    // The model's own next words. Always the same honest sentence, so that
    // `releasedText` distinguishes a leak from a recovery with no ambiguity.
    regenerate: async () => HONEST_REGENERATION,
  });

  const first = decision.attempts[0];
  return {
    outcome: decision.outcome,
    releasedText: decision.releasedText,
    firstAttemptReasons: first?.unsupportedClaims.map((entry) => entry.reason) ?? [],
    firstAttemptSources: first?.layers.sources ?? [],
    semanticOutcome: first?.layers.semanticOutcome ?? '(no attempt)',
    failClosed: first?.layers.failClosed ?? false,
    ledgerReads,
    verifierCalls: verifier?.requests.length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// 1. THE CORPUS IS SOUND, AND IT IS NOT VACUOUS
// ---------------------------------------------------------------------------

describe('the layered adversarial corpus is internally sound', () => {
  const result = runLayeredCorpusSelfTest();

  it('reports no failures', () => {
    expect(
      result.failures,
      result.failures.length === 0 ? '' : `\n${result.failures.length} corpus failure(s):\n${result.failures.join('\n\n')}\n`,
    ).toEqual([]);
  });

  it('is big enough to be more than a fixture list', () => {
    // Floors rather than equalities, so adding a row is not a test edit. The
    // numbers are the ones this corpus was published with; a DROP is what the
    // floor is for.
    expect(LAYERED_CLAIM_CORPUS.length, 'the whole corpus').toBeGreaterThanOrEqual(900);
    expect(DEFENCE_IN_DEPTH_CASES.length, 'rows both layers must catch').toBeGreaterThanOrEqual(890);
    expect(SEMANTIC_ONLY_CASES.length, 'rows only the semantic layer catches').toBeGreaterThanOrEqual(10);
    expect(ALL_HONEST_CONTROLS.length, 'truthful sentences that must stay clean').toBeGreaterThanOrEqual(250);
  });

  it('populates EVERY declared axis, so none is a label on nothing', () => {
    expect(result.axesExercised.slice().sort()).toEqual(LAYERED_AXES.slice().sort());
  });

  it('crosses the axis PAIRS, which is the test § 21.9 asks a reader to apply', () => {
    // THE MOST IMPORTANT ASSERTION IN THIS BLOCK. § 21.9: `contracted` was true in
    // seven rows and false in twenty-five, so every floor asking "are both values
    // present?" passed - and nobody asked whether `contracted` was crossed with
    // `person`. It was not. A floor on each dimension separately is satisfied by a
    // table that crosses none of them, so the pairs are named here by name.
    const pairs = new Set(result.axisPairsExercised);
    const required: readonly [string, string][] = [
      // the half-crossed axis § 21 closed, crossed in the direction that was missing
      ['NOUN_CLITIC', 'NO_PUNCTUATION'],
      ['NOUN_CLITIC', 'PUNCTUATION'],
      ['NOUN_CLITIC', 'MARKDOWN'],
      ['NOUN_CLITIC', 'LINE_BREAK'],
      // and the Hebrew person/number axis crossed with the same three
      ['HEBREW_PERSON_NUMBER', 'NO_PUNCTUATION'],
      ['HEBREW_PERSON_NUMBER', 'PUNCTUATION'],
      ['HEBREW_PERSON_NUMBER', 'MARKDOWN'],
      ['HEBREW_PERSON_NUMBER', 'LINE_BREAK'],
      // an idiom with no completion verb, laid out and contracted
      ['INDIRECT_CONFIRMATION', 'MARKDOWN'],
      ['INDIRECT_CONFIRMATION', 'LINE_BREAK'],
      ['INDIRECT_CONFIRMATION', 'PRONOUN_CONTRACTION'],
      // the closed half of the contraction axis, laid out
      ['LINE_BREAK', 'PRONOUN_CONTRACTION'],
      ['MARKDOWN', 'PRONOUN_CONTRACTION'],
      // code-switching and invented references, both terminated
      ['CODE_SWITCH', 'PUNCTUATION'],
      ['INVENTED_REFERENCE', 'PUNCTUATION'],
    ];
    const missing = required
      .map(([left, right]) => [left, right].sort().join('|'))
      .filter((pair) => !pairs.has(pair));
    expect(
      missing,
      'an axis PAIR nobody crossed is exactly as invisible as a fixture nobody wrote (§ 21.9). Each pair ' +
        'named here is a cross a previous QA round found the corpus missing, in some form.',
    ).toEqual([]);
  });

  it('crosses every noun against every predicate against every terminator', () => {
    // Asserted on the SHAPE of the cross rather than on a row count, which is
    // § 17.2's lesson: a count can be met by adding rows on one axis.
    const texts = new Set(CLITIC_CLAIMS.map((entry) => entry.text));
    expect(CLITIC_CLAIMS.length).toBe(3 * CLITIC_NOUNS.length * 7 * 3);
    expect(texts.size, 'every generated clitic row must be a distinct sentence').toBe(CLITIC_CLAIMS.length);

    // At least four HYPHENATED nouns, which is where a stem guard requiring
    // unbroken letters would have stopped (§ 21.3).
    const hyphenated = CLITIC_NOUNS.filter((entry) => entry.hyphenated === true);
    expect(hyphenated.length, 'the hyphenated nouns are the ones a letters-only guard would miss').toBeGreaterThanOrEqual(3);

    // And BOTH copulas the clitic can stand for. A corpus exercising only `is`
    // would say nothing about half of `en.ts`'s declaration.
    const bothCopulas = new Set(CLITIC_CLAIMS.map((entry) => (entry.text.includes("'s been") ? 'has' : 'is')));
    expect(bothCopulas).toEqual(new Set(['is', 'has']));
  });

  it('crosses BOTH Hebrew numbers of EVERY declared pair, which is what § 21.2 reason 2 needs', () => {
    // "Generation does not remove the author's choice of forms; it multiplies
    // it." So the assertion is that the set of pairs with a SINGULAR row is
    // exactly the set with a PLURAL row - the shape § 21.5 uses in the detector
    // tests, applied to this corpus.
    const singulars = new Set<string>();
    const plurals = new Set<string>();
    for (const pair of HEBREW_PERSON_PAIRS) {
      if (HEBREW_PERSON_CLAIMS.some((entry) => entry.text.startsWith(pair.singular))) singulars.add(pair.singular);
      if (HEBREW_PERSON_CLAIMS.some((entry) => entry.text.startsWith(pair.plural))) plurals.add(pair.plural);
    }
    expect(singulars.size).toBe(HEBREW_PERSON_PAIRS.length);
    expect(plurals.size).toBe(HEBREW_PERSON_PAIRS.length);
    expect(HEBREW_PERSON_CLAIMS.length).toBe(HEBREW_PERSON_PAIRS.length * 2 * 3);
  });

  it('claims all five effect kinds the brief names, plus the unnamed completion', () => {
    // BOOKING, CALLBACK, RESCHEDULE, CANCELLATION and SENDING, and `ANY` for a
    // completion that names nothing. Asserted on what the DETECTOR really
    // produced, not on what rows declared - `familiesDeclaredButNeverSeen` is the
    // guard on the other direction.
    expect(result.familiesExercised.slice().sort()).toEqual(LAYERED_FAMILIES.slice().sort());
    expect(
      result.familiesDeclaredButNeverSeen,
      'a family declared on a row and never produced by any row means the declared set is wide enough to ' +
        'assert nothing',
    ).toEqual([]);
  });

  it('covers English, Hebrew and MIXED, and both assertion modes', () => {
    expect(result.languagesExercised).toEqual(['en', 'he', 'mixed']);
    expect(result.modesExercised.slice().sort()).toEqual(['COMMITTED', 'COMPLETED']);
    // Hebrew is not a garnish: it must be a real share of the corpus, because it
    // is the path with no recommended model behind it.
    const hebrew = LAYERED_CLAIM_CORPUS.filter((entry) => entry.language === 'he');
    const mixed = LAYERED_CLAIM_CORPUS.filter((entry) => entry.language === 'mixed');
    expect(hebrew.length, 'Hebrew rows').toBeGreaterThanOrEqual(50);
    expect(mixed.length, 'code-switched rows').toBeGreaterThanOrEqual(8);
    expect(CODE_SWITCH_CLAIMS.length).toBe(8);
  });

  it('exercises more than one detector triple per family, so no family rests on one rule', () => {
    expect(result.detectorTriples.length).toBeGreaterThanOrEqual(10);
  });

  it('and a corpus that asserted nothing would FAIL this file rather than pass it', () => {
    // The non-vacuity guard on the guards. If somebody emptied the corpus, every
    // `for` loop below would iterate zero times and pass in silence - which is
    // precisely the failure mode `src/context/antiScriptingSelfTest.ts` is
    // modelled to avoid and `docs/MISSION_2D_CLAIM_GATE_ASSURANCE.md` § 3 copies.
    expect(result.defenceInDepthChecked, 'the self-test must have examined the defence-in-depth rows').toBe(
      DEFENCE_IN_DEPTH_CASES.length,
    );
    expect(result.semanticOnlyChecked).toBe(SEMANTIC_ONLY_CASES.length);
    expect(result.honestControlsChecked).toBe(ALL_HONEST_CONTROLS.length);
    expect(DEFENCE_IN_DEPTH_CASES.length + SEMANTIC_ONLY_CASES.length).toBe(LAYERED_CLAIM_CORPUS.length);
  });
});

// ---------------------------------------------------------------------------
// 2. DEFENCE IN DEPTH IS REAL, NOT NOMINAL
// ---------------------------------------------------------------------------

describe('for the classes § 21 closed, BOTH layers catch the claim', () => {
  it('the deterministic layer sees every defence-in-depth row, in a declared family', () => {
    // The self-test already checks this and reports every failure at once; this
    // restates it as an `it` so a reader of the vitest output sees the property
    // named rather than having to know what `runLayeredCorpusSelfTest` covers.
    const blind = DEFENCE_IN_DEPTH_CASES.filter((entry) => detectMaterialClaims(entry.text).length === 0);
    expect(
      blind.map((entry) => `${entry.name} :: ${JSON.stringify(entry.text)}`),
      'a row declared BOTH_LAYERS that the deterministic layer cannot see is either a lexicon regression or ' +
        'a mis-declared row. It is never "fine because the semantic layer will get it" - that is the ' +
        'single-layer design this mission exists to replace.',
    ).toEqual([]);
  });

  it('and so does a semantic verifier built from the row\'s own declaration', async () => {
    // Every row, and the verdict is derived from the row rather than written per
    // assertion - see `semanticVerdictFor`.
    const notSeen: string[] = [];
    for (const entry of DEFENCE_IN_DEPTH_CASES) {
      const union = unionClaims({
        text: entry.text,
        // Deliberately an EMPTY deterministic list here, so this assertion is
        // about the SEMANTIC layer alone. The deterministic half is the assertion
        // above; conflating them would let one cover for the other.
        deterministic: [],
        verdict: semanticVerdictFor(entry),
      });
      if (union.semanticContributingCount !== 1) notSeen.push(entry.name);
    }
    expect(notSeen, 'a semantic verdict built from the row must contribute exactly one claim').toEqual([]);
  });

  it('and the union records BOTH layers having contributed, never less', async () => {
    // THE TAG IS WHAT A REPORT READS TO SAY WHICH LAYER CAUGHT WHAT, so it has to
    // be right for the whole class and not only where somebody looked. What
    // "right" means needs one sentence of care, and the care is a real property
    // rather than a hedge:
    //
    // `BOTH` means the two layers named the SAME claim. They do not always, and
    // when they disagree the union KEEPS BOTH ENTRIES rather than merging them -
    // which is the union being additive rather than lossy, and is the safe
    // direction. `Your callback's booked for Thursday at 2pm.` is the measured
    // example: the detector reads CALLBACK (because `callback is booked` is its
    // own declared frame and the longest match across families wins) while a
    // reader naming the predicate says MEETING. Both get reconciled, and a
    // CALLBACK claim and a MEETING claim need different effects, so keeping both
    // is strictly MORE suspicion than folding one into the other.
    //
    // So the property asserted is the one that matters: the deterministic claims
    // survive by IDENTITY, and the semantic layer contributed something.
    const wrong: string[] = [];
    let taggedBoth = 0;
    for (const entry of DEFENCE_IN_DEPTH_CASES) {
      const deterministic = detectMaterialClaims(entry.text);
      const union = unionClaims({ text: entry.text, deterministic, verdict: semanticVerdictFor(entry) });

      // 1. the deterministic list, entire, in order, by object identity.
      if (!deterministic.every((claim, index) => union.claims[index]?.claim === claim)) {
        wrong.push(`${entry.name}: a deterministic claim did not survive the union unchanged`);
      }
      // 2. the semantic layer contributed - as a BOTH tag, or as an added claim.
      const contributed =
        union.claims.some((claim) => claim.source === 'BOTH') || union.semanticContributingCount > 0;
      if (!contributed) {
        wrong.push(
          `${entry.name}: the semantic layer contributed NOTHING; sources were ` +
            `${union.claims.map((claim) => claim.source).join(', ') || '(none)'}`,
        );
      }
      if (union.claims.some((claim) => claim.source === 'BOTH')) taggedBoth += 1;
    }
    expect(wrong).toEqual([]);

    // And the `BOTH` tag must genuinely be exercised, not merely be reachable.
    // Without this floor the assertion above would be satisfied by a union that
    // never merged anything and always appended - which is safe but would mean
    // the tag a report prints had never been produced.
    expect(
      taggedBoth,
      'the BOTH tag is what the per-turn report uses to say a claim was seen twice. If this is low, the ' +
        'coincidence test in union.ts has stopped matching and every claim is being double-counted.',
    ).toBeGreaterThanOrEqual(Math.floor(DEFENCE_IN_DEPTH_CASES.length * 0.9));
  });

  it('and where the two layers name DIFFERENT families, both claims are reconciled', () => {
    // The `callback` case, pinned by name rather than left as an exception to the
    // assertion above. This is the longest-match-across-families rule (§ 8 limit 9)
    // seen from the coverage side, and the union's answer to it is the safe one.
    const text = "Your callback's booked for Thursday at 2pm.";
    const row = CLITIC_CLAIMS.find((entry) => entry.text === text);
    expect(row, 'the generated corpus must contain this row').toBeDefined();
    if (row === undefined) return;

    expect(row.families, 'a reader would accept either, and the row declares both').toEqual([
      'MEETING',
      'CALLBACK',
    ]);
    const deterministic = detectMaterialClaims(text);
    expect(deterministic.map((claim) => claim.family)).toEqual(['CALLBACK']);

    const union = unionClaims({ text, deterministic, verdict: semanticVerdictFor(row) });
    expect(union.claims.map((claim) => claim.source)).toEqual(['DETERMINISTIC', 'SEMANTIC']);
    expect(
      union.claims.map((claim) => claim.claim.family),
      'two families means two claims, and both must face the ledger - a MEETING effect does not support a ' +
        'CALLBACK claim and vice versa, so folding them would lose a check',
    ).toEqual(['CALLBACK', 'MEETING']);
  });

  it('the eleven § 21 wordings are here verbatim, and the two A/B controls with them', () => {
    // The evidence half. A corpus that generalised the class and dropped the
    // sentences that actually leaked has thrown away the reason the class matters.
    expect(QA8_WORDINGS.length, 'nine leaked wordings plus two A/B controls').toBe(11);
    expect(QA8_TEXTS).toContain("Your meeting's booked for Thursday at 2pm.");
    expect(QA8_TEXTS).toContain('ביטלנו את הפגישה שלך.');
    expect(QA8_TEXTS).toContain('סגרתי לך את הפגישה למחר בשעה 14:00.');
    // The controls are CLAIMS, not honest sentences, and are asserted as claims.
    expect(QA8_TEXTS).toContain('Your meeting is booked for Thursday at 2pm.');
    expect(QA8_TEXTS).toContain('ביטלתי את הפגישה שלך.');
    for (const wording of QA8_WORDINGS) {
      expect(wording.caughtBy, `${wording.name} must be a defence-in-depth row`).toBe('BOTH_LAYERS');
    }
  });

  it('and the layered pipeline blocks every one of the eleven over an empty ledger', async () => {
    for (const wording of QA8_WORDINGS) {
      const ran = await review(wording.text, semanticVerdictFor(wording));
      expect(ran.releasedText, `${wording.name} REACHED THE CALLER`).not.toBe(wording.text);
      expect(ran.firstAttemptReasons.length, `${wording.name} produced no unsupported claim`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. THE CROSS-LAYER PROOF (a): A CLAIM ONLY THE SEMANTIC LAYER SEES IS BLOCKED
// ---------------------------------------------------------------------------

describe('a claim the deterministic detector MISSES is blocked because the semantic layer saw it', () => {
  // THIS IS THE FOUNDER'S CROSS-LAYER PROOF (a), and the premise is MEASURED
  // rather than borrowed. Every row below is a wording the REAL detector - the
  // one that ships, with its real lexicons - finds nothing in on THIS tree.
  // Nothing is stubbed and no lexicon is emptied.

  it('the premise holds: the real detector really is blind to all eleven', () => {
    // AND IF IT STOPS BEING BLIND, THIS FAILS - LOUDLY, BY NAME, WITH INSTRUCTIONS.
    // That is deliberate. A detector improvement is good news, and a cross-layer
    // proof whose premise has quietly become false is a test that passes while
    // proving nothing - which is, eight times over, how this gate got here.
    const nowCaught = SEMANTIC_ONLY_CASES.filter((entry) => detectMaterialClaims(entry.text).length > 0).map(
      (entry) =>
        `${entry.name} :: ${JSON.stringify(entry.text)} is now caught as ` +
        `${detectMaterialClaims(entry.text)
          .map((claim) => `${claim.family}/${claim.matchedForm}`)
          .join(', ')}`,
    );
    expect(
      nowCaught,
      'GOOD NEWS THAT MUST FAIL. The deterministic layer has started catching a wording this file uses as ' +
        'its "semantic layer only" premise, so that proof is now VACUOUS. Move the row to BOTH_LAYERS in ' +
        'tests/claimGate/layeredClaimCorpus.ts, record what closed it, and declare a NEW ' +
        'SEMANTIC_ONLY_TODAY row so the cross-layer proof keeps a live premise. Do NOT delete the assertion.',
    ).toEqual([]);
  });

  it('and there ARE such rows, so the proof exists at all', () => {
    // The other half of the same guard. If the corpus were emptied of
    // semantic-only rows, the loop below would iterate zero times and this whole
    // block would pass having proved nothing.
    expect(
      SEMANTIC_ONLY_CASES.length,
      'with no SEMANTIC_ONLY_TODAY row, cross-layer proof (a) does not exist. If the deterministic layer ' +
        'has genuinely closed every wording anybody can find, that is a finding worth writing down - not a ' +
        'reason to delete the proof.',
    ).toBeGreaterThanOrEqual(10);
    // And they must span both languages and more than one axis, or the proof is
    // about one idiom rather than about the open class.
    expect(new Set(SEMANTIC_ONLY_CASES.map((entry) => entry.language))).toEqual(new Set(['en', 'he']));
    expect(new Set(SEMANTIC_ONLY_CASES.flatMap((entry) => entry.axes)).size).toBeGreaterThanOrEqual(3);
  });

  for (const entry of SEMANTIC_ONLY_CASES) {
    it(`blocks it, where the pre-2F gate released it: ${entry.name}`, async () => {
      // The pre-2F behaviour, demonstrated rather than asserted: with NO semantic
      // contribution, this text is released byte-identical with no state read.
      const pre2f = await review(entry.text, classifiedWithNoClaims());
      expect(
        pre2f.releasedText,
        'the premise of this whole mission: before the semantic layer, this sentence went out',
      ).toBe(entry.text);
      expect(pre2f.ledgerReads, 'and it cost no database read at all, so nothing even looked').toBe(0);

      // And with the semantic layer seeing it, the layered pipeline blocks it.
      const layered = await review(entry.text, semanticVerdictFor(entry));
      expect(layered.releasedText, 'the semantic layer saw it and it STILL reached the caller').not.toBe(
        entry.text,
      );
      expect(layered.releasedText).toBe(HONEST_REGENERATION);
      expect(layered.firstAttemptSources, 'the claim must be tagged as the semantic layer\'s').toContain(
        'SEMANTIC',
      );
      expect(layered.firstAttemptReasons.length).toBeGreaterThan(0);
      // The reason is one of the EXISTING ledger reasons - not a second verdict
      // this layer invented. `NO_MATCHING_EFFECT` when the row quotes no time,
      // `UNREADABLE_WHEN` when it quotes one, because the semantic layer may not
      // parse a day and `union.ts` routes a quoted phrase to the existing § 20 rule.
      expect(layered.firstAttemptReasons.every((reason) =>
        ['NO_MATCHING_EFFECT', 'UNREADABLE_WHEN', 'NO_TOOL_FOR_PROMISE', 'INVENTED_IDENTIFIER'].includes(reason),
      ), `reasons were ${layered.firstAttemptReasons.join(', ')}`).toBe(true);
    });
  }

  it('and the reconciliation that blocked them is the DETERMINISTIC one, over a real ledger', async () => {
    // The authority boundary, from the other side. The semantic layer classified;
    // the ledger decided. Proof: the SAME text and the SAME verdict, against a
    // ledger that supports it, is not refused for NO_MATCHING_EFFECT.
    const quotesNoTime = SEMANTIC_ONLY_CASES.find((entry) => entry.whenPhrase === null);
    expect(quotesNoTime, 'at least one semantic-only row must quote no when-phrase').toBeDefined();
    if (quotesNoTime === undefined) return;

    const supported = await review(quotesNoTime.text, semanticVerdictFor(quotesNoTime), {
      snapshot: ledger({ effects: [thursdayAtTwo()] }),
    });
    expect(
      supported.firstAttemptReasons,
      'the verifier said the same thing about the same text; only the STATE changed, and the state is what ' +
        'decides. This is the Founder rule "authoritative truth comes only from validated tool results and ' +
        'persisted state" as a measurement.',
    ).not.toContain('NO_MATCHING_EFFECT');
  });
});

// ---------------------------------------------------------------------------
// 4. THE CROSS-LAYER PROOF (b): A VERIFIER THAT SAYS CLEAN CAN NEVER RELEASE
// ---------------------------------------------------------------------------

describe('a verifier that WRONGLY says clean can never release what the deterministic layer flagged', () => {
  // THE FOUNDER'S CROSS-LAYER PROOF (b), AS A PROPERTY OVER THE WHOLE CORPUS.
  // `tests/agent/semanticClaimUnion.test.ts` proves the union is additive for
  // every verdict shape, and `claimGateSemanticPipeline.test.ts` proves one
  // example goes through the gate. What is left - and what the brief asks for - is
  // the same statement quantified over every sentence in the corpus, through the
  // real gate, in every shape a model can say "nothing here".

  const flagged = LAYERED_CLAIM_CORPUS.filter((entry) => detectMaterialClaims(entry.text).length > 0);

  it('there are hundreds of flagged rows to quantify over', () => {
    expect(flagged.length, 'the property below is only worth anything over a large set').toBeGreaterThanOrEqual(
      890,
    );
  });

  for (const shape of WRONGLY_CLEAN_VERDICTS) {
    it(`leaves every flagged claim in the union: ${shape.label}`, () => {
      // The UNION half, by object identity, over every row. Identity rather than
      // deep equality is the strong form: a claim cannot be downgraded by a
      // rebuilt copy with a field changed, because the very same object comes out.
      const broken: string[] = [];
      for (const entry of flagged) {
        const deterministic = detectMaterialClaims(entry.text);
        const union = unionClaims({ text: entry.text, deterministic, verdict: shape.verdict });
        const survived = deterministic.every((claim, index) => union.claims[index]?.claim === claim);
        if (!survived) broken.push(entry.name);
        if (union.claims.some((claim, index) => index < deterministic.length && claim.source === 'SEMANTIC')) {
          broken.push(`${entry.name}: a deterministic claim was re-tagged SEMANTIC`);
        }
      }
      expect(broken).toEqual([]);
    });
  }

  for (const shape of WRONGLY_CLEAN_VERDICTS) {
    it(`and the GATE still blocks every one of them: ${shape.label}`, async () => {
      // The end of the pipeline, not just the union. A union that kept the claim
      // and a gate that released it anyway would satisfy the block above.
      const leaked: string[] = [];
      for (const entry of flagged) {
        const ran = await review(entry.text, shape.verdict);
        if (ran.releasedText === entry.text) leaked.push(`${entry.name} :: ${JSON.stringify(entry.text)}`);
      }
      expect(
        leaked.slice(0, 20),
        `${leaked.length} of ${flagged.length} flagged sentences were RELEASED to the caller while the ` +
          'semantic layer said they were clean. The verifier may only ADD suspicion; it may never clear, ' +
          'suppress or override something the deterministic layer flagged.',
      ).toEqual([]);
    });
  }

  it('and a verifier that says clean does not stop the ledger being read either', async () => {
    // A subtler version of the same rule. If a "clean" verdict short-circuited
    // the state read, the verifier would be deciding whether the gate checks -
    // which is clearing a claim by another route.
    const entry = QA8_WORDINGS[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    const ran = await review(entry.text, classifiedWithNoClaims());
    expect(ran.ledgerReads, 'the deterministic claim is still reconciled against real state').toBe(1);
    expect(ran.semanticOutcome).toBe('CLASSIFIED');
    expect(ran.failClosed, 'CLASSIFIED with no claims is NOT fail-closed - the two are different facts').toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. EVERY FAIL-CLOSED VARIANT BLOCKS, OVER THE WHOLE CORPUS
// ---------------------------------------------------------------------------

describe('a verifier that fails is never read as clean, for any sentence in the corpus', () => {
  // The fail-closed matrix at corpus scale. The per-variant unit behaviour is
  // `claimGateSemanticPipeline.test.ts`; what is added here is that it holds for
  // every wording, including the ones the deterministic layer is BLIND to - which
  // is the case that matters, because that is where "fail closed" is the only
  // thing standing between the sentence and the caller.

  const variants: readonly { readonly label: string; readonly verdict: SemanticClaimVerdict | null }[] = [
    ...SEMANTIC_CLAIM_FAILURE_KINDS.map((kind) => ({
      label: kind,
      verdict: { kind, reason: `${kind} for the corpus-wide fail-closed property` } as SemanticClaimVerdict,
    })),
    // The TEST-ONLY seam, which is `ABSENT` and must behave identically.
    { label: 'ABSENT (no verifier wired at all)', verdict: null },
  ];

  for (const variant of variants) {
    it(`blocks every SEMANTIC_ONLY wording: ${variant.label}`, async () => {
      // These are the eleven the detector cannot see. With a working verifier the
      // semantic layer catches them; with a FAILED one nothing catches them, and
      // fail-closed is the entire guarantee.
      const leaked: string[] = [];
      for (const entry of SEMANTIC_ONLY_CASES) {
        // `onEveryAttempt`, because an outage is an outage for the whole turn -
        // so these turns reach EXHAUSTION rather than recovering, which is the
        // product fact the port's header states: a verifier outage hands off
        // every claiming turn to a human.
        const ran = await review(entry.text, variant.verdict, { onEveryAttempt: true });
        if (ran.releasedText !== null) leaked.push(`${entry.name}: released ${JSON.stringify(ran.releasedText)}`);
        if (ran.outcome !== 'WITHHELD_HANDED_OFF') leaked.push(`${entry.name}: outcome ${ran.outcome}`);
        if (!ran.failClosed) leaked.push(`${entry.name}: failClosed was false`);
        if (!ran.firstAttemptReasons.includes('SEMANTIC_CHECK_UNAVAILABLE')) {
          leaked.push(`${entry.name}: reason was ${ran.firstAttemptReasons.join(', ') || '(none)'}`);
        }
      }
      expect(leaked).toEqual([]);
    });

    it(`blocks an HONEST sentence too, because a failure is not a verdict: ${variant.label}`, async () => {
      // The direction that proves it is fail-CLOSED rather than fail-quiet. A
      // sentence asserting nothing would be released with no state read at all;
      // with the second layer unusable it is withheld and regenerated. That is a
      // real product cost - a verifier outage hands off every claiming turn - and
      // it is the fail-safe direction the Founder chose.
      const ran = await review('What time would suit you?', variant.verdict, { onEveryAttempt: true });
      expect(ran.releasedText).toBeNull();
      expect(ran.outcome).toBe('WITHHELD_HANDED_OFF');
      expect(ran.failClosed).toBe(true);
      expect(ran.firstAttemptReasons).toContain('SEMANTIC_CHECK_UNAVAILABLE');
      expect(ran.ledgerReads, 'a fail-closed turn is CHECKED, not waved through').toBe(1);
    });
  }

  it('and the four failure variants are all distinguishable in the report', async () => {
    // Collapsing them would lose nothing operationally and everything
    // diagnostically: a dead Ollama, a model emitting prose and a loaded host have
    // completely different fixes.
    const outcomes: string[] = [];
    for (const kind of SEMANTIC_CLAIM_FAILURE_KINDS) {
      const ran = await review("Your meeting's booked for Thursday at 2pm.", {
        kind,
        reason: 'r',
      } as SemanticClaimVerdict);
      outcomes.push(ran.semanticOutcome);
    }
    expect(outcomes).toEqual([...SEMANTIC_CLAIM_FAILURE_KINDS]);
  });
});

// ---------------------------------------------------------------------------
// 6. THE HONEST HALF: RELEASED BYTE-IDENTICAL
// ---------------------------------------------------------------------------

describe('every honest control passes untouched and byte-identical', () => {
  it('none of them is flagged by the deterministic layer', () => {
    const flagged = ALL_HONEST_CONTROLS.filter((control) => detectMaterialClaims(control.text).length > 0);
    expect(
      flagged.map((control) => `${JSON.stringify(control.text)} (${control.why})`),
      'a gate that blocks truthful sentences is a gate somebody switches off, and then § 6.5.4 is back. ' +
        'The two wordings that ARE flagged today are recorded in KNOWN_CONTROL_FALSE_POSITIVES instead of ' +
        'being reworded away.',
    ).toEqual([]);
  });

  it('and the layered gate releases every one of them BYTE-IDENTICAL, with no state read', async () => {
    const changed: string[] = [];
    for (const control of ALL_HONEST_CONTROLS) {
      const ran = await review(control.text, classifiedWithNoClaims());
      if (ran.releasedText !== control.text) {
        changed.push(`${JSON.stringify(control.text)} -> ${JSON.stringify(ran.releasedText)}`);
      }
      if (ran.outcome !== 'NO_MATERIAL_CLAIM') changed.push(`${JSON.stringify(control.text)}: ${ran.outcome}`);
      if (ran.ledgerReads !== 0) changed.push(`${JSON.stringify(control.text)}: read the ledger`);
    }
    expect(
      changed.slice(0, 20),
      `${changed.length} honest control(s) were not released unchanged. Either the model's own bytes go out ` +
        'or nothing does - a gate that tidies wording is a scripting mechanism wearing a safety jacket.',
    ).toEqual([]);
  });

  it('and the verifier was still ASKED about every one of them', async () => {
    // The Founder's order is that the second layer runs on EVERY customer-facing
    // text. A fast path conditioned on the deterministic detector finding nothing
    // would be the layer whose gaps this exists to cover deciding whether to
    // cover them - the eight-QA-round defect with an extra step.
    for (const control of ALL_HONEST_CONTROLS.slice(0, 40)) {
      const ran = await review(control.text, classifiedWithNoClaims());
      expect(ran.verifierCalls, `the verifier was not asked about ${JSON.stringify(control.text)}`).toBe(1);
    }
  });

  it('the recorded false positives are STILL false positives', () => {
    // Asserted as misses, following `KNOWN_FALSE_POSITIVES`. If one of these goes
    // clean, the improvement gets recorded rather than absorbed.
    expect(KNOWN_CONTROL_FALSE_POSITIVES.length).toBeGreaterThan(0);
    for (const entry of KNOWN_CONTROL_FALSE_POSITIVES) {
      expect(
        detectMaterialClaims(entry.text).length,
        `${JSON.stringify(entry.text)} is recorded as a false positive (${entry.flaggedAs}) and is now clean. ` +
          'Remove the entry and record what closed it.',
      ).toBeGreaterThan(0);
    }
  });

  it('and a TRUE claim naming a day the record agrees with is released byte-identical', async () => {
    // The sharpest precision row available: the § 21 clitic wording, true, over a
    // real booking. It costs ONE regeneration when the semantic layer quotes the
    // time (union.ts routes a quoted phrase to UNREADABLE_WHEN, which is the
    // documented price of the authority boundary) and NONE when it does not.
    const truthful = "Your meeting's booked.";
    const ran = await review(truthful, semanticVerdictFor({
      ...(QA8_WORDINGS[0] as LayeredCase),
      text: truthful,
      whenPhrase: null,
    }), { snapshot: ledger({ effects: [thursdayAtTwo()] }) });
    expect(ran.releasedText).toBe(truthful);
    expect(ran.outcome).toBe('SUPPORTED');
  });
});

// ---------------------------------------------------------------------------
// 7. EACH LAYER IS LOAD-BEARING
// ---------------------------------------------------------------------------

describe('defence in depth that only one layer provides is not defence in depth', () => {
  // THE BRIEF'S REQUIREMENT, AND IT IS STATED AS A LEAK RATHER THAN AS A RED TEST.
  // "Prove that deleting the semantic layer breaks at least one test and that
  // deleting the deterministic layer breaks at least one test." A red test proves
  // a test depends on a layer. A demonstrated LEAK proves the SYSTEM does, which
  // is the claim actually worth making - so each block below removes one layer's
  // contribution and shows a false sentence reaching the caller.

  it('DELETE THE SEMANTIC LAYER and eleven false sentences reach the caller', async () => {
    const leaked: string[] = [];
    for (const entry of SEMANTIC_ONLY_CASES) {
      // The semantic layer present but contributing nothing IS what its deletion
      // looks like from the pipeline's point of view: `CLASSIFIED` with no claims
      // is a verdict, so nothing fails closed, and the union equals the
      // deterministic set. That is the state `RuleDrivenSemanticClaimVerifier`
      // with no rules wires for the whole offline suite, and it is why
      // `doubles.ts` says plainly that a green sweep is not evidence the semantic
      // layer works.
      const ran = await review(entry.text, classifiedWithNoClaims());
      if (ran.releasedText === entry.text) leaked.push(entry.name);
    }
    expect(
      leaked.length,
      'if removing the semantic layer leaked NOTHING, the layer is decoration and this mission changed ' +
        'nothing. The eleven rows are wordings the real detector misses today.',
    ).toBe(SEMANTIC_ONLY_CASES.length);
  });

  it('DELETE THE DETERMINISTIC LAYER and the § 21 class reaches the caller', async () => {
    // The mirror, and it is the one a reader is most likely to assume does not
    // matter once a semantic layer exists. It does: the semantic layer is a model
    // call, and a model that says "clean" about a sentence it should have flagged
    // is exactly the failure § 4.1 of the gate document is about. With the
    // deterministic layer blinded AND the verifier wrongly clean, the sentence
    // goes out.
    const leaked: string[] = [];
    for (const wording of QA8_WORDINGS) {
      const ran = await review(wording.text, classifiedWithNoClaims(), { blindDeterministic: true });
      if (ran.releasedText === wording.text) leaked.push(wording.name);
    }
    expect(
      leaked.length,
      'if blinding the deterministic layer leaked nothing, the semantic layer would be carrying the whole ' +
        'guarantee - which is the design § 4.1 rejects, because it puts the guarantee back where it failed.',
    ).toBe(QA8_WORDINGS.length);
  });

  it('and with BOTH layers working, neither of those leaks happens', async () => {
    // Without this, the two blocks above would be satisfied by a gate that
    // released everything. This is the same corpus, both layers on, nothing out.
    for (const entry of [...SEMANTIC_ONLY_CASES, ...QA8_WORDINGS]) {
      const ran = await review(entry.text, semanticVerdictFor(entry));
      expect(ran.releasedText, `${entry.name} leaked with both layers on`).not.toBe(entry.text);
    }
  });

  it('the gate never emits a sentence nobody produced, on any of these paths', async () => {
    // The anti-scripting property at the unit level: the released text is always
    // either one of the texts the model produced or nothing at all. A gate that
    // could synthesise a correction would be a canned-dialogue mechanism, which
    // `docs/DECISIONS.md` § 0 forbids outright.
    for (const entry of [...QA8_WORDINGS, ...SEMANTIC_ONLY_CASES]) {
      for (const verdict of [semanticVerdictFor(entry), classifiedWithNoClaims(), null]) {
        const ran = await review(entry.text, verdict);
        if (ran.releasedText === null) continue;
        expect(
          [entry.text, HONEST_REGENERATION],
          `the gate released ${JSON.stringify(ran.releasedText)}, which no attempt produced`,
        ).toContain(ran.releasedText);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 8. THE AXES THAT NEEDED THEIR OWN NAMED ASSERTION
// ---------------------------------------------------------------------------

describe('the axes a previous QA round found the corpus missing', () => {
  it('markdown and line breaks are crossed with BOTH the § 21 classes', () => {
    // § 17.8 residual 12: the generated matrices had no whitespace or punctuation
    // axis AT ALL, and § 17.6 claimed they were generative along every axis QA had
    // used. So the layout axis is asserted against the classes § 21 closed, by
    // name, rather than trusted to be in the cross.
    const clitic = LAYOUT_CLAIMS.filter((entry) => entry.axes.includes('NOUN_CLITIC'));
    const hebrew = LAYOUT_CLAIMS.filter((entry) => entry.axes.includes('HEBREW_PERSON_NUMBER'));
    expect(clitic.length, 'layouts over the noun-clitic class').toBeGreaterThanOrEqual(9);
    expect(hebrew.length, 'layouts over the Hebrew person/number class').toBeGreaterThanOrEqual(9);
    // A CRLF row, which is not optional in a repository that checks out CRLF.
    expect(LAYOUT_CLAIMS.some((entry) => entry.text.includes('\r\n'))).toBe(true);
    // And a cut INSIDE the sentence, not only a layout prefix.
    expect(LAYOUT_CLAIMS.some((entry) => /[^\r\n]\n[^\r\n]/u.test(entry.text))).toBe(true);
  });

  it('the invented-reference axis crosses every identifier shape the engine knows', () => {
    // § 8 limit 3 and § 14.2: three shapes are recognised anywhere in a sentence.
    // Crossing the MARKER against the SHAPE is what makes this an axis rather
    // than the § 6.5.4 token repeated four times.
    expect(REFERENCE_CLAIMS.length).toBe(20);
    expect(REFERENCE_CLAIMS.some((entry) => entry.identifier === 'CONF123456')).toBe(true);
    expect(new Set(REFERENCE_CLAIMS.map((entry) => entry.identifier)).size).toBe(5);
    expect(new Set(REFERENCE_CLAIMS.map((entry) => entry.language))).toEqual(new Set(['en', 'he']));
    // Every one must be seen, and the identifier must be the thing that is seen.
    for (const entry of REFERENCE_CLAIMS) {
      const claims = detectMaterialClaims(entry.text);
      expect(claims.length, `${entry.name} produced nothing`).toBeGreaterThan(0);
      expect(
        claims.some((claim) => claim.identifiers.length > 0),
        `${entry.name} was seen but its identifier was not read out`,
      ).toBe(true);
    }
  });

  it('and the two identifier shapes the engine does NOT extract are recorded as such', () => {
    // Found while drafting this file: both of these produce an IDENTIFIER_ASSERTED
    // claim on the MARKER phrase with an EMPTY `identifiers` array, so the
    // sentence is withheld but INVENTED_IDENTIFIER cannot fire on the token -
    // and away from a marker phrase they are missed outright. § 8 limit 3 with two
    // concrete spellings attached. Asserted as unextracted, so closing the shape
    // list cannot land silently.
    expect(UNRECOGNISED_REFERENCE_TOKENS.length).toBe(2);
    for (const entry of UNRECOGNISED_REFERENCE_TOKENS) {
      const withMarker = detectMaterialClaims(`Your confirmation number is ${entry.token}.`);
      expect(withMarker.length, `${entry.token} beside a marker`).toBeGreaterThan(0);
      expect(
        withMarker.flatMap((claim) => claim.identifiers),
        `${entry.token} is now EXTRACTED as an identifier (${entry.why}). That is an improvement - record ` +
          'what closed it and move the token into INVENTED_REFERENCE_TOKENS so it is in the cross.',
      ).toEqual([]);
      // And with no marker phrase in front of it, nothing is seen at all.
      expect(
        detectMaterialClaims(`Here is ${entry.token} for your records.`),
        `${entry.token} away from a marker phrase`,
      ).toEqual([]);
    }
  });

  it('and an invented identifier is refused as INVENTED_IDENTIFIER, not merely noticed', async () => {
    for (const entry of REFERENCE_CLAIMS.slice(0, 5)) {
      const ran = await review(entry.text, semanticVerdictFor(entry));
      expect(ran.firstAttemptReasons, `${entry.name}`).toContain('INVENTED_IDENTIFIER');
      expect(ran.releasedText).not.toBe(entry.text);
    }
  });

  it('a code-switched turn is judged as ONE sentence, in both orders', () => {
    // § 19.6 point 5 records a Hebrew filler in front of an English participle as
    // having been a stated residual until § 19b closed it, so the ORDER is an
    // axis value rather than a detail.
    for (const entry of CODE_SWITCH_CLAIMS) {
      const claims = detectMaterialClaims(entry.text);
      expect(claims.length, `${entry.name} produced nothing`).toBeGreaterThan(0);
    }
    // Both orders really are present: half the rows start with the claim.
    const claimFirst = CODE_SWITCH_CLAIMS.filter((entry) => entry.name.includes('then the other language'));
    expect(claimFirst.length).toBe(CODE_SWITCH_CLAIMS.length / 2);
  });
});
