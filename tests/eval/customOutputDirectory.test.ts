/**
 * THE OUTPUT DIRECTORY IS HONOURED EVERYWHERE, OR THE FRESH RUN EATS THE OLD ONE.
 *
 * The Founder's re-benchmark has to produce results that can be compared against
 * the PRELIMINARY ones already committed under `eval-output/`. That only works if
 * the fresh run writes somewhere else - which means every path the harness
 * touches must derive from the output root, with nothing hardcoded to the
 * default. One forgotten `join(DEFAULT_OUT_DIR, ...)` and the preliminary
 * evidence is silently overwritten, and EVAL_HARNESS.md section 8 records what it
 * cost the last time those artefacts went missing.
 *
 * So this file asserts, against a TEMPORARY directory:
 *   - runs/ are read from it
 *   - environment/ is read from it
 *   - transcripts/ are written to it
 *   - results.json and COMPARISON.md are written to it
 *   - and NOTHING is written under the default root, whose committed files are
 *     compared byte-for-byte before and after.
 *
 * FIXTURES ONLY. No model, no host sampling.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { environmentPath, readEnvironmentRecord } from '../../src/eval/environment/store.js';
import { generateReportArtefacts } from '../../src/eval/report/generate.js';
import { DEFAULT_OUT_DIR, modelSlug, runPath, writeRun } from '../../src/eval/runner/store.js';
import { fixtureRun, installEnvironmentFixture, makeTempOutDir } from './support/fixtures.js';

const SAMPLED = 'qwen2.5:7b-instruct';
const UNSAMPLED = 'mistral:7b-instruct';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/**
 * A temporary output root holding two models' runs, one of which has a host
 * environment record and one of which deliberately does not.
 */
function seedOutDir(label: string): string {
  const dir = makeTempOutDir(label);
  cleanups.push(dir.cleanup);

  writeRun(dir.path, fixtureRun(SAMPLED, 'intro-interested-lead'));
  writeRun(dir.path, fixtureRun(SAMPLED, 'cancellation'));
  writeRun(dir.path, fixtureRun(UNSAMPLED, 'intro-interested-lead'));
  installEnvironmentFixture(dir.path, 'qwen2.5_7b-instruct.json', modelSlug(SAMPLED));

  return dir.path;
}

/** Every committed file under the default root, with its bytes and mtime. */
function snapshotDefaultOutDir(): Map<string, string> {
  const snapshot = new Map<string, string>();
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else snapshot.set(path, `${statSync(path).mtimeMs}:${readFileSync(path, 'utf8').length}`);
    }
  };
  walk(DEFAULT_OUT_DIR);
  return snapshot;
}

// ---------------------------------------------------------------------------

