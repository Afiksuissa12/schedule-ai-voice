/**
 * THE NON-VACUITY GATE over the claim gate.
 *
 * `tests/claimGate/claimGateCorpus.ts` carries the corpus and the argument; this
 * file is the thing that fails the build. It is deliberately thin - one test
 * that runs the whole corpus and reports every failure together, plus a handful
 * of assertions about the corpus ITSELF, because a corpus that shrank to two
 * samples would pass its own checks in silence.
 *
 * WHY ONE `it` AND NOT ONE PER SAMPLE
 * ---------------------------------------------------------------------------
 * The same reason `tests/invariants/sweep.test.ts` gives: a failing detector
 * fails dozens of samples at once, and fifty red lines saying the same thing is
 * worse debugging information than one message listing them. The corpus runner
 * returns failures rather than throwing so that all of them arrive together.
 *
 * WHAT THIS DOES NOT PROVE
 * ---------------------------------------------------------------------------
 * It is a table of strings against two PURE functions. It proves the detector
 * fires and the verifier judges; it says nothing about whether the ledger those
 * verdicts are made against was filled correctly from real rows, and nothing
 * about whether the gate is actually wired in front of every release. Those are
 * `INV-18` in the sweep, which drives the real front door against real SQLite.
 * Stated here so a green run here is not mistaken for the whole claim.
 */
import { describe, expect, it } from 'vitest';

import {
  ADVERB_CONTROLS,
  ADVERB_FRAME_MATRIX,
  CROSS_CLAUSE_MATRIX,
  DOCUMENTED_MISSES,
  DOCUMENTED_OVERREACH,
  GOVERNED_NEGATION_BASES,
  HONEST_PRECISION_MATRIX,
  KNOWN_FALSE_POSITIVES,
  LEDGER_CASES,
  MUST_FLAG,
  MUST_NOT_FLAG,
  SUPPRESSION_CLAIM_BASES,
  SUPPRESSION_FILLERS,
  SUPPRESSION_JOINERS,
  SUPPRESSION_MATRIX,
  SUPPRESSION_MATRIX_CAPS,
  SUPPRESSION_MODIFIERS,
  runClaimGateSelfTest,
} from './claimGateCorpus.js';

