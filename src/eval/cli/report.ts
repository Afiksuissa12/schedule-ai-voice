/**
 * `npm run eval:report` - distil recorded runs into committed artefacts.
 *
 * Reads only what is already on disk. It never calls a model, so it is safe to
 * re-run at any time and it cannot change the evidence it is reporting on.
 *
 * Writes:
 *   <outDir>/results.json                              COMMITTED
 *   <outDir>/COMPARISON.md                             COMMITTED
 *   <outDir>/transcripts/<model>/<scenario>.md         COMMITTED
 *
 * The transcripts are committed deliberately. Every judged score in this
 * harness is an opinion from a 7-8B model, and an opinion nobody can check
 * against the conversation that produced it is not evidence.
 */
import { join } from 'node:path';

import { loadCorpus } from '../corpus/index.js';
import { CANDIDATES } from '../models/candidates.js';
import { buildReport } from '../report/report.js';
import { renderTranscript } from '../runner/transcript.js';
import {
  DEFAULT_OUT_DIR,
  modelSlug,
  readModelRuns,
  recordedModels,
  writeJson,
  writeText,
} from '../runner/store.js';
import type { ScenarioRun } from '../types.js';

async function main(): Promise<void> {
  const outDir = process.env['EVAL_OUT_DIR'] ?? DEFAULT_OUT_DIR;
  const corpus = loadCorpus();

  // Candidate order first, then anything else that happens to be recorded, so
  // an ad-hoc extra model still appears rather than being silently dropped.
  const found = recordedModels(outDir);
  const ordered = [
    ...CANDIDATES.map((c) => c.tag).filter((tag) => found.includes(tag)),
    ...found.filter((tag) => !CANDIDATES.some((c) => c.tag === tag)),
  ];

  if (ordered.length === 0) {
    console.error(`No recorded runs under ${outDir}/runs. Run \`npm run eval:run\` first.`);
    process.exitCode = 1;
    return;
  }

  const runsByModel = new Map<string, ScenarioRun[]>();
  let transcriptCount = 0;

  for (const modelId of ordered) {
    const runs = readModelRuns(outDir, modelId);
    runsByModel.set(modelId, runs);

    for (const run of runs) {
      writeText(join(outDir, 'transcripts', modelSlug(modelId), `${run.scenarioId}.md`), renderTranscript(run));
      transcriptCount += 1;
    }

    const missing = corpus.scenarios.filter((s) => !runs.some((r) => r.scenarioId === s.id));
    console.log(
      `${modelId}: ${runs.length}/${corpus.scenarios.length} scenarios recorded` +
        (missing.length > 0 ? ` (MISSING: ${missing.map((s) => s.id).join(', ')})` : ''),
    );
  }

  const report = buildReport({ runsByModel, generatedAtIso: new Date().toISOString() });

  const jsonPath = join(outDir, 'results.json');
  const markdownPath = join(outDir, 'COMPARISON.md');
  writeJson(jsonPath, report.json);
  writeText(markdownPath, report.markdown);

  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);
  console.log(`Wrote ${transcriptCount} transcript(s) under ${join(outDir, 'transcripts')}`);
}

main().catch((error: unknown) => {
  console.error('\neval:report FAILED\n');
  console.error(error);
  process.exitCode = 1;
});
