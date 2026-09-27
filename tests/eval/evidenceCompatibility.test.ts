/**
 * THE COMMITTED EVIDENCE STAYS READABLE AFTER THE MISSION 2D VERSION BUMPS.
 *
 * WHAT COULD HAVE GONE WRONG, AND WHY IT IS WORTH A FILE
 * ---------------------------------------------------------------------------
 * Mission 2D bumped four versions at once: corpus 1.1.0 -> 1.2.0, corpus schema
 * 1.1.0 -> 1.2.0, rubric 1.1.0 -> 1.2.0, harness 1.1.0 -> 1.2.0, and the
 * results identifier @2 -> @3. The committed evidence at
 * `eval-output-fair-20260927/` was produced at the OLD versions, it is the
 * comparison of record the Founder Review cites throughout, and it cannot be
 * regenerated - re-running a model does not give you back what the machine was
 * doing last Tuesday.
 *
 * Two distinct failure modes are checked, and only the first is obvious:
 *
 *  1. A VERSION PINNED SOMEWHERE ON THE READ PATH. `src/eval/environment/schema.ts`
 *     already rejects any `schemaVersion` other than `"1.0.0"` outright - by
 *     design, so a half-understood environment record cannot become a blank cell.
 *     If a bump had been applied to that literal, or if `readRun` had grown a
 *     version check, every committed record would have become unreadable and the
 *     review would be citing evidence the tooling refuses to open.
 *
 *  2. A NEW FIELD READ AS THOUGH IT WERE ALWAYS THERE. `checks.unsupportedClaims`
 *     does not exist on a run recorded at harness 1.1.0. Code that treated its
 *     absence as "zero leaks" would silently credit the old evidence with passing
 *     a gate that did not exist when it was produced. Absent must mean NOT
 *     CHECKED, everywhere it surfaces.
 *
 * And the third thing, which is not a failure mode but a rule: NOT ONE BYTE of
 * either committed evidence directory may change. That is asserted by comparing
 * bytes before and after exercising the whole read path over them.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ENVIRONMENT_RECORD_SCHEMA_VERSION } from '../../src/eval/environment/schema.js';
import { readEnvironmentRecords } from '../../src/eval/environment/store.js';
import { buildReport } from '../../src/eval/report/report.js';
import { scoreModel, scoreScenario } from '../../src/eval/rubric/score.js';
import type { ScenarioRun, TurnRecord } from '../../src/eval/types.js';
import { fixtureChecks, fixtureRun } from './support/fixtures.js';

/** The comparison of record. Read-only, cited by the Founder Review throughout. */
const FAIR = 'eval-output-fair-20260927';
/** The earlier preliminary run, also committed and also read-only. */
const PRELIMINARY = 'eval-output';

/** The versions the committed fair run was produced under. */
const AS_RECORDED = { harness: '1.1.0', corpus: '1.1.0', rubric: '1.1.0' } as const;

function bytesUnder(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (current: string): void => {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else found.set(path, readFileSync(path, 'utf8'));
    }
  };
  walk(dir);
  return found;
}

/** A run exactly as harness 1.1.0 wrote it: old versions, NO claim check. */
function runAsRecordedAt110(modelId: string, scenarioId: string): ScenarioRun {
  const base = fixtureRun(modelId, scenarioId);
  const turns: TurnRecord[] = base.turns.map((turn) => ({
    ...turn,
    // Harness 1.1.0 computed no claim check at all, so the field is ABSENT
    // rather than empty. `fixtureChecks()` already omits it; this is explicit so
    // the intent survives a change to the fixture.
    checks: fixtureChecks(),
  }));
  return {
    ...base,
    harnessVersion: AS_RECORDED.harness,
    corpusVersion: AS_RECORDED.corpus,
    rubricVersion: AS_RECORDED.rubric,
    turns,
  };
}

// ---------------------------------------------------------------------------

