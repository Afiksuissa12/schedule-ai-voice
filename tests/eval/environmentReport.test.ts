/**
 * The report's two new sections: machine conditions, and the offload split.
 *
 * WHAT THIS FILE IS REALLY PROTECTING is rule 1 of `src/eval/report/report.ts` -
 * NOTHING IS INVENTED - extended to host conditions. A quantity nobody sampled
 * must print `not measured` in COMPARISON.md and be `null` plus an explicit
 * `notMeasured` key in results.json. Never 0. Never a plausible-looking default.
 * A fairness section that guessed would be worse than no fairness section, since
 * its whole purpose is to tell a reader when NOT to trust a comparison.
 *
 * FIXTURES ONLY. No model, no host sampling, and nothing written into
 * `eval-output/`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseEnvironmentRecord, type EnvironmentRecord } from '../../src/eval/environment/schema.js';
import { buildReport } from '../../src/eval/report/report.js';
import type { ScenarioRun } from '../../src/eval/types.js';
import { environmentFixture, fixtureRun } from './support/fixtures.js';

const GIB = 2 ** 30;

function fixtureRecord(name: string): EnvironmentRecord {
  return parseEnvironmentRecord(JSON.parse(readFileSync(environmentFixture(name), 'utf8')), name);
}

interface Built {
  readonly markdown: string;
  readonly json: JsonShape;
}

interface JsonShape {
  readonly schema: string;
  readonly environment: {
    readonly recordSchemaVersion: string;
    readonly directory: string;
    readonly notMeasuredConvention: string;
    readonly models: ReadonlyArray<{
      readonly modelId: string;
      readonly recordPresent: boolean;
      readonly notMeasured: readonly string[];
      readonly sampleCount: number;
      readonly numCtx: number | null;
      readonly runId: string | null;
      readonly note: string | null;
      readonly modelResidentBytes: number | null;
      readonly offload: {
        readonly gpuBytes: number | null;
        readonly cpuBytes: number | null;
        readonly gpuPercent: number | null;
      } | null;
      readonly quantities: Record<string, { n: number; min: number | null; median: number | null; max: number | null }>;
    }>;
  };
  readonly models: ReadonlyArray<{ readonly modelId: string }>;
}

function build(
  models: ReadonlyArray<readonly [string, readonly ScenarioRun[]]>,
  environment?: ReadonlyArray<readonly [string, EnvironmentRecord | null]>,
): Built {
  const report = buildReport({
    runsByModel: new Map(models),
    generatedAtIso: '2026-09-27T14:00:00.000Z',
    ...(environment ? { environmentByModel: new Map(environment) } : {}),
  });
  return { markdown: report.markdown, json: report.json as JsonShape };
}

/** The row of a markdown table whose first cell names this model. */
function row(markdown: string, section: string, modelId: string): string {
  const start = markdown.indexOf(`## ${section}`);
  expect(start, `section "${section}" must exist`).toBeGreaterThan(-1);
  const nextSection = markdown.indexOf('\n## ', start + 1);
  const body = markdown.slice(start, nextSection === -1 ? undefined : nextSection);
  const line = body.split('\n').find((l) => l.startsWith(`| \`${modelId}\` |`));
  expect(line, `${modelId} must have a row in "${section}"`).toBeDefined();
  return line ?? '';
}

// ---------------------------------------------------------------------------

