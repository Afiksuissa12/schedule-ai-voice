/**
 * Loading the verifier corpus, and refusing to load a broken one.
 *
 * Four gates run at load time and all four THROW rather than warn, on the same
 * argument `src/eval/corpus/index.ts` makes: a typo in an expectation would
 * otherwise become a silently unchecked assertion - the eval would still run,
 * still report a number, and quietly stop testing something.
 *
 *  1. ZOD VALIDATION of every case, including the two cross-field rules that keep
 *     a CLAIM from being labelled with a non-material status and a CONTROL from
 *     being labelled with a material one.
 *  2. UNIQUE IDS. Ids are report row keys.
 *  3. UNIQUE TEXTS. Two cases with the same string would be counted twice in one
 *     recall number, which is a quiet way to make a corpus look bigger than it is.
 *  4. THE COVERAGE CONTRACT below, which is what stops this corpus losing a
 *     requirement while still looking healthy.
 */
import { ENGLISH_VERIFIER_CASES } from './cases.en.js';
import { HEBREW_VERIFIER_CASES } from './cases.he.js';
import { MIXED_VERIFIER_CASES } from './cases.mixed.js';
import {
  VERIFIER_CORPUS_SCHEMA_VERSION,
  VerifierCorpusSchema,
  type VerifierCase,
  type VerifierCaseLanguage,
  type VerifierCorpus,
} from './schema.js';

/**
 * Bump on any change to a case's text, its label or its provenance.
 *
 * Recorded in every verifier-eval output file, so two operator runs can be
 * compared only when they measured the same thing - the same rule the benchmark
 * corpus keeps, and for the same reason.
 *
 * `1.0.0` is the first. It carries every wording recorded in
 * `docs/MISSION_2D_CLAIM_GATE.md` §§ 14-21, both sentences the Founder Review
 * quotes, all nine Mission 2D-R QA-3 wordings and both of their A/B controls, the
 * fifteen honest controls independent QA re-verified, the two live false
 * positives of the deterministic layer, and new paraphrases written for this
 * corpus.
 */
export const VERIFIER_CORPUS_VERSION = '1.0.0';

const RAW_CASES: readonly VerifierCase[] = [
  ...ENGLISH_VERIFIER_CASES,
  ...HEBREW_VERIFIER_CASES,
  ...MIXED_VERIFIER_CASES,
];

/**
 * THE COVERAGE CONTRACT.
 *
 * It is deliberately NOT a list of coverage keys the way the benchmark corpus's
 * `REQUIRED_COVERAGE` is, because the axes that matter here are structural rather
 * than conversational, and a key somebody has to remember to claim is the kind of
 * axis `docs/MISSION_2D_CLAIM_GATE.md` § 21.10 calls "remembered rather than
 * mechanical". These are derived from the data itself and checked as counts.
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
}

/**
 * Which requirements are unmet. Empty is the only acceptable answer.
 *
 * Each rule below exists because failing it would make a headline number
 * meaningless rather than merely incomplete:
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
 */
export function unmetVerifierCoverage(cases: readonly VerifierCase[]): string[] {
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

  return unmet;
}

export function verifierCoverage(cases: readonly VerifierCase[]): VerifierCoverageReport {
  const byLanguage: Record<VerifierCaseLanguage, { claims: number; controls: number }> = {
    en: { claims: 0, controls: 0 },
    he: { claims: 0, controls: 0 },
    mixed: { claims: 0, controls: 0 },
  };
  const byProvenance: Record<string, number> = {};
  const claimFamilies = new Set<string>();
  const controlFamilies = new Set<string>();

  for (const entry of cases) {
    const bucket = byLanguage[entry.language];
    if (entry.kind === 'CLAIM') {
      bucket.claims += 1;
      claimFamilies.add(entry.effectFamily);
    } else {
      bucket.controls += 1;
      controlFamilies.add(entry.effectFamily);
    }
    byProvenance[entry.provenance] = (byProvenance[entry.provenance] ?? 0) + 1;
  }

  return {
    byLanguage,
    claimFamilies: [...claimFamilies].sort(),
    controlFamilies: [...controlFamilies].sort(),
    byProvenance,
    totalClaims: cases.filter((c) => c.kind === 'CLAIM').length,
    totalControls: cases.filter((c) => c.kind === 'HONEST_CONTROL').length,
  };
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

  const ids = new Set<string>();
  for (const entry of corpus.cases) {
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate verifier case id "${entry.id}". Ids are report row keys and must be unique.`);
    }
    ids.add(entry.id);
  }

  const texts = new Map<string, string>();
  for (const entry of corpus.cases) {
    const seen = texts.get(entry.text);
    if (seen !== undefined) {
      throw new Error(
        `Verifier cases "${seen}" and "${entry.id}" carry the SAME text. One wording counted twice makes the ` +
          'corpus look bigger than it is and weights one sentence twice in every rate this eval reports.',
      );
    }
    texts.set(entry.text, entry.id);
  }

  const unmet = unmetVerifierCoverage(corpus.cases);
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

export * from './schema.js';
export { ENGLISH_VERIFIER_CASES } from './cases.en.js';
export { HEBREW_VERIFIER_CASES } from './cases.he.js';
export { MIXED_VERIFIER_CASES } from './cases.mixed.js';
