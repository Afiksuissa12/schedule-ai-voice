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
  CROSS_CLAUSE_MATRIX,
  DOCUMENTED_MISSES,
  DOCUMENTED_OVERREACH,
  KNOWN_FALSE_POSITIVES,
  LEDGER_CASES,
  MUST_FLAG,
  MUST_NOT_FLAG,
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

    const hebrewLetters = /[֐-׿]/;
    expect(
      CROSS_CLAUSE_MATRIX.filter((sample) => hebrewLetters.test(sample.text)).length,
      'the leak was reachable in Hebrew as well as English, and Hebrew is the path with no recommended model',
    ).toBeGreaterThanOrEqual(50);
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