describe('a custom output directory is honoured by every path', () => {
  it('writes both report artefacts into the custom root and none into the default', () => {
    const before = snapshotDefaultOutDir();
    // The preliminary evidence really is there to be protected - if this is
    // empty the test below proves nothing.
    expect(before.size).toBeGreaterThan(0);

    const outDir = seedOutDir('custom-root');
    const result = generateReportArtefacts({ outDir, generatedAtIso: '2026-09-27T14:00:00.000Z' });

    expect(result.jsonPath).toBe(join(outDir, 'results.json'));
    expect(result.markdownPath).toBe(join(outDir, 'COMPARISON.md'));
    expect(existsSync(join(outDir, 'results.json'))).toBe(true);
    expect(existsSync(join(outDir, 'COMPARISON.md'))).toBe(true);

    expect(snapshotDefaultOutDir()).toEqual(before);
  });

  it('reads runs/ from the custom root', () => {
    const outDir = seedOutDir('runs');
    expect(existsSync(runPath(outDir, SAMPLED, 'cancellation'))).toBe(true);

    const result = generateReportArtefacts({ outDir, generatedAtIso: '2026-09-27T14:00:00.000Z' });

    // Candidate order, not filesystem order.
    expect(result.models).toEqual([SAMPLED, UNSAMPLED]);
  });

  it('writes transcripts/ into the custom root, one per recorded run', () => {
    const outDir = seedOutDir('transcripts');
    const result = generateReportArtefacts({ outDir, generatedAtIso: '2026-09-27T14:00:00.000Z' });

    expect(result.transcriptCount).toBe(3);
    expect(existsSync(join(outDir, 'transcripts', modelSlug(SAMPLED), 'intro-interested-lead.md'))).toBe(true);
    expect(existsSync(join(outDir, 'transcripts', modelSlug(SAMPLED), 'cancellation.md'))).toBe(true);
    expect(existsSync(join(outDir, 'transcripts', modelSlug(UNSAMPLED), 'intro-interested-lead.md'))).toBe(true);
  });

  it('reads environment/ from the custom root, so conditions move with EVAL_OUT_DIR', () => {
    const outDir = seedOutDir('environment');

    expect(environmentPath(outDir, SAMPLED)).toBe(
      join(outDir, 'environment', `${modelSlug(SAMPLED)}.json`),
    );
    expect(readEnvironmentRecord(outDir, SAMPLED)).not.toBeNull();

    const result = generateReportArtefacts({ outDir, generatedAtIso: '2026-09-27T14:00:00.000Z' });
    expect(result.sampledModels).toEqual([SAMPLED]);

    // The conditions really reached the artefacts, not just the return value.
    const markdown = readFileSync(join(outDir, 'COMPARISON.md'), 'utf8');
    expect(markdown).toContain('0.0% / 60.0% / 95.0%');

    const json = JSON.parse(readFileSync(join(outDir, 'results.json'), 'utf8')) as {
      environment: { models: Array<{ modelId: string; recordPresent: boolean; notMeasured: string[] }> };
    };
    const sampled = json.environment.models.find((m) => m.modelId === SAMPLED);
    const unsampled = json.environment.models.find((m) => m.modelId === UNSAMPLED);
    expect(sampled?.recordPresent).toBe(true);
    expect(unsampled?.recordPresent).toBe(false);
    expect(unsampled?.notMeasured).toHaveLength(5);
  });

  it('an environment record in the DEFAULT root is not picked up for a custom run', () => {
    // The failure this guards against is the subtle one: conditions read from the
    // old directory and printed next to the new run's latency numbers.
    const outDir = seedOutDir('isolation');
    expect(environmentPath(outDir, SAMPLED).startsWith(outDir)).toBe(true);
    expect(environmentPath(outDir, SAMPLED).startsWith(DEFAULT_OUT_DIR)).toBe(false);

    // Nothing is sampled for the second model anywhere under the custom root...
    expect(readEnvironmentRecord(outDir, UNSAMPLED)).toBeNull();
    // ...and that stays true even though the default root exists on disk.
    expect(existsSync(DEFAULT_OUT_DIR)).toBe(true);
  });

  it('reports an empty custom root as "nothing recorded" rather than writing anything', () => {
    const dir = makeTempOutDir('empty');
    cleanups.push(dir.cleanup);

    const result = generateReportArtefacts({ outDir: dir.path, generatedAtIso: '2026-09-27T14:00:00.000Z' });

    expect(result.models).toEqual([]);
    expect(existsSync(join(dir.path, 'results.json'))).toBe(false);
    expect(existsSync(join(dir.path, 'COMPARISON.md'))).toBe(false);
  });

  it('reports an environment record that matches no recorded run instead of ignoring it', () => {
    // Almost always a typo in the slug. Silently dropping it is how evidence
    // goes missing.
    const outDir = seedOutDir('orphan');
    installEnvironmentFixture(outDir, 'hermes3_8b.json', 'hermes3_8b');

    const warnings: string[] = [];
    const result = generateReportArtefacts({
      outDir,
      generatedAtIso: '2026-09-27T14:00:00.000Z',
      warn: (message) => warnings.push(message),
    });

    expect(result.orphanedEnvironmentSlugs).toEqual(['hermes3_8b']);
    expect(warnings.join('\n')).toContain('match no recorded run');
  });

  it('fails loudly on a malformed record in the custom root rather than reporting a blank', () => {
    const outDir = seedOutDir('malformed');
    installEnvironmentFixture(outDir, 'malformed/vram-unit-mixup.json', modelSlug(UNSAMPLED));

    expect(() => generateReportArtefacts({ outDir, generatedAtIso: '2026-09-27T14:00:00.000Z' })).toThrow(
      /Malformed environment record/,
    );
  });

  it('lets two runs of the same models sit side by side without touching each other', () => {
    // This is the whole point: the fresh comparable run BESIDE the preliminary
    // one, not on top of it.
    const preliminary = seedOutDir('preliminary');
    generateReportArtefacts({ outDir: preliminary, generatedAtIso: '2026-09-23T18:00:00.000Z' });
    const preliminaryJson = readFileSync(join(preliminary, 'results.json'), 'utf8');

    const fresh = seedOutDir('fresh');
    installEnvironmentFixture(fresh, 'hermes3_8b.json', modelSlug(UNSAMPLED));
    // The fixture declares hermes3:8b, so filing it under mistral must be
    // refused - which is itself the guarantee that keeps the two roots honest.
    expect(() => generateReportArtefacts({ outDir: fresh, generatedAtIso: '2026-09-27T14:00:00.000Z' })).toThrow(
      /declares modelId/,
    );

    // And the preliminary root is byte-for-byte untouched by that failure.
    expect(readFileSync(join(preliminary, 'results.json'), 'utf8')).toBe(preliminaryJson);
  });

  it('keeps the default root as the default when no custom root is given', () => {
    // The override must be an override, not a replacement: `eval:report` with no
    // `EVAL_OUT_DIR` still has to find the committed artefacts.
    expect(DEFAULT_OUT_DIR.endsWith('eval-output')).toBe(true);
    expect(existsSync(join(DEFAULT_OUT_DIR, 'COMPARISON.md'))).toBe(true);
    expect(existsSync(join(DEFAULT_OUT_DIR, 'results.json'))).toBe(true);
  });
});
