/**
 * Turning recorded runs into the two artefacts the Founder Review consumes:
 * a machine-readable `results.json` and a human-readable `COMPARISON.md`.
 *
 * TWO RULES GOVERN THIS FILE.
 *
 * 1. NOTHING IS INVENTED. Every number printed comes from a recorded run. A
 *    metric with no observations prints `n/a`, never `0`, and never a plausible
 *    guess. Where a model was not run, the row says so.
 *
 * 2. JUDGED AND MEASURED ARE NEVER MIXED WITHOUT A LABEL. Every table that
 *    contains a judged number says it contains a judged number, and the
 *    recommendation section restates the judge's limitations rather than
 *    assuming the reader remembers them.
 *
 * The host environment sections added in results@2 are MEASURED, but they are
 * measured by an EXTERNAL host sampler rather than by this harness, and they are
 * labelled as such - a third provenance that must not be blurred into either of
 * the other two. Where no sampler wrote a record, those sections print
 * `not measured`: rule 1 applies to them exactly as it applies to everything
 * else, so there is no zero and no plausible-looking default.
 */
import { coverageMap, loadCorpus } from '../corpus/index.js';
import { REQUIRED_COVERAGE } from '../corpus/schema.js';
import {
  ENVIRONMENT_QUANTITIES,
  NOT_MEASURED,
  summariseEnvironment,
  type EnvironmentSummary,
  type Spread,
} from '../environment/aggregate.js';
import { ENVIRONMENT_DIR_NAME } from '../environment/store.js';
import { ENVIRONMENT_RECORD_SCHEMA_VERSION, type EnvironmentRecord } from '../environment/schema.js';
import { CANDIDATES, REJECTED } from '../models/candidates.js';
import { JUDGE_MODELS } from '../rubric/judge.js';
import { JUDGE_PROMPT_VERSION } from '../rubric/judgePrompt.js';
import {
  GATES,
  RUBRIC_CATEGORIES,
  RUBRIC_VERSION,
  TIMESTAMP_FABRICATION_GATE,
  UNSUPPORTED_CLAIM_ATTEMPTS_MEASURE,
  UNSUPPORTED_CLAIM_GATE,
  WRONG_DAY_RESOLUTION_GATE,
} from '../rubric/rubric.js';
import { scoreModel, scoreScenario, type ModelScore } from '../rubric/score.js';
import { HARNESS_VERSION } from '../runner/runScenario.js';
import type { ScenarioRun } from '../types.js';

export interface ReportInput {
  /** Recorded runs, keyed by model id, in candidate order. */
  readonly runsByModel: ReadonlyMap<string, readonly ScenarioRun[]>;
  readonly generatedAtIso: string;
  /**
   * Host conditions during each model's run, keyed by model id, as written by an
   * EXTERNAL host sampler and validated by `src/eval/environment/schema.ts`.
   *
   * OPTIONAL, and `null` per model is a first-class value. Omitting it entirely
   * is what a caller that does not care about conditions does - every existing
   * caller, and every test written before results@2 - and it renders exactly the
   * same as a run nobody sampled: `not measured` everywhere. A missing record is
   * never an error, only an absence the report states out loud.
   */
  readonly environmentByModel?: ReadonlyMap<string, EnvironmentRecord | null>;
}

export interface Report {
  readonly json: unknown;
  readonly markdown: string;
}

