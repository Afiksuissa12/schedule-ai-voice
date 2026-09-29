/**
 * Loading the verifier corpus, and refusing to load a broken one.
 *
 * SIX gates run at load time and all six THROW rather than warn, on the same
 * argument `src/eval/corpus/index.ts` makes: a typo in an expectation would
 * otherwise become a silently unchecked assertion - the eval would still run,
 * still report a number, and quietly stop testing something.
 *
 *  1. ZOD VALIDATION of every case, including the cross-field rules that keep a
 *     CLAIM from being labelled with a non-material status, a CONTROL from being
 *     labelled with a material one, and a shape axis from landing on the wrong
 *     kind.
 *  2. UNIQUE IDS. Ids are report row keys.
 *  3. UNIQUE TEXTS. Two cases with the same string would be counted twice in one
 *     recall number, which is a quiet way to make a corpus look bigger than it is.
 *  4. THE IN-REPO FIELD CONTRACT (Mission 2G). `split`, and one of `claimShape` /
 *     `controlShape`, are OPTIONAL IN THE SCHEMA and REQUIRED ON EVERY IN-REPO
 *     ROW. See `unmetVerifierInRepoFields` for why the asymmetry exists.
 *  5. THE COVERAGE CONTRACT below, which is what stops this corpus losing a
 *     requirement while still looking healthy.
 *  6. THE SPLIT PROCEDURE'S OWN AGREEMENT with the committed `split` field, for
 *     the three BASE case files. Asserted in
 *     `tests/eval/verifierSplitReproducibility.test.ts` rather than thrown here,
 *     because it is a property of the repository rather than of a load.
 */
import { ENGLISH_VERIFIER_CASES } from './cases.en.js';
import { HEBREW_VERIFIER_CASES } from './cases.he.js';
import { MIXED_VERIFIER_CASES } from './cases.mixed.js';
import { ENGLISH_HELDOUT_VERIFIER_CASES } from './heldout/cases.heldout.en.js';
import { HEBREW_HELDOUT_VERIFIER_CASES } from './heldout/cases.heldout.he.js';
import { MIXED_HELDOUT_VERIFIER_CASES } from './heldout/cases.heldout.mixed.js';
import {
  VERIFIER_CORPUS_SCHEMA_VERSION,
  VerifierCorpusSchema,
  type VerifierCase,
  type VerifierCaseLanguage,
  type VerifierSplitSelector,
  type VerifierClaimShape,
  type VerifierControlShape,
  type VerifierCorpus,
} from './schema.js';

/**
 * Bump on any change to a case's text, its label or its provenance.
 *
 * Recorded in every verifier-eval output file, so two operator runs can be
 * compared only when they measured the same thing - the same rule the benchmark
 * corpus keeps, and for the same reason.
 *
 * `1.0.0` was Mission 2F's 172 rows.
 *
 * `2.0.0` IS A NEW MAJOR BECAUSE MISSION 2G MOVED LABELS AND ADDED A SPLIT, and
 * both of those make a 1.0.0 number and a 2.0.0 number uncomparable:
 *
 *  - THREE ROWS WERE RELABELLED under the written labelling policy
 *    (`docs/MISSION_2G_VERIFIER_ROUND.md` §§ 1 and 2). One of them changed KIND,
 *    which moves the recall denominator and the false-positive denominator both.
 *  - EVERY ROW GAINED A `split`, so "the corpus" is now three numbers - dev,
 *    held-out and all - and a report that did not say which one it ran is not a
 *    result. The resolved split is in the artefact AND in the file name.
 *  - 90 NEW HELD-OUT ROWS were added, in `./heldout/`.
 */
export const VERIFIER_CORPUS_VERSION = '2.0.0';

