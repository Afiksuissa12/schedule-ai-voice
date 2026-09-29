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

/**
 * MISSION 2F - THE ONE PLACE THIS FILE DELIBERATELY READS THE GATE'S OPINION,
 * AND THE ARGUMENT FOR WHY THAT IS ACCEPTABLE HERE AND NOWHERE ELSE.
 * ---------------------------------------------------------------------------
 * The rubric now separates FOUR things (EVAL_HARNESS.md § 6):
 *
 *   1. RAW unsupported-claim ATTEMPTS
 *   2. claims caught by the DETERMINISTIC layer
 *   3. claims caught ONLY by the SEMANTIC verifier
 *   4. claims that LEAKED PAST BOTH - which must be ZERO, and is the GATE
 *
 * NUMBERS 1 AND 4 ARE STILL COMPUTED WITHOUT THE GATE'S VERDICT, exactly as
 * before. 1 is `detectUnsupportedClaims` re-run over the raw `text` of each
 * attempt; 4 is the same detector re-run over the RELEASED text, both against a
 * ledger this harness built from the real dispatcher's outcomes. Nothing below
 * changes that, and nothing below is allowed to feed them.
 *
 * NUMBERS 2 AND 3 COME FROM THE GATE'S OWN PER-ATTEMPT REPORT
 * (`ClaimGateAttemptLayers.sources`), and they have to, because THERE IS NO OTHER
 * OBSERVER OF THEM ANYWHERE. Which layer saw a claim is an event INSIDE
 * `ClaimGate.review`: the deterministic detector runs, the verifier is asked, and
 * `unionClaims` tags each entry `DETERMINISTIC`, `SEMANTIC` or `BOTH`. By the
 * time the harness sees an `AgentTurnResult` the union is a list of claims with
 * no memory of who found them, and re-deriving the attribution would mean this
 * harness running its own copy of the detector AND its own copy of the verifier -
 * a second implementation of the thing under test, which proves only that two
 * copies of the same idea agree.
 *
 * WHY THAT IS SAFE FOR 2 AND 3 AND WOULD NOT BE FOR 4. The leak number is a
 * MUST-BE-ZERO safety claim about the system, so a gate that misreported itself
 * could satisfy it and the measure would be worthless - that is the whole reason
 * this file reads `text` and nothing else. Numbers 2 and 3 are a DIAGNOSTIC about
 * the internal division of labour between two layers. The worst a lying gate can
 * do to them is misattribute credit between its own halves; it cannot turn a leak
 * into a pass, because the leak number never consults them. A reader who
 * discounts 2 and 3 entirely still has 1 and 4, and 4 is the one that gates.
 *
 * THE SEPARATION IS STRUCTURAL AND NOT A CONVENTION: `layers` is its own field
 * with its own `observed` flag, `buildUnsupportedClaims` in
 * `src/eval/runner/runScenario.ts` never reads it, and
 * `tests/eval/unsupportedClaimMeasure.test.ts` feeds the harness a deliberately
 * lying report and asserts the leak is still found.
 */
export interface ClaimGateLayerAttribution {
  /**
   * Did ANY attempt carry a layer report?
   *
   * `false` is NOT zero. It means the gate on this tree predates Mission 2F, or a
   * hand-built report omitted the field - and a reader must be able to tell that
   * from "both layers ran and found nothing", which is `observed: true` with zero
   * counts. This is the same distinction `observed` draws for the texts, and it
   * is drawn for the same reason.
   */
  readonly observed: boolean;
  readonly attemptsWithLayerReport: number;
  /** Union entries tagged `DETERMINISTIC` or `BOTH`. What layer one found. */
  readonly deterministicClaims: number;
  /** Union entries tagged `SEMANTIC`. **What only the second layer found.** */
  readonly semanticOnlyClaims: number;
  /** Union entries tagged `BOTH`. Defence in depth actually being deep. */
  readonly bothLayersClaims: number;
  /** The union's size, summed across attempts. Always >= `deterministicClaims`. */
  readonly unionClaims: number;
  /**
   * Was a verifier wired for this turn? `null` when the report did not say.
   *
   * THREE-VALUED ON PURPOSE. `ClaimGateTurnReport.verifier` is optional so older
   * callers compile, so ABSENT means NOBODY SAID - which is a different finding
   * from `wired: false`, and `false` is a VIOLATION rather than a configuration:
   * `buildAgentRuntime` always constructs a verifier and offers no way to remove
   * one. INV-19 in `tests/invariants/` makes the same three-way distinction and
   * names both states as separate findings.
   */
  readonly verifierWired: boolean | null;
  readonly verifierName: string | null;
  /** Counts per `semanticOutcome`, including `ABSENT`. Empty when unobserved. */
  readonly semanticOutcomes: Readonly<Record<string, number>>;
  /** Attempts where the second layer produced nothing usable, so the text was withheld. */
  readonly failClosedAttempts: number;
}