export function buildReport(input: ReportInput): Report {
  const corpus = loadCorpus();
  const scores: ModelScore[] = [];

  for (const [, runs] of input.runsByModel) {
    if (runs.length > 0) scores.push(scoreModel(runs));
  }

  // The ranking rule, applied here and stated in the markdown: a model whose run
  // tripped ANY gate is ranked BELOW every model whose run tripped none,
  // regardless of composite. A charming model that invents timestamps is not a
  // better product than a duller one that does not; neither is one whose
  // conversations ended in a booking on the wrong day; and neither is one whose
  // conversations ended with the contact told a meeting existed when none did.
  const ranked = [...scores].sort((a, b) => {
    if (a.passedAllGates !== b.passedAllGates) return a.passedAllGates ? -1 : 1;
    return (b.composite ?? -1) - (a.composite ?? -1);
  });

  // Host conditions, in the SAME order as every other table so a reader can
  // read across. Models that produced no scorable run are appended rather than
  // dropped: a model whose whole run errored is exactly the one whose machine
  // conditions might explain why.
  const environmentSummaries = environmentOrder(ranked, input).map((modelId) =>
    summariseEnvironment(modelId, input.environmentByModel?.get(modelId) ?? null),
  );

  const json = {
    // BUMPED FROM @2, on the same rule that produced @2 from @1: results@3 is a
    // strict SUPERSET. Every key @1 and @2 carried is still here, unmoved and
    // unrenamed. What @3 adds is `unsupportedClaimAttemptsMeasure` at the top
    // level, a third entry in `gates`, and `models[].unsupportedClaims`. A reader
    // written against @1 or @2 keeps working; the identifier moves because the
    // shape grew, not because it was restructured.
    schema: 'schedule-ai-voice/eval-results@3',
    generatedAtIso: input.generatedAtIso,
    harnessVersion: HARNESS_VERSION,
    corpusVersion: corpus.corpusVersion,
    corpusSchemaVersion: corpus.schemaVersion,
    rubricVersion: RUBRIC_VERSION,
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    judgeModels: JUDGE_MODELS,
    /** Kept for readers written against results@1; `gates` is the full list. */
    gate: TIMESTAMP_FABRICATION_GATE,
    gates: GATES,
    /**
     * ADDED IN results@3. The definition of the unweighted attempts diagnostic,
     * as data, so a reader gets the rule next to the number rather than having to
     * trust that prose somewhere else still matches the code.
     *
     * It is NOT in `gates`, deliberately: it gates nothing, and putting it there
     * would tell every existing reader of `gates` that a model with a non-zero
     * attempts count had failed something. It has not.
     */
    unsupportedClaimAttemptsMeasure: UNSUPPORTED_CLAIM_ATTEMPTS_MEASURE,
    rubric: RUBRIC_CATEGORIES.map((category) => ({
      key: category.key,
      label: category.label,
      weight: category.weight,
      rationale: category.rationale,
      dimensions: category.dimensions.map((d) => ({
        key: d.key,
        label: d.label,
        method: d.method,
        weight: d.weight,
        rationale: d.rationale,
      })),
    })),
    candidates: CANDIDATES,
    rejectedCandidates: REJECTED,
    coverage: coverageMap(corpus.scenarios),
    scenarios: corpus.scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      language: s.language,
      turns: s.turns.length,
      coverage: s.coverage,
    })),
    ranking: ranked.map((s) => s.modelId),
    models: ranked,
    perScenario: [...input.runsByModel.values()].flat().map((run) => {
      const score = scoreScenario(run);
      return {
        modelId: run.modelId,
        scenarioId: run.scenarioId,
        language: run.language,
        status: run.status,
        composite: score.composite,
        categories: score.categories,
        gateFailedTurns: score.gate.failedTurns,
        wrongDayFailedTurns: score.wrongDayGate.failedTurns,
        wrongDayFindings: score.wrongDayGate.findings,
        /** ADDED IN results@3. The leak count MUST be zero; attempts need not be. */
        unsupportedClaimLeakTurns: score.unsupportedClaimGate.leakTurns,
        unsupportedClaimLeakFindings: score.unsupportedClaimGate.findings,
        unsupportedClaimAttemptTurns: score.unsupportedClaimGate.attemptTurns,
        judgeDisagreement: score.judgeDisagreement,
        judgesOk: score.judgesOk,
        turns: run.turns.length,
        durationMs: run.durationMs,
      };
    }),
    /**
     * ADDED IN results@2. Machine conditions per model, min/median/max over the
     * host sampler's series, plus the offload split.
     *
     * Numeric fields are `null` where nothing was sampled - the same convention
     * the rest of this file already uses, so a `null` never means zero. Because
     * `null` on its own cannot distinguish "not sampled" from "this key is newer
     * than your reader", each model ALSO carries `recordPresent` and an explicit
     * `notMeasured` list of quantity keys. That list is the machine-readable form
     * of the `not measured` cell in COMPARISON.md.
     */
    environment: {
      recordSchemaVersion: ENVIRONMENT_RECORD_SCHEMA_VERSION,
      /** Relative to the output root, so it moves with `EVAL_OUT_DIR`. */
      directory: ENVIRONMENT_DIR_NAME,
      writtenBy:
        'An EXTERNAL host sampler, not this harness. `src/eval` never samples the machine: it runs in a ' +
        'container and would measure the container rather than the host whose GPU did the work.',
      provenance:
        'MEASURED on the host, not judged, and not measured by this harness. Keep it distinct from both the ' +
        'programmatic dimensions (measured here) and the judged dimensions (opinions).',
      notMeasuredConvention:
        'A quantity nobody sampled is `null` here, is listed by key in that model\'s `notMeasured`, and prints ' +
        '`not measured` in COMPARISON.md. It is never 0 and never a default.',
      quantities: ENVIRONMENT_QUANTITIES.map((q) => ({ key: q.key, label: q.label })),
      models: environmentSummaries,
    },
  };

  return { json, markdown: renderMarkdown(ranked, input, corpus, environmentSummaries) };
}

/**
 * Ranked models first, then anything else that has runs or a sampled record.
 *
 * De-duplicated while preserving that order, so the environment tables read
 * across against the ranking and nothing with evidence on disk is omitted.
 */