/**
 * The three BASE files - the 172 rows Mission 2F wrote, as relabelled.
 *
 * SEPARATE FROM THE HELD-OUT FILES ON PURPOSE. The split procedure in
 * `./split.ts` is defined over THESE rows and reproduces THEIR committed `split`
 * field exactly; the rows in `./heldout/` are `heldout` BY CONSTRUCTION and are
 * not subject to it, because a procedure that could assign one of them to `dev`
 * would defeat the reason that directory exists.
 */
export const BASE_VERIFIER_CASES: readonly VerifierCase[] = [
  ...ENGLISH_VERIFIER_CASES,
  ...HEBREW_VERIFIER_CASES,
  ...MIXED_VERIFIER_CASES,
];

/**
 * The Mission 2G additions. EVERY ROW IS `heldout`.
 *
 * `tests/eval/verifierAntiOverfitting.test.ts` asserts that, and asserts that no
 * text in here appears anywhere under `src/agent/`.
 */
export const HELDOUT_VERIFIER_CASES: readonly VerifierCase[] = [
  ...ENGLISH_HELDOUT_VERIFIER_CASES,
  ...HEBREW_HELDOUT_VERIFIER_CASES,
  ...MIXED_HELDOUT_VERIFIER_CASES,
];

const RAW_CASES: readonly VerifierCase[] = [...BASE_VERIFIER_CASES, ...HELDOUT_VERIFIER_CASES];

// ---------------------------------------------------------------------------
// THE DECLARED COVERAGE GRIDS
// ---------------------------------------------------------------------------

/**
 * Every (language x claimShape) pair this corpus CLAIMS to cover.
 *
 * DECLARED RATHER THAN DERIVED, and that is the whole point: a contract computed
 * from the data can never fail, because whatever is there is what it says is
 * there. This list is a promise, `unmetVerifierCoverage` is the check, and a row
 * deleted from a file turns the promise into a red build.
 *
 * `he` CARRIES NO `CONTRACTION` ENTRY, and the omission is deliberate rather than
 * an oversight: Hebrew has no apostrophe copula clitic, which is the § 21 CLASS A
 * shape this axis exists to measure, and inventing a Hebrew form for it would be
 * a non-native guess at a spelling no model has been recorded producing.
 * `docs/MISSION_2G_VERIFIER_ROUND.md` § 4.4 states it as something deliberately
 * NOT added.
 */
export const REQUIRED_CLAIM_SHAPE_COVERAGE: readonly (readonly [VerifierCaseLanguage, VerifierClaimShape])[] = [
  ['en', 'LAYOUT'],
  ['en', 'VERY_SHORT'],
  ['en', 'REFERENCE'],
  ['en', 'CONTRACTION'],
  ['en', 'INDIRECT'],
  ['en', 'PASSIVE'],
  ['en', 'DIRECT'],
  ['he', 'LAYOUT'],
  ['he', 'VERY_SHORT'],
  ['he', 'REFERENCE'],
  ['he', 'INDIRECT'],
  ['he', 'PASSIVE'],
  ['he', 'DIRECT'],
  ['mixed', 'LAYOUT'],
  ['mixed', 'VERY_SHORT'],
  ['mixed', 'REFERENCE'],
  ['mixed', 'CONTRACTION'],
  ['mixed', 'INDIRECT'],
  ['mixed', 'PASSIVE'],
  ['mixed', 'DIRECT'],
];

/** The five control shapes, crossed with every family the port declares. */
export const REQUIRED_CONTROL_SHAPES: readonly VerifierControlShape[] = [
  'QUESTION',
  'CONDITIONAL',
  'OFFER',
  'TENTATIVE_INTENTION',
  'PLAIN',
];

/**
 * The three control shapes that must PAIR with every claim, in the same language
 * and the same family.
 *
 * This is the requirement that makes the precision measurement about something
 * other than the word "not". An OFFER, a QUESTION and a CONDITIONAL carry the
 * same vocabulary, the same family and often the same day and hour as the claim
 * they sit beside - so a verifier that flags the claim and leaves the three of
 * them alone has demonstrated something a negation-only control set cannot ask.
 *
 * `TENTATIVE_INTENTION` and `PLAIN` are NOT in this list and are required only by
 * the family grid, because a tentative intention has no natural twin for every
 * family (a RESCHEDULE "let me look" is the same sentence as a MEETING one) and
 * requiring 3 x 8 x 5 rows would have bought repetition rather than coverage.
 */
