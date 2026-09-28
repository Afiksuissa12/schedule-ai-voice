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
 * MISSION 2G: THREE LAYERS ARE REPORTED, NOT ONE
 * ---------------------------------------------------------------------------
 * The Founder requires semantic-only AND layered numbers, per language, and the
 * harness reported only the semantic layer. So for every case this runner also
 * runs the PURE deterministic detector over the same text and combines the two
 * through the REAL `unionClaims`:
 *
 *   detectMaterialClaims(text)  ->  the first layer, imported from
 *                                   `src/agent/claimGate/detector.ts`
 *   verifier.classify(text)     ->  the second layer
 *   unionClaims({...})          ->  the union, imported from
 *                                   `src/agent/claimGate/semantic/union.ts`
 *
 * BOTH ARE IMPORTED AND NEITHER IS REIMPLEMENTED, and that is the whole argument
 * for the layered number being worth anything. `docs/MISSION_2F_SEMANTIC_VERIFIER.md`
 * § 10.3 makes the same point about the benchmark's leak count: a harness running
 * its own second copy of an idea proves only that two copies of the same idea
 * agree. The union's additive property - every deterministic claim, entire, in
 * order, by object identity - is `unionClaims`'s own and is proved in
 * `tests/agent/semanticClaimUnion.test.ts`, not here.
 *
 * NEITHER OF THOSE TWO IMPORTS NEEDS A MODEL. `detectMaterialClaims` is pure and
 * `unionClaims` is pure, so the whole layered table is provable against the same
 * verifier doubles the semantic table is - which is what
 * `tests/eval/verifierLayeredReporting.test.ts` does.
 *
 * THE THREE DENOMINATORS ARE NOT THE SAME, AND THAT IS NOT A BUG.
 * The deterministic layer ALWAYS answers: it is pure code and has no failure
 * mode, so its denominator is every claim. The semantic layer can fail closed, so
 * its denominator is the claims it ANSWERED. The layered figure is answerable on
 * every case - the deterministic half answered - so its denominator is every claim
 * too. A run with fail-closures therefore has a semantic recall over a smaller
 * denominator than the other two, and the output says so in words rather than
 * leaving a reader to divide and wonder.
 *
 * A FAIL-CLOSED VERDICT IS NEVER COUNTED AS A LAYERED HIT. In production it
 * blocks, so it is safe; but counting it as recall would let a dead Ollama print
 * as a working gate, which is the exact failure mode § 12.3 residual 13 is about.
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
import { detectMaterialClaims } from '../../agent/claimGate/detector.js';
import { unionClaims } from '../../agent/claimGate/semantic/union.js';
import { MATERIAL_SEMANTIC_CLAIM_STATUSES } from '../../agent/claimGate/semantic/schema.js';
import type { VerifierCase, VerifierCaseLanguage } from './schema.js';

/**
 * Bump when this runner's own behaviour changes in a way that moves a number.
 *
 * Carried in every output file beside the corpus version, for the same reason
 * `HARNESS_VERSION` is carried beside `CORPUS_VERSION`: two runs are comparable
 * only when the same corpus was scored by the same rules.
 *
 * `2.0.0` is Mission 2G: the layered-union reporting above. Every 1.0.0 number is
 * still computed identically, so the semantic columns of a 1.0.0 run and a 2.0.0
 * run ARE comparable - but the file gained three whole quantities and a reader who
 * saw only the old shape would not know the new ones existed.
 */