function environmentOrder(ranked: readonly ModelScore[], input: ReportInput): string[] {
  const order = [
    ...ranked.map((score) => score.modelId),
    ...input.runsByModel.keys(),
    ...(input.environmentByModel?.keys() ?? []),
  ];
  return [...new Set(order)];
}

// ---------------------------------------------------------------------------

function renderMarkdown(
  ranked: readonly ModelScore[],
  input: ReportInput,
  corpus: ReturnType<typeof loadCorpus>,
  environment: readonly EnvironmentSummary[],
): string {
  const out: string[] = [];
  const p = (line = ''): void => void out.push(line);

  p('# Local model comparison - Schedule AI Voice, Mission 2');
  p();
  p(`Generated ${input.generatedAtIso}`);
  p();
  p(
    `Harness \`${HARNESS_VERSION}\` &middot; corpus \`${corpus.corpusVersion}\` &middot; ` +
      `rubric \`${RUBRIC_VERSION}\` &middot; judge prompt \`${JUDGE_PROMPT_VERSION}\``,
  );
  p();
  p(
    'Every number below comes from a real run against a real local model through the real ' +
      '`AgentTurnService`, the real nine tool schemas and the real `ToolDispatcher`. Transcripts for every ' +
      'conversation are committed next to this file.',
  );
  p();

  // ---- headline -----------------------------------------------------------
  p('## 1. The gates');
  p();
  p('### 1.1 Manufactured timestamps');
  p();
  p(`> ${TIMESTAMP_FABRICATION_GATE.rule}`);
  p();
  p(`> **Consequence:** ${TIMESTAMP_FABRICATION_GATE.consequence}`);
  p();
  p('| Model | Turns | Gate failures | Rate | Verdict |');
  p('| --- | ---: | ---: | ---: | --- |');
  for (const score of ranked) {
    const g = score.timestampFabrication;
    p(
      `| \`${score.modelId}\` | ${g.totalTurns} | ${g.failedTurns} | ${(g.rate * 100).toFixed(1)}% | ` +
        `${g.passedGate ? '**PASS**' : '**FAIL**'} |`,
    );
  }
  p();
  const offenders = ranked.filter((s) => !s.timestampFabrication.passedGate);
  if (offenders.length === 0) {
    p('No candidate manufactured a timestamp on any turn. The passthrough architecture held for every model.');
  } else {
    p('Findings, verbatim:');
    p();
    for (const score of offenders) {
      for (const finding of score.timestampFabrication.findings.slice(0, 20)) {
        p(`- \`${score.modelId}\` - ${finding}`);
      }
    }
  }
  p();

  // ---- the second gate ----------------------------------------------------
  p('### 1.2 Bookings resolved onto the wrong calendar day');
  p();
  p(`> ${WRONG_DAY_RESOLUTION_GATE.rule}`);
  p();
  p(`> **Consequence:** ${WRONG_DAY_RESOLUTION_GATE.consequence}`);
  p();
  p('| Model | Turns where a day was asserted and an instant resolved | Wrong day | Rate | Verdict |');
  p('| --- | ---: | ---: | ---: | --- |');
  for (const score of ranked) {
    const g = score.wrongDayResolution;
    p(
      `| \`${score.modelId}\` | ${g.applicableTurns} | ${g.failedTurns} | ` +
        `${g.rate === null ? 'n/a' : `${(g.rate * 100).toFixed(1)}%`} | ` +
        `${g.applicableTurns === 0 ? 'not exercised' : g.passedGate ? '**PASS**' : '**FAIL**'} |`,
    );
  }
  p();
  const wrongDayOffenders = ranked.filter((s) => !s.wrongDayResolution.passedGate);
  if (wrongDayOffenders.length === 0) {
    p(
      'No run ended in a booking on a day the contact did not name. Note the denominator: a model that was ' +
        'refused by the resolver, or that never reached a time-bearing tool, contributes nothing here - it ' +
        'is not credited with a pass it did not earn.',
    );
  } else {
    p('Findings, verbatim. **Read these as defects in `src/scheduling/`, not as defects in the model:**');
    p();
    for (const score of wrongDayOffenders) {
      for (const finding of score.wrongDayResolution.findings.slice(0, 20)) {
        p(`- \`${score.modelId}\` - ${finding}`);
      }
    }
  }
  p();

  // ---- the third gate, and the number beside it ---------------------------
  renderUnsupportedClaims(p, ranked);

  // ---- ranking ------------------------------------------------------------
  p('## 2. Composite ranking');
  p();
  p(
    'Weights: ' +
      RUBRIC_CATEGORIES.map((c) => `${c.label} ${(c.weight * 100).toFixed(0)}%`).join(', ') +
      '. Conversation quality dominates by design - a technically correct model that sounds robotic must ' +
      'not win. **A model failing ANY of the three gates is ranked below every model that passes all three, ' +
      'whatever its score.**',
  );
  p();
  p(
    '| # | Model | Composite | Conversation | Tool/structural | Language | Fabrication gate | Wrong-day gate | Claim-leak gate |',
  );
  p('| ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- |');
  ranked.forEach((score, index) => {
    const wrongDay = score.wrongDayResolution;
    const claims = score.unsupportedClaims;
    p(
      `| ${index + 1} | \`${score.modelId}\` | ${pct(score.composite)} | ` +
        `${pct(score.categories['conversationQuality']?.score ?? null)} | ` +
        `${pct(score.categories['toolAndStructural']?.score ?? null)} | ` +
        `${pct(score.categories['languageQuality']?.score ?? null)} | ` +
        `${score.timestampFabrication.passedGate ? 'pass' : '**FAIL**'} | ` +
        `${wrongDay.applicableTurns === 0 ? 'n/a' : wrongDay.passedGate ? 'pass' : '**FAIL**'} | ` +
        `${claims.applicableTurns === 0 ? 'not checked' : claims.passedGate ? 'pass' : '**FAIL**'} |`,
    );
  });
  p();
  p(
    '_Conversation and Language contain judged dimensions and are therefore part opinion. Tool/structural ' +
      'is entirely programmatic and entirely reproducible._',
  );
  p();

  // ---- programmatic detail ------------------------------------------------
  p('## 3. Programmatic results (measured, reproducible)');
  p();
  p('| Model | Tool selection | Arg validity | No hallucinated ids | No unnecessary calls | Sched. intent | Structured output |');
  p('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const score of ranked) {
    p(
      `| \`${score.modelId}\` | ${dim(score, 'toolSelectionAccuracy')} | ${dim(score, 'argumentValidity')} | ` +
        `${dim(score, 'noHallucinatedIds')} | ${dim(score, 'noUnnecessaryToolCalls')} | ` +
        `${dim(score, 'schedulingIntentRecognition')} | ${dim(score, 'structuredOutputReliability')} |`,
    );
  }
  p();
  p('| Model | Content expectations | Length budget | Non-repetitive | Language match |');
  p('| --- | ---: | ---: | ---: | ---: |');
  for (const score of ranked) {
    p(
      `| \`${score.modelId}\` | ${dim(score, 'textExpectationsMet')} | ` +
        `${dim(score, 'responseLengthAppropriateness')} | ${dim(score, 'nonRepetitiveness')} | ` +
        `${dim(score, 'languageMatch')} |`,
    );
  }
  p();
  p('**Tool-call health, straight from the provider:**');
  p();
  p('| Model | Native | Recovered from text | Malformed (refused) | Malformed rate |');
  p('| --- | ---: | ---: | ---: | ---: |');
  for (const score of ranked) {
    const h = score.toolCallHealth;
    p(
      `| \`${score.modelId}\` | ${h.native} | ${h.recovered} | ${h.malformed} | ` +
        `${score.malformedToolCallRate === null ? 'n/a' : `${(score.malformedToolCallRate * 100).toFixed(1)}%`} |`,
    );
  }
  p();

  // ---- judged -------------------------------------------------------------
  p('## 4. Judged results (opinion, not measurement)');
  p();
  p(
    `Judges: ${JUDGE_MODELS.map((m) => `\`${m}\``).join(' and ')}. Both are themselves candidates, both are ` +
      '7-8B models grading 7-8B models, and both read the same committed transcripts a human can read. ' +
      '**These are opinions.** The `judge disagreement` column is the mean absolute difference between the ' +
      'two judges across all dimensions, on the 0-5 scale: where it is large, this harness cannot resolve ' +
      'the dimension and the transcripts should be read directly.',
  );
  p();
  const judged = RUBRIC_CATEGORIES.flatMap((c) => c.dimensions).filter((d) => d.method === 'judged');
  p(`| Model | ${judged.map((d) => d.label).join(' | ')} | Judge disagreement | Judge failures |`);
  p(`| --- | ${judged.map(() => '---:').join(' | ')} | ---: | ---: |`);
  for (const score of ranked) {
    p(
      `| \`${score.modelId}\` | ${judged.map((d) => dim(score, d.key)).join(' | ')} | ` +
        `${score.judgeDisagreement === null ? 'n/a' : score.judgeDisagreement.toFixed(2)} | ` +
        `${score.judgeFailures} |`,
    );
  }
  p();
  p('**Each judge separately - look for self-preference.**');
  p();
  p(
    'Both judges are also candidates. If a judge marks its own row materially higher than the other judge ' +
      'does, that is self-preference and the composite for that model should be discounted accordingly. ' +
      'Their own rows are marked.',
  );
  p();
  p(`| Model | ${JUDGE_MODELS.map((m) => `Judged by \`${m}\``).join(' | ')} | Difference |`);
  p(`| --- | ${JUDGE_MODELS.map(() => '---:').join(' | ')} | ---: |`);
  for (const score of ranked) {
    const cells = JUDGE_MODELS.map((judge) => {
      const aggregate = score.judgedByJudge[judge];
      const self = judge === score.modelId ? ' **(self)**' : '';
      return aggregate && aggregate.score !== null ? `${pct(aggregate.score)}${self}` : 'n/a';
    });
    const [a, b] = JUDGE_MODELS.map((judge) => score.judgedByJudge[judge]?.score ?? null);
    const delta = a !== null && a !== undefined && b !== null && b !== undefined ? pct(Math.abs(a - b)) : 'n/a';
    p(`| \`${score.modelId}\` | ${cells.join(' | ')} | ${delta} |`);
  }
  p();

  // ---- language -----------------------------------------------------------
  p('## 5. Composite by language');
  p();
  p('| Model | English | Hebrew | Mixed |');
  p('| --- | ---: | ---: | ---: |');
  for (const score of ranked) {
    p(
      `| \`${score.modelId}\` | ${pct(score.byLanguage['en']?.score ?? null)} | ` +
        `${pct(score.byLanguage['he']?.score ?? null)} | ${pct(score.byLanguage['mixed']?.score ?? null)} |`,
    );
  }
  p();

  // ---- performance --------------------------------------------------------
  p('## 6. Latency and throughput');
  p();
  p(
    'Every turn ran through the STREAMING path, so time-to-first-token is real rather than inferred. ' +
      '`TTFT` is the first provider call of a turn - what a caller on a phone perceives. `Total` is the whole ' +
      'agent turn including every tool round-trip and the database writes, which is the number that decides ' +
      'whether this is usable for voice. `tok/s` is generation only, excluding prompt evaluation and model ' +
      'load, as the provider reports it.',
  );
  p();
  p(
    '**Do not compare these rows without reading section 7 and section 8 first.** Every number in this table ' +
      'is a property of the machine as much as of the model. A candidate benchmarked while another ' +
      'application held VRAM, or one whose weights spilled into system RAM, is slower for reasons that have ' +
      'nothing to do with its quality.',
  );
  p();
  p('| Model | TTFT p50 | TTFT p95 | Turn p50 | Turn p95 | tok/s | Prompt tokens (mean / max) | Ctx util (mean / max) |');
  p('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const score of ranked) {
    p(
      `| \`${score.modelId}\` | ${ms(score.timeToFirstToken.p50Ms)} | ${ms(score.timeToFirstToken.p95Ms)} | ` +
        `${ms(score.totalLatency.p50Ms)} | ${ms(score.totalLatency.p95Ms)} | ` +
        `${score.tokensPerSecond.mean === null ? 'n/a' : score.tokensPerSecond.mean.toFixed(1)} | ` +
        `${num(score.promptTokens.mean)} / ${num(score.promptTokens.max)} | ` +
        `${pct(score.contextUtilization.mean)} / ${pct(score.contextUtilization.max)} |`,
    );
  }
  p();

  // ---- host conditions ----------------------------------------------------
  // Placed immediately after latency because it is the section that decides
  // whether the latency table is a comparison or five unrelated measurements.
  renderEnvironment(p, environment);
  renderOffloadSplit(p, environment);

  // ---- completeness -------------------------------------------------------
  p('## 9. Run completeness');
  p();
  p('| Model | Scenarios | OK | Errored | Turns |');
  p('| --- | ---: | ---: | ---: | ---: |');
  for (const score of ranked) {
    p(
      `| \`${score.modelId}\` | ${score.scenariosRun} | ${score.scenariosOk} | ${score.scenariosErrored} | ` +
        `${score.turnsRun} |`,
    );
  }
  p();
  p(`Corpus: ${corpus.scenarios.length} scenarios covering all ${REQUIRED_COVERAGE.length} required shapes.`);
  p();

  // ---- coverage -----------------------------------------------------------
  p('## 10. Corpus coverage');
  p();
  p('| Required shape | Scenarios |');
  p('| --- | --- |');
  const map = coverageMap(corpus.scenarios);
  for (const key of REQUIRED_COVERAGE) {
    p(`| \`${key}\` | ${(map[key] ?? []).map((id) => `\`${id}\``).join(', ') || '**NONE**'} |`);
  }
  p();

  return `${out.join('\n')}\n`;
}

type Emit = (line?: string) => void;

// ---------------------------------------------------------------------------
// The third gate, and the unweighted number printed beside it.
//
// TWO NUMBERS, NEVER ONE, AND THEY ARE LABELLED DIFFERENTLY ON PURPOSE. The
// leak count is a property of the SYSTEM and must be zero. The attempts count is
// a property of the MODEL and is expected not to be. A report that printed one
// figure, or printed both under one heading, would invite a reader to congratulate
// a model for a low attempts number or to condemn it for a high one - and neither
// reading is available from these numbers.
// ---------------------------------------------------------------------------

function renderUnsupportedClaims(p: Emit, ranked: readonly ModelScore[]): void {
  p('### 1.3 Unsupported material claims - ATTEMPTED by the model vs LEAKED to the contact');
  p();
  p(`> ${UNSUPPORTED_CLAIM_GATE.rule}`);
  p();
  p(`> **Consequence:** ${UNSUPPORTED_CLAIM_GATE.consequence}`);
  p();
  p(
    '**Read the two columns as facts about two different things.** `Attempts` is a property of the MODEL: ' +
      'unsupported material claims in its own pre-release wording. It is **expected to be non-zero** - the ' +
      'corpus provokes it deliberately on five adversarial scenarios - and it carries **no weight in the ' +
      'composite**. `LEAKS` is a property of the SYSTEM: the same claims in the text that actually reached ' +
      'the contact. **It must be zero.** A non-zero leak count is not a weak model, it is a claim gate that ' +
      'did not hold.',
  );
  p();
  p(
    '**The leak number is computed independently of the claim gate.** The detector is re-run here, over the ' +
      "released text, against this harness's own ledger of what the real dispatcher actually did. Nothing in " +
      "this table is read from the gate's report about itself, so a gate that misreported itself could not " +
      'produce a zero here.',
  );
  p();

  if (ranked.length === 0) {
    p('_No models to report._');
    p();
    return;
  }

  p('| Model | Turns checked | Attempt turns | Attempt findings | **LEAK turns (must be 0)** | Leak findings | Verdict |');
  p('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const score of ranked) {
    const c = score.unsupportedClaims;
    p(
      `| \`${score.modelId}\` | ${c.applicableTurns === 0 ? NOT_MEASURED : c.applicableTurns} | ` +
        `${c.applicableTurns === 0 ? NOT_MEASURED : c.attemptTurns} | ` +
        `${c.applicableTurns === 0 ? NOT_MEASURED : c.attemptFindings} | ` +
        `${c.applicableTurns === 0 ? NOT_MEASURED : `**${c.leakTurns}**`} | ` +
        `${c.applicableTurns === 0 ? NOT_MEASURED : c.leakFindings} | ` +
        `${c.applicableTurns === 0 ? 'not checked' : c.passedGate ? '**PASS**' : '**FAIL**'} |`,
    );
  }
  p();

  // A model whose runs predate harness 1.2.0 carries no ledger and cannot be
  // retro-scored. Saying `not checked` is the only honest cell; a zero would read
  // as a clean bill of health nobody issued.
  const unchecked = ranked.filter((score) => score.unsupportedClaims.applicableTurns === 0);
  if (unchecked.length > 0) {
    p(
      `**${unchecked.length} of ${ranked.length} model(s) were not checked at all:** ` +
        `${unchecked.map((s) => `\`${s.modelId}\``).join(', ')}. Their recorded runs predate harness 1.2.0, so ` +
        'they carry no ledger for a claim to be judged against and cannot be scored retrospectively. ' +
        `\`${NOT_MEASURED}\` here is a gap in the evidence, **not a zero and not a pass.**`,
    );
    p();
  }

  const echoed = ranked.filter(
    (score) => score.unsupportedClaims.applicableTurns > 0 && !score.unsupportedClaims.attemptsIndependentlyObserved,
  );
  if (echoed.length > 0) {
    p(
      `**For ${echoed.length} model(s) the attempts column is NOT an independent observation:** ` +
        `${echoed.map((s) => `\`${s.modelId}\``).join(', ')}. No claim-gate report was present for every ` +
        "checked turn, so the model's raw wording and the released text are the same string and the two " +
        'columns are one number seen twice. A matching pair of columns for these models means the gate was ' +
        'absent, **not that it corrected nothing.**',
    );
    p();
  }

  const malformed = ranked.filter((score) => score.unsupportedClaims.malformedReportTurns > 0);
  if (malformed.length > 0) {
    p(
      '**A claim-gate report was present but malformed on some turns:** ' +
        `${malformed.map((s) => `\`${s.modelId}\` (${s.unsupportedClaims.malformedReportTurns} turn(s))`).join(', ')}. ` +
        'That is a contract change between the agent and this harness, not a model behaviour, and the ' +
        'attempts number for those turns fell back to the released text.',
    );
    p();
  }

  const leaking = ranked.filter((score) => !score.unsupportedClaims.passedGate);
  if (leaking.length > 0) {
    p('**LEAKS, verbatim. Every line below is something false that a contact was told:**');
    p();
    for (const score of leaking) {
      for (const finding of score.unsupportedClaims.findings.slice(0, 20)) {
        p(`- \`${score.modelId}\` - ${finding}`);
      }
    }
    p();
  } else if (unchecked.length < ranked.length) {
    p(
      'No candidate released an unsupported material claim on any checked turn. **That is a result about the ' +
        'claim gate, not about the models** - see the attempts column for what the models tried to say.',
    );
    p();
  }

  const attempting = ranked.filter((score) => score.unsupportedClaims.attemptFindings > 0);
  if (attempting.length > 0) {
    p(
      `<details><summary>Attempts, verbatim (${attempting.reduce((n, s) => n + s.unsupportedClaims.attemptFindings, 0)} ` +
        'across all models) - model behaviour the system absorbed</summary>',
    );
    p();
    for (const score of attempting) {
      for (const detail of score.unsupportedClaims.attemptDetail.slice(0, 20)) {
        p(`- \`${score.modelId}\` - ${detail}`);
      }
    }
    p();
    p('</details>');
    p();
  } else if (unchecked.length < ranked.length) {
    p(
      '**No model attempted an unsupported material claim on any checked turn, and that should be read with ' +
        'suspicion rather than relief.** The corpus contains five scenarios written to provoke exactly this, ' +
        'and two of the five candidates did it on the record at corpus 1.1.0. A zero here is more likely to ' +
        'mean the detector or the attempt wording stopped arriving than that every model became honest.',
    );
    p();
  }
}