export const REQUIRED_PAIRED_CONTROL_SHAPES: readonly VerifierControlShape[] = ['OFFER', 'QUESTION', 'CONDITIONAL'];

/**
 * THE COVERAGE CONTRACT.
 *
 * It is deliberately NOT only a list of coverage keys the way the benchmark
 * corpus's `REQUIRED_COVERAGE` is: the counts below are derived from the data,
 * and the GRIDS above are declared. Both kinds are needed. A derived count
 * catches a language losing its controls; a declared grid catches an AXIS being
 * lost, which a count cannot see.
 */
export interface VerifierCoverageReport {
  readonly byLanguage: Record<VerifierCaseLanguage, { readonly claims: number; readonly controls: number }>;
  /** Every family that appears on at least one CLAIM. */
  readonly claimFamilies: readonly string[];
  /** Every family that appears on at least one HONEST_CONTROL. */
  readonly controlFamilies: readonly string[];
  readonly byProvenance: Record<string, number>;
  readonly totalClaims: number;
  readonly totalControls: number;
  /** Mission 2G. `language/claimShape` keys, present on at least one CLAIM. */
  readonly claimShapePairs: readonly string[];
  /** Mission 2G. `family/controlShape` keys, present on at least one HONEST_CONTROL. */
  readonly controlShapePairs: readonly string[];
  /** Mission 2G. How many rows are in each split, and how many carry no split at all. */
  readonly bySplit: Record<string, number>;
}

/**
 * Which requirements are unmet. Empty is the only acceptable answer.
 *
 * Each rule exists because failing it would make a headline number meaningless
 * rather than merely incomplete:
 *
 *  - A LANGUAGE WITH NO CONTROLS would report a 0% false-positive rate for that
 *    language, which reads as a precision result and is a missing denominator.
 *    Hebrew is the language this matters most for and the one with no recommended
 *    model.
 *  - A LANGUAGE WITH NO CLAIMS would report no recall at all, and the per-language
 *    table would print a gap that looks like a pass.
 *  - NO `RECORDED_MODEL_OUTPUT` case would mean the corpus had lost the two
 *    sentences the whole gate was built for.
 *  - NO `NEW_PARAPHRASE` case would mean the corpus only re-measures wordings
 *    somebody has already fixed, which is the shape of over-reading that § 17.8
 *    residual 1 warns about one layer down.
 *  - A MISSING (language x claimShape) PAIR would mean an axis the corpus says it
 *    covers is not covered - a very short Hebrew confirmation, an English
 *    indirect one, a mixed layout one. Mission 2G.
 *  - A MISSING (family x controlShape) PAIR would mean a family whose honest
 *    sentences are all negations, which measures the easy half of precision.
 *    Mission 2G.
 *
 * `scope` DECIDES WHETHER THE HELD-OUT-ONLY RULES APPLY. The grids above are
 * required of the corpus as a whole AND of the held-out split on its own, because
 * the held-out split is what the final number is measured on and a grid satisfied
 * only by dev rows would not constrain it. They are NOT required of an external
 * corpus - see `loadExternalVerifierCorpus`, which computes this and prints it
 * without making it fatal.
 */
