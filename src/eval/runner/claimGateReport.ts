/**
 * Reading the claim gate's report WITHOUT depending on the claim gate.
 *
 * WHY THIS FILE EXISTS AT ALL, AND WHY IT IMPORTS NOTHING
 * ---------------------------------------------------------------------------
 * The claim gate publishes a per-turn report on `AgentTurnResult`:
 *
 *   claimGate: {
 *     enabled: boolean,
 *     releases: [{
 *       iteration: number,
 *       attempts: [{ attempt, text, unsupportedClaims, supportedClaimCount }],
 *       releasedText, outcome
 *     }]
 *   }
 *
 * This harness wants exactly ONE thing out of it - the raw WORDING of each
 * pre-release attempt - and must not want anything else. Two independent reasons,
 * and both of them are the point rather than caution:
 *
 * 1. THE MEASURE MUST NOT ECHO THE GATE. `attempts[].unsupportedClaims` and
 *    `supportedClaimCount` are the gate's own verdict on its own behaviour. A
 *    leak number derived from them could be satisfied by a gate that lies about
 *    itself, and would then report zero leaks for a system that leaks. So this
 *    file reads `text` and nothing else, and the judgement on that text is made
 *    by `detectUnsupportedClaims` in `src/eval/rubric/programmatic.ts`, against a
 *    ledger this harness builds from the real dispatcher's outcomes.
 *
 * 2. SRC/EVAL MUST COMPILE WITHOUT THE GATE. The gate is built by a parallel
 *    task on a different branch. A benchmark that only typechecks once a sibling
 *    branch is merged is a benchmark that blocks the merge it is supposed to
 *    inform. So there is no `import` of the gate's types here and no structural
 *    duplicate of them - only a run-time shape check over `unknown`, which
 *    degrades to "not observable" when the field is absent.
 *
 * WHAT "NOT OBSERVABLE" MEANS, AND WHY IT IS NOT ZERO
 * ---------------------------------------------------------------------------
 * When the field is absent, the model's raw wording IS the released text: there
 * was no gate between them. So the attempts number is not unknown - it equals
 * the leak number - but the two are no longer INDEPENDENT observations, and a
 * report that presented them as two numbers would be presenting one number
 * twice. `observed: false` is carried all the way into `results.json` and
 * `COMPARISON.md` so a reader is told which situation they are looking at rather
 * than having to infer it from the numbers being equal.
 *
 * `enabled: false` IS THAT SAME SITUATION, AND IS READ AS SUCH
 * ---------------------------------------------------------------------------
 * Recorded at integration, because it is the one place this reader and the
 * landed gate could have disagreed silently. The gate reports
 * `{ enabled: false, releases: [] }` when it is not wired, and that is a
 * WELL-FORMED report - so a reader that only checked the shape would return
 * `observed: true` with zero texts and the harness would print an attempts
 * column of 0 beside a leak column that is not 0: a claim that leaked past a
 * gate it was never shown to. The field is not malformed and nothing lied; it
 * says plainly that no gate stood between the model and the caller, which is
 * exactly what `observed: false` means. So `enabled === false` is checked FIRST,
 * before the shape of `releases`, and yields the absent-report answer with no
 * `malformedReason` attached.
 *
 * `buildAgentRuntime` offers no way to reach it - it always constructs the gate,
 * and `INV-18` treats `enabled === false` as a sweep VIOLATION rather than as
 * inapplicable. The reachable path is `AgentTurnServiceOptions.claimGate: null`,
 * a test-only seam. This reader is therefore honest about a state the benchmark
 * should never see, instead of being silently wrong if it ever does.
 */

/** The raw pre-release wording, plus whether a report was there to read. */
export interface ClaimGateAttemptTexts {
  /**
   * True only when a well-formed report was present. False means the field was
   * absent or malformed, NOT that there were no attempts.
   */
  readonly observed: boolean;
  /**
   * Every attempt's text, in order, across every release of the turn.
   * `attempts[0]` of each release is the model's RAW ungated wording.
   */
  readonly texts: readonly string[];
  /** Releases the report described. Recorded so a reader can see it was read. */
  readonly releases: number;
  /** Set when a report was present but did not have the expected shape. */
  readonly malformedReason: string | null;
}

export const NO_CLAIM_GATE_REPORT: ClaimGateAttemptTexts = {
  observed: false,
  texts: [],
  releases: 0,
  malformedReason: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pull the attempt wording out of a turn result, structurally.
 *
 * Tolerant in one direction only: an absent report is a normal state and yields
 * `observed: false`, while a report that is PRESENT but the wrong shape yields
 * `observed: false` WITH a reason, because that is a contract change between two
 * tasks and must not read as "the gate was off".
 */
export function readClaimGateAttemptTexts(turnResult: unknown): ClaimGateAttemptTexts {
  if (!isRecord(turnResult)) return NO_CLAIM_GATE_REPORT;

  const report = turnResult['claimGate'];
  if (report === undefined || report === null) return NO_CLAIM_GATE_REPORT;

  if (!isRecord(report)) {
    return { ...NO_CLAIM_GATE_REPORT, malformedReason: 'claimGate was present but was not an object' };
  }

  // A gate that says it was off is the same observation as no gate at all, and
  // is not a contract violation - so no `malformedReason`. See the header.
  if (report['enabled'] === false) return NO_CLAIM_GATE_REPORT;

  const releases = report['releases'];
  if (!Array.isArray(releases)) {
    return { ...NO_CLAIM_GATE_REPORT, malformedReason: 'claimGate.releases was present but was not an array' };
  }

  const texts: string[] = [];
  for (const release of releases) {
    if (!isRecord(release)) continue;
    const attempts = release['attempts'];
    if (!Array.isArray(attempts)) continue;
    for (const attempt of attempts) {
      if (!isRecord(attempt)) continue;
      const text = attempt['text'];
      // An attempt whose text is null is a real state - a model that produced
      // no text - and contributes no claim rather than being dropped silently.
      if (typeof text === 'string') texts.push(text);
    }
  }

  return { observed: true, texts, releases: releases.length, malformedReason: null };
}
