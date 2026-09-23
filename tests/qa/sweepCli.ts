/**
 * `npm run qa:sweep` - run the invariant sweep and write the QA report.
 *
 * Exists so that a reviewer who does not want to read a test runner's output
 * can get one page that says how many scenarios ran, which invariants held,
 * which ValidationErrorCodes were exercised, and - just as importantly - what
 * this sweep does NOT cover.
 *
 * Writes to `.tmp/qa/`, which `.gitignore` already excludes: a generated
 * artifact committed to the repository is a stale artifact within a week.
 *
 *   npm run qa:sweep
 *   npm run qa:sweep -- --determinism     run the corpus TWICE and compare
 *   npm run qa:sweep -- --family A        only families whose key starts with A
 *   npm run qa:sweep -- --concurrency 8
 *
 * Exit code is 0 only when every invariant held, nothing reached the network,
 * and - if asked for - the second run agreed with the first.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { classificationOf, executeSweep } from '../invariants/sweep.js';
import { generateScenarios } from '../invariants/scenarios.js';
import { REPO_ROOT } from '../helpers/testDb.js';
import { renderJson, renderReport } from './report.js';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1] ?? '';
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const familyPrefix = flag('family');
const concurrency = Number(flag('concurrency') ?? '4');
const chunkSize = Number(flag('chunk') ?? '32');
const wantDeterminism = has('determinism');

const totalAvailable = generateScenarios().length;
const filter = familyPrefix ? (scenario: { family: string }) => scenario.family.startsWith(familyPrefix) : undefined;

process.stdout.write(
  `Running invariant sweep` +
    (familyPrefix ? ` (family ${familyPrefix}*)` : ` (all ${totalAvailable} scenarios)`) +
    ` with concurrency ${concurrency}...\n`,
);

const sweep = await executeSweep({
  concurrency,
  chunkSize,
  label: 'qa-sweep',
  ...(filter ? { filter } : {}),
  onProgress: (done, total) => {
    process.stdout.write(`\r  ${done}/${total} scenarios`);
  },
});
process.stdout.write('\n');

// INV-09. A second full run, compared on CLASSIFICATION rather than on row ids
// (which are cuids and differ by design).
let determinism: { ran: boolean; identical: boolean; differing: string[] } | undefined;
if (wantDeterminism) {
  process.stdout.write('Re-running the corpus to check determinism...\n');
  const second = await executeSweep({
    concurrency,
    chunkSize,
    label: 'qa-sweep-2',
    ...(filter ? { filter } : {}),
    onProgress: (done, total) => {
      process.stdout.write(`\r  ${done}/${total} scenarios`);
    },
  });
  process.stdout.write('\n');

  const first = classificationOf(sweep.observations);
  const repeat = classificationOf(second.observations);
  const differing = Object.keys(first).filter((id) => first[id] !== repeat[id]);
  determinism = { ran: true, identical: differing.length === 0, differing };
}

const options = {
  filtered: filter !== undefined,
  totalAvailable,
  ...(determinism ? { determinism } : {}),
};

const text = renderReport(sweep, options);
process.stdout.write(`\n${text}\n`);

const outputDir = join(REPO_ROOT, '.tmp', 'qa');
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'sweep-report.txt'), `${text}\n`, 'utf8');
writeFileSync(join(outputDir, 'sweep-report.json'), `${renderJson(sweep, options)}\n`, 'utf8');
process.stdout.write(`\nWritten to ${join('.tmp', 'qa')}/sweep-report.{txt,json}\n`);

const ok =
  sweep.violations.length === 0 &&
  sweep.networkAttempts.length === 0 &&
  (determinism === undefined || determinism.identical);

process.exit(ok ? 0 : 1);