export function unmetVerifierCoverage(
  cases: readonly VerifierCase[],
  scope: 'in-repo' | 'slice' = 'in-repo',
): string[] {
  const unmet: string[] = [];
  const coverage = verifierCoverage(cases);

  for (const language of ['en', 'he', 'mixed'] as const) {
    const counts = coverage.byLanguage[language];
    if (counts.claims === 0) unmet.push(`no CLAIM cases in language "${language}"`);
    if (counts.controls === 0) {
      unmet.push(
        `no HONEST_CONTROL cases in language "${language}" - the false-positive rate for it would have no ` +
          'denominator and would print as a clean zero',
      );
    }
  }

  for (const provenance of ['RECORDED_MODEL_OUTPUT', 'QA_FINDING', 'NEW_PARAPHRASE'] as const) {
    if ((coverage.byProvenance[provenance] ?? 0) === 0) unmet.push(`no cases with provenance "${provenance}"`);
  }

  // Every family the port declares must appear on at least one CLAIM. A family
  // nothing exercises is a family this corpus says nothing about, and the report
  // would print an empty row rather than admitting the gap.
  for (const family of ['MEETING', 'RESCHEDULE', 'CANCELLATION', 'CALLBACK', 'MESSAGE', 'RECORD', 'HANDOVER', 'ANY']) {
    if (!coverage.claimFamilies.includes(family)) unmet.push(`no CLAIM case in effect family "${family}"`);
  }

  if (scope !== 'in-repo') return unmet;

  for (const [language, shape] of REQUIRED_CLAIM_SHAPE_COVERAGE) {
    if (!coverage.claimShapePairs.includes(`${language}/${shape}`)) {
      unmet.push(`no CLAIM with language "${language}" and claimShape "${shape}"`);
    }
  }

  for (const family of ['MEETING', 'RESCHEDULE', 'CANCELLATION', 'CALLBACK', 'MESSAGE', 'RECORD', 'HANDOVER', 'ANY']) {
    for (const shape of REQUIRED_CONTROL_SHAPES) {
      if (!coverage.controlShapePairs.includes(`${family}/${shape}`)) {
        unmet.push(`no HONEST_CONTROL with effectFamily "${family}" and controlShape "${shape}"`);
      }
    }
  }

  return unmet;
}

/**
 * The HELD-OUT split's own contract, on top of `unmetVerifierCoverage`.
 *
 * TWO RULES, and both are about the split the FINAL number is measured on:
 *
 *  1. THE GRIDS MUST HOLD WITHIN THE HELD-OUT SPLIT ALONE. A (language x
 *     claimShape) pair satisfied only by a dev row does not constrain the
 *     held-out measurement at all.
 *  2. EVERY (language, family) THAT CARRIES A HELD-OUT CLAIM MUST ALSO CARRY A
 *     HELD-OUT OFFER, QUESTION AND CONDITIONAL. This is the pairing requirement,
 *     and it is checked per (language, family) rather than globally because an
 *     English offer says nothing about whether a Hebrew one is read correctly -
 *     `docs/MISSION_2D_CLAIM_GATE.md` § 21 CLASS B is an entire finding about a
 *     form that existed in one language's lexicon and not the other's.
 */
export function unmetHeldoutCoverage(cases: readonly VerifierCase[]): string[] {
  const heldout = cases.filter((entry) => entry.split === 'heldout');
  const unmet = unmetVerifierCoverage(heldout, 'in-repo').map((u) => `held-out split: ${u}`);

  const controlKeys = new Set(
    heldout
      .filter((entry) => entry.kind === 'HONEST_CONTROL')
      .map((entry) => `${entry.language}/${entry.effectFamily}/${entry.controlShape ?? '(none)'}`),
  );

  const claimCombos = new Set(
    heldout.filter((entry) => entry.kind === 'CLAIM').map((entry) => `${entry.language}/${entry.effectFamily}`),
  );

  for (const combo of [...claimCombos].sort()) {
    for (const shape of REQUIRED_PAIRED_CONTROL_SHAPES) {
      if (!controlKeys.has(`${combo}/${shape}`)) {
        unmet.push(
          `held-out split: a CLAIM exists for ${combo} but no HONEST_CONTROL with controlShape "${shape}" does - ` +
            'every claim category must be paired with honest offers, questions and conditional intentions in the ' +
            'same language and the same family',
        );
      }
    }
  }

  return unmet;
}