export const VERIFIER_EVAL_VERSION = '2.0.0';

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

  // ---- MISSION 2G: THE OTHER TWO LAYERS ----------------------------------

  /** How many claims the PURE deterministic detector found in this text. */
  readonly deterministicClaims: number;
  /** Did the deterministic layer flag this text at all? NEVER null: pure code always answers. */
  readonly deterministicFlagged: boolean;
  /** Size of the REAL `unionClaims` output for this case. */
  readonly unionClaims: number;
  /** Did the LAYERED union carry at least one claim? Never null, for the same reason. */
  readonly layeredFlagged: boolean;
  /**
   * `unionClaims`'s own `failClosed`, carried through rather than recomputed.
   *
   * True for all four semantic failure variants. In production it BLOCKS the text,
   * so it is the safe outcome - but it is not a demonstration that either layer
   * read the sentence, which is why `layeredFlagged` above ignores it.
   */
  readonly unionFailClosed: boolean;
  /** `semanticContributingCount` from the union: claims the second layer added ALONE. */
  readonly semanticOnlyClaims: number;

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

  // ---- MISSION 2G: THE LAYERED FIGURES -----------------------------------
  // THREE recalls and THREE false-positive rates, so that "what did the second
  // layer ADD" is a subtraction a reader can do rather than a claim they have to
  // accept. `recall` and `falsePositiveRate` above are the SEMANTIC-ONLY ones and
  // are unchanged, deliberately: a 1.0.0 artefact and a 2.0.0 artefact still mean
  // the same thing by the same key.

  /** Claims the PURE detector flagged. Denominator is `claims` - pure code always answers. */
  readonly deterministicRecalledClaims: number;
  readonly deterministicRecall: number | null;
  /** Claims the LAYERED union flagged. Denominator is `claims`, for the same reason. */
  readonly layeredRecalledClaims: number;
  readonly layeredRecall: number | null;

  readonly deterministicFalsePositives: number;
  readonly deterministicFalsePositiveRate: number | null;
  readonly layeredFalsePositives: number;
  readonly layeredFalsePositiveRate: number | null;

  /**
   * CLAIMS MISSED BY BOTH LAYERS, with the semantic layer having ANSWERED.
   *
   * **This is the number this mission is judged on.** Both readers looked at the
   * sentence and neither reported anything, so in production the text would have
   * been released. The ids are carried beside the count because a count nobody can
   * check against rows is not evidence - the same rule EVAL_HARNESS.md § 8 states
   * for transcripts.
   */
  readonly missedByBothClaims: number;
  readonly missedByBothCaseIds: readonly string[];

  /**
   * CLAIMS MISSED BY THE DETECTOR WHERE THE SEMANTIC LAYER FAILED CLOSED.
   *
   * Counted SEPARATELY and never folded into the number above, because these are
   * not leaks: a fail-closed verdict blocks the text and hands the turn off. They
   * are also not recall. A run with a large number here measured a sick host, and
   * the fix is a host fix rather than an instruction fix.
   */
  readonly missedByDetectorAndUnansweredClaims: number;
  readonly missedByDetectorAndUnansweredCaseIds: readonly string[];

  /** Claims the SECOND layer contributed that the first did not have. The value added. */
  readonly semanticOnlyRecalledClaims: number;
}

export interface VerifierEvalReport {
  readonly evalVersion: string;
  readonly corpusVersion: string;
  readonly corpusSchemaVersion: string;
  /**
   * WHICH SPLIT THIS RUN MEASURED - `dev`, `heldout` or `all`. Mission 2G.
   *
   * IN THE REPORT AND IN THE OUTPUT FILE NAME BOTH, and the duplication is the
   * point: a dev number and a held-out number answer different questions, and a
   * file that did not say which one it was would be indistinguishable from the
   * other after the fact. `verifierResultsPath` puts it in the filename so the
   * distinction survives somebody copying one file out of a directory.
   */
  readonly split: string;
  /**
   * WHERE THE CORPUS CAME FROM. `in-repo`, or the resolved absolute path of a
   * `--corpus-file`.
   */
  readonly corpusSource: string;
  /** sha256 of the external corpus file's BYTES, or `null` for the in-repo corpus. */
  readonly corpusSha256: string | null;
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
  /** Mission 2G. `dev` / `heldout` / `all`. Recorded verbatim; defaults to `all`. */
  readonly split?: string;
  /** Mission 2G. `in-repo`, or the resolved path of a `--corpus-file`. */
  readonly corpusSource?: string;
  /** Mission 2G. sha256 of the external corpus bytes; `null` for the in-repo corpus. */
  readonly corpusSha256?: string | null;
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

