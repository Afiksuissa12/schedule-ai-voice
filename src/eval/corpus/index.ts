/**
 * Loading the corpus, and refusing to load a broken one.
 *
 * Two gates run at load time, and both throw rather than warn:
 *
 *  1. ZOD VALIDATION of every scenario. A typo in an expectation would
 *     otherwise become a silently unchecked assertion - the benchmark would
 *     still run, still report a score, and quietly stop testing something.
 *
 *  2. COVERAGE. Every key in `REQUIRED_COVERAGE` must be claimed by at least
 *     one scenario, and no scenario id may repeat. The mission names the
 *     conversational shapes that must be covered; encoding that as a check
 *     means the corpus cannot lose one and keep looking healthy.
 */
import { ENGLISH_SCENARIOS } from './scenarios.en.js';
import { HEBREW_SCENARIOS } from './scenarios.he.js';
import {
  CORPUS_SCHEMA_VERSION,
  CorpusSchema,
  REQUIRED_COVERAGE,
  type BenchmarkScenario,
  type Corpus,
  type CoverageKey,
} from './schema.js';

/**
 * Bump on any change to a scenario's world, utterances or expectations.
 *
 * Recorded in every results file, so two runs can be compared only when they
 * measured the same thing.
 */
export const CORPUS_VERSION = '1.0.0';

const RAW_SCENARIOS: BenchmarkScenario[] = [...ENGLISH_SCENARIOS, ...HEBREW_SCENARIOS];

export function loadCorpus(): Corpus {
  const parsed = CorpusSchema.safeParse({
    schemaVersion: CORPUS_SCHEMA_VERSION,
    corpusVersion: CORPUS_VERSION,
    scenarios: RAW_SCENARIOS,
  });

  if (!parsed.success) {
    throw new Error(
      `The benchmark corpus does not satisfy its own schema. This is a bug in the corpus, not in a model:\n` +
        parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }

  const corpus = parsed.data;

  const ids = new Set<string>();
  for (const scenario of corpus.scenarios) {
    if (ids.has(scenario.id)) {
      throw new Error(`Duplicate scenario id "${scenario.id}". Ids are used as filenames and must be unique.`);
    }
    ids.add(scenario.id);
  }

  const missing = missingCoverage(corpus.scenarios);
  if (missing.length > 0) {
    throw new Error(
      `The corpus does not cover every required conversational shape. Missing: ${missing.join(', ')}. ` +
        'Add a scenario claiming each, or the benchmark is reporting on less than it says it is.',
    );
  }

  return corpus;
}

/** Which required keys nothing claims. Empty is the only acceptable answer. */
export function missingCoverage(scenarios: readonly BenchmarkScenario[]): CoverageKey[] {
  const claimed = new Set(scenarios.flatMap((scenario) => scenario.coverage));
  return REQUIRED_COVERAGE.filter((key) => !claimed.has(key));
}

/** Coverage key -> the scenarios claiming it. Printed in EVAL_HARNESS.md. */
export function coverageMap(scenarios: readonly BenchmarkScenario[]): Record<CoverageKey, string[]> {
  const map = {} as Record<CoverageKey, string[]>;
  for (const key of REQUIRED_COVERAGE) map[key] = [];
  for (const scenario of scenarios) {
    for (const key of scenario.coverage) map[key].push(scenario.id);
  }
  return map;
}

export * from './schema.js';
export { ENGLISH_SCENARIOS } from './scenarios.en.js';
export { HEBREW_SCENARIOS } from './scenarios.he.js';