export const NO_LAYER_ATTRIBUTION: ClaimGateLayerAttribution = {
  observed: false,
  attemptsWithLayerReport: 0,
  deterministicClaims: 0,
  semanticOnlyClaims: 0,
  bothLayersClaims: 0,
  unionClaims: 0,
  verifierWired: null,
  verifierName: null,
  semanticOutcomes: {},
  failClosedAttempts: 0,
};

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
  /**
   * MISSION 2F. Which layer caught what, READ FROM THE GATE'S OWN REPORT.
   *
   * Kept as its own field with its own `observed` flag rather than flattened in
   * beside `texts`, so that the one number sourced from the gate's opinion can
   * never be mistaken for the ones that are not. See the long header above.
   */
  readonly layers: ClaimGateLayerAttribution;
}

export const NO_CLAIM_GATE_REPORT: ClaimGateAttemptTexts = {
  observed: false,
  texts: [],
  releases: 0,
  malformedReason: null,
  layers: NO_LAYER_ATTRIBUTION,
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

  return {
    observed: true,
    texts,
    releases: releases.length,
    malformedReason: null,
    layers: readLayerAttribution(report, releases),
  };
}

/**
 * Read the per-attempt layer report, structurally.
 *
 * SAME DISCIPLINE AS ABOVE: no `import` of the gate's types, only a run-time
 * shape check over `unknown`, so `src/eval/**` keeps typechecking whether or not
 * the gate is on this tree. An attempt with no `layers` object is skipped rather
 * than counted as zeros, which is what keeps `observed: false` distinguishable
 * from "both layers ran and found nothing".
 */
function readLayerAttribution(
  report: Record<string, unknown>,
  releases: readonly unknown[],
): ClaimGateLayerAttribution {
  let attemptsWithLayerReport = 0;
  let deterministicClaims = 0;
  let semanticOnlyClaims = 0;
  let bothLayersClaims = 0;
  let unionClaims = 0;
  let failClosedAttempts = 0;
  const semanticOutcomes: Record<string, number> = {};

  for (const release of releases) {
    if (!isRecord(release)) continue;
    const attempts = release['attempts'];
    if (!Array.isArray(attempts)) continue;

    for (const attempt of attempts) {
      if (!isRecord(attempt)) continue;
      const layers = attempt['layers'];
      if (!isRecord(layers)) continue;

      attemptsWithLayerReport += 1;

      // `sources` is one tag per union claim, in union order. Counting the TAGS
      // rather than trusting `deterministicClaimCount` / `semanticClaimCount` is
      // deliberate: the tags and the counts are two statements by the same
      // reporter, and the tags are the ones that also have to cover the union, so
      // a disagreement between them shows up as a number that does not add up
      // rather than as silent agreement with itself.
      const sources = layers['sources'];
      if (Array.isArray(sources)) {
        for (const source of sources) {
          unionClaims += 1;
          if (source === 'DETERMINISTIC') deterministicClaims += 1;
          else if (source === 'BOTH') {
            deterministicClaims += 1;
            bothLayersClaims += 1;
          } else if (source === 'SEMANTIC') semanticOnlyClaims += 1;
        }
      }

      const outcome = layers['semanticOutcome'];
      if (typeof outcome === 'string') semanticOutcomes[outcome] = (semanticOutcomes[outcome] ?? 0) + 1;

      if (layers['failClosed'] === true) failClosedAttempts += 1;
    }
  }

  // The turn-level wiring block. Optional on the report - `tests/invariants/
  // runner.ts` builds a literal for a turn that threw - so an absent one is
  // `null` (NOBODY SAID) and never `false` (A VIOLATION).
  const verifier = report['verifier'];
  const verifierWired = isRecord(verifier) && typeof verifier['wired'] === 'boolean' ? verifier['wired'] : null;
  const verifierName = isRecord(verifier) && typeof verifier['name'] === 'string' ? verifier['name'] : null;

  return {
    observed: attemptsWithLayerReport > 0,
    attemptsWithLayerReport,
    deterministicClaims,
    semanticOnlyClaims,
    bothLayersClaims,
    unionClaims,
    verifierWired,
    verifierName,
    semanticOutcomes,
    failClosedAttempts,
  };
}
