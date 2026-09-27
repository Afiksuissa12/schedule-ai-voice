/**
 * THE OPERATOR'S RE-BENCHMARK WILL WORK - PROVEN WITHOUT RUNNING A MODEL.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------------------------------------------------------------
 * After this mission the operator re-benchmarks exactly two candidates,
 * `qwen2.5:7b-instruct` and `aya-expanse:8b`, on the FULL updated corpus, into a
 * FRESH output directory, under identical recorded conditions
 * (EVAL_HARNESS.md § 11). That run costs hours of GPU time on a memory-constrained
 * laptop, and every way it can fail before producing a single number is cheap to
 * check here and expensive to discover there:
 *
 *   - a candidate tag that is not in the candidate set, so `eval:run` refuses it;
 *   - a corpus that does not load, because the coverage contract gained a key
 *     nothing claims;
 *   - a run plan that is not enumerable, so "26 scenarios times two models" is an
 *     assumption rather than a count;
 *   - a fresh output directory that is not actually fresh, because some path is
 *     hardcoded to the default root and the committed evidence gets overwritten.
 *
 * NOT ONE ASSERTION HERE CALLS A MODEL, OPENS A SOCKET OR TOUCHES OLLAMA. The
 * plan is enumerated from committed data and the directory work happens in a
 * temporary directory outside the repository. `tests/eval/customOutputDirectory.test.ts`
 * is the existing pattern and this file follows it deliberately, including its
 * before-and-after byte snapshot of the committed evidence.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CORPUS_VERSION, loadCorpus, missingCoverage } from '../../src/eval/corpus/index.js';
import { CORPUS_SCHEMA_VERSION, REQUIRED_COVERAGE } from '../../src/eval/corpus/schema.js';
import { CANDIDATES } from '../../src/eval/models/candidates.js';
import { JUDGE_MODELS } from '../../src/eval/rubric/judge.js';
import { RUBRIC_VERSION } from '../../src/eval/rubric/rubric.js';
import { HARNESS_VERSION } from '../../src/eval/runner/runScenario.js';
import {
  DEFAULT_OUT_DIR,
  hasRun,
  modelSlug,
  readModelRuns,
  readRun,
  recordedModels,
  runPath,
  writeRun,
} from '../../src/eval/runner/store.js';
import { fixtureRun, makeTempOutDir } from './support/fixtures.js';

/** The two models the operator re-benchmarks after this mission. */
const RE_BENCHMARK: readonly string[] = ['qwen2.5:7b-instruct', 'aya-expanse:8b'];

/** The committed evidence, which must not be touched by anything here. */
const COMMITTED_EVIDENCE = 'eval-output-fair-20260927';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** Every file under a root, with its bytes and mtime. */
function snapshot(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (current: string): void => {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else found.set(path, `${statSync(path).mtimeMs}:${readFileSync(path, 'utf8').length}`);
    }
  };
  walk(dir);
  return found;
}

// ---------------------------------------------------------------------------

describe('both re-benchmark candidates are runnable', () => {
  it('has both tags in the candidate set, spelled exactly as the host has them', () => {
    // `eval:run` refuses a tag that is not on the host and resolves the default
    // model list from CANDIDATES. A tag missing here means the operator's
    // `--model <tag>` silently benchmarks nothing, or `eval:report` drops the row.
    const tags = CANDIDATES.map((c) => c.tag);
    for (const tag of RE_BENCHMARK) {
      expect(tags, `${tag} must be a candidate for the operator to re-benchmark it`).toContain(tag);
    }
  });

  it('keeps qwen2.5:7b-instruct FIRST, because it is the incumbent default', () => {
    // Not cosmetic: `generateReportArtefacts` orders every table by candidate
    // order, and the recommendation in the review is about this model.
    expect(CANDIDATES[0]?.tag).toBe('qwen2.5:7b-instruct');
  });

  it('has both judges present as candidates, so the judging pass needs no extra pull', () => {
    // EVAL_HARNESS.md § 9.4: both judges are themselves candidates, which is why
    // the judging pass does not need `eval:pull` and does not unload between
    // candidates. If a judge stopped being a candidate that reasoning breaks.
    const tags = CANDIDATES.map((c) => c.tag);
    for (const judge of JUDGE_MODELS) {
      expect(tags, `judge ${judge} must also be a candidate`).toContain(judge);
    }
  });

  it('gives the two models distinct output slugs, so neither can overwrite the other', () => {
    const slugs = RE_BENCHMARK.map((tag) => modelSlug(tag));
    expect(new Set(slugs).size).toBe(slugs.length);
    // `:` and `.` are not path characters; the slug is what `runs/`,
    // `transcripts/` and `environment/` all agree on.
    for (const slug of slugs) expect(slug).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(slugs).toEqual(['qwen2.5_7b-instruct', 'aya-expanse_8b']);
  });
});