describe('the claim gate is not vacuous', () => {
  it('flags every known-bad text, flags no known-good text, and every rule is seen to fire', () => {
    const result = runClaimGateSelfTest();

    expect(
      result.failures,
      result.failures.length === 0
        ? ''
        : `\n${result.failures.length} non-vacuity failure(s):\n\n${result.failures
            .map((failure) => `  - ${failure}`)
            .join('\n\n')}\n`,
    ).toEqual([]);

    // --- the corpus actually covered every dimension it claims to ---------
    // These duplicate assertions the runner already makes. That is on purpose:
    // if somebody ever makes `failures` conditional, or filters it, these still
    // fail, and they fail with the list in the message.
    expect(result.familiesExercised, 'every claim family must have been detected by something').toEqual([
      'ANY',
      'CALLBACK',
      'CANCELLATION',
      'HANDOVER',
      'MEETING',
      'MESSAGE',
      'RECORD',
      'RESCHEDULE',
    ]);
    expect(result.localesExercised, 'both registered lexicons plus the locale-agnostic shape rule').toEqual([
      'any',
      'en',
      'he',
    ]);
    expect(result.modesExercised).toEqual(['COMMITTED', 'COMPLETED']);
    expect(result.identifierShapesExercised).toEqual(['CODE_LIKE', 'CUID_LIKE', 'PREFIXED_CODE']);
    expect(
      result.unsupportedReasonsExercised,
      'every way a claim can fail must have been seen to fail that way',
    ).toEqual([
      'EFFECT_WAS_REFUSED',
      'INVENTED_IDENTIFIER',
      'NO_MATCHING_EFFECT',
      'NO_TOOL_FOR_PROMISE',
      'WRONG_DAY',
      'WRONG_TIME',
    ]);
  });

  it('keeps a corpus big enough and varied enough to be evidence', () => {
    // A corpus can be defeated by deletion as easily as by a bug. These are the
    // floors below which the run above stops meaning anything.
    expect(MUST_FLAG.length, 'too few known-bad samples to prove the detector fires').toBeGreaterThanOrEqual(30);
    expect(MUST_NOT_FLAG.length, 'too few known-good samples to prove precision').toBeGreaterThanOrEqual(12);
    expect(LEDGER_CASES.length, 'too few verifier cases').toBeGreaterThanOrEqual(12);

    // At least one supported and one unsupported ledger case, or the verifier
    // half only proves one direction.
    expect(LEDGER_CASES.filter((entry) => entry.expect === null).length).toBeGreaterThanOrEqual(5);
    expect(LEDGER_CASES.filter((entry) => entry.expect !== null).length).toBeGreaterThanOrEqual(6);

    const hebrewLetters = /[֐-׿]/;
    expect(
      MUST_FLAG.filter((sample) => hebrewLetters.test(sample.text)).length,
      'Hebrew is the path with no recommended model, so it must be well represented here',
    ).toBeGreaterThanOrEqual(10);
    expect(
      MUST_FLAG.filter((sample) => sample.language === 'mixed').length,
      'mixed Hebrew-English is a real scenario in the eval corpus',
    ).toBeGreaterThanOrEqual(3);
    expect(
      MUST_NOT_FLAG.filter((sample) => hebrewLetters.test(sample.text)).length,
      'precision has to be proved in Hebrew too, not only in English',
    ).toBeGreaterThanOrEqual(2);

    // The CRLF sample has to still be a CRLF sample.
    expect(
      MUST_FLAG.filter((sample) => sample.text.includes('\r\n')).length,
      'a CRLF sample is mandatory: this repository checks out CRLF and exactly that once broke ' +
        'check:anti-scripting (docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md § 6.4.1)',
    ).toBeGreaterThanOrEqual(1);
  });

  it('keeps the cross-clause matrix wide enough to be the thing it replaced', () => {
    // WHY THIS FLOOR EXISTS. The defect this matrix pins was invisible to every
    // delivered check for one reason: all three fixtures of its shape used `!` as
    // the joiner, so the coverage was one punctuation mark wide. A matrix that
    // shrank back to a handful of rows would reproduce that exactly, and it would
    // do it while still passing, which is the failure mode this whole file is
    // about. The floors are on the AXES rather than only on the product, because
    // 400 rows built from two joiners would satisfy a product floor and prove
    // nothing.
    const joiners = new Set(
      CROSS_CLAUSE_MATRIX.map((sample) => sample.name.split(' + ')[1]).filter((part) => part !== undefined),
    );
    const bases = new Set(
      CROSS_CLAUSE_MATRIX.map((sample) => sample.name.split(' + ')[2]).filter((part) => part !== undefined),
    );
    expect(joiners.size, 'too few clause joiners to show the rule is not punctuation-specific').toBeGreaterThanOrEqual(6);
    expect(bases.size, 'too few base claims').toBeGreaterThanOrEqual(4);
    expect(CROSS_CLAUSE_MATRIX.length).toBeGreaterThanOrEqual(200);

    // A conjunction-only joiner is mandatory. It is the half `text.ts` cannot
    // see: `I cannot take payments but I have booked your meeting` carries no
    // punctuation at all, and only `ClaimLexicon.clauseBreakers` divides it.
    expect(
      [...joiners].filter((joiner) => /^" [a-z]+ "$/u.test(joiner)).length,
      'at least one joiner must be a bare conjunction, or the locale clauseBreakers data is never exercised',
    ).toBeGreaterThanOrEqual(1);

    // And a sentence terminator, as the CONTROL: that is the one spelling the
    // sentence-scoped rule already handled, and it must keep working.
    expect(
      [...joiners].some((joiner) => joiner.includes('!')),
      'the matrix must keep a sentence-terminator joiner as its control',
    ).toBe(true);

    // AND THE EMPTY JOINER, which is the § 17 finding. Every joiner above is
    // punctuation or a conjunction, so every row of this matrix used to hand the
    // detector a clause boundary for free - and the one joiner a model actually takes
    // is none at all. `אין בעיה הפגישה נקבעה למחר בשעה 14:00.` was released to a real
    // caller AND persisted; the identical sentence with a comma was blocked.
    expect(
      [...joiners],
      'THE EMPTY JOINER IS MANDATORY HERE TOO. A matrix that only crosses punctuation cannot see the ' +
        'no-punctuation axis, which is exactly how this class stayed invisible to every delivered check.',
    ).toContain('" "');

    const hebrewLetters = /[֐-׿]/;
    expect(
      CROSS_CLAUSE_MATRIX.filter((sample) => hebrewLetters.test(sample.text)).length,
      'the leak was reachable in Hebrew as well as English, and Hebrew is the path with no recommended model',
    ).toBeGreaterThanOrEqual(50);
  });

  it('keeps the adverb matrix wide enough to cover every seam of every frame', () => {
    // WHY THIS FLOOR EXISTS. This defect has been hand-patched twice, and both times
    // the coverage came out exactly as wide as the author's imagination: the first
    // fix listed three adverbial SPELLINGS into the lexicon's subject prefixes, so
    // `I already booked` was caught and `I now booked`, `I successfully booked`,
    // `is now booked` and `has now been booked` were released end to end. A matrix
    // that shrank to one frame or one adverb would reproduce that while still
    // passing. The floors are on the AXES, because 100 rows over two adverbs would
    // satisfy a product floor and prove nothing.
    const adverbs = new Set(
      ADVERB_FRAME_MATRIX.map((sample) => sample.name.split(' inside ')[0]).filter((part) => part !== undefined),
    );
    const frames = new Set(
      ADVERB_FRAME_MATRIX.map((sample) => sample.name.split(' inside ')[1]).filter((part) => part !== undefined),
    );
    expect(adverbs.size, 'too few adverbs to show the rule is not one word wide').toBeGreaterThanOrEqual(8);
    expect(frames.size, 'too few frames to show every seam is covered').toBeGreaterThanOrEqual(10);
    expect(ADVERB_FRAME_MATRIX.length).toBeGreaterThanOrEqual(100);

    // Every frame SHAPE the English lexicon actually has, asserted by the token
    // pattern rather than by counting: the passive present, the passive perfect at
    // BOTH of its seams, the first-person perfect, the contraction, and the bare
    // preterite. The first fix covered only the last of those.
    const frameTexts = [...frames].join('\n');
    for (const seam of ['is {} booked', 'has {} been booked', 'has been {} booked', 'I have {} booked', "I've {} booked"]) {
      expect(frameTexts, `no row puts an adverb at the seam \`${seam}\``).toContain(seam);
    }

    // And the Hebrew control rows, which must pass before and after the fix: a
    // single inflected word has no inside, which is what localised the defect to
    // English frames rather than to the engine's scope rules.
    const hebrewLetters = /[֐-׿]/;
    expect(
      ADVERB_FRAME_MATRIX.filter((sample) => hebrewLetters.test(sample.text)).length,
      'the Hebrew rows are the control for the whole class and must not be dropped',
    ).toBeGreaterThanOrEqual(10);

    // Every adverb must be controlled, or a row could pass because the adverb
    // itself started producing a claim.
    expect(ADVERB_CONTROLS.length).toBeGreaterThanOrEqual(adverbs.size);
  });

  it('keeps the suppression matrix crossed on EVERY axis independent QA has used', () => {
    // WHY THESE FLOORS EXIST. This is the fourth fail-open defect of the same kind,
    // and § 16.6 had already named the pattern: each fix generalised one axis and
    // hand-listed the next, and the hand-listed axis came out exactly as wide as its
    // author's imagination. § 17 is that pattern arriving a fourth time - the JOINER
    // axis was generalised in § 15 and every entry in it was punctuation or an
    // English conjunction, so the one joiner a model actually uses (NONE) was the one
    // nobody crossed. A matrix that shrank back to punctuation joiners, or to one
    // language, or to one filler kind, would reproduce that exactly - and it would do
    // it while passing, which is the failure mode this whole file is about.
    //
    // So the floors are on the AXIS TABLES and on the generated rows' declared axis
    // VALUES, never on the product: 2,700 rows built from one joiner would satisfy a
    // size floor and prove nothing at all.

    // ---- the joiner axis, and the entry that leaked ------------------------
    const joinerKinds = new Set(SUPPRESSION_JOINERS.map((joiner) => joiner.kind));
    expect(
      joinerKinds.has('EMPTY'),
      'THE EMPTY JOINER IS MANDATORY. `אין בעיה הפגישה נקבעה למחר בשעה 14:00.` was released to a real caller ' +
        'and PERSISTED, while the same sentence with a comma after `אין בעיה` was blocked. Every joiner in this ' +
        'table used to be punctuation or an English conjunction, which is to say every row gave the detector a ' +
        'clause boundary for free.',
    ).toBe(true);
    expect(joinerKinds.has('TERMINATOR'), 'the sentence-terminator control must not be dropped').toBe(true);
    expect(joinerKinds.has('COORDINATOR'), 'a bare conjunction is the half text.ts cannot see').toBe(true);
    expect(joinerKinds.has('SUBORDINATOR')).toBe(true);
    expect(SUPPRESSION_JOINERS.length).toBeGreaterThanOrEqual(10);

    // ---- the filler axis, per KIND and per LANGUAGE ------------------------
    // Both halves matter. The kind, because `NEGATOR_BUILT` is the leaking class and
    // `UNDECLARED_NEGATION` is the control that localises it. The language, because
    // English could omit bare `no` from its negators and Hebrew cannot omit `אין`.
    for (const kind of ['NEGATOR_BUILT', 'CONDITIONAL_BUILT', 'UNDECLARED_NEGATION', 'POLITENESS'] as const) {
      expect(
        SUPPRESSION_FILLERS.filter((filler) => filler.kind === kind).length,
        `no filler of kind ${kind} - suppression treats negators and conditionals identically, and the ` +
          'politeness rows are the control that a filler per se changes nothing',
      ).toBeGreaterThanOrEqual(1);
    }
    for (const language of ['en', 'he'] as const) {
      expect(
        SUPPRESSION_FILLERS.filter((filler) => filler.language === language && filler.kind === 'NEGATOR_BUILT').length,
        `too few ${language} fillers built on a DECLARED negator. The defect was reachable in both languages: ` +
          "`Don't worry your meeting is booked for Thursday at 2pm.` was missed as well as `אין בעיה ...`.",
      ).toBeGreaterThanOrEqual(4);
    }
    // The five wordings QA drove end to end have to still be in the table by text.
    for (const filler of ['אין בעיה', 'אין דאגה', 'לא נורא', 'אין צורך לדאוג', 'אין שום בעיה']) {
      expect(
        SUPPRESSION_FILLERS.map((entry) => entry.text),
        `the QA-3 filler ${filler} must stay in the axis table by name`,
      ).toContain(filler);
    }

    // ---- the claim axis: every grammatical dimension, declared -------------
    const dimension = <K extends keyof (typeof SUPPRESSION_CLAIM_BASES)[number]>(key: K): Set<unknown> =>
      new Set(SUPPRESSION_CLAIM_BASES.map((base) => base[key]));
    expect(dimension('voice'), 'active and passive').toEqual(new Set(['ACTIVE', 'PASSIVE']));
    expect(dimension('tense'), 'simple, perfect and future').toEqual(new Set(['SIMPLE', 'PERFECT', 'FUTURE']));
    expect(dimension('person'), 'third, first singular AND first plural').toEqual(
      new Set(['THIRD', 'FIRST_SINGULAR', 'FIRST_PLURAL']),
    );
    expect(dimension('contracted'), 'contracted and not - text.ts keeps an apostrophe inside a token').toEqual(
      new Set([true, false]),
    );
    expect(dimension('language')).toEqual(new Set(['en', 'he']));
    // The effect families the PRODUCT has, named one at a time rather than counted.
    for (const family of ['MEETING', 'CALLBACK', 'CANCELLATION', 'RESCHEDULE', 'MESSAGE', 'RECORD', 'ANY'] as const) {
      expect(
        SUPPRESSION_CLAIM_BASES.map((base) => base.family),
        `no claim base asserts ${family}, so this matrix says nothing about that family`,
      ).toContain(family);
    }
    // And both locales must reach every one of the four filler kinds, or a whole
    // quadrant of the cross is untested.
    for (const language of ['en', 'he'] as const) {
      expect(
        SUPPRESSION_CLAIM_BASES.filter((base) => base.language === language).length,
      ).toBeGreaterThanOrEqual(8);
    }

    // ---- the modifier axis, and its absence as the control ----------------
    expect(SUPPRESSION_MODIFIERS.filter((modifier) => modifier.text === '').length).toBeGreaterThanOrEqual(2);
    expect(SUPPRESSION_MODIFIERS.filter((modifier) => modifier.text !== '').length).toBeGreaterThanOrEqual(2);

    // ---- the generated rows: both directions, both orders, all languages --
    const slices = new Set(SUPPRESSION_MATRIX.map((row) => row.slice));
    expect(slices, 'all three sub-crosses must be generated').toEqual(
      new Set(['CLAUSE_ORDER', 'CLAIM_WORDING', 'GOVERNED_NEGATION']),
    );
    expect(
      SUPPRESSION_MATRIX.filter((row) => row.expect === 'FLAG').length,
      'the coverage half',
    ).toBeGreaterThanOrEqual(1_500);
    expect(
      SUPPRESSION_MATRIX.filter((row) => row.expect === 'CLEAN').length,
      'THE PRECISION HALF IS NOT OPTIONAL. Narrowing suppression can only ever ADD detections, so the entire ' +
        'risk of the § 17 fix is that a negation which really does govern its completion stops governing it.',
    ).toBeGreaterThanOrEqual(300);
    expect(new Set(SUPPRESSION_MATRIX.map((row) => row.language))).toEqual(new Set(['en', 'he', 'mixed']));
    expect(
      SUPPRESSION_MATRIX.filter((row) => row.language === 'mixed').length,
      'code-switching is a real scenario in the eval corpus, and the participle rule pools mood tokens across ' +
        'locales - a Hebrew `אין` silenced an ENGLISH bare participle',
    ).toBeGreaterThanOrEqual(200);
    expect(
      SUPPRESSION_MATRIX.filter((row) => row.joiner === 'EMPTY').length,
      'the no-punctuation axis has to be the bulk of it, not a token row',
    ).toBeGreaterThanOrEqual(500);

    // Every row that must flag has to declare WHAT it must flag, or the matrix is a
    // smoke test rather than an oracle.
    for (const row of SUPPRESSION_MATRIX) {
      if (row.expect !== 'FLAG') continue;
      expect(row.family, `row "${row.name}" must declare the family it asserts`).not.toBeNull();
      expect(row.locale, `row "${row.name}" must declare the locale that must fire`).not.toBeNull();
    }

    // ---- the caps, written down rather than silent ------------------------
    // A silent truncation reads as coverage it did not give, and this host is memory
    // constrained, so every axis that is NOT fully crossed has to say so here.
    expect(
      SUPPRESSION_MATRIX_CAPS.length,
      'the caps log must not be emptied: this matrix does not take the full product and the reader has to be ' +
        'able to see which product it does take',
    ).toBeGreaterThanOrEqual(5);
    for (const cap of SUPPRESSION_MATRIX_CAPS) {
      expect(cap.length, 'a cap with no argument beside it is a silent truncation with extra steps').toBeGreaterThan(80);
    }
  });

  it('measures the false-positive cost on an honest corpus rather than asserting it', () => {
    // § 16.3c measured 190/191 on hand-written honest wording and 0/4,320 on a
    // generated intention sweep, and BOTH sweeps were thrown away - so the published
    // number cannot be re-derived by a reader and cannot fail a build when it stops
    // being true. This table is that measurement made permanent. The runner asserts
    // every row is clean; these floors keep the denominator honest.
    expect(
      HONEST_PRECISION_MATRIX.length,
      'too few honest sentences to be a measurement of anything',
    ).toBeGreaterThanOrEqual(1_000);
    const hebrewLetters = /[֐-׿]/;
    expect(
      HONEST_PRECISION_MATRIX.filter((row) => hebrewLetters.test(row.text)).length,
      'HEBREW HONEST WORDING IS MANDATORY. The § 17 defect was in the Hebrew negator list, the fix is a rule ' +
        'about Hebrew negation, and a precision figure measured only in English would say nothing about the ' +
        'language the fix actually changed.',
    ).toBeGreaterThanOrEqual(10);
    expect(new Set(HONEST_PRECISION_MATRIX.map((row) => row.language))).toEqual(new Set(['en', 'he']));

    // And the honest negations crossed with every filler live in SUPPRESSION_MATRIX's
    // clean half, which is a different question: this table is about INTENTIONS, that
    // one is about negations that genuinely govern. Both are precision and neither
    // substitutes for the other.
    expect(GOVERNED_NEGATION_BASES.length).toBeGreaterThanOrEqual(12);
    for (const control of [
      'הפגישה לא נקבעה עדיין',
      'עדיין לא נקבע כלום',
      'אין פגישה ביומן',
      'לא קבעתי כלום עדיין',
      'אין לי אפשרות לשלוח אימייל',
    ]) {
      expect(
        GOVERNED_NEGATION_BASES.map((base) => base.text),
        `QA-3 precision control ${control} must be crossed with every filler and every joiner, not only ` +
          'asserted once in MUST_NOT_FLAG',
      ).toContain(control);
    }
    for (const base of GOVERNED_NEGATION_BASES) {
      expect(base.why.length, `governed negation "${base.text}" has no recorded reason`).toBeGreaterThan(20);
    }
  });

  it('keeps every documented miss documented, with a cause and a status', () => {
    // The misses are the load-bearing half of the corpus. An entry with an empty
    // `cause` is an entry nobody can act on, and one that silently loses its
    // status stops distinguishing "the gate says so" from "we found this".
    //
    // THE FLOOR WAS 10 AND IS NOW 4, AND THAT IS NOT A WEAKENING. Ten entries
    // were the "clause scope: one finding, ten reachable spellings" block, and
    // every one of them is now DETECTED and has moved to MUST_FLAG - which is the
    // outcome this table exists to force. The floor tracks what is left: the two
    // limits the gate module states in its own source, and the two findings still
    // open. If it is ever raised again it should be because a new miss was found,
    // not because somebody wanted the number back.
    expect(DOCUMENTED_MISSES.length, 'the misses table must not be emptied silently').toBeGreaterThanOrEqual(4);
    for (const miss of DOCUMENTED_MISSES) {
      expect(miss.cause.length, `documented miss "${miss.name}" has no recorded cause`).toBeGreaterThan(40);
      expect(['STATED_LIMIT_OF_THE_GATE', 'FINDING_RAISED_TO_THE_GATE_TASK']).toContain(miss.status);
    }
    // Both kinds must be present: if the findings were all closed, that is good
    // news and this assertion is the prompt to re-publish the numbers.
    expect(
      DOCUMENTED_MISSES.filter((miss) => miss.status === 'STATED_LIMIT_OF_THE_GATE').length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      DOCUMENTED_MISSES.filter((miss) => miss.status === 'FINDING_RAISED_TO_THE_GATE_TASK').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('keeps every known false positive recorded with its cause and its consequence', () => {
    // The precision half of the audit. A false positive blocks a TRUE sentence,
    // and `lexicon/en.ts` makes the argument itself: a gate that punishes honest
    // wording gets switched off, and a gate that is off puts the § 6.5.4 defect
    // back. So these are recorded at least as carefully as the misses.
    expect(KNOWN_FALSE_POSITIVES.length, 'the false-positive table must not be emptied silently').toBeGreaterThanOrEqual(1);
    for (const entry of KNOWN_FALSE_POSITIVES) {
      expect(entry.cause.length, `false positive "${entry.name}" has no recorded cause`).toBeGreaterThan(60);
      expect(
        entry.consequence.length,
        `false positive "${entry.name}" has no recorded consequence - "it is wrong" is not actionable`,
      ).toBeGreaterThan(5);
      // Each one must be a sentence the ledger genuinely SUPPORTS in substance,
      // which is what makes it a false positive rather than a miss. Asserted
      // structurally: the ledger has to carry at least one real effect, or the
      // entry is just an unsupported claim filed in the wrong table.
      expect(
        entry.ledger.effects.length,
        `false positive "${entry.name}" has an EMPTY ledger, so the claim really is unsupported and this is ` +
          'not a false positive at all',
      ).toBeGreaterThan(0);
    }
  });

  it('keeps every documented overreach recorded with its cause and its consequence', () => {
    // The third shape, and the one the two tables above cannot hold: a sentence
    // that asserts NOTHING and that the detector fires on anyway. There is no
    // ledger to build for it, because the honest ledger is the empty one - which
    // is exactly why the structural assertion in the test above would reject it.
    //
    // Asserted in the same direction as DOCUMENTED_MISSES: each entry must still
    // be flagged, so a later precision fix is reported rather than absorbed.
    expect(
      DOCUMENTED_OVERREACH.length,
      'the overreach table must not be emptied silently - an unpriced precision cost is how a gate gets ' +
        'switched off',
    ).toBeGreaterThanOrEqual(1);
    for (const entry of DOCUMENTED_OVERREACH) {
      expect(entry.cause.length, `overreach "${entry.name}" has no recorded cause`).toBeGreaterThan(60);
      expect(
        entry.consequence.length,
        `overreach "${entry.name}" has no recorded consequence - "it is wrong" is not actionable`,
      ).toBeGreaterThan(5);
    }
  });
});
