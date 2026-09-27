/**
 * Where host environment records live, and how they are read back.
 *
 *   <outDir>/environment/<model-slug>.json
 *
 * A SIBLING of `runs/` and `transcripts/` under the SAME output root, so it
 * moves with `EVAL_OUT_DIR`. That matters for the one thing this directory is
 * for: a fresh, fairly-conducted run has to be able to live BESIDE the
 * preliminary results rather than overwriting them, and conditions recorded
 * against the wrong run are worse than no conditions at all.
 *
 * READ-ONLY, DELIBERATELY. There is no `writeEnvironmentRecord` here. An
 * external host sampler writes these files; this harness runs in a container and
 * would measure the container rather than the host whose GPU is doing the work.
 * See `schema.ts` for the full argument.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { modelSlug } from '../runner/store.js';
import { parseEnvironmentRecord, type EnvironmentRecord } from './schema.js';

/** Named once so the docs, the tests and `.gitignore` cannot disagree with it. */
export const ENVIRONMENT_DIR_NAME = 'environment';

export function environmentDir(outDir: string): string {
  return join(outDir, ENVIRONMENT_DIR_NAME);
}

/** Same slugging as `runs/` and `transcripts/`, so the three line up by eye. */
export function environmentPath(outDir: string, modelId: string): string {
  return join(environmentDir(outDir), `${modelSlug(modelId)}.json`);
}

/**
 * Read one record, or `null` if nobody sampled this model's run.
 *
 * MISSING IS NORMAL AND RETURNS NULL. MALFORMED THROWS.
 *
 * This is deliberately the opposite of `readRun`, which swallows a corrupt file
 * and returns `null` so that one bad scenario does not stop a report. The
 * asymmetry is intentional: a dropped `ScenarioRun` shows up as a missing
 * scenario in the completeness counts, where a reader will see it. A dropped
 * environment record would show up as `not measured`, which is indistinguishable
 * from "nobody sampled it" - so a file that exists but cannot be trusted has to
 * stop the report rather than quietly become a blank cell.
 */
export function readEnvironmentRecord(outDir: string, modelId: string): EnvironmentRecord | null {
  const path = environmentPath(outDir, modelId);
  if (!existsSync(path)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `Environment record at ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const record = parseEnvironmentRecord(raw, path);

  // The path says which model this is; so does the file. If they disagree, one
  // model's conditions are about to be credited to another - which is precisely
  // the unfair comparison these files exist to make visible.
  if (record.modelId !== modelId) {
    throw new Error(
      `Environment record at ${path} declares modelId "${record.modelId}" but was read for "${modelId}". ` +
        'A record filed under the wrong model would attribute one model\'s machine conditions to another.',
    );
  }

  return record;
}

/** Every requested model, in the order given, with `null` where none was written. */
export function readEnvironmentRecords(
  outDir: string,
  modelIds: readonly string[],
): Map<string, EnvironmentRecord | null> {
  const records = new Map<string, EnvironmentRecord | null>();
  for (const modelId of modelIds) records.set(modelId, readEnvironmentRecord(outDir, modelId));
  return records;
}

/**
 * The model slugs that have a record on disk.
 *
 * Used by `eval:report` to warn about a record that belongs to no recorded run -
 * a typo in a filename, or conditions sampled for a model that was never
 * benchmarked. Silently ignoring it is how 57 artefacts went missing once; see
 * EVAL_HARNESS.md section 8.
 */
export function recordedEnvironmentSlugs(outDir: string): string[] {
  const dir = environmentDir(outDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => entry.slice(0, -'.json'.length))
    .sort();
}
