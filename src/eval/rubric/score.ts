/**
 * Turning recorded runs into scores, and being explicit about denominators.
 *
 * THE RULE THAT MATTERS MOST HERE
 * ---------------------------------------------------------------------------
 * A dimension is scored only over the turns where it APPLIES. If a scenario
 * never states a tool expectation, that scenario contributes nothing to
 * tool-selection accuracy - it does not contribute a free 1.0. Averaging in
 * inapplicable turns is the standard way benchmark numbers drift upwards for no
 * reason, and every aggregate here therefore carries its own `n`.
 *
 * Dimensions with `n = 0` are reported as `null`, not as 0 and not as 1.
 */
import type { ScenarioRun, TurnRecord } from '../types.js';
import { judgeAgreement } from './judge.js';
import {
  JUDGED_DIMENSIONS,
  PROGRAMMATIC_DIMENSIONS,
  RUBRIC_CATEGORIES,
  TIMESTAMP_FABRICATION_GATE,
  WRONG_DAY_RESOLUTION_GATE,
} from './rubric.js';

/** A score plus the number of observations behind it. */
export interface Aggregate {
  /** 0..1, or null when nothing was applicable. */
  readonly score: number | null;
  readonly n: number;
}

function mean(values: readonly number[]): Aggregate {
  if (values.length === 0) return { score: null, n: 0 };
  return { score: values.reduce((a, b) => a + b, 0) / values.length, n: values.length };
}

// ---------------------------------------------------------------------------
// Per-turn programmatic dimension scores.
// ---------------------------------------------------------------------------

/**
 * One turn's programmatic dimensions, each either a 0..1 score or `null` when
 * the dimension does not apply to this turn.
 */
export function scoreTurnProgrammatic(turn: TurnRecord): Record<string, number | null> {
  const c = turn.checks;
  const callCount = turn.toolCalls.length;

  const toolSelectionAccuracy =
    c.toolSelection.applicable && c.toolSelection.assertionsChecked > 0
      ? c.toolSelection.assertionsPassed / c.toolSelection.assertionsChecked
      : null;

  const argumentValidity =
    callCount === 0 ? null : c.toolCalls.filter((call) => call.known && call.jsonParsed && call.schemaValid).length / callCount;

  const hallucinations = c.toolCalls.filter((call) => call.hallucinatedContactId || call.hallucinatedMeetingId).length;
  const noHallucinatedIds = callCount === 0 ? null : 1 - hallucinations / callCount;

  // Only scorable where the corpus said what was defensible.
  const boundedTurn = c.toolSelection.applicable;
  const noUnnecessaryToolCalls = !boundedTurn
    ? null
    : c.unnecessaryCalls.length === 0
      ? 1
      : Math.max(0, 1 - c.unnecessaryCalls.length / Math.max(1, callCount));

  const schedulingIntentRecognition = c.schedulingIntent.applicable ? (c.schedulingIntent.recognised ? 1 : 0) : null;

  // Native calls are the good path; a recovered one worked but signals a model
  // whose tool-calling template is shaky, so it earns half credit.
  const health = turn.metrics?.toolCallHealth;
  const healthTotal = health ? health.native + health.recoveredFromText + health.malformed : 0;
  const structuredOutputReliability =
    health && healthTotal > 0 ? (health.native + 0.5 * health.recoveredFromText) / healthTotal : null;

  // The passthrough verdict is the sharpest single signal in the corpus, so it
  // rides with the text expectations rather than being averaged into nothing.
  const textSignals: number[] = [];
  if (c.text.applicable) textSignals.push(c.text.passed ? 1 : 0);
  if (c.passthrough.applicable) textSignals.push(c.passthrough.passed ? 1 : 0);
  const textExpectationsMet = textSignals.length === 0 ? null : mean(textSignals).score;

  return {
    toolSelectionAccuracy,
    argumentValidity,
    noHallucinatedIds,
    noUnnecessaryToolCalls,
    schedulingIntentRecognition,
    structuredOutputReliability,
    textExpectationsMet,
    responseLengthAppropriateness: c.text.lengthScore,
    nonRepetitiveness: c.repetition.score,
    languageMatch: c.language.matched ? 1 : 0,
  };
}

/** Did this turn trip the timestamp-fabrication gate? */
export function turnFailedGate(turn: TurnRecord): boolean {
  return turn.checks.fabricatedTimestamps.length > 0;
}

/**
 * Did this turn trip the wrong-day gate?
 *
 * `resolvedDay` is optional on `TurnChecks` so that a results file written by
 * harness 1.0.0 still loads. Absent means the check never ran, which is "not
 * applicable" - never "passed" and never "failed".
 */
