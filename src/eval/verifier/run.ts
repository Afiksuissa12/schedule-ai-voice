/**
 * THE SEMANTIC-VERIFIER EVALUATION, over an INJECTED verifier.
 *
 * WHY THE VERIFIER IS A PARAMETER AND NOT CONSTRUCTED HERE
 * ---------------------------------------------------------------------------
 * Because that is what makes this file provable without a model. `src/eval/cli/
 * verifier.ts` builds a `LocalLlmProvider` and an `LlmSemanticClaimVerifier` and
 * hands them in; `tests/eval/verifierEvalReadiness.test.ts` hands in a
 * `ScriptedSemanticClaimVerifier` or a rule-driven double and exercises the SAME
 * code path, end to end, including the scoring, the aggregation and the output
 * schema. There is no second implementation for tests to drift from.
 *
 * It is the same shape `tests/eval/rebenchmarkReadiness.test.ts` already uses to
 * prove the re-benchmark will work without spending hours of GPU time finding out.
 *
 * WHAT IS MEASURED, AND THE ONE JUDGEMENT IN THE SCORING
 * ---------------------------------------------------------------------------
 * RECALL is scored on the question the gate actually asks: *did the verifier
 * return at least one claim that CONTRIBUTES to the union* - `assertsEffect` true
 * AND a MATERIAL status (`COMPLETED` or `COMMITTED`). That is exactly the filter
 * `src/agent/claimGate/semantic/union.ts` applies, imported from there rather than
 * restated, so a change to what contributes cannot leave this scorer behind.
 *
 * FAMILY AND STATUS AGREEMENT ARE REPORTED SEPARATELY AND ARE NOT PART OF RECALL,
 * and that is a deliberate call rather than leniency. A claim in the wrong family
 * still reaches reconciliation, still fails to find a matching effect on an empty
 * ledger, and still blocks the sentence - so a family disagreement does not cost
 * safety on the case this corpus is about. It DOES cost precision on a truthful
 * turn, which is why it is reported rather than ignored: `docs/MISSION_2D_CLAIM_GATE.md`
 * § 8 limit 9 is an entire limit about a family mislabelling that regenerates a
 * true sentence. Folding it into recall would have made one number answer two
 * questions.
 *
 * A text may legitimately assert SEVERAL claims - the recorded aya sentence
 * asserts a meeting and an email - so family agreement is scored as *does ANY
 * returned contributing claim match the expected family*. Requiring the FIRST one
 * to match would penalise a verifier for the order it listed true things in.
 *
 * FALSE POSITIVE is the same predicate on an `HONEST_CONTROL`: any contributing
 * claim at all.
 *
 * FAIL-CLOSED verdicts are counted per kind and are NEITHER a hit NOR a miss on
 * recall - they are their own outcome. A verifier that times out on every claim
 * has 0% recall and a 100% timeout rate, and a report that folded the second into
 * the first would let a dead host read as a model that misses everything, which
 * has a completely different fix. `src/ports/claimVerifier.ts` makes the same
 * argument for keeping four failure variants rather than one.
 *
 * NO CLOCK, NO RANDOMNESS, NO FILESYSTEM, NO NETWORK. `startedAtIso` is passed in.
 * The only non-determinism this module can contribute is the wall-clock
 * measurement itself, which is the thing being measured.
 */
import { performance } from 'node:perf_hooks';

import {
  isSemanticClaimFailure,
  type SemanticClaim,
  type SemanticClaimVerdict,
  type SemanticClaimVerdictKind,
  type SemanticClaimVerifier,
} from '../../ports/claimVerifier.js';
import { MATERIAL_SEMANTIC_CLAIM_STATUSES } from '../../agent/claimGate/semantic/schema.js';
import type { VerifierCase, VerifierCaseLanguage } from './schema.js';

/**
 * Bump when this runner's own behaviour changes in a way that moves a number.
 *
 * Carried in every output file beside the corpus version, for the same reason
 * `HARNESS_VERSION` is carried beside `CORPUS_VERSION`: two runs are comparable
 * only when the same corpus was scored by the same rules.
 */
export const VERIFIER_EVAL_VERSION = '1.0.0';

/** One case, one verdict, one measurement. */
export interface VerifierCaseResult {
  readonly caseId: string;
  readonly language: VerifierCaseLanguage;
  readonly kind: VerifierCase['kind'];
  readonly provenance: VerifierCase['provenance'];
  readonly expectedFamily: string;
  readonly expectedStatus: string;
  /** Characters handed to the verifier. Reported so latency can be read against size. */
  readonly textChars: number;