    // THE LATENCY IS TAKEN BEFORE `scoreCase` RUNS, and that ordering is load
    // bearing now that `scoreCase` also runs the deterministic detector. The
    // reported number is still wall clock around ONE `classify` call and nothing
    // else. The detector costs a p50 of 0.022 ms on a short reply
    // (`docs/MISSION_2D_CLAIM_GATE_ASSURANCE.md` § 4.3), so it adds that much
    // between provider calls and nothing to any figure in the table.
    results.push(scoreCase(entry, verdict, latencyMs));

    if ((index + 1) % 25 === 0 || index + 1 === options.cases.length) {
      log(`  ${index + 1}/${options.cases.length} cases classified`);
    }
  }

  return {
    evalVersion: VERIFIER_EVAL_VERSION,
    corpusVersion: options.corpusVersion,
    corpusSchemaVersion: options.corpusSchemaVersion,
    // `all` when the caller said nothing, which matches `--split`'s default. It is
    // never left absent: a report with no split is a report nobody can place.
    split: options.split ?? 'all',
    corpusSource: options.corpusSource ?? 'in-repo',
    corpusSha256: options.corpusSha256 ?? null,
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
  // ---- THE FIRST LAYER AND THE UNION, both PURE and both IMPORTED ---------
  // Run here rather than in the loop above so that `scoreCase` remains the one
  // place a result is built and a test can exercise the whole scoring rule with
  // one call. Neither of these touches a clock, a socket or a model.
  const deterministic = detectMaterialClaims(entry.text);
  const union = unionClaims({ text: entry.text, deterministic, verdict });

  const base = {
    caseId: entry.id,
    language: entry.language,
    kind: entry.kind,
    provenance: entry.provenance,
    expectedFamily: entry.effectFamily,
    expectedStatus: entry.status,
    textChars: entry.text.length,
    latencyMs,
    deterministicClaims: deterministic.length,
    deterministicFlagged: deterministic.length > 0,
    unionClaims: union.claims.length,
    layeredFlagged: union.claims.length > 0,
    unionFailClosed: union.failClosed,
    semanticOnlyClaims: union.semanticContributingCount,
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

  // ---- MISSION 2G: the deterministic and layered tallies -------------------
  const deterministicRecalled = claims.filter((r) => r.deterministicFlagged);
  const layeredRecalled = claims.filter((r) => r.layeredFlagged);
  const deterministicFalsePositives = controls.filter((r) => r.deterministicFlagged);
  const layeredFalsePositives = controls.filter((r) => r.layeredFlagged);

  // THE NUMBER THIS MISSION IS JUDGED ON, and the one beside it that must not be
  // folded into it. `missedByBoth` is a real leak: both readers answered and
  // neither reported anything, so the text would have been released.
  // `missedUnanswered` is the detector missing a claim on a turn where the second
  // layer FAILED CLOSED - which blocks in production and is therefore not a leak,
  // and is not recall either.
  const missedByBoth = claims.filter((r) => !r.layeredFlagged && !r.unionFailClosed);
  const missedUnanswered = claims.filter((r) => !r.layeredFlagged && r.unionFailClosed);

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

    // ---- MISSION 2G: the other two layers, over the FULL claim denominator --
    // `claims.length` and not `answeredClaims.length`, because the deterministic
    // layer answered every one of them and the union therefore did too. The
    // asymmetry with `recall` above is deliberate and is stated in the module
    // header and in the output markdown.
    deterministicRecalledClaims: deterministicRecalled.length,
    deterministicRecall: rate(deterministicRecalled.length, claims.length),
    layeredRecalledClaims: layeredRecalled.length,
    layeredRecall: rate(layeredRecalled.length, claims.length),

    deterministicFalsePositives: deterministicFalsePositives.length,
    deterministicFalsePositiveRate: rate(deterministicFalsePositives.length, controls.length),
    layeredFalsePositives: layeredFalsePositives.length,
    layeredFalsePositiveRate: rate(layeredFalsePositives.length, controls.length),

    missedByBothClaims: missedByBoth.length,
    missedByBothCaseIds: missedByBoth.map((r) => r.caseId),
    missedByDetectorAndUnansweredClaims: missedUnanswered.length,
    missedByDetectorAndUnansweredCaseIds: missedUnanswered.map((r) => r.caseId),
    semanticOnlyRecalledClaims: claims.filter((r) => r.semanticOnlyClaims > 0).length,
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
