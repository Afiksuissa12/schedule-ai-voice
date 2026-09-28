/**
 * THE DEV / HELD-OUT SPLIT IS REPRODUCIBLE, AND A HAND EDIT IS A RED BUILD.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------------------------------------------------------------
 * Mission 2G's final measurement is worth something only if the held-out half was
 * really held out. The assignment is BOTH a pure function (`assignVerifierSplits`)
 * and COMMITTED DATA (a `split` field on every row), and neither alone would do:
 *
 *  - a function alone means a reader cannot see which half a row is in without
 *    running code, and a change to the function silently moves rows AFTER THE FACT,
 *    which is exactly how a held-out set stops being held out;
 *  - data alone means one hand edit to one row moves a row the tuning task has
 *    already read into the held-out half, and nothing says so.
 *
 * So this file recomputes the procedure from the case data and asserts it
 * reproduces the committed field EXACTLY, for all 172 base rows.
 *
 * IT NAMES CASE IDS AND NEVER CASE TEXTS. `npm run test` is run by the task that
 * must not be handed held-out sentences, and `verifierSplitDisagreements` returns
 * ids for that reason.
 *
 * NO MODEL, NO NETWORK, NO CLOCK. Every assertion here is a pure function of
 * committed bytes.
 */
import { describe, expect, it } from 'vitest';

import {
  BASE_VERIFIER_CASES,
  HELDOUT_VERIFIER_CASES,
  assignVerifierSplits,
  loadVerifierCorpus,
  verifierSplitDisagreements,
  verifierStratumKey,
} from '../../src/eval/verifier/corpus.js';

