/**
 * `npm run eval:corpus` - validate the corpus and print its coverage.
 *
 * Calls NO model and touches NO network, so it is the cheap way to check that a
 * change to a scenario is still well-formed before spending an hour of GPU time
 * finding out. Exits non-zero if the corpus fails its own schema or leaves a
 * required conversational shape unclaimed.
 */
import { coverageMap, loadCorpus } from '../corpus/index.js';
import { REQUIRED_COVERAGE } from '../corpus/schema.js';
import { JUDGED_DIMENSIONS, PROGRAMMATIC_DIMENSIONS, RUBRIC_CATEGORIES, RUBRIC_VERSION } from '../rubric/rubric.js';

function main(): void {
  const corpus = loadCorpus();

  console.log(`Corpus ${corpus.corpusVersion} (schema ${corpus.schemaVersion}) - VALID`);
  console.log(`  ${corpus.scenarios.length} scenarios, ${corpus.scenarios.reduce((n, s) => n + s.turns.length, 0)} turns\n`);

  const byLanguage = new Map<string, number>();
  for (const scenario of corpus.scenarios) {
    byLanguage.set(scenario.language, (byLanguage.get(scenario.language) ?? 0) + 1);
  }

  console.log('Scenarios:');
  for (const scenario of corpus.scenarios) {
    const expectations = scenario.turns.filter((t) => t.tools || t.passthrough || t.text).length;
    console.log(
      `  ${scenario.id.padEnd(30)} ${scenario.language.padEnd(6)} ${String(scenario.turns.length).padStart(2)} turns, ` +
        `${expectations} with expectations`,
    );
  }

  console.log(`\nBy language: ${[...byLanguage].map(([k, v]) => `${k}=${v}`).join(', ')}`);

  console.log('\nCoverage:');
  const map = coverageMap(corpus.scenarios);
  let uncovered = 0;
  for (const key of REQUIRED_COVERAGE) {
    const scenarios = map[key] ?? [];
    if (scenarios.length === 0) uncovered += 1;
    console.log(`  ${key.padEnd(30)} ${scenarios.length === 0 ? '*** UNCOVERED ***' : scenarios.join(', ')}`);
  }

  console.log(`\nRubric ${RUBRIC_VERSION}:`);
  for (const category of RUBRIC_CATEGORIES) {
    console.log(`  ${category.label} - ${(category.weight * 100).toFixed(0)}% of the composite`);
    for (const dimension of category.dimensions) {
      console.log(
        `      ${dimension.key.padEnd(32)} ${(dimension.weight * 100).toFixed(0).padStart(3)}%  ${dimension.method}`,
      );
    }
  }
  console.log(
    `\n  ${PROGRAMMATIC_DIMENSIONS.length} programmatic dimensions, ${JUDGED_DIMENSIONS.length} judged.`,
  );

  if (uncovered > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error('\neval:corpus FAILED\n');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
