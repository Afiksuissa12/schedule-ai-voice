/**
 * One candidate model against the whole corpus.
 *
 * ISOLATION. Each model gets its own throwaway SQLite file, and each scenario
 * gets its own seeded world inside it via a unique suffix. So no model can be
 * affected by rows another model's conversation wrote, and a scenario cannot
 * see the meetings of the one before it. One `prisma db push` per model rather
 * than per scenario, because the schema application costs seconds and the
 * schema is frozen anyway.
 *
 * WHY THE PROVIDER IS CONSTRUCTED WITH `streamByDefault: true`
 * ---------------------------------------------------------------------------
 * A later voice milestone lives or dies on perceived latency, and perceived
 * latency is time-to-first-token, not total time. The streaming path is the one
 * that can report it, so every benchmarked turn runs through it. Both paths
 * return the identical result shape, so this changes what is MEASURED and not
 * what is measured ABOUT.
 *
 * `keepAlive` is long so that cold-load time is paid once per model rather than
 * being smeared across the run as if it were generation cost, and `maxRetries`
 * is zero so that a failure is recorded as a failure instead of being quietly
 * retried into a slower success.
 */
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { LOCAL_BRAIN_SYSTEM_PROMPT_REF } from '../../agent/prompt/systemPrompt.js';
import { buildAgentRuntime, type AgentRuntime } from '../../app/composition.js';
import { loadBusinessProfile } from '../../context/businessProfile.js';
import { LocalLlmProvider } from '../../llm/localLlmProvider.js';
import type { BenchmarkScenario } from '../corpus/schema.js';
import { judgeConversation, JUDGE_MODELS } from '../rubric/judge.js';
import type { ScenarioRun } from '../types.js';
import { CORPUS_VERSION } from '../corpus/index.js';
import { JUDGE_PROMPT_VERSION } from '../rubric/judgePrompt.js';
import { RUBRIC_VERSION } from '../rubric/rubric.js';
import { MetricsCapturingProvider } from './metricsCapturingProvider.js';
import { HARNESS_VERSION, runScenario } from './runScenario.js';
import { hasRun, readRun, REPO_ROOT, writeRun } from './store.js';
import { toJudgeRequest } from './transcript.js';
import { applySchema, clockForScenario, providersForScenario } from './world.js';

export interface RunModelOptions {
  readonly modelId: string;
  readonly scenarios: readonly BenchmarkScenario[];
  readonly outDir: string;
  readonly baseUrl?: string;
  readonly numCtx?: number;
  readonly keepAlive?: string;
  readonly timeoutMs?: number;
  /** Re-run scenarios that already have a recorded result. */
  readonly force?: boolean;
  /** Skip the LLM judge. Programmatic results are still complete. */
  readonly skipJudge?: boolean;
  readonly judgeModels?: readonly string[];
  /**
   * Run against the CONTEXT task's real assembled context, which is the
   * production path. `false` runs the Baseline V1 path instead, which is only
   * useful as a deliberate comparison and is recorded as such.
   */
  readonly assembledContext?: boolean;
  readonly log?: (message: string) => void;
}

export interface RunModelSummary {
  readonly modelId: string;
  readonly ran: number;
  readonly skipped: number;
  readonly errored: number;
  readonly durationMs: number;
}

