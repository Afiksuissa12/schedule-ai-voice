/**
 * The host environment record: its schema, its aggregation, and its store.
 *
 * FIXTURES ONLY. No model is called, no GPU tool is shelled out to, and the live
 * machine is never read - every number here comes from committed JSON under
 * `tests/eval/fixtures/environment/`. That is not a convenience: the harness must
 * never sample the host (it runs in a container and would measure the container),
 * so a test that observed the real machine would be testing something this code
 * is forbidden to do.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ENVIRONMENT_QUANTITIES,
  NOT_MEASURED,
  spread,
  summariseEnvironment,
} from '../../src/eval/environment/aggregate.js';
import {
  ENVIRONMENT_RECORD_SCHEMA_VERSION,
  parseEnvironmentRecord,
} from '../../src/eval/environment/schema.js';
import {
  ENVIRONMENT_DIR_NAME,
  environmentPath,
  readEnvironmentRecord,
  recordedEnvironmentSlugs,
} from '../../src/eval/environment/store.js';
import { modelSlug } from '../../src/eval/runner/store.js';
import { environmentFixture, installEnvironmentFixture, makeTempOutDir } from './support/fixtures.js';

const GIB = 2 ** 30;

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(environmentFixture(name), 'utf8'));
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function tempOut(label: string): string {
  const dir = makeTempOutDir(label);
  cleanups.push(dir.cleanup);
  return dir.path;
}

// ---------------------------------------------------------------------------

describe('the environment record schema', () => {
  it('accepts a well-formed record and preserves every field', () => {
    const record = parseEnvironmentRecord(readFixture('qwen2.5_7b-instruct.json'), 'fixture');

    expect(record.schemaVersion).toBe(ENVIRONMENT_RECORD_SCHEMA_VERSION);
    expect(record.modelId).toBe('qwen2.5:7b-instruct');
    expect(record.runId).toBe('fairness-sweep-2026-09-27');
    expect(record.numCtx).toBe(16_384);
    expect(record.samples).toHaveLength(5);
    expect(record.modelResidentBytes).toBe(5 * GIB);
    expect(record.offload?.gpuBytes).toBe(5 * GIB);
    expect(record.offload?.cpuBytes).toBe(0);
    expect(record.offload?.runtimeReportedText).toBe('100% GPU');
    expect(record.note).toBeNull();
  });

  it('carries a SERIES, not a single reading, and every sample is timestamped', () => {
    const record = parseEnvironmentRecord(readFixture('qwen2.5_7b-instruct.json'), 'fixture');

    expect(record.samples.length).toBeGreaterThan(1);
    for (const sample of record.samples) {
      expect(sample.atIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it('accepts a free-text note describing conditions no schema could anticipate', () => {
    const record = parseEnvironmentRecord(readFixture('hermes3_8b.json'), 'fixture');
    expect(record.note).toContain('Another GPU application');
  });

  it('accepts a record in which nothing at all could be sampled', () => {
    // "The sampler did not run" and "the sampler ran and saw nothing" are
    // different statements, and the second one is allowed to be written down.
    const record = parseEnvironmentRecord(readFixture('nothing-sampled.json'), 'fixture');
    expect(record.samples).toHaveLength(2);
    expect(record.samples[0]?.vramUsedBytes).toBeNull();
    expect(record.offload).toBeNull();
    expect(record.modelResidentBytes).toBeNull();
  });

  it('names its unit in every numeric field, so no reader has to guess one', () => {
    // A number whose unit is implicit is a fabrication risk: `vramUsed: 5491` is
    // bytes, MiB or GB depending on who wrote it. Asserted structurally so a
    // future field cannot be added without a unit.
    const sample = parseEnvironmentRecord(readFixture('qwen2.5_7b-instruct.json'), 'fixture').samples[0];
    for (const key of Object.keys(sample ?? {})) {
      if (key === 'atIso') continue;
      expect(key, `${key} must name its unit`).toMatch(/(Bytes|Percent)$/);
    }
  });
});

describe('strict rejection of a malformed record', () => {
  // One defect per fixture, so each case asserts on its own reason rather than on
  // "something was wrong". See tests/eval/fixtures/environment/README.md.
  const cases: ReadonlyArray<readonly [string, string | RegExp]> = [
    ['malformed/omitted-field.json', /cpuLoadPercent/],
    ['malformed/unknown-key.json', /vramFree|unrecognized/i],
    ['malformed/wrong-schema-version.json', /schemaVersion/],
    ['malformed/vram-unit-mixup.json', /MiB-for-bytes|exceeds vramTotalBytes/],
    ['malformed/no-samples.json', /samples/],
    ['malformed/ends-before-it-starts.json', /precedes startedAtIso/],
    ['malformed/percent-out-of-range.json', /gpuUtilizationPercent|less than or equal to 100/],
  ];

  for (const [fixture, expected] of cases) {
    it(`rejects ${fixture} loudly, naming the field`, () => {
      expect(() => parseEnvironmentRecord(readFixture(fixture), fixture)).toThrow(expected);
    });
  }

  it('quotes the source path in the failure, because five files are involved', () => {
    expect(() => parseEnvironmentRecord(readFixture('malformed/no-samples.json'), '/out/environment/x.json')).toThrow(
      /\/out\/environment\/x\.json/,
    );
  });

  it('rejects a record that is not an object at all', () => {
    expect(() => parseEnvironmentRecord('not a record', 'fixture')).toThrow(/Malformed environment record/);
    expect(() => parseEnvironmentRecord(null, 'fixture')).toThrow(/Malformed environment record/);
  });
});

describe('min / median / max', () => {
  it('reports a single sample as min, median and max alike', () => {
    expect(spread([42])).toEqual({ n: 1, min: 42, median: 42, max: 42 });
  });

  it('averages the two middle values on an EVEN count', () => {
    // Taking the upper middle instead would bias every even-length series
    // upward, and a run sampled on a fixed interval is even about half the time.
    expect(spread([10, 20, 30, 40]).median).toBe(25);
    expect(spread([1, 2]).median).toBe(1.5);
  });

  it('takes the middle value on an ODD count', () => {
    expect(spread([10, 20, 30]).median).toBe(20);
  });

  it('does not care what order the samples arrived in', () => {
    expect(spread([90, 10, 40, 20])).toEqual(spread([10, 20, 40, 90]));
  });

  it('DROPS nulls rather than counting them as zero', () => {
    // A sampler that could not read a quantity says null. Scoring that as 0
    // would manufacture an idle GPU out of a missing instrument.
    const result = spread([null, 50, null, 70]);
    expect(result).toEqual({ n: 2, min: 50, median: 60, max: 70 });
  });

  it('reports nothing at all - not zero - for a quantity with no readings', () => {
    expect(spread([])).toEqual({ n: 0, min: null, median: null, max: null });
    expect(spread([null, null])).toEqual({ n: 0, min: null, median: null, max: null });
  });
});

describe('summarising a record', () => {
  it('aggregates an odd-count series across all five quantities', () => {
    const summary = summariseEnvironment(
      'qwen2.5:7b-instruct',
      parseEnvironmentRecord(readFixture('qwen2.5_7b-instruct.json'), 'fixture'),
    );

    expect(summary.recordPresent).toBe(true);
    expect(summary.sampleCount).toBe(5);
    expect(summary.notMeasured).toEqual([]);

    expect(summary.quantities.freeSystemRamBytes).toEqual({
      n: 5,
      min: 14 * GIB,
      median: 16 * GIB,
      max: 18 * GIB,
    });
    expect(summary.quantities.vramUsedBytes.median).toBe(6 * GIB);
    expect(summary.quantities.vramTotalBytes).toEqual({
      n: 5,
      min: 8_585_740_288,
      median: 8_585_740_288,
      max: 8_585_740_288,
    });
    expect(summary.quantities.gpuUtilizationPercent).toEqual({ n: 5, min: 0, median: 60, max: 95 });
    expect(summary.quantities.cpuLoadPercent).toEqual({ n: 5, min: 8, median: 15, max: 40 });

    expect(summary.firstSampleIso).toBe('2026-09-27T09:00:00.000Z');
    expect(summary.lastSampleIso).toBe('2026-09-27T09:40:00.000Z');
  });

  it('aggregates an even-count series, and counts only the samples that carried a value', () => {
    const summary = summariseEnvironment(
      'hermes3:8b',
      parseEnvironmentRecord(readFixture('hermes3_8b.json'), 'fixture'),
    );

    expect(summary.sampleCount).toBe(4);
    // Even count -> mean of the two middle readings.
    expect(summary.quantities.gpuUtilizationPercent).toEqual({ n: 4, min: 10, median: 30, max: 90 });
    expect(summary.quantities.cpuLoadPercent.median).toBe(20);
    expect(summary.quantities.freeSystemRamBytes.median).toBe(11.5 * GIB);

    // One sample carried `vramUsedBytes: null`, so n is 3 of 4 and the median is
    // the middle of the three that existed - not of four with a zero in it.
    expect(summary.quantities.vramUsedBytes.n).toBe(3);
    expect(summary.quantities.vramUsedBytes.median).toBe(7 * GIB);
    expect(summary.notMeasured).toEqual([]);
  });

  it('derives the GPU share from the two byte counts it prints, not from resident size', () => {
    const summary = summariseEnvironment(
      'hermes3:8b',
      parseEnvironmentRecord(readFixture('hermes3_8b.json'), 'fixture'),
    );

    expect(summary.offload?.gpuBytes).toBe(4.5 * GIB);
    expect(summary.offload?.cpuBytes).toBe(1.5 * GIB);
    expect(summary.offload?.gpuPercent).toBeCloseTo(75, 6);
    expect(summary.offload?.runtimeReportedText).toBe('25%/75% CPU/GPU');
  });

  it('treats an ABSENT record as every quantity unmeasured, and says so by key', () => {
    const summary = summariseEnvironment('aya-expanse:8b', null);

    expect(summary.recordPresent).toBe(false);
    expect(summary.sampleCount).toBe(0);
    expect(summary.runId).toBeNull();
    expect(summary.numCtx).toBeNull();
    expect(summary.offload).toBeNull();
    expect(summary.modelResidentBytes).toBeNull();
    expect(summary.notMeasured).toEqual(ENVIRONMENT_QUANTITIES.map((q) => q.key));

    for (const quantity of ENVIRONMENT_QUANTITIES) {
      const value = summary.quantities[quantity.key];
      expect(value.n).toBe(0);
      // The point of the whole exercise: never 0, never a plausible default.
      expect(value.min).toBeNull();
      expect(value.median).toBeNull();
      expect(value.max).toBeNull();
    }
  });

  it('lists every quantity as unmeasured when the sampler ran but saw nothing', () => {
    const summary = summariseEnvironment(
      'aya-expanse:8b',
      parseEnvironmentRecord(readFixture('nothing-sampled.json'), 'fixture'),
    );

    // The record IS present - that is the difference from the case above, and it
    // is why `recordPresent` exists next to `notMeasured` rather than instead of it.
    expect(summary.recordPresent).toBe(true);
    expect(summary.sampleCount).toBe(2);
    expect(summary.notMeasured).toEqual(ENVIRONMENT_QUANTITIES.map((q) => q.key));
  });

  it('reports a single-sample run as min = median = max', () => {
    const summary = summariseEnvironment(
      'mistral:7b-instruct',
      parseEnvironmentRecord(readFixture('single-sample.json'), 'fixture'),
    );

    expect(summary.sampleCount).toBe(1);
    expect(summary.quantities.gpuUtilizationPercent).toEqual({ n: 1, min: 55, median: 55, max: 55 });
    expect(summary.quantities.freeSystemRamBytes).toEqual({
      n: 1,
      min: 16 * GIB,
      median: 16 * GIB,
      max: 16 * GIB,
    });
  });

  it('exposes the label the report prints for an unmeasured quantity', () => {
    expect(NOT_MEASURED).toBe('not measured');
  });
});

describe('reading records off disk', () => {
  it('puts the environment directory beside runs/ and transcripts/ under the output root', () => {
    const outDir = '/somewhere/else/eval-output-fresh';
    expect(environmentPath(outDir, 'qwen2.5:7b-instruct')).toBe(
      `${outDir}/${ENVIRONMENT_DIR_NAME}/qwen2.5_7b-instruct.json`,
    );
    // Same slugging as the other two directories, so the three line up by eye.
    expect(environmentPath(outDir, 'llama3.1:8b-instruct-q4_K_M')).toContain(
      modelSlug('llama3.1:8b-instruct-q4_K_M'),
    );
  });

  it('returns null for a MISSING file - an unsampled run is normal, not an error', () => {
    const outDir = tempOut('missing');
    expect(readEnvironmentRecord(outDir, 'qwen2.5:7b-instruct')).toBeNull();
    // Not even the directory exists yet, and that is still not an error.
    expect(recordedEnvironmentSlugs(outDir)).toEqual([]);
  });

  it('reads a record that is present', () => {
    const outDir = tempOut('present');
    installEnvironmentFixture(outDir, 'qwen2.5_7b-instruct.json', modelSlug('qwen2.5:7b-instruct'));

    const record = readEnvironmentRecord(outDir, 'qwen2.5:7b-instruct');
    expect(record?.samples).toHaveLength(5);
    expect(recordedEnvironmentSlugs(outDir)).toEqual(['qwen2.5_7b-instruct']);
  });

  it('THROWS on a malformed file rather than quietly reporting `not measured`', () => {
    // Deliberately the opposite of `readRun`, which swallows a corrupt file. A
    // dropped run shows up as a missing scenario in the completeness counts; a
    // dropped environment record would look identical to "nobody sampled it".
    const outDir = tempOut('malformed');
    installEnvironmentFixture(outDir, 'malformed/no-samples.json', modelSlug('qwen2.5:7b-instruct'));

    expect(() => readEnvironmentRecord(outDir, 'qwen2.5:7b-instruct')).toThrow(/Malformed environment record/);
  });

  it('THROWS on a file that is not JSON at all', () => {
    const outDir = tempOut('notjson');
    installEnvironmentFixture(outDir, 'qwen2.5_7b-instruct.json', modelSlug('qwen2.5:7b-instruct'));
    writeFileSync(environmentPath(outDir, 'qwen2.5:7b-instruct'), '{ truncated', 'utf8');

    expect(() => readEnvironmentRecord(outDir, 'qwen2.5:7b-instruct')).toThrow(/not valid JSON/);
  });

  it('refuses a record filed under the wrong model', () => {
    // Otherwise one model's machine conditions are silently credited to another,
    // which is the exact unfair comparison these files exist to expose.
    const outDir = tempOut('mismatch');
    installEnvironmentFixture(outDir, 'hermes3_8b.json', modelSlug('qwen2.5:7b-instruct'));

    expect(() => readEnvironmentRecord(outDir, 'qwen2.5:7b-instruct')).toThrow(
      /declares modelId "hermes3:8b" but was read for "qwen2.5:7b-instruct"/,
    );
  });
});