describe('machine conditions in COMPARISON.md', () => {
  it('renders min / median / max for every quantity, per model', () => {
    const { markdown } = build(
      [['qwen2.5:7b-instruct', [fixtureRun('qwen2.5:7b-instruct')]]],
      [['qwen2.5:7b-instruct', fixtureRecord('qwen2.5_7b-instruct.json')]],
    );

    const cells = row(markdown, '7. Machine conditions', 'qwen2.5:7b-instruct');

    // Free RAM 14 / 16 / 18 GiB, VRAM used 5 / 6 / 7 GiB, GPU 0 / 60 / 95 %,
    // CPU 8 / 15 / 40 %. Asserted as rendered, because the rendering is the
    // artefact a human reads.
    expect(cells).toContain('14.00 / 16.00 / 18.00');
    expect(cells).toContain('5.00 / 6.00 / 7.00');
    expect(cells).toContain('0.0% / 60.0% / 95.0%');
    expect(cells).toContain('8.0% / 15.0% / 40.0%');
    expect(cells).not.toContain('not measured');
  });

  it('states its units in the table headers', () => {
    const { markdown } = build(
      [['qwen2.5:7b-instruct', [fixtureRun('qwen2.5:7b-instruct')]]],
      [['qwen2.5:7b-instruct', fixtureRecord('qwen2.5_7b-instruct.json')]],
    );

    expect(markdown).toContain('Free RAM (GiB)');
    expect(markdown).toContain('VRAM used (GiB)');
    expect(markdown).toContain('VRAM total (GiB)');
    expect(markdown).toContain('GPU util (%)');
    expect(markdown).toContain('CPU load (%)');
  });

  it('labels the numbers as measured on the host by an EXTERNAL sampler', () => {
    // Judged, harness-measured and host-measured are three different provenances
    // and this file's rule 2 forbids mixing any of them without a label.
    const { markdown } = build(
      [['qwen2.5:7b-instruct', [fixtureRun('qwen2.5:7b-instruct')]]],
      [['qwen2.5:7b-instruct', fixtureRecord('qwen2.5_7b-instruct.json')]],
    );

    expect(markdown).toContain('## 7. Machine conditions during each run (measured on the host)');
    expect(markdown).toMatch(/external host sampler/i);
  });

  it('prints the free-text note, so "another GPU app was open" survives into the report', () => {
    const { markdown } = build(
      [['hermes3:8b', [fixtureRun('hermes3:8b')]]],
      [['hermes3:8b', fixtureRecord('hermes3_8b.json')]],
    );

    expect(markdown).toContain('Another GPU application');
    expect(markdown).toContain('NOT comparable with the others on latency');
  });

  it('warns when the candidates did not all run at the same context length', () => {
    const qwen = fixtureRecord('qwen2.5_7b-instruct.json');
    const { markdown } = build(
      [
        ['qwen2.5:7b-instruct', [fixtureRun('qwen2.5:7b-instruct')]],
        ['hermes3:8b', [fixtureRun('hermes3:8b')]],
      ],
      [
        ['qwen2.5:7b-instruct', qwen],
        ['hermes3:8b', { ...fixtureRecord('hermes3_8b.json'), numCtx: 8192 }],
      ],
    );

    expect(markdown).toContain('did NOT all run at the same context length');
    expect(markdown).toContain('8192, 16384');
    expect(markdown).toContain('invalid as a like-for-like ranking');
  });

  it('warns when the records come from different runs rather than one sitting', () => {
    const { markdown } = build(
      [
        ['qwen2.5:7b-instruct', [fixtureRun('qwen2.5:7b-instruct')]],
        ['hermes3:8b', [fixtureRun('hermes3:8b')]],
      ],
      [
        ['qwen2.5:7b-instruct', fixtureRecord('qwen2.5_7b-instruct.json')],
        ['hermes3:8b', { ...fixtureRecord('hermes3_8b.json'), runId: 'some-other-sitting' }],
      ],
    );

    expect(markdown).toContain('different runs');
    expect(markdown).toContain('some-other-sitting');
  });

  it('points the reader from the latency table at the conditions that explain it', () => {
    const { markdown } = build([['qwen2.5:7b-instruct', [fixtureRun('qwen2.5:7b-instruct')]]]);
    expect(markdown).toContain('**Do not compare these rows without reading section 7 and section 8 first.**');
  });
});