export async function runModel(options: RunModelOptions): Promise<RunModelSummary> {
  const log = options.log ?? (() => {});
  const started = Date.now();

  const assembled = options.assembledContext !== false;
  const numCtx = options.numCtx ?? (assembled ? 16_384 : 8192);
  // Loaded once per model, not once per scenario: it is a pure value read from
  // a committed JSON file and re-parsing it 19 times would prove nothing.
  const businessProfile = assembled ? loadBusinessProfile() : null;

  const databasePath = join(REPO_ROOT, '.tmp', `eval-${randomUUID().slice(0, 8)}.db`);
  applySchema(REPO_ROOT, databasePath);

  let ran = 0;
  let skipped = 0;
  let errored = 0;
  /** Scenario ids produced in phase 1, to be judged in phase 2. */
  const produced: string[] = [];

  try {
    for (const [index, scenario] of options.scenarios.entries()) {
      if (!options.force && hasRun(options.outDir, options.modelId, scenario.id)) {
        // Already recorded but never judged - a run interrupted between the two
        // phases. Judge it rather than leaving a permanent hole in the table.
        const existing = readRun(options.outDir, options.modelId, scenario.id);
        if (existing && existing.turns.length > 0 && Object.keys(existing.judges).length === 0) {
          produced.push(scenario.id);
        }
        skipped += 1;
        log(`  [${index + 1}/${options.scenarios.length}] ${scenario.id} - already recorded, skipping`);
        continue;
      }

      // A fresh provider per scenario, so `stats()` is scenario-scoped and a
      // malformed-call rate can be attributed to the conversation that caused it.
      const provider = new LocalLlmProvider({
        model: options.modelId,
        temperature: 0,
        numCtx,
        keepAlive: options.keepAlive ?? '30m',
        timeoutMs: options.timeoutMs ?? 120_000,
        maxRetries: 0,
        streamByDefault: true,
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      });
      const meter = new MetricsCapturingProvider(provider);

      const clock = clockForScenario(scenario);

      // THE COMPOSITION ROOT COMPOSES THIS, and the benchmark does not.
      //
      // An earlier version of this file hand-built the assembler and swapped
      // `AgentTurnService` on a runtime the composition root had already
      // returned, because `buildAgentRuntime` had no pass-through to the
      // context layer. That seam exists now (`contextAssembly`), and using it
      // is not tidiness: the hand-rolled version reused `base.dispatcher`,
      // which had been constructed with NO business profile, so
      // `get_contact_context` silently came back without its `business` block
      // for every benchmarked turn. The background had the profile and the tool
      // did not, which is the exact defect the composition seam was fixed to
      // close - and a benchmark that measures a differently-wired agent than
      // the one that ships measures the wrong thing.
      //
      // The rolling summary (`memory`) is left OFF, deliberately. It issues its own model
      // call to summarise, and including it would attribute summarisation
      // latency and tokens to conversational turns - confounding exactly the
      // numbers this benchmark exists to compare. The scenarios here are short
      // enough that nothing scrolls out of the transcript window, so the
      // summary would have little to recap. Stated in EVAL_HARNESS.md § 2.
      //
      // `modelNumCtx` is passed explicitly and must be: the provider is handed
      // in as an instance via `llm`, and a built provider's window is not
      // visible to the composition root (see `resolveContextBudget`). Passing
      // the same `numCtx` the provider was constructed with is what keeps the
      // budget and the model agreeing.
      const runtime: AgentRuntime = buildAgentRuntime({
        clock,
        datasourceUrl: `file:${databasePath}`,
        providers: providersForScenario(scenario),
        llm: meter,
        ...(assembled
          ? { contextAssembly: { businessProfile, budget: { modelNumCtx: numCtx } } }
          : {}),
      });

      let run: ScenarioRun;
      try {
        run = await runScenario({
          runtime,
          provider,
          meter,
          modelId: options.modelId,
          scenario,
          worldSuffix: `${scenario.id}-${index}`,
          contextMode: assembled ? 'assembled' : 'baseline-v1',
          ...(assembled ? { systemPromptRef: LOCAL_BRAIN_SYSTEM_PROMPT_REF } : {}),
        });
      } catch (error) {
        // The scenario could not even be set up. Recorded as an ERROR run so
        // the model still appears in the table with an honest zero rather than
        // silently having one fewer scenario than everybody else.
        run = errorRun(options.modelId, scenario, error, assembled ? 'assembled' : 'baseline-v1');
        log(`  [${index + 1}/${options.scenarios.length}] ${scenario.id} - SETUP FAILED: ${run.error}`);
      } finally {
        await runtime.shutdown();
      }

      if (run.status !== 'OK') errored += 1;

      // Written now, UNJUDGED. Judging is a separate phase - see below.
      writeRun(options.outDir, run);
      produced.push(run.scenarioId);
      ran += 1;

      log(
        `  [${index + 1}/${options.scenarios.length}] ${scenario.id} - ${run.status}, ` +
          `${run.turns.length} turns, ${(run.durationMs / 1000).toFixed(1)}s`,
      );
    }
  } finally {
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }
  }

  // ---- PHASE 2: judging, grouped by judge -----------------------------------
  //
  // WHY JUDGING IS A SEPARATE PHASE, AND WHY IT IS GROUPED BY JUDGE.
  //
  // Judging inline after each scenario made the host cycle candidate -> judge A
  // -> judge B -> candidate for every scenario. On an 8 GiB card only one 8B
  // model is resident at a time, so that is roughly three model loads per
  // scenario, ~57 per candidate. Two consequences, and the second is the
  // serious one:
  //
  //   1. It is slow - several seconds of load per swap, repeated.
  //   2. IT CORRUPTS THE LATENCY MEASUREMENT. The judges evict the candidate,
  //      so the FIRST TURN OF EVERY SCENARIO paid a cold load inside its
  //      time-to-first-token. Measured: ~6,700 ms on a cold first turn against
  //      ~66 ms warm. With 2-5 turn scenarios that is up to a third of all
  //      turns, and it would have made TTFT p50 a measure of model-loading
  //      rather than of model speed - on the one metric a voice milestone
  //      actually depends on.
  //
  // Running all scenarios first keeps the candidate resident throughout, then
  // each judge loads once and judges everything. Three loads per model instead
  // of fifty-seven, and a TTFT that means what it says.
  if (!options.skipJudge && produced.length > 0) {
    const judgeModels = options.judgeModels ?? JUDGE_MODELS;
    for (const judgeModel of judgeModels) {
      let failures = 0;
      const judgeStarted = Date.now();

      for (const scenarioId of produced) {
        const recorded = readRun(options.outDir, options.modelId, scenarioId);
        if (!recorded || recorded.turns.length === 0) continue;

        const verdict = await judgeConversation(judgeModel, toJudgeRequest(recorded), {
          ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
        });
        if (!verdict.ok) failures += 1;

        // Re-read and re-write per scenario rather than holding all nineteen in
        // memory and writing at the end: an interrupted judging pass then keeps
        // every verdict it had already earned.
        writeRun(options.outDir, { ...recorded, judges: { ...recorded.judges, [judgeModel]: verdict } });
      }

      log(
        `  judged ${produced.length} scenario(s) with ${judgeModel} in ` +
          `${((Date.now() - judgeStarted) / 1000).toFixed(0)}s` +
          (failures > 0 ? ` - ${failures} FAILED` : ''),
      );
    }
  }

  return { modelId: options.modelId, ran, skipped, errored, durationMs: Date.now() - started };
}

// ---------------------------------------------------------------------------

function errorRun(
  modelId: string,
  scenario: BenchmarkScenario,
  error: unknown,
  contextMode: 'baseline-v1' | 'assembled',
): ScenarioRun {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return {
    harnessVersion: HARNESS_VERSION,
    corpusVersion: CORPUS_VERSION,
    rubricVersion: RUBRIC_VERSION,
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    modelId,
    providerName: `local-ollama:${modelId}`,
    contextMode,
    systemPromptRef: contextMode === 'assembled' ? LOCAL_BRAIN_SYSTEM_PROMPT_REF : null,
    scenarioId: scenario.id,
    title: scenario.title,
    objective: scenario.objective,
    language: scenario.language,
    coverage: scenario.coverage,
    status: 'ERROR',
    error: message,
    contactId: '',
    conversationId: '',
    nowUtc: scenario.world.nowUtc,
    priorConversation: [],
    turns: [],
    judges: {},
    startedAtIso: new Date().toISOString(),
    durationMs: 0,
    providerStats: null,
  };
}

/** Re-read a recorded run, for a report pass that does not re-run anything. */
export function loadRecorded(outDir: string, modelId: string, scenarioId: string): ScenarioRun | null {
  return readRun(outDir, modelId, scenarioId);
}