describe('the split procedure reproduces the committed split field', () => {
  it('agrees with EVERY base row, with no disagreement at all', () => {
    // THE CENTRAL ASSERTION OF THIS FILE. A hand edit to one row's `split` breaks
    // it, and the message names the id, the committed value and what the procedure
    // says instead.
    expect(verifierSplitDisagreements(BASE_VERIFIER_CASES)).toEqual([]);
  });

  it('is DETERMINISTIC: the same input yields the same assignment, every time', () => {
    const first = assignVerifierSplits(BASE_VERIFIER_CASES);
    const second = assignVerifierSplits(BASE_VERIFIER_CASES);
    expect([...second.entries()].sort()).toEqual([...first.entries()].sort());
  });

  it('does NOT depend on the order the cases arrive in', () => {
    // The procedure sorts by stratum key and then by case id, so a shuffled input
    // must give an identical answer. If it did not, the split would be a property
    // of which file happened to be imported first.
    const reversed = [...BASE_VERIFIER_CASES].reverse();
    const rotated = [...BASE_VERIFIER_CASES.slice(40), ...BASE_VERIFIER_CASES.slice(0, 40)];
    const baseline = assignVerifierSplits(BASE_VERIFIER_CASES);
    for (const variant of [reversed, rotated]) {
      const got = assignVerifierSplits(variant);
      expect(got.size).toBe(baseline.size);
      for (const [id, split] of baseline) expect(got.get(id), id).toBe(split);
    }
  });

  it('does NOT depend on a row\'s PROSE - editing a source note cannot move a row', () => {
    // The sort key is the case id, which the schema requires to be stable across
    // versions. `text` and `source` are deliberately not stratification variables:
    // a typo fix in a comment must never relocate a held-out sentence.
    const rewritten = BASE_VERIFIER_CASES.map((entry) => ({
      ...entry,
      source: `${entry.source} (prose edited by this test)`,
    }));
    const baseline = assignVerifierSplits(BASE_VERIFIER_CASES);
    const after = assignVerifierSplits(rewritten);
    for (const [id, split] of baseline) expect(after.get(id), id).toBe(split);
  });

  it('DETECTS a tampered split, so the guard cannot pass vacuously', () => {
    // The counter-example. Without this, a `verifierSplitDisagreements` that always
    // returned `[]` would satisfy the first assertion in this file.
    const first = BASE_VERIFIER_CASES[0];
    expect(first).toBeDefined();
    if (!first) return;
    const flipped = [
      { ...first, split: first.split === 'dev' ? ('heldout' as const) : ('dev' as const) },
      ...BASE_VERIFIER_CASES.slice(1),
    ];
    const problems = verifierSplitDisagreements(flipped);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(first.id);
    // AND IT PRINTS NO TEXT. The tuning task reads these failures.
    expect(problems[0]).not.toContain(first.text);
  });

  it('DETECTS a missing split too', () => {
    const [first, ...rest] = BASE_VERIFIER_CASES;
    expect(first).toBeDefined();
    if (!first) return;
    const stripped = { ...first };
    delete (stripped as { split?: unknown }).split;
    const problems = verifierSplitDisagreements([stripped, ...rest]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no committed split');
  });

  it('STRATIFIES: every stratum is split as evenly as its size allows', () => {
    // The property that a hash of the id would NOT have. A stratum of four rows
    // must come out 2/2 and never 4/0, because a family or a language landing
    // entirely on one side of the split would be invisible to one of the two
    // measurements.
    const byStratum = new Map<string, { dev: number; heldout: number }>();
    for (const entry of BASE_VERIFIER_CASES) {
      const key = verifierStratumKey(entry);
      const bucket = byStratum.get(key) ?? { dev: 0, heldout: 0 };
      if (entry.split === 'dev') bucket.dev += 1;
      else bucket.heldout += 1;
      byStratum.set(key, bucket);
    }
    expect(byStratum.size).toBeGreaterThan(20);
    for (const [key, counts] of byStratum) {
      expect(Math.abs(counts.dev - counts.heldout), key).toBeLessThanOrEqual(1);
    }
  });

  it('lands close to 50/50 overall, which is what the alternating STARTING SIDE buys', () => {
    // With 144 possible strata over 172 rows most non-empty strata are small and
    // many are singletons. A walk that always began at `dev` would put every
    // singleton in `dev`; alternating the starting side with the stratum's ordinal
    // spreads the odd remainders. This assertion is what would fail if that step
    // were removed.
    const dev = BASE_VERIFIER_CASES.filter((c) => c.split === 'dev').length;
    const heldout = BASE_VERIFIER_CASES.filter((c) => c.split === 'heldout').length;
    expect(dev + heldout).toBe(172);
    expect(Math.abs(dev - heldout)).toBeLessThanOrEqual(8);
    expect(dev).toBe(85);
    expect(heldout).toBe(87);
  });

  it('holds the mission FLOORS on the dev split', () => {
    // The dev split must retain at least 60 CLAIM rows and at least 14
    // HONEST_CONTROL rows, or the tuning task cannot see a change it made.
    const dev = BASE_VERIFIER_CASES.filter((c) => c.split === 'dev');
    expect(dev.filter((c) => c.kind === 'CLAIM').length).toBeGreaterThanOrEqual(60);
    expect(dev.filter((c) => c.kind === 'HONEST_CONTROL').length).toBeGreaterThanOrEqual(14);
    // And both halves carry every language, which is what stratifying by language
    // was for.
    for (const language of ['en', 'he', 'mixed'] as const) {
      expect(dev.some((c) => c.language === language), language).toBe(true);
      expect(
        BASE_VERIFIER_CASES.some((c) => c.split === 'heldout' && c.language === language),
        language,
      ).toBe(true);
    }
  });

  it('keeps RECORDED and QA provenance in BOTH halves', () => {
    // A held-out half made only of NEW_PARAPHRASE rows would be weaker evidence
    // than the dev half it gets compared against. Stratifying by provenance is what
    // makes this true rather than lucky.
    for (const split of ['dev', 'heldout'] as const) {
      const rows = BASE_VERIFIER_CASES.filter((c) => c.split === split);
      for (const provenance of ['RECORDED_MODEL_OUTPUT', 'QA_FINDING', 'NEW_PARAPHRASE'] as const) {
        expect(rows.some((c) => c.provenance === provenance), `${split}/${provenance}`).toBe(true);
      }
    }
  });
});

describe('the held-out ADDITIONS are heldout by construction, not by procedure', () => {
  it('has every row in src/eval/verifier/heldout/ marked heldout', () => {
    expect(HELDOUT_VERIFIER_CASES.length).toBeGreaterThanOrEqual(80);
    for (const entry of HELDOUT_VERIFIER_CASES) expect(entry.split, entry.id).toBe('heldout');
  });

  it('is NOT subject to the base split procedure, and that is the point', () => {
    // A procedure that could assign one of these rows to `dev` would defeat the
    // reason the directory exists. So they are excluded from it by construction,
    // and this test states the exclusion rather than leaving it implicit in which
    // array `assignVerifierSplits` happens to be called with.
    const assignment = assignVerifierSplits(BASE_VERIFIER_CASES);
    for (const entry of HELDOUT_VERIFIER_CASES) expect(assignment.has(entry.id), entry.id).toBe(false);
  });

  it('is all NEW_PARAPHRASE, so no reader can mistake one for a recorded wording', () => {
    for (const entry of HELDOUT_VERIFIER_CASES) expect(entry.provenance, entry.id).toBe('NEW_PARAPHRASE');
  });

  it('adds up to the corpus the loader returns', () => {
    const cases = loadVerifierCorpus().cases;
    expect(cases).toHaveLength(BASE_VERIFIER_CASES.length + HELDOUT_VERIFIER_CASES.length);
  });
});
