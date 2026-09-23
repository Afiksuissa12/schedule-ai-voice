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
 */
import { coverageMap, loadCorpus } from '../corpus/index.js';
import { REQUIRED_COVERAGE } from '../corpus/schema.js';
import { CANDIDATES, REJECTED } from '../models/candidates.js';
import { JUDGE_MODELS } from '../rubric/judge.js';
import { JUDGE_PROMPT_VERSION } from '../rubric/judgePrompt.js';
import { RUBRIC_CATEGORIES, RUBRIC_VERSION, TIMESTAMP_FABRICATION_GATE } from '../rubric/rubric.js';
import { scoreModel, scoreScenario, type ModelScore } from '../rubric/score.js';
import { HARNESS_VERSION } from '../runner/runScenario.js';
import type { ScenarioRun } from '../types.js';

export interface ReportInput {
  /** Recorded runs, keyed by model id, in candidate order. */
  readonly runsByModel: ReadonlyMap<string, readonly ScenarioRun[]>;
  readonly generatedAtIso: string;
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

  // The ranking rule, applied here and stated in the markdown: a model that
  // trips the fabrication gate is ranked BELOW every model that does not,
  // regardless of composite. A charming model that invents timestamps is not a
  // better product than a duller one that does not.
  const ranked = [...scores].sort((a, b) => {
    if (a.timestampFabrication.passedGate !== b.timestampFabrication.passedGate) {
      return a.timestampFabrication.passedGate ? -1 : 1;
    }
    return (b.composite ?? -1) - (a.composite ?? -1);
  });

  const json = {
    schema: 'schedule-ai-voice/eval-results@1',
    generatedAtIso: input.generatedAtIso,
    harnessVersion: HARNESS_VERSION,
    corpusVersion: corpus.corpusVersion,
    corpusSchemaVersion: corpus.schemaVersion,
    rubricVersion: RUBRIC_VERSION,
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    judgeModels: JUDGE_MODELS,
    gate: TIMESTAMP_FABRICATION_GATE,
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
        judgeDisagreement: score.judgeDisagreement,
        judgesOk: score.judgesOk,
        turns: run.turns.length,
        durationMs: run.durationMs,
      };
    }),
  };

  return { json, markdown: renderMarkdown(ranked, input, corpus) };
}

// ---------------------------------------------------------------------------

function renderMarkdown(
  ranked: readonly ModelScore[],
  input: ReportInput,
  corpus: ReturnType<typeof loadCorpus>,
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
  p('## 1. The gate: manufactured timestamps');
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

  // ---- ranking ------------------------------------------------------------
  p('## 2. Composite ranking');
  p();
  p(
    'Weights: ' +
      RUBRIC_CATEGORIES.map((c) => `${c.label} ${(c.weight * 100).toFixed(0)}%`).join(', ') +
      '. Conversation quality dominates by design - a technically correct model that sounds robotic must ' +
      'not win. **A model failing the gate is ranked below every model that passes it, whatever its score.**',
  );
  p();
  p('| # | Model | Composite | Conversation | Tool/structural | Language | Gate |');
  p('| ---: | --- | ---: | ---: | ---: | ---: | --- |');
  ranked.forEach((score, index) => {
    p(
      `| ${index + 1} | \`${score.modelId}\` | ${pct(score.composite)} | ` +
        `${pct(score.categories['conversationQuality']?.score ?? null)} | ` +
        `${pct(score.categories['toolAndStructural']?.score ?? null)} | ` +
        `${pct(score.categories['languageQuality']?.score ?? null)} | ` +
        `${score.timestampFabrication.passedGate ? 'pass' : '**FAIL**'} |`,
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

  // ---- completeness -------------------------------------------------------
  p('## 7. Run completeness');
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
  p('## 8. Corpus coverage');
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