export function turnResolvedWrongDay(turn: TurnRecord): boolean {
  const resolved = turn.checks.resolvedDay;
  return resolved !== undefined && resolved.applicable && !resolved.passed;
}

/** Either gate. This is what zeroes the technical category. */
export function turnFailedAnyGate(turn: TurnRecord): boolean {
  return turnFailedGate(turn) || turnResolvedWrongDay(turn);
}

// ---------------------------------------------------------------------------
// Which judged dimensions a scenario could actually exercise.
// ---------------------------------------------------------------------------

/**
 * Should this scenario's judged score for `dimension` count?
 *
 * THE PROBLEM THIS SOLVES. Asked to rate "recovers after a topic change" on a
 * conversation containing no topic change, a small judge does not say "not
 * applicable" - it says 5, because nothing went wrong. Averaged over a corpus
 * where only two scenarios contain a digression, that turns a dimension
 * measuring a hard behaviour into a dimension measuring its own absence, and
 * every model scores near the ceiling on it.
 *
 * So applicability is decided HERE, deterministically, from the recorded run
 * and the scenario's coverage tags - not by the judge. Giving the judge an
 * "n/a" option would have been the obvious alternative and was rejected: a 7-8B
 * model handed an escape hatch uses it to avoid difficult calls, which would
 * silently shrink the denominator on exactly the dimensions that matter most.
 *
 * Dimensions not named below apply to every conversation, because every
 * scenario is a sales call and can be judged on naturalness, relevance,
 * continuity, questioning and register.
 */