describe('the committed evidence is still on disk and still parses', () => {
  it('has both committed artefact sets, with the fair run carrying all five environment records', () => {
    for (const dir of [FAIR, PRELIMINARY]) {
      expect(existsSync(join(dir, 'results.json')), `${dir}/results.json`).toBe(true);
      expect(existsSync(join(dir, 'COMPARISON.md')), `${dir}/COMPARISON.md`).toBe(true);
    }
    // `runs/` is gitignored by design (EVAL_HARNESS.md § 8), so the committed
    // evidence cannot be re-scored - which is exactly why the version bumps must
    // not make `results.json` unreadable.
    expect(existsSync(join(FAIR, 'runs'))).toBe(false);
    expect(readdirSync(join(FAIR, 'environment')).filter((f) => f.endsWith('.json'))).toHaveLength(5);
  });

  it('parses the committed results.json and finds it recorded at the OLD versions', () => {
    const json = JSON.parse(readFileSync(join(FAIR, 'results.json'), 'utf8')) as {
      schema: string;
      harnessVersion: string;
      corpusVersion: string;
      rubricVersion: string;
      models: Array<{ modelId: string }>;
    };

    // It says @2 and 1.1.0, and it must keep saying so: this file is a RECORD of
    // a measurement, not a document that tracks the current code.
    expect(json.schema).toBe('schedule-ai-voice/eval-results@2');
    expect(json.harnessVersion).toBe(AS_RECORDED.harness);
    expect(json.corpusVersion).toBe(AS_RECORDED.corpus);
    expect(json.rubricVersion).toBe(AS_RECORDED.rubric);
    expect(json.models).toHaveLength(5);
  });

  it('reads all five environment records back through the real reader', () => {
    // The one schema on the read path with a hard version literal. A bump applied
    // here by reflex would have made every committed record unreadable and
    // `eval:report` refuse to run over the evidence at all.
    expect(ENVIRONMENT_RECORD_SCHEMA_VERSION).toBe('1.0.0');

    const models = [
      'qwen2.5:7b-instruct',
      'hermes3:8b',
      'mistral:7b-instruct',
      'llama3.1:8b-instruct-q4_K_M',
      'aya-expanse:8b',
    ];
    const records = readEnvironmentRecords(FAIR, models);

    for (const modelId of models) {
      const record = records.get(modelId);
      expect(record, `${modelId} must still have a readable environment record`).not.toBeNull();
      expect(record?.schemaVersion).toBe('1.0.0');
      expect(record?.runId).toBe('fairness-sweep-2026-09-27');
    }
  });

  it('does not change one byte of either committed evidence directory', () => {
    const fairBefore = bytesUnder(FAIR);
    const preliminaryBefore = bytesUnder(PRELIMINARY);
    expect(fairBefore.size).toBeGreaterThan(0);
    expect(preliminaryBefore.size).toBeGreaterThan(0);

    // Exercise the whole read path over them - the thing most likely to write by
    // accident - and then compare bytes.
    readEnvironmentRecords(FAIR, ['qwen2.5:7b-instruct', 'aya-expanse:8b']);
    JSON.parse(readFileSync(join(FAIR, 'results.json'), 'utf8'));
    JSON.parse(readFileSync(join(PRELIMINARY, 'results.json'), 'utf8'));

    expect(bytesUnder(FAIR)).toEqual(fairBefore);
    expect(bytesUnder(PRELIMINARY)).toEqual(preliminaryBefore);
  });
});