// ---------------------------------------------------------------------------
// Host conditions. Measured on the host by an external sampler - a third
// provenance, kept labelled and kept apart from both judged and harness-measured
// numbers, exactly as rule 2 of this file requires.
// ---------------------------------------------------------------------------

function renderEnvironment(p: Emit, environment: readonly EnvironmentSummary[]): void {
  p('## 7. Machine conditions during each run (measured on the host)');
  p();
  p(
    'Recorded by an **external host sampler**, not by this harness - `src/eval` runs in a container and would ' +
      'measure the container rather than the host whose GPU did the work. One file per model per run under ' +
      `\`${ENVIRONMENT_DIR_NAME}/\` in this output directory, schema ` +
      `\`${ENVIRONMENT_RECORD_SCHEMA_VERSION}\`.`,
  );
  p();
  p(
    `Each cell is **min / median / max** across that run's samples. \`${NOT_MEASURED}\` means no sample ` +
      'carried the quantity. **It does not mean zero, and it is not a default** - a comparison whose ' +
      'conditions were never recorded is one nobody can defend, and saying so is the honest output.',
  );
  p();

  if (environment.length === 0) {
    p('_No models to report._');
    p();
    return;
  }

  p(`| Model | ${ENVIRONMENT_QUANTITIES.map((q) => q.header).join(' | ')} | Samples | num_ctx |`);
  p(`| --- | ${ENVIRONMENT_QUANTITIES.map(() => '---:').join(' | ')} | ---: | ---: |`);
  for (const summary of environment) {
    const cells = ENVIRONMENT_QUANTITIES.map((q) =>
      q.display === 'gib'
        ? spreadGiB(summary.quantities[q.key])
        : spreadPercent(summary.quantities[q.key]),
    );
    p(
      `| \`${summary.modelId}\` | ${cells.join(' | ')} | ` +
        `${summary.recordPresent ? summary.sampleCount : NOT_MEASURED} | ` +
        `${summary.numCtx === null ? NOT_MEASURED : summary.numCtx.toLocaleString('en-US')} |`,
    );
  }
  p();

  const unsampled = environment.filter((summary) => !summary.recordPresent);
  if (unsampled.length > 0) {
    p(
      `**${unsampled.length} of ${environment.length} model(s) have no host environment record at all:** ` +
        `${unsampled.map((s) => `\`${s.modelId}\``).join(', ')}. Their latency and throughput rows in ` +
        'section 6 cannot be compared against the others, because nothing records whether the machine was ' +
        'in the same state. This is a gap in the evidence, not a result.',
    );
    p();
  }

  // `num_ctx` is the fairness precondition the protocol states, so a disagreement
  // is called out here rather than left for a reader to spot across five rows.
  const contexts = new Set(
    environment.filter((s) => s.numCtx !== null).map((s) => s.numCtx as number),
  );
  if (contexts.size > 1) {
    p(
      `**The candidates did NOT all run at the same context length** (${[...contexts]
        .sort((a, b) => a - b)
        .join(', ')}). The KV cache is a real part of the VRAM footprint, so this comparison is invalid as a ` +
        'like-for-like ranking. Re-run every model at one `num_ctx`.',
    );
    p();
  }

  const runIds = new Set(environment.filter((s) => s.runId !== null).map((s) => s.runId as string));
  if (runIds.size > 1) {
    p(
      `**These records come from ${runIds.size} different runs** (${[...runIds]
        .sort()
        .map((id) => `\`${id}\``)
        .join(', ')}). Conditions from separate sittings are not the identical conditions a fair ` +
        'comparison needs. Treat the cross-model numbers as indicative only.',
    );
    p();
  }

  const noted = environment.filter((summary) => summary.note !== null && summary.note.trim() !== '');
  p('**Conditions the sampler recorded in words:**');
  p();
  if (noted.length === 0) {
    p(
      '_No model carried a free-text note. Note that an EMPTY note is not evidence of a quiet machine - it ' +
        'only means nobody wrote anything down._',
    );
  } else {
    for (const summary of noted) p(`- \`${summary.modelId}\` - ${summary.note}`);
  }
  p();
}