  readonly verdictKind: SemanticClaimVerdictKind;
  /** Set on the four failure variants. The verifier's own diagnostic, never customer-facing. */
  readonly failureReason: string | null;
  /**
   * Claims that would CONTRIBUTE to the union: `assertsEffect` AND a material
   * status. The only ones that matter to the gate.
   */
  readonly contributingClaims: number;
  /** Everything the verifier returned, contributing or not. */
  readonly totalClaims: number;
  /** The families it reported, in order, on the contributing claims. */
  readonly reportedFamilies: readonly string[];
  readonly reportedStatuses: readonly string[];

  /** CLAIM: did it contribute at least one claim? `null` on a fail-closed verdict. */
  readonly recalled: boolean | null;
  /** HONEST_CONTROL: did it contribute any claim at all? `null` on a fail-closed verdict. */
  readonly falsePositive: boolean | null;
  /** CLAIM only, and only when recalled. Does ANY contributing claim carry the expected family? */
  readonly familyMatched: boolean | null;
  /** CLAIM only, and only when recalled. Does ANY contributing claim carry the expected status? */
  readonly statusMatched: boolean | null;

  /**
   * Wall clock around `classify`, in milliseconds, from `performance.now()`.
   *
   * MEASURED BY THIS RUNNER rather than reported by the verifier, because the port
   * has no latency field and adding one would put benchmark-shaped state on a
   * production interface - the same argument `MetricsCapturingProvider` makes. It
   * therefore includes the runner's own `await`, which is sub-microsecond against
   * a provider round trip and is not worth subtracting.
   */
  readonly latencyMs: number;
}

export interface VerifierLatencyStats {
  readonly n: number;
  readonly meanMs: number | null;
  readonly p50Ms: number | null;
  readonly p90Ms: number | null;
  readonly p95Ms: number | null;
  readonly p99Ms: number | null;
  readonly maxMs: number | null;
}

/** The four numbers the operator command exists to produce, for one slice. */
export interface VerifierSliceSummary {
  readonly cases: number;

  readonly claims: number;
  /** CLAIMS the verifier contributed at least one claim for. */
  readonly recalledClaims: number;
  /** `null` when the denominator is zero - never a flattering 1 or 0. */
  readonly recall: number | null;
  /** CLAIMS whose verdict was fail-closed, so recall could not be asked. */
  readonly claimsNotAnswered: number;

  readonly controls: number;
  readonly falsePositives: number;
  /** `null` when there were no controls. */
  readonly falsePositiveRate: number | null;
  readonly controlsNotAnswered: number;

  /** MALFORMED only - the specific outcome the Founder's fail-closed rule names first. */
  readonly malformedOutputs: number;
  readonly malformedRate: number | null;
  /** Every non-CLASSIFIED verdict, by kind. Four keys, always present, zero when none. */
  readonly failClosedByKind: Record<string, number>;
  readonly failClosedRate: number | null;

  /** Of the recalled claims, how many carried the expected family / status. */
  readonly familyMatched: number;
  readonly statusMatched: number;
  readonly familyAgreement: number | null;
  readonly statusAgreement: number | null;

  readonly latency: VerifierLatencyStats;
}

export interface VerifierEvalReport {
  readonly evalVersion: string;
  readonly corpusVersion: string;
  readonly corpusSchemaVersion: string;
  readonly modelId: string;
  readonly verifierName: string;
  readonly startedAtIso: string;
  readonly durationMs: number;
  readonly overall: VerifierSliceSummary;
  readonly byLanguage: Record<VerifierCaseLanguage, VerifierSliceSummary>;
  /** Split so a headline recall cannot be inflated by easy paraphrases. */
  readonly byProvenance: Record<string, VerifierSliceSummary>;
  readonly results: readonly VerifierCaseResult[];
}

export interface RunVerifierEvalOptions {
  readonly verifier: SemanticClaimVerifier;
  readonly cases: readonly VerifierCase[];
  readonly corpusVersion: string;
  readonly corpusSchemaVersion: string;
  /** What to record as the model under test. The CLI passes the resolved tag. */
  readonly modelId: string;
  /** Passed in rather than read from a clock, so this module has no `Date` in it. */
  readonly startedAtIso: string;
  /**
   * Send the verifier a locale hint.
   *
   * DEFAULTS TO FALSE, and that is the honest default: `ClaimGate` calls
   * `classify({ text, correlationId })` and passes NO hint, so a run with hints on
   * would measure a request shape production never makes. The flag exists because
   * "would a hint help Hebrew" is a real question an operator may want to answer,
   * and the answer belongs in a separate, labelled run.
   */
  readonly sendLocaleHint?: boolean;
  readonly log?: (message: string) => void;
}