/**
 * The fields the SCHEMA leaves optional and the IN-REPO CORPUS requires.
 *
 * WHY THE ASYMMETRY EXISTS, stated here because this is where it is enforced.
 * `--corpus-file` lets an operator run a SEALED evaluation set that this
 * repository has never seen. Such a file is a legitimate slice of this schema and
 * may carry no `split` (it is all one thing), no `claimShape` and no
 * `controlShape` (nobody labelled its axes). A schema that required the three
 * would refuse it, which would make the flag useless for the purpose the Founder
 * built it for. So the schema says what a case MAY carry and this function says
 * what THIS corpus MUST - and this corpus must, because the whole value of
 * Mission 2G's final measurement is that the split is not a matter of trust.
 */
export function unmetVerifierInRepoFields(cases: readonly VerifierCase[]): string[] {
  const unmet: string[] = [];
  for (const entry of cases) {
    if (entry.split === undefined) unmet.push(`case "${entry.id}" carries no split`);
    if (entry.kind === 'CLAIM' && entry.claimShape === undefined) {
      unmet.push(`CLAIM "${entry.id}" carries no claimShape`);
    }
    if (entry.kind === 'HONEST_CONTROL' && entry.controlShape === undefined) {
      unmet.push(`HONEST_CONTROL "${entry.id}" carries no controlShape`);
    }
  }
  return unmet;
}

export function verifierCoverage(cases: readonly VerifierCase[]): VerifierCoverageReport {
  const byLanguage: Record<VerifierCaseLanguage, { claims: number; controls: number }> = {
    en: { claims: 0, controls: 0 },
    he: { claims: 0, controls: 0 },
    mixed: { claims: 0, controls: 0 },
  };
  const byProvenance: Record<string, number> = {};
  const bySplit: Record<string, number> = { dev: 0, heldout: 0, '(none)': 0 };
  const claimFamilies = new Set<string>();
  const controlFamilies = new Set<string>();
  const claimShapePairs = new Set<string>();
  const controlShapePairs = new Set<string>();

  for (const entry of cases) {
    const bucket = byLanguage[entry.language];
    if (entry.kind === 'CLAIM') {
      bucket.claims += 1;
      claimFamilies.add(entry.effectFamily);
      if (entry.claimShape !== undefined) claimShapePairs.add(`${entry.language}/${entry.claimShape}`);
    } else {
      bucket.controls += 1;
      controlFamilies.add(entry.effectFamily);
      if (entry.controlShape !== undefined) controlShapePairs.add(`${entry.effectFamily}/${entry.controlShape}`);
    }
    byProvenance[entry.provenance] = (byProvenance[entry.provenance] ?? 0) + 1;
    const splitKey = entry.split ?? '(none)';
    bySplit[splitKey] = (bySplit[splitKey] ?? 0) + 1;
  }

  return {
    byLanguage,
    claimFamilies: [...claimFamilies].sort(),
    controlFamilies: [...controlFamilies].sort(),
    byProvenance,
    totalClaims: cases.filter((c) => c.kind === 'CLAIM').length,
    totalControls: cases.filter((c) => c.kind === 'HONEST_CONTROL').length,
    claimShapePairs: [...claimShapePairs].sort(),
    controlShapePairs: [...controlShapePairs].sort(),
    bySplit,
  };
}

/**
 * THE DUPLICATE CHECKS, factored out so `--corpus-file` runs the SAME TWO on an
 * external corpus rather than a second implementation of them.
 *
 * Returns the first problem it finds, or `null`. Not a list, because either one is
 * fatal and reporting all of them would just be a longer way to stop.
 */