export function judgedDimensionApplies(run: ScenarioRun, dimension: string): boolean {
  switch (dimension) {
    case 'recoversFromTopicChange':
      return run.coverage.includes('unexpected-topic-change');

    case 'handlesUnexpectedInput':
      return (
        run.coverage.includes('unexpected-topic-change') ||
        run.coverage.includes('question-before-answering') ||
        run.coverage.includes('unexpected-product-question') ||
        run.coverage.includes('interrupts-sales-direction') ||
        run.coverage.includes('adversarial-guardrail')
      );

    case 'remembersEarlierInformation':
      // Either the scenario plants something to remember, or it explicitly
      // tests recall. A two-turn call with nothing to recall cannot show this.
      return (
        run.priorConversation.length > 0 ||
        run.coverage.includes('reference-to-earlier-turn') ||
        run.coverage.includes('continuing-previous-session') ||
        run.turns.length >= 3
      );

    case 'continuesAfterToolResult':
      // Only where the machinery actually produced a result to continue from.
      return run.turns.some((turn) => turn.toolOutcomes.length > 0);

    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Per-scenario.
// ---------------------------------------------------------------------------

export interface ScenarioScore {
  readonly scenarioId: string;
  readonly modelId: string;
  readonly status: string;
  /** Dimension key -> aggregate over this scenario's turns (or the judges). */
  readonly dimensions: Record<string, Aggregate>;
  readonly categories: Record<string, Aggregate>;
  readonly composite: number | null;
  readonly gate: {
    readonly failedTurns: number;
    readonly totalTurns: number;
    readonly findings: readonly string[];
  };
  readonly wrongDayGate: {
    readonly failedTurns: number;
    readonly totalTurns: number;
    readonly findings: readonly string[];
  };
  /** Mean absolute difference between the two judges, when both succeeded. */
  readonly judgeDisagreement: number | null;
  readonly judgesOk: number;
  readonly judgesAttempted: number;
}

export function scoreScenario(run: ScenarioRun): ScenarioScore {
  const dimensions: Record<string, Aggregate> = {};

  // ---- programmatic, averaged over applicable turns ------------------------
  const perTurn = run.turns.map(scoreTurnProgrammatic);
  for (const dimension of PROGRAMMATIC_DIMENSIONS) {
    const values = perTurn
      .map((scores) => scores[dimension.key])
      .filter((value): value is number => typeof value === 'number');
    dimensions[dimension.key] = mean(values);
  }

  // ---- judged, averaged over the judges that returned a valid verdict ------
  const verdicts = Object.values(run.judges).filter((judge) => judge.ok);
  for (const dimension of JUDGED_DIMENSIONS) {
    if (!judgedDimensionApplies(run, dimension.key)) {
      dimensions[dimension.key] = { score: null, n: 0 };
      continue;
    }
    const values = verdicts
      .map((judge) => (judge.ok ? judge.scores[dimension.key]?.score : undefined))
      .filter((value): value is number => typeof value === 'number')
      // The judge answers 0-5; the rubric works in 0..1.
      .map((value) => value / 5);
    dimensions[dimension.key] = mean(values);
  }

  // ---- the gates -----------------------------------------------------------
  const failedTurns = run.turns.filter(turnFailedGate);
  const findings = failedTurns.flatMap((turn) =>
    turn.checks.fabricatedTimestamps.map(
      (f) => `${run.scenarioId} turn ${turn.index + 1}: ${f.toolName}.${f.field} = "${f.matched}" (${f.pattern})`,
    ),
  );

  const wrongDayTurns = run.turns.filter(turnResolvedWrongDay);
  const wrongDayFindings = wrongDayTurns.map(
    (turn) => `${run.scenarioId} turn ${turn.index + 1}: ${turn.checks.resolvedDay?.detail ?? '(no detail)'}`,
  );

  // ---- categories ----------------------------------------------------------
  const categories: Record<string, Aggregate> = {};
  for (const category of RUBRIC_CATEGORIES) {
    let weighted = 0;
    let weightUsed = 0;
    let observations = 0;

    for (const dimension of category.dimensions) {
      const aggregate = dimensions[dimension.key];
      if (!aggregate || aggregate.score === null) continue;
      weighted += aggregate.score * dimension.weight;
      weightUsed += dimension.weight;
      observations += aggregate.n;
    }

    // Renormalise over the weight actually observed, so a category is not
    // dragged down by a dimension this scenario could not exercise.
    categories[category.key] =
      weightUsed === 0 ? { score: null, n: 0 } : { score: weighted / weightUsed, n: observations };
  }

  // THE GATES BITE HERE. A scenario in which a timestamp was manufactured, or in
  // which a booking landed on the wrong calendar day, scores zero on the
  // technical category no matter what else it got right.
  if (failedTurns.length > 0 || wrongDayTurns.length > 0) {
    const technical = categories['toolAndStructural'];
    categories['toolAndStructural'] = { score: 0, n: technical?.n ?? run.turns.length };
  }

  let composite: number | null = null;
  let compositeWeight = 0;
  let compositeSum = 0;
  for (const category of RUBRIC_CATEGORIES) {
    const aggregate = categories[category.key];
    if (!aggregate || aggregate.score === null) continue;
    compositeSum += aggregate.score * category.weight;
    compositeWeight += category.weight;
  }
  if (compositeWeight > 0) composite = compositeSum / compositeWeight;

  const [first, second] = verdicts;
  const judgeDisagreement =
    first?.ok && second?.ok ? judgeAgreement(first.scores, second.scores).meanAbsoluteDifference : null;

  return {
    scenarioId: run.scenarioId,
    modelId: run.modelId,
    status: run.status,
    dimensions,
    categories,
    composite,
    gate: { failedTurns: failedTurns.length, totalTurns: run.turns.length, findings },
    wrongDayGate: {
      failedTurns: wrongDayTurns.length,
      totalTurns: run.turns.length,
      findings: wrongDayFindings,
    },
    judgeDisagreement,
    judgesOk: verdicts.length,
    judgesAttempted: Object.keys(run.judges).length,
  };
}

// ---------------------------------------------------------------------------
// Per-model.
// ---------------------------------------------------------------------------

export interface LatencyStats {
  readonly n: number;
  readonly meanMs: number | null;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
}

export interface ModelScore {
  readonly modelId: string;
  readonly scenariosRun: number;
  readonly scenariosOk: number;
  readonly scenariosErrored: number;
  readonly turnsRun: number;

  readonly dimensions: Record<string, Aggregate>;
  readonly categories: Record<string, Aggregate>;
  readonly composite: number | null;

  /** THE HEADLINE. Turns that manufactured a timestamp, over all turns. */
  readonly timestampFabrication: {
    readonly failedTurns: number;
    readonly totalTurns: number;
    readonly rate: number;
    readonly findings: readonly string[];
    readonly passedGate: boolean;
  };

  /**
   * THE OTHER HEADLINE. Turns where a booking was accepted onto a different
   * calendar day from the one the contact named.
   *
   * `totalTurns` here is the number of turns where the question could be asked
   * at all - turns whose scenario states an expected day AND which produced a
   * resolved instant - not every turn in the run. A rate over all turns would
   * shrink towards zero as the corpus grew and would say nothing.
   */
  readonly wrongDayResolution: {
    readonly failedTurns: number;
    readonly applicableTurns: number;
    readonly rate: number | null;
    readonly findings: readonly string[];
    readonly passedGate: boolean;
  };

  /** True only when NEITHER gate was tripped. This is what ranking uses. */
  readonly passedAllGates: boolean;

  readonly timeToFirstToken: LatencyStats;
  readonly totalLatency: LatencyStats;
  readonly tokensPerSecond: { readonly n: number; readonly mean: number | null };
  readonly promptTokens: { readonly n: number; readonly mean: number | null; readonly max: number | null };
  readonly generatedTokens: { readonly n: number; readonly mean: number | null };
  readonly contextUtilization: { readonly n: number; readonly mean: number | null; readonly max: number | null };

  readonly malformedToolCallRate: number | null;
  readonly toolCallHealth: { readonly native: number; readonly recovered: number; readonly malformed: number };

  readonly judgeDisagreement: number | null;
  readonly judgeFailures: number;

  /**
   * Mean judged score from EACH judge separately, keyed by judge model.
   *
   * Reported because both judges are also candidates, and LLM judges are known
   * to favour their own outputs. A reader can compare a model's row under
   * `qwen2.5` against its row under `llama3.1` and see for themselves whether a
   * judge flattered itself. Averaging the two would hide precisely that.
   */
  readonly judgedByJudge: Record<string, Aggregate>;

  /** Per-language composite, so a bilingual weakness cannot hide in an average. */
  readonly byLanguage: Record<string, Aggregate>;
}

export function scoreModel(runs: readonly ScenarioRun[]): ModelScore {
  const modelId = runs[0]?.modelId ?? '(unknown)';
  const scenarioScores = runs.map(scoreScenario);
  const allTurns = runs.flatMap((run) => run.turns);

  // Dimensions are averaged over TURNS, not over scenarios, so a ten-turn
  // scenario carries more weight than a two-turn one - which is right, because
  // it contains more evidence.
  const dimensions: Record<string, Aggregate> = {};
  const perTurnScores = allTurns.map(scoreTurnProgrammatic);
  for (const dimension of PROGRAMMATIC_DIMENSIONS) {
    dimensions[dimension.key] = mean(
      perTurnScores.map((s) => s[dimension.key]).filter((v): v is number => typeof v === 'number'),
    );
  }
  for (const dimension of JUDGED_DIMENSIONS) {
    dimensions[dimension.key] = mean(
      scenarioScores
        .map((s) => s.dimensions[dimension.key])
        .filter((a): a is Aggregate => a !== undefined && a.score !== null)
        .map((a) => a.score as number),
    );
  }

  const gateFailedTurns = allTurns.filter(turnFailedGate);
  const gateFindings = scenarioScores.flatMap((s) => s.gate.findings);

  const wrongDayApplicableTurns = allTurns.filter((t) => t.checks.resolvedDay?.applicable === true);
  const wrongDayFailedTurns = allTurns.filter(turnResolvedWrongDay);
  const wrongDayFindings = scenarioScores.flatMap((s) => s.wrongDayGate.findings);

  const categories: Record<string, Aggregate> = {};
  for (const category of RUBRIC_CATEGORIES) {
    let weighted = 0;
    let weightUsed = 0;
    let observations = 0;
    for (const dimension of category.dimensions) {
      const aggregate = dimensions[dimension.key];
      if (!aggregate || aggregate.score === null) continue;
      weighted += aggregate.score * dimension.weight;
      weightUsed += dimension.weight;
      observations += aggregate.n;
    }
    categories[category.key] = weightUsed === 0 ? { score: null, n: 0 } : { score: weighted / weightUsed, n: observations };
  }

  const gatedTurns = allTurns.filter(turnFailedAnyGate);
  if (gatedTurns.length > 0) {
    // Proportional at model level rather than a flat zero: one bad turn in
    // eighty is a serious finding but it is not the same product as a model
    // that fabricates constantly, and collapsing both to zero would hide that.
    const technical = categories['toolAndStructural'];
    if (technical?.score !== null && technical !== undefined) {
      const survivingFraction = 1 - gatedTurns.length / Math.max(1, allTurns.length);
      categories['toolAndStructural'] = { score: technical.score * survivingFraction, n: technical.n };
    }
  }

  let compositeSum = 0;
  let compositeWeight = 0;
  for (const category of RUBRIC_CATEGORIES) {
    const aggregate = categories[category.key];
    if (!aggregate || aggregate.score === null) continue;
    compositeSum += aggregate.score * category.weight;
    compositeWeight += category.weight;
  }

  const byLanguage: Record<string, Aggregate> = {};
  for (const language of ['en', 'he', 'mixed']) {
    const subset = scenarioScores.filter(
      (s, i) => runs[i]?.language === language && s.composite !== null,
    );
    byLanguage[language] = mean(subset.map((s) => s.composite as number));
  }

  const metrics = allTurns.map((t) => t.metrics).filter((m): m is NonNullable<typeof m> => m !== null);
  const health = metrics.reduce(
    (acc, m) => ({
      native: acc.native + (m.toolCallHealth?.native ?? 0),
      recovered: acc.recovered + (m.toolCallHealth?.recoveredFromText ?? 0),
      malformed: acc.malformed + (m.toolCallHealth?.malformed ?? 0),
    }),
    { native: 0, recovered: 0, malformed: 0 },
  );
  const healthTotal = health.native + health.recovered + health.malformed;

  const judgeFailures = runs.reduce(
    (sum, run) => sum + Object.values(run.judges).filter((j) => !j.ok).length,
    0,
  );
  const disagreements = scenarioScores
    .map((s) => s.judgeDisagreement)
    .filter((v): v is number => typeof v === 'number');

  // Each judge's own mean, over the dimensions that actually applied.
  const judgedByJudge: Record<string, Aggregate> = {};
  const judgeIds = new Set(runs.flatMap((run) => Object.keys(run.judges)));
  for (const judgeId of judgeIds) {
    const values: number[] = [];
    for (const run of runs) {
      const verdict = run.judges[judgeId];
      if (!verdict?.ok) continue;
      for (const dimension of JUDGED_DIMENSIONS) {
        if (!judgedDimensionApplies(run, dimension.key)) continue;
        const score = verdict.scores[dimension.key]?.score;
        if (typeof score === 'number') values.push(score / 5);
      }
    }
    judgedByJudge[judgeId] = mean(values);
  }

  return {
    modelId,
    scenariosRun: runs.length,
    scenariosOk: runs.filter((r) => r.status === 'OK').length,
    scenariosErrored: runs.filter((r) => r.status === 'ERROR').length,
    turnsRun: allTurns.length,
    dimensions,
    categories,
    composite: compositeWeight > 0 ? compositeSum / compositeWeight : null,
    timestampFabrication: {
      failedTurns: gateFailedTurns.length,
      totalTurns: allTurns.length,
      rate: allTurns.length === 0 ? 0 : gateFailedTurns.length / allTurns.length,
      findings: gateFindings,
      passedGate: gateFailedTurns.length === 0,
    },
    wrongDayResolution: {
      failedTurns: wrongDayFailedTurns.length,
      applicableTurns: wrongDayApplicableTurns.length,
      rate: wrongDayApplicableTurns.length === 0 ? null : wrongDayFailedTurns.length / wrongDayApplicableTurns.length,
      findings: wrongDayFindings,
      passedGate: wrongDayFailedTurns.length === 0,
    },
    passedAllGates: gateFailedTurns.length === 0 && wrongDayFailedTurns.length === 0,
    timeToFirstToken: latency(metrics.map((m) => m.timeToFirstTokenMs)),
    totalLatency: latency(allTurns.map((t) => t.turnLatencyMs)),
    tokensPerSecond: numeric(metrics.map((m) => m.tokensPerSecond)),
    promptTokens: numericWithMax(metrics.map((m) => m.promptTokens)),
    generatedTokens: numeric(metrics.map((m) => m.generatedTokens)),
    contextUtilization: numericWithMax(metrics.map((m) => m.contextUtilization)),
    malformedToolCallRate: healthTotal === 0 ? null : health.malformed / healthTotal,
    toolCallHealth: health,
    judgeDisagreement: disagreements.length === 0 ? null : mean(disagreements).score,
    judgeFailures,
    judgedByJudge,
    byLanguage,
  };
}

// ---------------------------------------------------------------------------

function latency(values: ReadonlyArray<number | null>): LatencyStats {
  const present = values.filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
  if (present.length === 0) return { n: 0, meanMs: null, p50Ms: null, p95Ms: null };
  return {
    n: present.length,
    meanMs: present.reduce((a, b) => a + b, 0) / present.length,
    p50Ms: percentile(present, 0.5),
    p95Ms: percentile(present, 0.95),
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] as number;
}

function numeric(values: ReadonlyArray<number | null>): { n: number; mean: number | null } {
  const present = values.filter((v): v is number => typeof v === 'number');
  return { n: present.length, mean: present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length };
}

function numericWithMax(values: ReadonlyArray<number | null>): { n: number; mean: number | null; max: number | null } {
  const present = values.filter((v): v is number => typeof v === 'number');
  if (present.length === 0) return { n: 0, mean: null, max: null };
  return {
    n: present.length,
    mean: present.reduce((a, b) => a + b, 0) / present.length,
    max: Math.max(...present),
  };
}

export { TIMESTAMP_FABRICATION_GATE, WRONG_DAY_RESOLUTION_GATE };