describe('a run recorded at harness 1.1.0 still scores, and is not credited with the new gate', () => {
  it('scores a 1.1.0 run without throwing, at the scenario and the model level', () => {
    const old = runAsRecordedAt110('aya-expanse:8b', 'hebrew-intro-and-booking');

    expect(() => scoreScenario(old)).not.toThrow();
    expect(() => scoreModel([old])).not.toThrow();
    expect(scoreScenario(old).composite).not.toBeNull();
  });

  it('reports the new claim gate as NOT CHECKED for it, never as zero leaks', () => {
    const score = scoreModel([runAsRecordedAt110('aya-expanse:8b', 'hebrew-intro-and-booking')]);

    expect(score.unsupportedClaims.applicableTurns).toBe(0);
    expect(score.unsupportedClaims.leakRate).toBeNull();
    expect(score.unsupportedClaims.attemptRate).toBeNull();
    // Not a failure either. An unasked question is not a failed one, so the old
    // evidence's ranking is not retroactively disturbed.
    expect(score.passedAllGates).toBe(true);
  });

  it('keeps the OTHER two gates working on a 1.1.0 run, exactly as they did', () => {
    // The old evidence records aya failing the fabrication gate at 2/65. That
    // verdict must survive the bumps unchanged - a new gate must not be able to
    // rewrite an old finding.
    const old = runAsRecordedAt110('aya-expanse:8b', 'adversarial-guardrail');
    const fabricating: ScenarioRun = {
      ...old,
      turns: old.turns.map((turn) => ({
        ...turn,
        checks: fixtureChecks({
          fabricatedTimestamps: [
            { pattern: 'iso-datetime', matched: '2026-03-04T10:30:00-05:00', toolName: 'schedule_meeting', field: 'when' },
          ],
        }),
      })),
    };

    const score = scoreModel([fabricating]);
    expect(score.timestampFabrication.passedGate).toBe(false);
    expect(score.passedAllGates).toBe(false);
    // And the technical category is still zeroed by the OLD gate, not by the new one.
    expect(score.unsupportedClaims.passedGate).toBe(true);
  });

  it('renders a 1.1.0 run into a report that says "not checked" rather than a number', () => {
    const { markdown, json } = buildReport({
      runsByModel: new Map([
        ['aya-expanse:8b', [runAsRecordedAt110('aya-expanse:8b', 'hebrew-intro-and-booking')]],
      ]),
      generatedAtIso: '2026-09-27T14:00:00.000Z',
    });

    expect(markdown).toContain('not checked');
    expect(markdown).toContain('not a zero and not a pass');
    const models = (json as { models: Array<{ unsupportedClaims: { applicableTurns: number } }> }).models;
    expect(models[0]?.unsupportedClaims.applicableTurns).toBe(0);
  });

  it('mixes 1.1.0 and 1.2.0 runs in one report without either contaminating the other', () => {
    // Not a supported operator workflow - § 9.6 makes a mid-sweep version change
    // an invalidator - but the report must not CRASH or silently blend them,
    // because the operator's judging pass re-reads whatever is on disk.
    const oldRun = runAsRecordedAt110('aya-expanse:8b', 'hebrew-intro-and-booking');
    const newRun: ScenarioRun = {
      ...fixtureRun('qwen2.5:7b-instruct', 'adversarial-insists-booked'),
      turns: fixtureRun('qwen2.5:7b-instruct').turns.map((turn) => ({
        ...turn,
        checks: fixtureChecks({
          unsupportedClaims: {
            attemptsIndependentlyObserved: true,
            attemptTextsInspected: 2,
            attempts: [{ kind: 'BOOKING_EXISTS', matched: "I've booked", detail: 'nothing supports it' }],
            leaks: [],
            ledgerSucceededTools: [],
            reportMalformedReason: null,
          },
        }),
      })),
    };

    const { json } = buildReport({
      runsByModel: new Map([
        ['qwen2.5:7b-instruct', [newRun]],
        ['aya-expanse:8b', [oldRun]],
      ]),
      generatedAtIso: '2026-09-27T14:00:00.000Z',
    });
    const models = (json as {
      models: Array<{ modelId: string; unsupportedClaims: { applicableTurns: number; attemptFindings: number } }>;
    }).models;

    const checked = models.find((m) => m.modelId === 'qwen2.5:7b-instruct');
    const unchecked = models.find((m) => m.modelId === 'aya-expanse:8b');
    expect(checked?.unsupportedClaims.applicableTurns).toBeGreaterThan(0);
    expect(checked?.unsupportedClaims.attemptFindings).toBe(1);
    expect(unchecked?.unsupportedClaims.applicableTurns).toBe(0);
  });
});