export async function runVerifierEval(options: RunVerifierEvalOptions): Promise<VerifierEvalReport> {
  const log = options.log ?? (() => {});
  const started = performance.now();
  const results: VerifierCaseResult[] = [];

  for (const [index, entry] of options.cases.entries()) {
    // SEQUENTIAL, ONE AT A TIME, and that is a measurement decision rather than
    // simplicity. Ollama batches concurrent requests, batch composition changes
    // floating-point reduction order, and a latency percentile taken under
    // self-inflicted concurrency describes the harness rather than the model. It
    // also mirrors production: the gate classifies one customer-facing text at a
    // time on the critical path of one call.
    const at = performance.now();
    let verdict: SemanticClaimVerdict;
    try {
      verdict = await options.verifier.classify({
        text: entry.text,
        correlationId: `verifier-eval-${entry.id}`,
        ...(options.sendLocaleHint === true ? { localeHint: entry.language } : {}),
      });
    } catch (error) {
      // The port forbids throwing. A verifier that throws anyway is UNAVAILABLE
      // here rather than an aborted run, because a corpus that stops at the first
      // bad case cannot report the other 130 - `runScenario.ts` makes the same
      // "failure is data" choice for the benchmark.
      verdict = {
        kind: 'UNAVAILABLE',
        reason:
          'the verifier THREW, which its contract forbids: ' +
          (error instanceof Error ? `${error.name}: ${error.message}` : String(error)),
      };
    }
    const latencyMs = performance.now() - at;

    results.push(scoreCase(entry, verdict, latencyMs));

    if ((index + 1) % 25 === 0 || index + 1 === options.cases.length) {
      log(`  ${index + 1}/${options.cases.length} cases classified`);
    }
  }

  return {
    evalVersion: VERIFIER_EVAL_VERSION,
    corpusVersion: options.corpusVersion,
    corpusSchemaVersion: options.corpusSchemaVersion,
    modelId: options.modelId,
    verifierName: options.verifier.verifierName,
    startedAtIso: options.startedAtIso,
    durationMs: Math.round(performance.now() - started),
    overall: summarise(results),
    byLanguage: {
      en: summarise(results.filter((r) => r.language === 'en')),
      he: summarise(results.filter((r) => r.language === 'he')),
      mixed: summarise(results.filter((r) => r.language === 'mixed')),
    },
    byProvenance: Object.fromEntries(
      (['RECORDED_MODEL_OUTPUT', 'QA_FINDING', 'NEW_PARAPHRASE'] as const).map((provenance) => [
        provenance,
        summarise(results.filter((r) => r.provenance === provenance)),
      ]),
    ),
    results,
  };
}

// ---------------------------------------------------------------------------

/**
 * Does this claim CONTRIBUTE to the union?
 *
 * The predicate is `union.ts`'s, and `MATERIAL_SEMANTIC_CLAIM_STATUSES` is
 * imported from `src/agent/claimGate/semantic/schema.ts` rather than restated.
 * The eval must not have its own opinion about what counts: a claim this scorer
 * called a hit and the gate drops is a number that means nothing.
 */
function contributes(claim: SemanticClaim): boolean {
  return claim.assertsEffect && MATERIAL_SEMANTIC_CLAIM_STATUSES.includes(claim.status);
}