/**
 * The offload split, in its own section rather than a column in a wide table.
 *
 * This is THE number that explains an unfair comparison: a model that spilled
 * part of itself into system RAM is slower for a reason that has nothing to do
 * with its quality, and a reader scanning for that explanation must not have to
 * find it inside a nine-column table.
 */
function renderOffloadSplit(p: Emit, environment: readonly EnvironmentSummary[]): void {
  p('## 8. Offload split - how much of each model was on the GPU');
  p();
  p(
    'As reported by the local runtime while the model was resident. A model held entirely in VRAM and a model ' +
      'whose weights spilled into system RAM are **not competing on the same terms**: the spilled one pays a ' +
      'PCIe round trip per token, and its latency in section 6 describes the spill rather than the model. ' +
      'This is the first thing to check before believing any speed difference between two candidates.',
  );
  p();
  p(`\`${NOT_MEASURED}\` means the local runtime's split was not recorded - never that it was 100% GPU.`);
  p();

  if (environment.length === 0) {
    p('_No models to report._');
    p();
    return;
  }

  p('| Model | Resident (GiB) | On GPU (GiB) | In system RAM (GiB) | On GPU (%) | Runtime said | Reported by |');
  p('| --- | ---: | ---: | ---: | ---: | --- | --- |');
  for (const summary of environment) {
    const offload = summary.offload;
    p(
      `| \`${summary.modelId}\` | ${gib(summary.modelResidentBytes)} | ${gib(offload?.gpuBytes ?? null)} | ` +
        `${gib(offload?.cpuBytes ?? null)} | ${percent(offload?.gpuPercent ?? null)} | ` +
        `${offload?.runtimeReportedText === undefined || offload.runtimeReportedText === null ? NOT_MEASURED : `\`${offload.runtimeReportedText}\``} | ` +
        `${offload === null || offload === undefined ? NOT_MEASURED : offload.reportedBy} |`,
    );
  }
  p();

  // A model with NO record is not listed here. "We did not measure it" and "we
  // measured it and it fitted" are different statements and only the second one
  // may be treated as a clean bill of health.
  const spilled = environment.filter((summary) => {
    const cpuBytes = summary.offload?.cpuBytes ?? null;
    return cpuBytes !== null && cpuBytes > 0;
  });
  if (spilled.length > 0) {
    p(
      `**${spilled.length} model(s) did not fit entirely on the GPU:** ` +
        `${spilled.map((s) => `\`${s.modelId}\` (${gib(s.offload?.cpuBytes ?? null)} in system RAM)`).join(', ')}. ` +
        'Their latency figures are not comparable with the models that fitted. Either free VRAM and re-run ' +
        'them, or state the spill next to every speed claim about them.',
    );
    p();
  }
}

// ---------------------------------------------------------------------------

/** Bytes to GiB, or the `not measured` label. Never 0 for an absent reading. */
function gib(bytes: number | null): string {
  return bytes === null ? NOT_MEASURED : (bytes / 2 ** 30).toFixed(2);
}

function percent(value: number | null): string {
  return value === null ? NOT_MEASURED : `${value.toFixed(1)}%`;
}

/**
 * `min / median / max`, or a single `not measured` for the whole cell.
 *
 * The cell collapses to one label rather than printing three of them, because
 * `not measured / not measured / not measured` is noise that makes a table
 * harder to read without saying anything extra.
 */
function spreadGiB(value: Spread): string {
  if (value.n === 0) return NOT_MEASURED;
  return `${gib(value.min)} / ${gib(value.median)} / ${gib(value.max)}`;
}

function spreadPercent(value: Spread): string {
  if (value.n === 0) return NOT_MEASURED;
  return `${percent(value.min)} / ${percent(value.median)} / ${percent(value.max)}`;
}

// ---------------------------------------------------------------------------

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function num(value: number | null): string {
  return value === null ? 'n/a' : Math.round(value).toLocaleString('en-US');
}

function ms(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value).toLocaleString('en-US')} ms`;
}

function dim(score: ModelScore, key: string): string {
  const aggregate = score.dimensions[key];
  if (!aggregate || aggregate.score === null) return 'n/a';
  return `${(aggregate.score * 100).toFixed(1)}% <sub>n=${aggregate.n}</sub>`;
}