export function duplicateVerifierCaseProblem(cases: readonly VerifierCase[]): string | null {
  const ids = new Set<string>();
  for (const entry of cases) {
    if (ids.has(entry.id)) {
      return `Duplicate verifier case id "${entry.id}". Ids are report row keys and must be unique.`;
    }
    ids.add(entry.id);
  }

  const texts = new Map<string, string>();
  for (const entry of cases) {
    const seen = texts.get(entry.text);
    if (seen !== undefined) {
      return (
        `Verifier cases "${seen}" and "${entry.id}" carry the SAME text. One wording counted twice makes the ` +
        'corpus look bigger than it is and weights one sentence twice in every rate this eval reports.'
      );
    }
    texts.set(entry.text, entry.id);
  }

  return null;
}

export function loadVerifierCorpus(): VerifierCorpus {
  const parsed = VerifierCorpusSchema.safeParse({
    schemaVersion: VERIFIER_CORPUS_SCHEMA_VERSION,
    corpusVersion: VERIFIER_CORPUS_VERSION,
    cases: RAW_CASES,
  });

  if (!parsed.success) {
    throw new Error(
      'The semantic-verifier corpus does not satisfy its own schema. This is a bug in the corpus, not in a ' +
        'model:\n' +
        parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }

  const corpus = parsed.data;

  const duplicate = duplicateVerifierCaseProblem(corpus.cases);
  if (duplicate !== null) throw new Error(duplicate);

  const missingFields = unmetVerifierInRepoFields(corpus.cases);
  if (missingFields.length > 0) {
    throw new Error(
      'Every IN-REPO verifier case must carry a split and its kind\'s shape axis, even though the schema leaves ' +
        `all three optional for external corpora:\n${missingFields.map((u) => `  - ${u}`).join('\n')}`,
    );
  }

  const unmet = [...unmetVerifierCoverage(corpus.cases), ...unmetHeldoutCoverage(corpus.cases)];
  if (unmet.length > 0) {
    throw new Error(
      `The verifier corpus does not cover what it claims to. Unmet:\n${unmet.map((u) => `  - ${u}`).join('\n')}`,
    );
  }

  return corpus;
}

/** The cases for one language, in declaration order. */
export function casesForLanguage(
  cases: readonly VerifierCase[],
  language: VerifierCaseLanguage,
): readonly VerifierCase[] {
  return cases.filter((entry) => entry.language === language);
}

/**
 * The cases for one split, in declaration order. `'all'` is everything.
 *
 * NO FALLBACK AND NO LENIENCE. A row with no `split` is NOT returned for `dev` or
 * for `heldout` - it is returned only by `'all'`. That is why `--split dev`
 * REFUSES an external corpus that carries no splits rather than running it: a
 * silent empty selection, or a silent full one, would both be a run nobody meant.
 */
export function casesForSplit(cases: readonly VerifierCase[], split: VerifierSplitSelector): readonly VerifierCase[] {
  if (split === 'all') return cases;
  return cases.filter((entry) => entry.split === split);
}

/** True when at least one row carries a `split`. Drives the `--split` refusal. */
export function corpusCarriesSplits(cases: readonly VerifierCase[]): boolean {
  return cases.some((entry) => entry.split !== undefined);
}

// `export *` below already re-exports VerifierCaseSplit, VerifierSplitSelector and
// the two shape enums from `./schema.js`; naming them again here would be a second
// place to keep in step for no benefit.
export * from './schema.js';
export * from './split.js';
export { ENGLISH_VERIFIER_CASES } from './cases.en.js';
export { HEBREW_VERIFIER_CASES } from './cases.he.js';
export { MIXED_VERIFIER_CASES } from './cases.mixed.js';
export { ENGLISH_HELDOUT_VERIFIER_CASES } from './heldout/cases.heldout.en.js';
export { HEBREW_HELDOUT_VERIFIER_CASES } from './heldout/cases.heldout.he.js';
export { MIXED_HELDOUT_VERIFIER_CASES } from './heldout/cases.heldout.mixed.js';