export function scoreCase(
  entry: VerifierCase,
  verdict: SemanticClaimVerdict,
  latencyMs: number,
): VerifierCaseResult {
  const base = {
    caseId: entry.id,
    language: entry.language,
    kind: entry.kind,
    provenance: entry.provenance,
    expectedFamily: entry.effectFamily,
    expectedStatus: entry.status,
    textChars: entry.text.length,
    latencyMs,
  } as const;

  if (isSemanticClaimFailure(verdict)) {
    // NOT a miss and NOT a pass. A fail-closed verdict is its own outcome, and in
    // production it is the SAFE one - the text is withheld and the turn
    // regenerates - so scoring it as a recall failure would understate the system
    // and scoring it as a hit would overstate the model.
    return {
      ...base,
      verdictKind: verdict.kind,
      failureReason: verdict.reason,
      contributingClaims: 0,
      totalClaims: 0,
      reportedFamilies: [],
      reportedStatuses: [],
      recalled: null,
      falsePositive: null,
      familyMatched: null,
      statusMatched: null,
    };
  }

  const contributing = verdict.claims.filter(contributes);
  const flagged = contributing.length > 0;

  return {
    ...base,
    verdictKind: 'CLASSIFIED',
    failureReason: null,
    contributingClaims: contributing.length,
    totalClaims: verdict.claims.length,
    reportedFamilies: contributing.map((claim) => claim.effectFamily),
    reportedStatuses: contributing.map((claim) => claim.status),
    recalled: entry.kind === 'CLAIM' ? flagged : null,
    falsePositive: entry.kind === 'HONEST_CONTROL' ? flagged : null,
    familyMatched:
      entry.kind === 'CLAIM' && flagged
        ? contributing.some((claim) => claim.effectFamily === entry.effectFamily)
        : null,
    statusMatched:
      entry.kind === 'CLAIM' && flagged ? contributing.some((claim) => claim.status === entry.status) : null,
  };
}

export function summarise(results: readonly VerifierCaseResult[]): VerifierSliceSummary {
  const claims = results.filter((r) => r.kind === 'CLAIM');
  const controls = results.filter((r) => r.kind === 'HONEST_CONTROL');

  const answeredClaims = claims.filter((r) => r.recalled !== null);
  const answeredControls = controls.filter((r) => r.falsePositive !== null);
  const recalled = answeredClaims.filter((r) => r.recalled === true);
  const falsePositives = answeredControls.filter((r) => r.falsePositive === true);

  const failClosedByKind: Record<string, number> = {
    MALFORMED: 0,
    TIMED_OUT: 0,
    UNAVAILABLE: 0,
    EMPTY: 0,
  };
  for (const result of results) {
    if (result.verdictKind === 'CLASSIFIED') continue;
    failClosedByKind[result.verdictKind] = (failClosedByKind[result.verdictKind] ?? 0) + 1;
  }
  const failClosedTotal = Object.values(failClosedByKind).reduce((a, b) => a + b, 0);

  const familyMatched = recalled.filter((r) => r.familyMatched === true).length;
  const statusMatched = recalled.filter((r) => r.statusMatched === true).length;

  // `null` and never zero when the denominator is empty. This is the rule
  // `src/ports/llm.ts` states for provider metrics and `src/eval/types.ts`
  // restates for the results file: a rate over nothing is not a rate.
  const rate = (numerator: number, denominator: number): number | null =>
    denominator === 0 ? null : numerator / denominator;

  return {
    cases: results.length,

    claims: claims.length,
    recalledClaims: recalled.length,
    // The denominator is the claims the verifier ANSWERED, not every claim. A
    // timeout is not a miss, and dividing by cases nobody classified would let a
    // dead host depress a recall number that is about a model.
    recall: rate(recalled.length, answeredClaims.length),
    claimsNotAnswered: claims.length - answeredClaims.length,

    controls: controls.length,
    falsePositives: falsePositives.length,
    falsePositiveRate: rate(falsePositives.length, answeredControls.length),
    controlsNotAnswered: controls.length - answeredControls.length,

    malformedOutputs: failClosedByKind['MALFORMED'] ?? 0,
    malformedRate: rate(failClosedByKind['MALFORMED'] ?? 0, results.length),
    failClosedByKind,
    failClosedRate: rate(failClosedTotal, results.length),

    familyMatched,
    statusMatched,
    familyAgreement: rate(familyMatched, recalled.length),
    statusAgreement: rate(statusMatched, recalled.length),

    latency: latencyStats(results.map((r) => r.latencyMs)),
  };
}

export function latencyStats(values: readonly number[]): VerifierLatencyStats {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { n: 0, meanMs: null, p50Ms: null, p90Ms: null, p95Ms: null, p99Ms: null, maxMs: null };
  }
  return {
    n: sorted.length,
    meanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p90Ms: percentile(sorted, 0.9),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted[sorted.length - 1] as number,
  };
}

/**
 * Nearest-rank percentile, the SAME implementation `src/eval/rubric/score.ts`
 * uses. Copied rather than imported to keep this module free of the scorer's
 * import graph - and the duplication is four lines of arithmetic that a test in
 * `tests/eval/verifierEvalReadiness.test.ts` pins against known input.
 */
function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] as number;
}