describe('the absent-record path renders `not measured`', () => {
  it('prints `not measured` in COMPARISON.md - never 0, never a default', () => {
    const { markdown } = build(
      [['aya-expanse:8b', [fixtureRun('aya-expanse:8b')]]],
      [['aya-expanse:8b', null]],
    );

    const conditions = row(markdown, '7. Machine conditions', 'aya-expanse:8b');
    // Every quantity cell, the sample count and num_ctx all say so.
    expect(conditions.match(/not measured/g)?.length).toBe(7);
    expect(conditions).not.toMatch(/\b0\.00\b/);
    expect(conditions).not.toMatch(/\b0\.0%/);

    const offload = row(markdown, '8. Offload split', 'aya-expanse:8b');
    expect(offload.match(/not measured/g)?.length).toBe(6);

    expect(markdown).toContain('1 of 1 model(s) have no host environment record at all');
    expect(markdown).toContain('This is a gap in the evidence, not a result.');
  });

  it('renders identically when the caller omits environment data entirely', () => {
    // Every existing caller. An absent map and an explicit null must not differ.
    const withNull = build([['aya-expanse:8b', [fixtureRun('aya-expanse:8b')]]], [['aya-expanse:8b', null]]);
    const withoutKey = build([['aya-expanse:8b', [fixtureRun('aya-expanse:8b')]]]);

    expect(withoutKey.markdown).toBe(withNull.markdown);
    expect(JSON.stringify(withoutKey.json.environment)).toBe(JSON.stringify(withNull.json.environment));
  });

  it('records the absence in results.json as null PLUS an explicit notMeasured list', () => {
    const { json } = build(
      [['aya-expanse:8b', [fixtureRun('aya-expanse:8b')]]],
      [['aya-expanse:8b', null]],
    );

    const entry = json.environment.models.find((m) => m.modelId === 'aya-expanse:8b');
    expect(entry?.recordPresent).toBe(false);
    expect(entry?.sampleCount).toBe(0);
    expect(entry?.offload).toBeNull();
    expect(entry?.modelResidentBytes).toBeNull();
    expect(entry?.notMeasured).toEqual([
      'freeSystemRamBytes',
      'vramUsedBytes',
      'vramTotalBytes',
      'gpuUtilizationPercent',
      'cpuLoadPercent',
    ]);

    // `null`, not 0 - the same convention the rest of results.json already uses.
    for (const key of entry?.notMeasured ?? []) {
      const quantity = entry?.quantities[key];
      expect(quantity?.n).toBe(0);
      expect(quantity?.min).toBeNull();
      expect(quantity?.median).toBeNull();
      expect(quantity?.max).toBeNull();
    }
  });

  it('distinguishes "the sampler never ran" from "the sampler ran and saw nothing"', () => {
    const absent = build([['aya-expanse:8b', [fixtureRun('aya-expanse:8b')]]], [['aya-expanse:8b', null]]);
    const blank = build(
      [['aya-expanse:8b', [fixtureRun('aya-expanse:8b')]]],
      [['aya-expanse:8b', fixtureRecord('nothing-sampled.json')]],
    );

    const absentEntry = absent.json.environment.models[0];
    const blankEntry = blank.json.environment.models[0];

    // Both report `not measured` for every quantity...
    expect(absentEntry?.notMeasured).toEqual(blankEntry?.notMeasured);
    // ...but only one of them has a record, and only one carries the note that
    // explains why. Collapsing the two would lose the operator's explanation.
    expect(absentEntry?.recordPresent).toBe(false);
    expect(blankEntry?.recordPresent).toBe(true);
    expect(blankEntry?.sampleCount).toBe(2);
    expect(blank.markdown).toContain('nvidia-smi was not on PATH');
  });

  it('reports a partially-sampled run per quantity, not all-or-nothing', () => {
    // A sampler that read RAM and CPU but not the GPU must have its RAM and CPU
    // numbers used, and only the GPU cells say `not measured`.
    const record = fixtureRecord('qwen2.5_7b-instruct.json');
    const partial: EnvironmentRecord = {
      ...record,
      samples: record.samples.map((sample) => ({
        ...sample,
        vramUsedBytes: null,
        vramTotalBytes: null,
        gpuUtilizationPercent: null,
      })),
    };

    const { markdown, json } = build(
      [['qwen2.5:7b-instruct', [fixtureRun('qwen2.5:7b-instruct')]]],
      [['qwen2.5:7b-instruct', partial]],
    );

    const entry = json.environment.models[0];
    expect(entry?.notMeasured).toEqual(['vramUsedBytes', 'vramTotalBytes', 'gpuUtilizationPercent']);
    expect(entry?.quantities['freeSystemRamBytes']?.median).toBe(16 * GIB);
    expect(entry?.quantities['cpuLoadPercent']?.median).toBe(15);

    const cells = row(markdown, '7. Machine conditions', 'qwen2.5:7b-instruct');
    expect(cells).toContain('14.00 / 16.00 / 18.00');
    expect(cells).toContain('8.0% / 15.0% / 40.0%');
    expect(cells.match(/not measured/g)?.length).toBe(3);
  });
});

