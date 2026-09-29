/**
 * `npm run eval:report` - distil recorded runs into committed artefacts.
 *
 * Reads only what is already on disk. It never calls a model, so it is safe to
 * re-run at any time and it cannot change the evidence it is reporting on.
 *
 * Reads:
 *   <outDir>/runs/<model>/<scenario>.json              the recorded runs
 *   <outDir>/environment/<model>.json                  host conditions, OPTIONAL
 *
 * Writes:
 *   <outDir>/results.json                              COMMITTED
 *   <outDir>/COMPARISON.md                             COMMITTED
 *   <outDir>/transcripts/<model>/<scenario>.md         COMMITTED
 *
 * EVERY path above is derived from `outDir`, and `outDir` is the ONLY thing this
 * file decides: it reads `EVAL_OUT_DIR` and hands the result to
 * `generateReportArtefacts`. Nothing downstream is hardcoded to the default root,
 * so a fresh comparable run can be reported BESIDE the preliminary results
 * instead of overwriting them - proved by
 * `tests/eval/customOutputDirectory.test.ts`, which drives that function against
 * a temporary directory.
 *
 * The transcripts are committed deliberately. Every judged score in this
 * harness is an opinion from a 7-8B model, and an opinion nobody can check
 * against the conversation that produced it is not evidence.
 */
import { join } from 'node:path';

import { generateReportArtefacts } from '../report/generate.js';
import { DEFAULT_OUT_DIR } from '../runner/store.js';

async function main(): Promise<void> {
  const outDir = process.env['EVAL_OUT_DIR'] ?? DEFAULT_OUT_DIR;

  const result = generateReportArtefacts({
    outDir,
    generatedAtIso: new Date().toISOString(),
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
  });

  if (result.models.length === 0) {
    console.error(`No recorded runs under ${join(outDir, 'runs')}. Run \`npm run eval:run\` first.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nWrote ${result.jsonPath}`);
  console.log(`Wrote ${result.markdownPath}`);
  console.log(`Wrote ${result.transcriptCount} transcript(s) under ${join(outDir, 'transcripts')}`);
}

main().catch((error: unknown) => {
  console.error('\neval:report FAILED\n');
  console.error(error);
  process.exitCode = 1;
});
