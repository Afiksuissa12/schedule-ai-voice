/**
 * Where results live on disk, and why the layout is what it is.
 *
 * ONE FILE PER (MODEL, SCENARIO). That is the whole resumability design: a run
 * that dies after forty minutes has forty minutes of committed evidence on
 * disk, and restarting it skips everything already present. A single
 * accumulating results file would have to be rewritten after every scenario and
 * would lose the lot on an interrupt.
 *
 *   <outDir>/runs/<model-slug>/<scenario-id>.json     one ScenarioRun
 *   <outDir>/environment/<model-slug>.json            host conditions per run
 *   <outDir>/models.json                              the model inventory
 *   <outDir>/results.json                             the distilled comparison
 *   <outDir>/transcripts/<model-slug>/<scenario>.md   human-readable
 *   <outDir>/COMPARISON.md                            the side-by-side report
 *
 * ONLY `<outDir>/runs` is gitignored - it is large and fully regenerable from
 * the models. `results.json`, `models.json`, `COMPARISON.md`, the transcripts AND
 * `environment/` are COMMITTED, because the Founder Review depends on them and a
 * judged score nobody can check against its transcript is not evidence.
 * `.gitignore` says the same thing at the one line that enforces it.
 *
 * `environment/` is committed for a sharper reason than the rest: it is the only
 * artefact here that CANNOT be regenerated. You can always re-run a model, but
 * you cannot go back and re-measure what the machine was doing last Tuesday. It
 * is also tiny. It is written by an EXTERNAL host sampler rather than by this
 * harness - see `src/eval/environment/schema.ts` - and read back by
 * `src/eval/environment/store.ts`, which owns its paths.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ScenarioRun } from '../types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..', '..');

/** The default output root. Overridable so a run can be kept side by side. */
export const DEFAULT_OUT_DIR = join(REPO_ROOT, 'eval-output');

/** Model tags contain `:` and `.`, neither of which belongs in a path. */
export function modelSlug(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function runPath(outDir: string, modelId: string, scenarioId: string): string {
  return join(outDir, 'runs', modelSlug(modelId), `${scenarioId}.json`);
}

export function hasRun(outDir: string, modelId: string, scenarioId: string): boolean {
  return existsSync(runPath(outDir, modelId, scenarioId));
}

export function writeRun(outDir: string, run: ScenarioRun): void {
  const path = runPath(outDir, run.modelId, run.scenarioId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
}

/**
 * Read one back.
 *
 * A corrupt file returns `null` rather than throwing: a half-written result
 * from an interrupted process should cause that one scenario to be re-run, not
 * stop the report from being produced at all.
 */
export function readRun(outDir: string, modelId: string, scenarioId: string): ScenarioRun | null {
  const path = runPath(outDir, modelId, scenarioId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ScenarioRun;
  } catch {
    return null;
  }
}

/** Every run recorded for a model, in scenario-id order. */
export function readModelRuns(outDir: string, modelId: string): ScenarioRun[] {
  const dir = join(outDir, 'runs', modelSlug(modelId));
  if (!existsSync(dir)) return [];

  const runs: ScenarioRun[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.json')) continue;
    try {
      runs.push(JSON.parse(readFileSync(join(dir, entry), 'utf8')) as ScenarioRun);
    } catch {
      // Skip and let the caller notice the missing scenario in the counts.
    }
  }
  return runs;
}

/** Which models have at least one recorded run. */
export function recordedModels(outDir: string): string[] {
  const dir = join(outDir, 'runs');
  if (!existsSync(dir)) return [];
  const models = new Set<string>();
  for (const slug of readdirSync(dir)) {
    const runs = readdirSync(join(dir, slug)).filter((f) => f.endsWith('.json'));
    const first = runs[0];
    if (!first) continue;
    try {
      const run = JSON.parse(readFileSync(join(dir, slug, first), 'utf8')) as ScenarioRun;
      models.add(run.modelId);
    } catch {
      // ignore
    }
  }
  return [...models].sort();
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, 'utf8');
}