describe('the offload-split section', () => {
  it('is its own top-level section, not a column in a wide table', () => {
    // This is the number that explains an unfair comparison. A reader scanning
    // for it must not have to find it inside a nine-column table.
    const { markdown } = build(
      [['hermes3:8b', [fixtureRun('hermes3:8b')]]],
      [['hermes3:8b', fixtureRecord('hermes3_8b.json')]],
    );

    expect(markdown).toContain('## 8. Offload split - how much of each model was on the GPU');
  });

  it('lists GPU versus system RAM per model, with the derived share', () => {
    const { markdown } = build(
      [['hermes3:8b', [fixtureRun('hermes3:8b')]]],
      [['hermes3:8b', fixtureRecord('hermes3_8b.json')]],
    );

    const cells = row(markdown, '8. Offload split', 'hermes3:8b');
    expect(cells).toContain('6.00'); // resident
    expect(cells).toContain('4.50'); // on GPU
    expect(cells).toContain('1.50'); // in system RAM
    expect(cells).toContain('75.0%'); // derived share
    expect(cells).toContain('25%/75% CPU/GPU'); // the runtime's own words
    expect(cells).toContain('ollama 0.34.3 /api/ps');
  });

  it('calls out a model that did not fit entirely on the GPU', () => {
    const { markdown } = build(
      [
        ['qwen2.5:7b-instruct', [fixtureRun('qwen2.5:7b-instruct')]],
        ['hermes3:8b', [fixtureRun('hermes3:8b')]],
      ],
      [
        ['qwen2.5:7b-instruct', fixtureRecord('qwen2.5_7b-instruct.json')],
        ['hermes3:8b', fixtureRecord('hermes3_8b.json')],
      ],
    );

    expect(markdown).toContain('1 model(s) did not fit entirely on the GPU');
    expect(markdown).toContain('`hermes3:8b` (1.50 in system RAM)');
    // And the one that DID fit is not accused of spilling.
    expect(markdown).not.toContain('`qwen2.5:7b-instruct` (0.00 in system RAM)');
  });

  it('does not accuse an UNMEASURED model of fitting - or of spilling', () => {
    // "We did not measure it" and "we measured it and it fitted" are different
    // statements, and only the second is a clean bill of health.
    const { markdown } = build(
      [['aya-expanse:8b', [fixtureRun('aya-expanse:8b')]]],
      [['aya-expanse:8b', null]],
    );

    expect(markdown).not.toContain('did not fit entirely on the GPU');
    expect(row(markdown, '8. Offload split', 'aya-expanse:8b')).toContain('not measured');
  });

  it('reports a fully-resident model as 100% GPU with zero in system RAM', () => {
    // Zero here is a MEASURED zero and is allowed to print as one. That is the
    // distinction the whole `not measured` convention exists to preserve.
    const { markdown, json } = build(
      [['qwen2.5:7b-instruct', [fixtureRun('qwen2.5:7b-instruct')]]],
      [['qwen2.5:7b-instruct', fixtureRecord('qwen2.5_7b-instruct.json')]],
    );

    expect(json.environment.models[0]?.offload?.cpuBytes).toBe(0);
    expect(json.environment.models[0]?.offload?.gpuPercent).toBe(100);
    const cells = row(markdown, '8. Offload split', 'qwen2.5:7b-instruct');
    expect(cells).toContain('100.0%');
    expect(cells).toContain('100% GPU');
  });
});

