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
  DOCUMENTED_VERIFIER_MISSES,
  FRAME_SPLITTERS,
  GOVERNED_NEGATION_BASES,
  HONEST_PRECISION_MATRIX,
  KNOWN_FALSE_POSITIVES,
  LAYOUT_TEMPLATES,
  LEDGER_CASES,
  MUST_FLAG,
  MUST_NOT_FLAG,
  SPLIT_FRAME_CONTROLS,
  SPLIT_FRAME_MATRIX,
  SPLIT_FRAME_MATRIX_CAPS,
  SUPPRESSION_CLAIM_BASES,
  SUPPRESSION_FILLERS,
  SUPPRESSION_JOINERS,
  SUPPRESSION_MATRIX,
  SUPPRESSION_MATRIX_CAPS,
  SUPPRESSION_MODIFIERS,
  TEMPORAL_CLAIM_FRAMES,
  TEMPORAL_DAY_WORDINGS,
  TEMPORAL_NULL_PATH_CONTROLS,
  TEMPORAL_PHRASE_MATRIX,
  TEMPORAL_TIME_WORDINGS,
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
      'UNREADABLE_WHEN',
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

  it('keeps the split matrix crossed on the axis nobody had: a terminator INSIDE the frame', () => {
    // WHY THIS FLOOR EXISTS. `CROSS_CLAUSE_MATRIX`, `ADVERB_FRAME_MATRIX` and
    // `SUPPRESSION_MATRIX` between them vary joiners, fillers, adverbs, voice, tense,
    // person and locale - and every axis value in all three is a TOKEN. There was no
    // WHITESPACE or PUNCTUATION-INSIDE-THE-FRAME axis anywhere in the generator, so
    // § 17.6's "generative along every axis QA has used so far" had a hole exactly
    // where the sixth fail-open defect lived. § 17.7's attack table DOES have a `\n`
    // row and it answers a different question: it put the break between the FILLER
    // and the CLAIM, where the claim survives intact inside its own segment.
    //
    // The floors are on the AXES, and the POSITION axis is the one that matters: a
    // matrix that crossed splitters against one hand-chosen cut point would be this
    // gate's § 16.6 pattern again, because the person choosing the cut point is the
    // person who already believes the rule works.
    const kinds = new Set(FRAME_SPLITTERS.map((splitter) => splitter.kind));
    expect(
      kinds,
      'all three ways a terminator gets into the middle of a claim must be generated: a hard wrap, another ' +
        'terminator character, and a markdown layout',
    ).toEqual(new Set(['LINE_BREAK', 'PUNCTUATION', 'LAYOUT']));
    expect(
      FRAME_SPLITTERS.filter((splitter) => splitter.text.includes('\r\n')).length,
      'CRLF IS MANDATORY. This repository checks out CRLF, model output arrives with whatever line endings the ' +
        'model felt like, and a parser that ignored that once broke check:anti-scripting outright',
    ).toBeGreaterThanOrEqual(1);
    expect(
      FRAME_SPLITTERS.filter((splitter) => splitter.kind === 'LAYOUT').length,
      'THE LAYOUT VALUES ARE NOT DECORATION. A label, a bullet and an indented continuation are the DEFAULT ' +
        'register of the benchmark candidates this mission is about - docs/MISSION_2D_AYA_ROOT_CAUSE.md is a ' +
        'whole document about aya-expanse speaking `Action:` lists at the contact',
    ).toBeGreaterThanOrEqual(3);
    // Every character `text.ts` treats as a sentence terminator has to appear, or
    // the axis is as wide as whichever spelling somebody remembered.
    for (const terminator of [';', '.', '!', '?', '…', '\n']) {
      expect(
        FRAME_SPLITTERS.map((splitter) => splitter.text).join(''),
        `no splitter carries ${JSON.stringify(terminator)}, which text.ts DOES cut on - so that spelling is ` +
          'untested and it is exactly the kind of gap this finding was',
      ).toContain(terminator);
    }
    // And the question mark's exclusion from the position cross has to stay a
    // DECLARED rule rather than a quiet omission.
    expect(
      FRAME_SPLITTERS.filter((splitter) => !splitter.positionAxis).map((splitter) => splitter.text),
      'the question mark is the one splitter held out of the position cross, because it makes its clause ' +
        'INTERROGATIVE rather than merely cutting it - that has to be declared, not omitted',
    ).toEqual(['? ']);

    const slices = new Set(SPLIT_FRAME_MATRIX.map((row) => row.slice));
    expect(slices, 'all four sub-crosses must be generated').toEqual(
      new Set(['CLAIM_WORDING', 'FILLER', 'JOINER', 'LAYOUT']),
    );

    // ---- THE LAYOUT AXIS, which is the operator note answered as a table ----
    // A splitter is one character in one gap. A layout is a whole SHAPE, and the
    // shapes are what the two benchmark candidates actually emit. The floors are
    // per KIND, because a table of bullets alone would prove nothing about a
    // numbered list - where the `1.` is a FULL STOP AFTER A DIGIT and cuts the
    // frame with a character nobody typed as punctuation.
    const layoutKinds = new Set(LAYOUT_TEMPLATES.map((template) => template.kind));
    expect(layoutKinds, 'every markdown shape a model actually writes must be generated').toEqual(
      new Set(['BULLET', 'NUMBERED', 'HEADING', 'EMPHASIS', 'LABEL', 'QUOTE', 'EXPLODED']),
    );
    expect(
      LAYOUT_TEMPLATES.filter((template) => template.kind === 'EXPLODED').length,
      'THE EXPLODED TEMPLATE IS MANDATORY. One word per line is a frame spread over as many segments as it ' +
        'has tokens, which the PAIR-WISE bridge cannot reach by construction - so it is the row that fails if ' +
        'the FLATTENED view is ever dropped, and without it the union looks like decoration.',
    ).toBeGreaterThanOrEqual(1);
    expect(
      SPLIT_FRAME_MATRIX.filter((row) => row.slice === 'LAYOUT' && row.language === 'he').length,
      'the layout axis must be crossed in Hebrew too. Hebrew is immune to a cut INSIDE a verb and is not ' +
        'immune to a bullet between the object and the verb, so the immunity argument does not carry here',
    ).toBeGreaterThanOrEqual(50);
    expect(SPLIT_FRAME_MATRIX.length, 'too few rows to be evidence of anything').toBeGreaterThanOrEqual(2_000);
    // THE POSITION AXIS, asserted as a RANGE rather than as a count: a matrix that
    // only cut at gap 1 would satisfy a size floor and prove nothing about the seams
    // further into the frame, which is where `has been booked` and `i have booked`
    // break.
    const positions = new Set(
      SPLIT_FRAME_MATRIX.filter((row) => row.slice === 'CLAIM_WORDING').map((row) => row.position),
    );
    expect(
      Math.max(...positions),
      'the cut must be tried deep into the sentence, not only at the first gap - the frames that leaked have ' +
        'their seams at gaps 3, 4 and 5',
    ).toBeGreaterThanOrEqual(6);
    expect(positions.size).toBeGreaterThanOrEqual(6);

    const hebrewLetters = /[֐-׿]/;
    expect(
      SPLIT_FRAME_MATRIX.filter((row) => hebrewLetters.test(row.text)).length,
      'the Hebrew rows are the CONTROL for this whole class, exactly as they are for § 16: a Hebrew completion ' +
        'verb is one inflected word with no inside, so a cut cannot land in it and these rows passed before ' +
        'the fix as well as after it',
    ).toBeGreaterThanOrEqual(200);
    expect(
      SPLIT_FRAME_MATRIX.filter((row) => row.language === 'mixed').length,
      'a filler in one language in front of a split frame in the other, which is the traffic the eval corpus ' +
        'actually contains',
    ).toBeGreaterThanOrEqual(50);

    // Every splitter must be controlled, or a row could pass because the splitter
    // itself started producing a claim out of two honest lines.
    expect(SPLIT_FRAME_CONTROLS.length).toBeGreaterThanOrEqual(FRAME_SPLITTERS.length);

    // The caps, written down rather than silent.
    expect(
      SPLIT_FRAME_MATRIX_CAPS.length,
      'this matrix does not take the full product and the reader has to be able to see which product it takes',
    ).toBeGreaterThanOrEqual(5);
    for (const cap of SPLIT_FRAME_MATRIX_CAPS) {
      expect(cap.length, 'a cap with no argument beside it is a silent truncation with extra steps').toBeGreaterThan(80);
    }

    // And the four wordings QA drove end to end, by their own bytes. An axis floor
    // can be satisfied by rows nobody reported.
    for (const reported of [
      'Your meeting is\nbooked for Thursday at 2pm.',
      'The meeting has been\nbooked for Thursday at 2pm.',
      'Your meeting is\r\nbooked for Thursday at 2pm.',
      "I'll\ncall you tomorrow at 3pm.",
    ]) {
      expect(
        MUST_FLAG.map((sample) => sample.text),
        `the § 19 wording ${JSON.stringify(reported)} must stay asserted by name - it was released to a real ` +
          'caller and persisted as a spoken AGENT row with an empty ledger',
      ).toContain(reported);
    }
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
    for (const kind of [
      'NEGATOR_BUILT',
      'CONDITIONAL_BUILT',
      'UNDECLARED_NEGATION',
      'POLITENESS',
      'ALL_CARRIER',
      'TELEGRAPHIC_REASSURANCE',
    ] as const) {
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

    // ---- THE § 18 FLOOR, PER LANGUAGE, AND IT IS A NEW AXIS VALUE ---------
    // THIS IS § 17.2's LESSON ARRIVING ONE LEVEL DOWN. § 17 generalised the JOINER
    // axis and then hand-listed the FILLER axis, and all 26 values somebody typed
    // contained an open-class word - `worry`, `payments`, `anyone`, `booking`,
    // `engineer`, `בעיה`, `דאגה`, `צורך`. Every one of those ENDS a negator's reach,
    // which is exactly why the § 17 rule passed on all 26 rows and why the value
    // that defeats it - a filler made of NOTHING BUT declared carriers - was never
    // generated. `Not at all I have booked your meeting for Thursday at 2pm.` was
    // released to a real caller and PERSISTED; so were six more English wordings and
    // seven Hebrew ones. An axis nobody declared is exactly as invisible as a
    // fixture nobody wrote.
    for (const language of ['en', 'he'] as const) {
      expect(
        SUPPRESSION_FILLERS.filter((filler) => filler.language === language && filler.kind === 'ALL_CARRIER').length,
        `too few ${language} fillers built ENTIRELY out of declared carriers. This is the § 18 class and it is ` +
          'the one value of this axis that can defeat the reach rule outright, because the rule asks whether ' +
          'everything between the negator and the form is carrier material and a filler made of nothing else ' +
          'answers yes. It leaked in BOTH languages, which is why the floor is per language.',
      ).toBeGreaterThanOrEqual(2);
    }
    // BOTH HALVES OF THE § 18 RULE have to be exercised, and which half catches a
    // row depends on the filler's own first word. A table of only `Not at all`-shaped
    // fillers would prove rule 1 and leave the predication scan untested.
    expect(
      SUPPRESSION_FILLERS.filter(
        (filler) => filler.kind === 'ALL_CARRIER' && /^nothing/iu.test(filler.text),
      ).length,
      'every ALL_CARRIER filler is built on a negator that cannot be a SUBJECT, so only § 18 rule 1 is ' +
        'exercised. `nothing`, `none` and `nobody` CAN be subjects - `Nothing at all has been booked yet.` is ' +
        'clean because of it - so those rows are the ones that test the fresh-predication scan instead.',
    ).toBeGreaterThanOrEqual(1);
    expect(
      SUPPRESSION_FILLERS.filter(
        (filler) => filler.kind === 'ALL_CARRIER' && /^once/iu.test(filler.text),
      ).length,
      'no CONDITIONAL all-carrier filler. A subordinator is allowed to cross the subject of the clause it ' +
        'opens - `Once your meeting is booked I will let you know.` is a plan - and must not be allowed to ' +
        'cross one an adverbial separates it from. Without a row like `Once more ...` that split is untested.',
    ).toBeGreaterThanOrEqual(1);

    // The five wordings QA-3 drove end to end, and the two QA-4 did, by their own
    // text. A kind floor alone can be satisfied by wordings nobody reported.
    for (const filler of ['אין בעיה', 'אין דאגה', 'לא נורא', 'אין צורך לדאוג', 'אין שום בעיה']) {
      expect(
        SUPPRESSION_FILLERS.map((entry) => entry.text),
        `the QA-3 filler ${filler} must stay in the axis table by name`,
      ).toContain(filler);
    }
    for (const filler of ['Not at all', 'לא צריך כלום']) {
      expect(
        SUPPRESSION_FILLERS.map((entry) => entry.text),
        `the QA-4 all-carrier filler ${filler} must stay in the axis table by name - it is the wording that ` +
          'was released to a real caller and persisted, in the language it was released in',
      ).toContain(filler);
    }

    // ---- THE § 19b FLOOR: the register that defeated § 18 on participles ---
    // A TELEGRAPHIC filler supplies the suppressor with a PREDICATE (`need`, `do`,
    // `have`) whose object slot then swallows a determiner-less domain object, so it
    // defeats the PREDICATION scan rather than the REACH test - and it does it ONLY
    // on the bare-participle path. Ten of these silenced `meeting booked for
    // Thursday at 2pm.` while leaving `your meeting is booked for Thursday at 2pm.`
    // detected behind the identical filler, which is why a matrix whose claim axis
    // happened to use the framed wording would have passed on every one of them.
    expect(
      SUPPRESSION_FILLERS.filter((filler) => filler.kind === 'TELEGRAPHIC_REASSURANCE').length,
      'too few TELEGRAPHIC fillers. This is the § 19b class: `There is nothing you need to do meeting booked ' +
        'for Thursday at 2pm.` A rule that closed one of these wordings and not the family would be this ' +
        "gate's § 16.6 pattern arriving a seventh time.",
    ).toBeGreaterThanOrEqual(3);
    for (const filler of ['There is nothing you need to do', 'You have nothing to do', 'לא צריך יותר']) {
      expect(
        SUPPRESSION_FILLERS.map((entry) => entry.text),
        `the QA-5 filler ${JSON.stringify(filler)} must stay in the axis table by name. The Hebrew one was ` +
          "§ 18's own recorded residual and is now closed, so it is generated rather than excluded.",
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

  it('keeps the temporal axis drawn from how a PERSON says a time, not from the lexicon under test', () => {
    // WHY THIS FLOOR EXISTS, AND WHY IT IS A DIFFERENT FAILURE FROM THE FOUR ABOVE.
    // § 19.7's lesson was that an axis nobody declared is invisible. This is the
    // subtler sibling: the temporal axis WAS in every matrix above - every row of
    // `CROSS_CLAUSE_MATRIX`, `ADVERB_FRAME_MATRIX`, `SUPPRESSION_MATRIX` and
    // `SPLIT_FRAME_MATRIX` names a day and an hour - and every value in all four is
    // one the detector can already read, because whoever wrote the row wrote a time
    // the gate understood. AN AXIS WHOSE VALUES ARE DRAWN FROM THE LEXICON UNDER TEST
    // CANNOT FALSIFY THAT LEXICON. Independent QA grepped the whole repository for
    // `half past`, `quarter past`, `this weekend`, `two days from now`, `lunchtime`,
    // `top of the hour` and `two thirty` and found zero hits anywhere, while eleven
    // sentences built out of them were certified SUPPORTED against a real booking.
    //
    // So the floors below are on the UNREADABLE half specifically. A matrix that
    // kept only the parsed values would satisfy a size floor and reproduce the hole
    // exactly.
    const unreadableDays = TEMPORAL_DAY_WORDINGS.filter((row) => row.reads === 'UNREADABLE');
    const unreadableTimes = TEMPORAL_TIME_WORDINGS.filter((row) => row.reads === 'UNREADABLE');
    expect(
      unreadableDays.length,
      'too few day wordings the readers cannot parse - this is the axis half that was never generated',
    ).toBeGreaterThanOrEqual(8);
    expect(
      unreadableTimes.length,
      'too few hour wordings the readers cannot parse',
    ).toBeGreaterThanOrEqual(8);
    for (const language of ['en', 'he'] as const) {
      expect(
        unreadableDays.filter((row) => row.language === language).length,
        `no unreadable DAY wording in ${language}. QA showed the hole is reachable in Hebrew too, so a fix ` +
          'measured only in English would be § 16.6 for the eighth time.',
      ).toBeGreaterThanOrEqual(3);
      expect(
        unreadableTimes.filter((row) => row.language === language).length,
        `no unreadable HOUR wording in ${language}`,
      ).toBeGreaterThanOrEqual(3);
    }

    // THE PARSED CONTROLS ARE NOT OPTIONAL. Without them a gate that started
    // refusing every sentence naming a time would pass this matrix outright.
    expect(TEMPORAL_DAY_WORDINGS.filter((row) => row.reads === 'AGREES').length).toBeGreaterThanOrEqual(5);
    expect(TEMPORAL_TIME_WORDINGS.filter((row) => row.reads === 'AGREES').length).toBeGreaterThanOrEqual(5);
    expect(
      TEMPORAL_DAY_WORDINGS.filter((row) => row.reads === 'DISAGREES').length,
      'the parsed-and-wrong day controls are QA control C2, which was blocked in the same run as the leaks - ' +
        'they are what localise the finding to the PHRASING rather than to the comparison',
    ).toBeGreaterThanOrEqual(2);
    expect(TEMPORAL_TIME_WORDINGS.filter((row) => row.reads === 'DISAGREES').length).toBeGreaterThanOrEqual(2);

    // THE EMPTY HOUR WORDING IS MANDATORY, in both languages. It is the § 20.6
    // constraint made into an axis value: a fix that turned the null branch into
    // `ok: false` would regenerate every truthful reply that does not restate the
    // slot, and these rows are what fails if somebody does it.
    for (const language of ['en', 'he'] as const) {
      expect(
        TEMPORAL_TIME_WORDINGS.filter((row) => row.language === language).map((row) => row.text),
        `no empty hour wording in ${language}, so the load-bearing null path is not crossed with anything`,
      ).toContain('');
    }

    // Every row must say WHY a person reads it that way, or a wrong declaration
    // cannot be reviewed - which is how a wrong one would survive.
    for (const row of [...TEMPORAL_DAY_WORDINGS, ...TEMPORAL_TIME_WORDINGS]) {
      expect(row.why.length, `temporal wording ${JSON.stringify(row.text)} carries no reason`).toBeGreaterThan(20);
    }

    // ---- the claim axis, and the product -----------------------------------
    expect(new Set(TEMPORAL_CLAIM_FRAMES.map((frame) => frame.language))).toEqual(new Set(['en', 'he']));
    for (const family of ['MEETING', 'RESCHEDULE', 'CALLBACK'] as const) {
      expect(
        TEMPORAL_CLAIM_FRAMES.map((frame) => frame.family),
        `no claim frame asserts ${family}, so the matrix says nothing about that family's instants`,
      ).toContain(family);
    }
    expect(TEMPORAL_PHRASE_MATRIX.length).toBeGreaterThanOrEqual(400);
    expect(
      TEMPORAL_PHRASE_MATRIX.filter((row) => row.expect === 'UNREADABLE_WHEN').length,
      'the § 20 half of the product',
    ).toBeGreaterThanOrEqual(200);
    expect(
      TEMPORAL_PHRASE_MATRIX.filter((row) => row.expect === 'SUPPORTED').length,
      'THE PRECISION HALF IS NOT OPTIONAL. Every row here names the day and the hour the booking really has, ' +
        'in wording the readers parse, and must be released byte-identical.',
    ).toBeGreaterThanOrEqual(50);
    expect(TEMPORAL_PHRASE_MATRIX.filter((row) => row.expect === 'WRONG_DAY').length).toBeGreaterThanOrEqual(20);
    expect(TEMPORAL_PHRASE_MATRIX.filter((row) => row.expect === 'WRONG_TIME').length).toBeGreaterThanOrEqual(20);
    expect(
      TEMPORAL_PHRASE_MATRIX.filter((row) => row.language === 'he').length,
      'Hebrew is the path with no recommended model and the fused ב-/ל- prefix is a different rule from the ' +
        'English standing preposition, so it cannot be proved by the English half',
    ).toBeGreaterThanOrEqual(100);

    // And the eleven wordings QA drove end to end, by their own bytes. An axis
    // floor can be satisfied by rows nobody reported.
    const generated = TEMPORAL_PHRASE_MATRIX.map((row) => row.text);
    for (const reported of [
      'Your meeting is booked for Thursday at half past four.',
      'Your meeting is confirmed for Thursday at two thirty.',
      'Your meeting is booked for Thursday at lunchtime.',
      'Your meeting is booked for this weekend at 2pm.',
      'Your meeting is booked for the end of the week at 2pm.',
      'Your meeting is booked for two days from now at 2pm.',
      'Your meeting is booked for the weekend at half past four.',
      'הפגישה נקבעה ליום חמישי בשתיים וחצי.',
      'הפגישה נקבעה לסוף השבוע בשעה 14:00.',
    ]) {
      expect(
        generated,
        `the § 20 wording ${JSON.stringify(reported)} must be generated by name - it was released to a real ` +
          'caller byte-identical, persisted as a spoken AGENT row, and the audit chain recorded it as VERIFIED',
      ).toContain(reported);
    }

    // The § 20.6 controls, asserted as a table rather than trusted to the product.
    expect(TEMPORAL_NULL_PATH_CONTROLS.length).toBeGreaterThanOrEqual(3);
    expect(
      TEMPORAL_NULL_PATH_CONTROLS.map((control) => control.text),
      'the three sentences the fix request names as the load-bearing null path must be asserted by name',
    ).toEqual(expect.arrayContaining(['Your meeting is booked.', "You're all set.", "I'll call you back."]));
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
    // Emptied DELIBERATELY by the hosted-demo callback fix (§ 8 limit 9): its four
    // entries now stand in LEDGER_CASES as `expect: null`, next to the false
    // callback confirmations that must still be rejected. Pinned, so the table
    // cannot change size in either direction without this line changing with it.
    expect(KNOWN_FALSE_POSITIVES.length, 'the false-positive table must not change silently').toBe(0);
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

  it('keeps every VERIFIER miss recorded, and asserted as still missed', () => {
    // The fourth shape, and § 20 is the first finding in this gate that has it: the
    // claim is DETECTED, the ledger is read, and the CHECK certifies a false
    // sentence anyway. `DOCUMENTED_MISSES` (detector blind),
    // `KNOWN_FALSE_POSITIVES` (true sentence rejected) and `DOCUMENTED_OVERREACH`
    // (asserts nothing, flagged) between them cannot hold it.
    //
    // Asserted in the same uncomfortable direction as the misses: each entry must
    // STILL be certified, so a later fix is reported by name rather than absorbed
    // while docs/MISSION_2D_CLAIM_GATE.md § 20.6 keeps claiming a residual that no
    // longer exists.
    expect(
      DOCUMENTED_VERIFIER_MISSES.length,
      'the verifier-miss table must not be emptied silently - it is where the ONE non-inverted enumeration ' +
        'in § 20 pays for itself, and an unpriced fail-open residual is how the last six findings happened',
    ).toBeGreaterThanOrEqual(1);
    for (const entry of DOCUMENTED_VERIFIER_MISSES) {
      expect(entry.cause.length, `verifier miss "${entry.name}" has no recorded cause`).toBeGreaterThan(60);
      expect(
        entry.consequence.length,
        `verifier miss "${entry.name}" has no recorded consequence - "it is wrong" is not actionable`,
      ).toBeGreaterThan(60);
      // The ledger must carry a real effect, or this is an unsupported claim filed
      // in the wrong table rather than a verifier that certified a false one.
      expect(
        entry.ledger.effects.length,
        `verifier miss "${entry.name}" has an EMPTY ledger, so the claim really is unsupported and the ` +
          'verifier is not missing anything',
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
