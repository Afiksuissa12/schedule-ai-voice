/**
 * Turning an output directory on disk into the committed report artefacts.
 *
 * WHY THIS IS NOT IN `cli/report.ts`
 * ---------------------------------------------------------------------------
 * `cli/report.ts` calls `main()` at module load, so importing it would RUN it -
 * and a test that imported it would generate a report into the default
 * `eval-output/`, overwriting the preliminary evidence a fresh run has to be
 * comparable against. EVAL_HARNESS.md section 8 records what it cost the last
 * time those artefacts went missing.
 *
 * So the work lives here, as a function that takes its output directory as an
 * ARGUMENT and has no opinion about `EVAL_OUT_DIR`. The CLI reads the
 * environment variable; this function is what
 * `tests/eval/customOutputDirectory.test.ts` drives against a temporary
 * directory to prove that every path really does move with it.
 *
 * READS ONLY WHAT IS ALREADY ON DISK. It never calls a model, so it is safe to
 * re-run at any time and cannot change the evidence it is reporting on.
 */
import { join } from 'node:path';

import { loadCorpus } from '../corpus/index.js';
import { ENVIRONMENT_DIR_NAME, readEnvironmentRecords, recordedEnvironmentSlugs } from '../environment/store.js';
import { CANDIDATES } from '../models/candidates.js';
import { buildReport } from './report.js';
import { renderTranscript } from '../runner/transcript.js';
import { modelSlug, readModelRuns, recordedModels, writeJson, writeText } from '../runner/store.js';
import type { ScenarioRun } from '../types.js';

export interface GenerateReportOptions {
  /** The output ROOT. Every path below is derived from it and none is hardcoded. */
  readonly outDir: string;
  readonly generatedAtIso: string;
  /** Where progress goes. Defaults to silence, which is what a test wants. */
  readonly log?: (message: string) => void;
  readonly warn?: (message: string) => void;
}

export interface GenerateReportResult {
  readonly outDir: string;
  /** Empty when nothing was recorded; the caller decides whether that is fatal. */
  readonly models: readonly string[];
  readonly transcriptCount: number;
  /** Models that had a validated host environment record. */
  readonly sampledModels: readonly string[];
  /** Environment records matching no recorded run. Reported, never silently dropped. */
  readonly orphanedEnvironmentSlugs: readonly string[];
  readonly jsonPath: string;
  readonly markdownPath: string;
}

export function generateReportArtefacts(options: GenerateReportOptions): GenerateReportResult {
  const { outDir } = options;
  const log = options.log ?? ((): void => {});
  const warn = options.warn ?? log;
  const corpus = loadCorpus();

  // Candidate order first, then anything else that happens to be recorded, so
  // an ad-hoc extra model still appears rather than being silently dropped.
  const found = recordedModels(outDir);
  const ordered = [
    ...CANDIDATES.map((c) => c.tag).filter((tag) => found.includes(tag)),
    ...found.filter((tag) => !CANDIDATES.some((c) => c.tag === tag)),
  ];

  const jsonPath = join(outDir, 'results.json');
  const markdownPath = join(outDir, 'COMPARISON.md');

  if (ordered.length === 0) {
    return {
      outDir,
      models: [],
      transcriptCount: 0,
      sampledModels: [],
      orphanedEnvironmentSlugs: [],
      jsonPath,
      markdownPath,
    };
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
    log(
      `${modelId}: ${runs.length}/${corpus.scenarios.length} scenarios recorded` +
        (missing.length > 0 ? ` (MISSING: ${missing.map((s) => s.id).join(', ')})` : ''),
    );
  }

  // Host conditions. A MISSING record is normal and reports `not measured`; a
  // malformed one throws out of here, because a half-read environment record
  // would become a blank cell indistinguishable from "nobody sampled it".
  const environmentByModel = readEnvironmentRecords(outDir, ordered);
  const sampledModels = ordered.filter((modelId) => environmentByModel.get(modelId) !== null);
  log(
    `Environment records: ${sampledModels.length}/${ordered.length} model(s) sampled` +
      (sampledModels.length < ordered.length
        ? ` (the rest report \`not measured\` - see ${join(outDir, ENVIRONMENT_DIR_NAME)})`
        : ''),
  );

  // A record whose filename matches no recorded run is almost always a typo in
  // the slug, and silently ignoring it would drop real evidence.
  const knownSlugs = new Set(ordered.map((modelId) => modelSlug(modelId)));
  const orphanedEnvironmentSlugs = recordedEnvironmentSlugs(outDir).filter((slug) => !knownSlugs.has(slug));
  if (orphanedEnvironmentSlugs.length > 0) {
    warn(
      `WARNING: ${orphanedEnvironmentSlugs.length} environment record(s) match no recorded run and were ` +
        `IGNORED: ${orphanedEnvironmentSlugs.join(', ')}. Expected one of: ${[...knownSlugs].join(', ')}.`,
    );
  }

  const report = buildReport({ runsByModel, environmentByModel, generatedAtIso: options.generatedAtIso });

  writeJson(jsonPath, report.json);
  writeText(markdownPath, report.markdown);

  return {
    outDir,
    models: ordered,
    transcriptCount,
    sampledModels,
    orphanedEnvironmentSlugs,
    jsonPath,
    markdownPath,
  };
}