describe('results.json stays backward-readable', () => {
  it('bumps the schema identifier because the shape grew', () => {
    const { json } = build([['qwen2.5:7b-instruct', [fixtureRun('qwen2.5:7b-instruct')]]]);
    // MOVED @2 -> @3 BY MISSION 2D, for the same reason @1 became @2: the shape
    // GREW. results@3 adds `unsupportedClaimAttemptsMeasure` at the top level, a
    // third entry in `gates`, `models[].unsupportedClaims` and three
    // `perScenario[]` keys. The superset property is what actually matters and it
    // is asserted by the next test rather than by this literal.
    expect(json.schema).toBe('schedule-ai-voice/eval-results@3');
  });

  it('keeps every key a results@1 reader depends on, unmoved and unrenamed', () => {
    const { json } = build([['qwen2.5:7b-instruct', [fixtureRun('qwen2.5:7b-instruct')]]]);
    const asRecord = json as unknown as Record<string, unknown>;

    // The exact top-level key list of the committed results@1 artefact.
    for (const key of [
      'schema',
      'generatedAtIso',
      'harnessVersion',
      'corpusVersion',
      'corpusSchemaVersion',
      'rubricVersion',
      'judgePromptVersion',
      'judgeModels',
      'gate',
      'rubric',
      'candidates',
      'rejectedCandidates',
      'coverage',
      'scenarios',
      'ranking',
      'models',
      'perScenario',
    ]) {
      expect(asRecord, `results@3 must still carry "${key}"`).toHaveProperty(key);
    }

    // results@2 adds exactly one thing beyond what @1 and the wrong-day work
    // already carried.
    expect(asRecord).toHaveProperty('environment');

    // results@3 adds the claim measure's definition, and it is at the TOP LEVEL
    // rather than inside `gates` on purpose: it gates nothing, and an existing
    // reader that treats every entry of `gates` as pass/fail would otherwise
    // report a model with a non-zero attempts count as having failed something.
    expect(asRecord).toHaveProperty('unsupportedClaimAttemptsMeasure');
  });

  it('documents the environment directory and the not-measured convention in the file itself', () => {
    const { json } = build([['qwen2.5:7b-instruct', [fixtureRun('qwen2.5:7b-instruct')]]]);

    expect(json.environment.directory).toBe('environment');
    expect(json.environment.recordSchemaVersion).toBe('1.0.0');
    expect(json.environment.notMeasuredConvention).toContain('not measured');
    expect(json.environment.notMeasuredConvention).toContain('never 0');
  });

  it('orders the environment rows to match the ranking, so a reader can read across', () => {
    const { json } = build(
      [
        ['mistral:7b-instruct', [fixtureRun('mistral:7b-instruct')]],
        ['qwen2.5:7b-instruct', [fixtureRun('qwen2.5:7b-instruct')]],
      ],
      [
        ['mistral:7b-instruct', fixtureRecord('single-sample.json')],
        ['qwen2.5:7b-instruct', fixtureRecord('qwen2.5_7b-instruct.json')],
      ],
    );

    expect(json.environment.models.map((m) => m.modelId)).toEqual(json.models.map((m) => m.modelId));
  });

  it('does not drop a model whose whole run errored but whose conditions were sampled', () => {
    // That model is exactly the one whose machine conditions might explain why it
    // produced nothing, so it is appended rather than omitted.
    const { json } = build(
      [
        ['qwen2.5:7b-instruct', [fixtureRun('qwen2.5:7b-instruct')]],
        ['hermes3:8b', []],
      ],
      [
        ['qwen2.5:7b-instruct', fixtureRecord('qwen2.5_7b-instruct.json')],
        ['hermes3:8b', fixtureRecord('hermes3_8b.json')],
      ],
    );

    expect(json.models.map((m) => m.modelId)).toEqual(['qwen2.5:7b-instruct']);
    expect(json.environment.models.map((m) => m.modelId)).toContain('hermes3:8b');
  });
});