describe('the full updated corpus loads with its coverage contract satisfied', () => {
  it('loads at all, which is the thing that throws if a scenario is malformed', () => {
    const corpus = loadCorpus();
    expect(corpus.corpusVersion).toBe(CORPUS_VERSION);
    expect(corpus.schemaVersion).toBe(CORPUS_SCHEMA_VERSION);
  });

  it('leaves NO required coverage key unclaimed', () => {
    // `loadCorpus` already throws on this; asserting it separately means the
    // failure message names the missing axis rather than being a load error.
    expect(missingCoverage(loadCorpus().scenarios)).toEqual([]);
  });

  it('claims the new adversarial-unsupported-claim axis in English, Hebrew AND mixed', () => {
    // The mission requires each of the two adversarial shapes in English and in
    // Hebrew, plus the code-switched mix. A key claimed only by English scenarios
    // would satisfy the coverage contract while measuring nothing about Hebrew.
    const claiming = loadCorpus().scenarios.filter((s) => s.coverage.includes('adversarial-unsupported-claim'));
    const languages = new Set(claiming.map((s) => s.language));

    expect(claiming.length).toBe(5);
    expect(languages).toEqual(new Set(['en', 'he', 'mixed']));
  });

  it('gives every adversarial-claim scenario a REAL refusal path, never a fixture', () => {
    // The corpus never fakes a tool failure. Each of these arranges a world where
    // the real dispatcher really refuses - an out-of-hours time, or a genuine
    // seeded busy block - and says so with `expectsToolFailure` on the turn that
    // sets the premise up.
    for (const scenario of loadCorpus().scenarios.filter((s) =>
      s.coverage.includes('adversarial-unsupported-claim'),
    )) {
      expect(
        scenario.turns.some((t) => t.expectsToolFailure === true),
        `${scenario.id} must contain a turn where the REAL dispatcher refuses, or its later turns are not ` +
          'provoking a claim against an empty ledger',
      ).toBe(true);
      expect(scenario.coverage, `${scenario.id} exercises a real refusal and should claim it`).toContain(
        'tool-result-failure',
      );
    }
  });

  it('prescribes no assistant wording anywhere, on the new scenarios as much as the old', () => {
    // The Founder directive: a benchmark scenario scripts the HUMAN side and the
    // checkable expectations, never the agent's words. There is deliberately no
    // `expectedAssistantText` field, and this asserts nothing smuggled one in
    // under another name.
    for (const scenario of loadCorpus().scenarios) {
      for (const turn of scenario.turns) {
        const keys = Object.keys(turn);
        expect(keys).not.toContain('expectedAssistantText');
        expect(keys).not.toContain('expectedReply');
        // `mustMentionAnyOf` is a memory probe, not a script: it names a FACT the
        // corpus planted, never a phrasing. Guarded by length - a required
        // substring long enough to be a sentence would be prescribed wording.
        for (const needle of turn.text?.mustMentionAnyOf ?? []) {
          expect(needle.length, `"${needle}" in ${scenario.id} is long enough to be prescribed wording`).toBeLessThan(
            24,
          );
        }
      }
    }
  });

  it('counts 26 scenarios and 81 turns, the numbers the docs quote', () => {
    // `npm run eval:corpus` is the authority and this is the assertion that keeps
    // the documented figures honest as the corpus grows.
    const corpus = loadCorpus();
    expect(corpus.scenarios.length).toBe(26);
    expect(corpus.scenarios.reduce((n, s) => n + s.turns.length, 0)).toBe(81);
  });

  it('has unique scenario ids, because ids are filenames', () => {
    const ids = loadCorpus().scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the run plan for two models times every scenario is enumerable', () => {
  it('enumerates 52 distinct (model, scenario) pairs', () => {
    const scenarios = loadCorpus().scenarios;
    const plan = RE_BENCHMARK.flatMap((modelId) =>
      scenarios.map((scenario) => ({ modelId, scenarioId: scenario.id })),
    );

    expect(plan).toHaveLength(RE_BENCHMARK.length * scenarios.length);
    expect(plan).toHaveLength(52);
    expect(new Set(plan.map((p) => `${p.modelId}::${p.scenarioId}`)).size).toBe(52);
  });

  it('gives every pair its own file path under a fresh root', () => {
    const fresh = makeTempOutDir('rebenchmark-plan');
    cleanups.push(fresh.cleanup);

    const paths = RE_BENCHMARK.flatMap((modelId) =>
      loadCorpus().scenarios.map((scenario) => runPath(fresh.path, modelId, scenario.id)),
    );

    // One file per pair, all distinct, all inside the fresh root and none inside
    // the default one. A collision here would mean one model's run silently
    // overwriting another's.
    expect(new Set(paths).size).toBe(52);
    for (const path of paths) {
      expect(path.startsWith(fresh.path)).toBe(true);
      expect(path.startsWith(DEFAULT_OUT_DIR)).toBe(false);
    }
  });

  it('reports every pair as NOT YET RECORDED in a fresh root, so nothing is skipped', () => {
    // THE RESUME TRAP. `runModel` skips any pair already on disk unless `--force`
    // is passed. In a genuinely fresh directory nothing is on disk, so the
    // generation pass runs all 52 - which is what makes step 8's `--force` a
    // belt-and-braces measure rather than the only thing standing between the
    // operator and silently reused records.
    const fresh = makeTempOutDir('rebenchmark-empty');
    cleanups.push(fresh.cleanup);

    for (const modelId of RE_BENCHMARK) {
      for (const scenario of loadCorpus().scenarios) {
        expect(hasRun(fresh.path, modelId, scenario.id)).toBe(false);
      }
    }
    expect(recordedModels(fresh.path)).toEqual([]);
  });

  it('round-trips a recorded run for both models through the fresh root', () => {
    const fresh = makeTempOutDir('rebenchmark-roundtrip');
    cleanups.push(fresh.cleanup);

    for (const modelId of RE_BENCHMARK) {
      for (const scenario of loadCorpus().scenarios) {
        writeRun(fresh.path, { ...fixtureRun(modelId, scenario.id) });
      }
    }

    expect(recordedModels(fresh.path).sort()).toEqual([...RE_BENCHMARK].sort());
    for (const modelId of RE_BENCHMARK) {
      expect(readModelRuns(fresh.path, modelId)).toHaveLength(26);
      expect(readRun(fresh.path, modelId, 'hebrew-adversarial-insists-booked')).not.toBeNull();
    }
  });
});

describe('the fresh directory really is fresh, and the committed evidence is untouched', () => {
  it('writes nothing into either committed evidence root', () => {
    const beforeDefault = snapshot(DEFAULT_OUT_DIR);
    const beforeFair = snapshot(COMMITTED_EVIDENCE);
    // If these are empty this test proves nothing, so the premise is asserted.
    expect(beforeDefault.size).toBeGreaterThan(0);
    expect(beforeFair.size).toBeGreaterThan(0);

    const fresh = makeTempOutDir('rebenchmark-isolation');
    cleanups.push(fresh.cleanup);
    for (const modelId of RE_BENCHMARK) {
      for (const scenario of loadCorpus().scenarios) {
        writeRun(fresh.path, fixtureRun(modelId, scenario.id));
      }
    }

    expect(snapshot(DEFAULT_OUT_DIR)).toEqual(beforeDefault);
    expect(snapshot(COMMITTED_EVIDENCE)).toEqual(beforeFair);
  });

  it('puts the temporary root OUTSIDE the repository, so no glob can reach the evidence', () => {
    const fresh = makeTempOutDir('rebenchmark-outside');
    cleanups.push(fresh.cleanup);

    expect(fresh.path.startsWith(DEFAULT_OUT_DIR)).toBe(false);
    expect(fresh.path).not.toContain(COMMITTED_EVIDENCE);
  });
});

describe('every recorded run carries the versions it was produced under', () => {
  it('stamps harness, corpus, rubric and judge-prompt versions on a written run', () => {
    // EVAL_HARNESS.md § 9.6: "the corpus or rubric version changed mid-sweep" is
    // an invalidator, and it can only be CHECKED because every run records both.
    const fresh = makeTempOutDir('rebenchmark-versions');
    cleanups.push(fresh.cleanup);

    writeRun(fresh.path, fixtureRun('qwen2.5:7b-instruct', 'adversarial-insists-booked'));
    const read = readRun(fresh.path, 'qwen2.5:7b-instruct', 'adversarial-insists-booked');

    for (const key of ['harnessVersion', 'corpusVersion', 'rubricVersion', 'judgePromptVersion'] as const) {
      expect(read?.[key], `a recorded run must carry ${key}`).toBeTruthy();
    }
  });

  it('has all four versions bumped past the committed fair run, so the two cannot be confused', () => {
    // The committed evidence was produced at corpus 1.1.0 / rubric 1.1.0 /
    // harness 1.1.0. Anything the operator produces now is a different
    // measurement, and the versions are what say so.
    expect(CORPUS_VERSION).toBe('1.2.0');
    expect(CORPUS_SCHEMA_VERSION).toBe('1.2.0');
    expect(RUBRIC_VERSION).toBe('1.2.0');
    expect(HARNESS_VERSION).toBe('1.2.0');
  });

  it('keeps the required-coverage list at 27 axes, all claimed', () => {
    expect(REQUIRED_COVERAGE).toHaveLength(27);
    expect(REQUIRED_COVERAGE).toContain('adversarial-unsupported-claim');
  });
});
