/**
 * The machine-generated QA report.
 *
 * HONESTY IS THE FEATURE
 * ---------------------------------------------------------------------------
 * The mission says it plainly: "Silent truncation that reads as full coverage
 * is a defect in itself." So this renderer is built around reporting what was
 * NOT achieved as prominently as what was:
 *
 *  - `applicable` is tracked separately from `passed`, so an invariant that had
 *    nothing to examine shows as "0 checked" rather than as a green tick. An
 *    invariant with zero applicable checks is called out as VACUOUS, because a
 *    property that never applies to anything is not evidence of anything.
 *  - Every `ValidationErrorCode` the system can emit is listed, including the
 *    ones the sweep never provoked, with a zero beside them.
 *  - When the corpus was filtered, the report says so at the top instead of
 *    quietly presenting a subset as the whole.
 */
import { detectMaterialClaims } from '../../src/agent/claimGate/detector.js';
import { VALIDATION_ERROR_CODES } from '../../src/ports/validation.js';
import { compareWitnesses, WITNESS_AGREEMENT_MEANING, type WitnessAgreement } from '../invariants/claimOracle.js';
import { declarationFor, INVARIANTS } from '../invariants/invariants.js';
import type { InvariantResult } from '../invariants/invariants.js';
import type { ScenarioObservation } from '../invariants/runner.js';
import { FAMILY_PURPOSE, type Scenario } from '../invariants/scenarios.js';
import type { SweepResult } from '../invariants/sweep.js';

/**
 * Coverage this slice's sweep does NOT provide.
 *
 * Written by hand because an automated report cannot know what it was never
 * asked to do. Reproduced verbatim in `docs/DECISIONS.md` and in the final
 * mission report; if a gap is closed, it is deleted from here.
 */
export const KNOWN_COVERAGE_GAPS: readonly string[] = [
  'The corpus is a set of named families, not the full Cartesian product of every axis (which would be ' +
    '>800,000 cases). Each axis the mission names is crossed exhaustively in at least one family, but ' +
    'not every axis is crossed with every other - e.g. the four availability states are swept across all ' +
    'five timezones at ONE `now` instant, not all ten.',
  'DST gap and DST-ambiguous local times are supplied as explicit ISO local datetimes. The natural-' +
    'language path into a DST gap ("tomorrow at 2:30am" on a transition day) is not swept, because ' +
    'generating one per zone per transition means computing the transition, which is the logic under test.',
  'Only `schedule_followup`, `schedule_meeting`, `check_availability`, `update_qualification` and two ' +
    'fabricated-subject calls are driven. `reschedule_meeting`, `cancel_meeting` (on a REAL meeting), ' +
    '`record_call_outcome`, `transfer_to_human` and `get_contact_context` are covered by the sibling ' +
    'suites in tests/e2e and tests/agent, not by this sweep. `reschedule_meeting` accepts the same ' +
    'model-supplied `timezone` argument family J sweeps, so that tool\'s override path is proved by a unit ' +
    'test rather than across this matrix.',
  'Family J sweeps the model-asserted `timezone` axis at ONE `now` instant and under ONE policy ' +
    '(p1-default). Crossing it with all ten instants and all four policies would be 2,800 cases for an ' +
    'axis whose interesting behaviour - which window the instant is judged in - does not depend on either.',
  'No policy in this matrix pins `BusinessHoursPolicy.timezone`, so the `policy` branch of ' +
    '`businessHoursAnchor` (a business whose hours are its OWN clock regardless of where the contact is) ' +
    'is never taken here. It is covered by tests/scheduling/schedulingValidator.test.ts. Consequence worth ' +
    'stating: under such a policy a distant contact CAN be booked outside their own working hours - that ' +
    'is the documented meaning of pinning a zone, and it is a decision by whoever wrote the configuration ' +
    'row, not something a model can bring about.',
  'The sweep stops at persistence. `DueActionRunner` execution - claim, lease, dispatch, retry, backoff - ' +
    'is proved by tests/scheduling/dueActionRunner*.test.ts and is NOT re-swept per scenario here, so no ' +
    'scenario in this corpus places a call through the telephony double at all.',
  'Concurrency is not swept. Two agents racing the same idempotency key is covered by a dedicated test ' +
    'in tests/scheduling/meetingSchedulingService.test.ts, not across the matrix.',
  'The live OpenAI provider is not exercised. Every scenario runs against ScriptedLlmProvider, which is ' +
    'the point - but it means the sweep says nothing about whether a real model emits well-formed calls.',
  'BOUNDED DELIBERATELY: family L crosses its Hebrew and code-switched expressions with THREE zones ' +
    '(Asia/Jerusalem, America/New_York, Pacific/Auckland) and TWO `now` instants of its own, not with the ' +
    'five zones and ten instants families A-K use. Adding Asia/Jerusalem and Pacific/Auckland to the main ' +
    '`TIMEZONES` axis would have cost ~224 extra scenarios across seven families to re-prove ENGLISH ' +
    'behaviour at a different offset, on a sweep that already runs against real SQLite on a ' +
    'memory-constrained host. The consequence: the two zones family L adds are NOT crossed with families ' +
    'A-K, and the Hebrew expressions are not crossed with Europe/London, Australia/Sydney, Asia/Kolkata ' +
    'or UTC. tests/scheduling/localeParity.test.ts covers six zones and six instants at the resolver ' +
    'level, where a cell costs microseconds instead of a database.',
  'INV-16 (Hebrew/English parity) resolves the counterpart phrase through DateTimeResolver, which is the ' +
    'system under test - unlike INV-02 it is NOT an independent measurement. It cannot be: no oracle can ' +
    'know what a Hebrew phrase means without a Hebrew dictionary, and writing one inside the harness ' +
    'would be the reimplementation this design forbids. What it does assert is RELATIONAL (two phrasings ' +
    'agree) and tied to the front door (the persisted row must equal both). A change that broke both ' +
    'languages identically would pass INV-16 and fail tests/scheduling/naturalLanguage.test.ts, which ' +
    'pins English independently.',
  'INV-17 re-derives the named calendar day only for day anchors whose meaning is fixed arithmetic - ' +
    '`today`, `implicit_today`, `tonight`, `tomorrow`, `day_after_tomorrow` and `iso_date:*`. A ' +
    '`weekday:*`, `next_weekday:*` or `end_of_week` anchor is reported INAPPLICABLE naming the label, ' +
    'because re-deriving it would mean reimplementing the ISO-week arithmetic under test. Weekday ' +
    'parity is asserted instead by INV-16 and by tests/scheduling/localeParity.test.ts.',
  'INV-15 reads the interpretation from the TOOL_CALL_VALIDATED audit event, so it covers every ACCEPTED ' +
    'call including read-only ones - but it says nothing about REFUSED calls. That a refusal NAMES the ' +
    'token it could not account for is asserted in tests/scheduling/localeRefusalBreadth.test.ts, across ' +
    'thirteen scripts, rather than across this matrix.',
  'INV-18 HAS TWO WITNESSES SINCE SECTION 17.5, AND THE FIRST ONE IS NOT THE DETECTOR. It always ' +
    're-derived SUPPORT independently - from rows read back through the repositories and from the turn\'s ' +
    'own ToolOutcome values, with Luxon doing the timezone arithmetic - but it used to find the CLAIMS by ' +
    "calling the gate's own detectMaterialClaims, and that circle certified five live fail-open defects as " +
    'zero leaks (docs/MISSION_2D_CLAIM_GATE.md sections 14.1, 15.1, 16.1, 17.1, 18.1). Now every scripted model ' +
    'text in this sweep declares, as hand-authored data beside the sentence in ' +
    'tests/invariants/releaseTexts.ts, whether it asserts a material effect and of which kind; the ' +
    'declaration is judged against observed state; and a released sentence that no declaration covers is a ' +
    'VIOLATION rather than an inapplicable case. tests/invariants/claimOracleBoundary.test.ts asserts ' +
    'structurally that neither the oracle nor the declarations reach src/agent/claimGate, directly or ' +
    'transitively, and tests/invariants/claimOracleCatchesPastFindings.test.ts drives all five historical ' +
    'findings through INV-18 with the detector stubbed to see nothing and requires every one to fail. ' +
    'WHAT IS STILL NOT INDEPENDENT, AND WHAT THAT COSTS: the detector is kept as a SECOND witness, ' +
    'deliberately, because the declaration only covers sentences somebody wrote down. The oracle is not a ' +
    'second detector and cannot read an arbitrary sentence - so for this sweep it covers everything (every ' +
    'released text is declared or the run fails), and for any FUTURE text nobody declares it covers ' +
    'nothing. That bound is stated in section 17.8 rather than implied. Disagreement between the two ' +
    'witnesses is printed under INV-18 rather than resolved quietly, because a sentence a person reads as ' +
    'a booking and the detector reads as nothing is the exact signature of all five findings. The thing ' +
    'that proves the DETECTOR sees a class at all is still tests/claimGate/claimGateCorpus.ts, a corpus ' +
    'with the answers written down: MUST_FLAG, MUST_NOT_FLAG, DOCUMENTED_MISSES, DOCUMENTED_OVERREACH, a ' +
    '1,870-row cross-clause matrix, a 144-row adverb-by-frame matrix, a 3,891-row suppression matrix ' +
    'carrying both directions, and a 1,262-row generated honest corpus.',
  'BOUNDED DELIBERATELY: family M crosses its claim texts with FOUR zones (America/New_York, Europe/London, ' +
    'Asia/Jerusalem, Asia/Kolkata) at ONE `now` instant, under ONE policy and one free diary. Australia/Sydney ' +
    'is deliberately excluded rather than overlooked: at n01-midweek Sydney is already on Thursday, so ' +
    '`tomorrow at 2pm` there is FRIDAY and every spec that says "Thursday" would become a genuine wrong-day ' +
    'claim - crossing it in would test a different thing and report it as this one. The consequence: the ' +
    'claim texts are not crossed with DST edges, with a busy diary, with a restricted tool allowlist, or ' +
    'with a southern-hemisphere offset. What varies across family M is only WHAT THE AGENT SAID, which is ' +
    'what makes a failure there localise to the sentence rather than to the scheduling.',
  'INV-18 says nothing about a turn whose text the gate never saw, because no such path exists to test: ' +
    'AgentTurnService.releaseText is the only route from completion.assistantText to appendAgentText. What ' +
    'INV-18 DOES assert is that every message handleTurn returned corresponds to a release the gate ' +
    'approved, which is the observable form of the same claim. A hand-wired AgentTurnService constructed ' +
    'with no gate would release text ungated; that constructor seam is test-only, buildAgentRuntime never ' +
    'takes it, and INV-18 treats `claimGate.enabled === false` as a VIOLATION rather than as inapplicable ' +
    'so that it cannot be reached silently.',
  'The claim gate is swept against ScriptedLlmProvider, so family M proves what the gate does with a given ' +
    'sentence - not how often a REAL model produces one. The rate at which a real model asserts something ' +
    'unsupported is a benchmark question, and AgentTurnResult.claimGate.releases[].attempts[0] is the field ' +
    'that answers it; this sweep deliberately does not call a model at all.',
  'The Hebrew natural-language path cannot name a local time between 01:00 and 03:00, which is where ' +
    'every ordinary DST transition sits: Hebrew has no am/pm and no declared day part covers 02:00, so a ' +
    'digit hour of 1-11 is refused first. The DST gap and repeat classes are therefore driven through ' +
    'the locale-agnostic ISO path and the English grammar. That a HEBREW phrase reaches the same DST ' +
    'checks is proved in tests/scheduling/localeTimezoneBoundaries.test.ts using America/Havana, whose ' +
    'spring-forward happens at local midnight - the one transition hour Hebrew can name.',
];

interface InvariantSummary {
  readonly id: string;
  readonly title: string;
  readonly checked: number;
  readonly passed: number;
  readonly failed: number;
  readonly notApplicable: number;
  readonly vacuous: boolean;
}

export function summarizeInvariants(results: readonly InvariantResult[]): InvariantSummary[] {
  return INVARIANTS.map((invariant) => {
    const mine = results.filter((result) => result.invariant === invariant.id);
    const applicable = mine.filter((result) => result.applicable);
    const failed = applicable.filter((result) => !result.passed);
    return {
      id: invariant.id,
      title: invariant.title,
      checked: applicable.length,
      passed: applicable.length - failed.length,
      failed: failed.length,
      notApplicable: mine.length - applicable.length,
      vacuous: applicable.length === 0,
    };
  });
}

export function errorCodeDistribution(
  observations: readonly ScenarioObservation[],
): { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const code of VALIDATION_ERROR_CODES) counts.set(code, 0);
  for (const observation of observations) {
    if (observation.errorCode === null) continue;
    counts.set(observation.errorCode, (counts.get(observation.errorCode) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/**
 * WHAT THE AGENT WAS ALLOWED TO SAY, as numbers.
 *
 * INV-18 is applicable to almost every scenario in the corpus, because almost
 * every scenario releases text. That breadth is the point of an invariant, and it
 * is also how an invariant can look busy while proving nothing: families A-L all
 * release the same two sentences, and neither asserts anything material, so
 * INV-18 could report 1,700 green checks without ever having examined a claim.
 *
 * So the honest figure is not "checks passed", it is HOW MANY RELEASES CARRIED A
 * MATERIAL CLAIM AT ALL. That is `releasesWithAClaim` below, and
 * `sweep.test.ts` asserts a floor on it. Reporting the totals without it would be
 * exactly the "silent truncation that reads as full coverage" this renderer
 * exists to refuse.
 */
export interface ClaimGateSummary {
  readonly scenariosWithAGate: number;
  readonly scenariosWithoutAGate: number;
  readonly releases: number;
  readonly releasesWithAClaim: number;
  readonly releasesWithheld: number;
  /** The model's RAW behaviour: attempt 1 carried an unsupported claim. */
  readonly rawModelAttemptsUnsupported: number;
  /** Claims that got past the gate on the attempt it released. Must be 0. */
  readonly leakedClaims: number;
  readonly regenerationsRequested: number;
  readonly byOutcome: readonly { readonly outcome: string; readonly count: number }[];
  readonly byUnsupportedReason: readonly { readonly reason: string; readonly count: number }[];
  /**
   * Released sentences that NO hand-authored declaration covers.
   *
   * Must be 0, and INV-18 fails each one, so this is a second reading of the
   * same fact rather than a new check. It is here because a reader looking at
   * the leak count deserves to see how much of the corpus the independent oracle
   * actually judged.
   */
  readonly releasesUndeclared: number;
  /**
   * HOW THE TWO WITNESSES COMPARED, sentence by sentence.
   *
   * INV-18 now reads every released sentence twice: once through the
   * hand-authored declaration (`tests/invariants/claimOracle.ts`), which owes the
   * gate nothing, and once through `detectMaterialClaims`, which is the gate's
   * own. Keeping both is the requirement - the declaration only covers sentences
   * somebody wrote down, and the detector covers everything - and neither can
   * silence the other.
   *
   * `DETECTOR_BLIND` is the row worth watching. It is the signature of all four
   * Mission 2D fail-open findings: a person reading the sentence says it asserts
   * an effect and the detector found none. It is not by itself a leak, because
   * the sentence may be true - but it means the gate would not have stopped it
   * if it were false.
   */
  readonly witnessAgreement: Readonly<Record<WitnessAgreement, number>>;
  /** The actual sentences behind a `DETECTOR_BLIND` or `DETECTOR_OVER_READ` row. */
  readonly witnessDisagreements: readonly {
    readonly agreement: WitnessAgreement;
    readonly text: string;
    readonly count: number;
  }[];
}

export function claimGateSummary(observations: readonly ScenarioObservation[]): ClaimGateSummary {
  const outcomes = new Map<string, number>();
  const reasons = new Map<string, number>();
  let scenariosWithAGate = 0;
  let scenariosWithoutAGate = 0;
  let releases = 0;
  let releasesWithAClaim = 0;
  let releasesWithheld = 0;
  let rawModelAttemptsUnsupported = 0;
  let leakedClaims = 0;
  let regenerationsRequested = 0;
  let releasesUndeclared = 0;
  const witnessAgreement: Record<WitnessAgreement, number> = {
    BOTH_SILENT: 0,
    BOTH_SAW_A_CLAIM: 0,
    DETECTOR_BLIND: 0,
    DETECTOR_OVER_READ: 0,
  };
  const disagreements = new Map<string, { agreement: WitnessAgreement; text: string; count: number }>();

  for (const observation of observations) {
    if (observation.claimGate.enabled) scenariosWithAGate += 1;
    else scenariosWithoutAGate += 1;

    for (const release of observation.claimGate.releases) {
      releases += 1;
      outcomes.set(release.outcome, (outcomes.get(release.outcome) ?? 0) + 1);
      if (release.releasedText === null) releasesWithheld += 1;

      // ---- the two witnesses, compared -------------------------------------
      if (release.releasedText !== null) {
        const declaration = declarationFor(release.releasedText);
        if (declaration === undefined) {
          releasesUndeclared += 1;
        } else {
          const agreement = compareWitnesses(declaration, detectMaterialClaims(release.releasedText).length);
          witnessAgreement[agreement] += 1;
          if (agreement === 'DETECTOR_BLIND' || agreement === 'DETECTOR_OVER_READ') {
            const key = `${agreement} ${release.releasedText}`;
            const existing = disagreements.get(key);
            if (existing === undefined) {
              disagreements.set(key, { agreement, text: release.releasedText, count: 1 });
            } else {
              existing.count += 1;
            }
          }
        }
      }

      // A release "carried a claim" when the gate had something to verify -
      // which is exactly the case where attempt 1 produced either a supported or
      // an unsupported claim.
      const first = release.attempts[0];
      if (first !== undefined && (first.supportedClaimCount > 0 || first.unsupportedClaims.length > 0)) {
        releasesWithAClaim += 1;
      }
      if (first !== undefined && first.unsupportedClaims.length > 0) rawModelAttemptsUnsupported += 1;

      regenerationsRequested += Math.max(0, release.attempts.length - 1);

      for (const attempt of release.attempts) {
        for (const claim of attempt.unsupportedClaims) {
          reasons.set(claim.reason, (reasons.get(claim.reason) ?? 0) + 1);
        }
        if (release.releasedText !== null && attempt.text === release.releasedText) {
          leakedClaims += attempt.unsupportedClaims.length;
        }
      }
    }
  }

  return {
    scenariosWithAGate,
    scenariosWithoutAGate,
    releases,
    releasesWithAClaim,
    releasesWithheld,
    rawModelAttemptsUnsupported,
    leakedClaims,
    regenerationsRequested,
    byOutcome: [...outcomes.entries()]
      .map(([outcome, count]) => ({ outcome, count }))
      .sort((a, b) => b.count - a.count || a.outcome.localeCompare(b.outcome)),
    byUnsupportedReason: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    releasesUndeclared,
    witnessAgreement,
    witnessDisagreements: [...disagreements.values()].sort(
      (a, b) => b.count - a.count || a.text.localeCompare(b.text),
    ),
  };
}

export function outcomeDistribution(
  observations: readonly ScenarioObservation[],
): { outcome: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const observation of observations) {
    counts.set(observation.outcome, (counts.get(observation.outcome) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([outcome, count]) => ({ outcome, count }))
    .sort((a, b) => b.count - a.count);
}

function familyTable(
  scenarios: readonly Scenario[],
  observations: readonly ScenarioObservation[],
): { family: string; total: number; persisted: number; rejected: number; other: number }[] {
  const byId = new Map(observations.map((observation) => [observation.scenarioId, observation]));
  const families = new Map<string, { total: number; persisted: number; rejected: number; other: number }>();
  for (const scenario of scenarios) {
    const row = families.get(scenario.family) ?? { total: 0, persisted: 0, rejected: 0, other: 0 };
    row.total += 1;
    const outcome = byId.get(scenario.id)?.outcome;
    if (outcome === 'PERSISTED') row.persisted += 1;
    else if (outcome === 'REJECTED') row.rejected += 1;
    else row.other += 1;
    families.set(scenario.family, row);
  }
  return [...families.entries()]
    .map(([family, row]) => ({ family, ...row }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

/** Distinct values actually exercised on each generated axis. */
function axisCoverage(scenarios: readonly Scenario[]): { axis: string; values: string[] }[] {
  const axes = new Map<string, Set<string>>();
  for (const scenario of scenarios) {
    for (const [axis, value] of Object.entries(scenario.labels)) {
      const set = axes.get(axis) ?? new Set<string>();
      set.add(value);
      axes.set(axis, set);
    }
  }
  return [...axes.entries()]
    .map(([axis, values]) => ({ axis, values: [...values].sort() }))
    .sort((a, b) => a.axis.localeCompare(b.axis));
}

function bar(label: string, count: number, total: number, width = 28): string {
  const filled = total === 0 ? 0 : Math.round((count / total) * width);
  return `${label.padEnd(30)} ${String(count).padStart(5)}  ${'#'.repeat(filled)}`;
}

export interface RenderOptions {
  /** True when the corpus was filtered, so the report must not claim totality. */
  readonly filtered?: boolean;
  readonly totalAvailable?: number;
  /** Result of the second run, when the determinism check was performed. */
  readonly determinism?: { readonly ran: boolean; readonly identical: boolean; readonly differing: string[] };
}

/** The whole report as plain text. */
export function renderReport(sweep: SweepResult, options: RenderOptions = {}): string {
  const lines: string[] = [];
  const invariantSummaries = summarizeInvariants(sweep.results);
  const failedInvariants = invariantSummaries.filter((summary) => summary.failed > 0);
  const vacuous = invariantSummaries.filter((summary) => summary.vacuous);

  lines.push('='.repeat(78));
  lines.push('SCHEDULE AI VOICE - INVARIANT SWEEP REPORT');
  lines.push('='.repeat(78));
  lines.push('');
  lines.push(`Scenarios run      : ${sweep.scenarios.length}`);
  if (options.filtered) {
    lines.push(
      `!! FILTERED RUN    : this is a SUBSET of ${options.totalAvailable ?? '?'} generated scenarios. ` +
        'It is NOT full coverage.',
    );
  }
  lines.push(`Invariant checks   : ${sweep.results.filter((result) => result.applicable).length} applicable ` +
    `(${sweep.results.length} evaluated)`);
  lines.push(`Violations         : ${sweep.violations.length}`);
  lines.push(`Network attempts   : ${sweep.networkAttempts.length}`);
  lines.push(`Elapsed            : ${(sweep.elapsedMs / 1000).toFixed(1)}s`);
  lines.push('');

  // ---- invariants --------------------------------------------------------
  lines.push('-'.repeat(78));
  lines.push('PASS / FAIL PER INVARIANT');
  lines.push('-'.repeat(78));
  lines.push('');
  lines.push('  id                                                checked  passed  failed   n/a');
  for (const summary of invariantSummaries) {
    lines.push(
      `  ${summary.id.padEnd(48)}${String(summary.checked).padStart(7)}` +
        `${String(summary.passed).padStart(8)}${String(summary.failed).padStart(8)}` +
        `${String(summary.notApplicable).padStart(6)}${summary.vacuous ? '   <- VACUOUS' : ''}`,
    );
  }
  lines.push('');
  lines.push('  INV-09 (determinism) and INV-10 (no network I/O) are properties of the whole');
  lines.push('  sweep rather than of one scenario, and are reported separately below.');
  lines.push('');

  if (vacuous.length > 0) {
    lines.push(`  !! ${vacuous.length} invariant(s) had NOTHING to check. A property that never applies is`);
    lines.push('     not evidence. Investigate before treating this run as green.');
    lines.push('');
  }

  // ---- INV-09 / INV-10 ---------------------------------------------------
  lines.push('-'.repeat(78));
  lines.push('INV-09  DETERMINISM');
  lines.push('-'.repeat(78));
  if (options.determinism?.ran) {
    if (options.determinism.identical) {
      lines.push('  PASS - a second full run produced byte-identical classifications for every scenario id.');
    } else {
      lines.push(`  FAIL - ${options.determinism.differing.length} scenario(s) classified differently on re-run:`);
      for (const id of options.determinism.differing.slice(0, 20)) lines.push(`    ${id}`);
    }
  } else {
    lines.push('  NOT RUN in this invocation. `npm run qa:sweep -- --determinism` runs the corpus');
    lines.push('  twice and compares; tests/invariants/determinism.test.ts asserts it on a subset.');
  }
  lines.push('');

  lines.push('-'.repeat(78));
  lines.push('INV-10  NO NETWORK I/O, NO REAL TELEPHONY, NO REAL CALENDAR');
  lines.push('-'.repeat(78));
  if (sweep.networkAttempts.length === 0) {
    lines.push('  PASS - 0 outbound attempts via fetch, http, https or net while the sweep ran.');
    lines.push('  Providers were the deterministic doubles; no scenario dials or writes a calendar.');
  } else {
    lines.push(`  FAIL - ${sweep.networkAttempts.length} outbound attempt(s):`);
    for (const attempt of sweep.networkAttempts.slice(0, 10)) {
      lines.push(`    via ${attempt.via} -> ${attempt.target}`);
    }
  }
  lines.push('');

  // ---- INV-18 ------------------------------------------------------------
  lines.push('-'.repeat(78));
  lines.push('INV-18  WHAT THE AGENT WAS ALLOWED TO SAY');
  lines.push('-'.repeat(78));
  lines.push('');
  const gate = claimGateSummary(sweep.observations);
  lines.push(`  Scenarios with a claim gate wired   : ${gate.scenariosWithAGate}`);
  if (gate.scenariosWithoutAGate > 0) {
    lines.push(
      `  !! WITHOUT a gate                   : ${gate.scenariosWithoutAGate}  <- every one of these is an ` +
        'INV-18 VIOLATION; buildAgentRuntime offers no way to disable the gate',
    );
  } else {
    lines.push('  Scenarios without a gate            : 0  (buildAgentRuntime offers no way to disable it)');
  }
  lines.push(`  Pieces of text released             : ${gate.releases}`);
  lines.push(
    `  ...of which asserted something      : ${gate.releasesWithAClaim}` +
      (gate.releasesWithAClaim === 0
        ? '   <- VACUOUS: INV-18 never examined a claim. A corpus in which nothing is'
        : ''),
  );
  if (gate.releasesWithAClaim === 0) {
    lines.push('     ever asserted cannot prove the gate has teeth. Check that family M is in the corpus.');
  }
  lines.push(`  Releases WITHHELD (nothing said)    : ${gate.releasesWithheld}`);
  lines.push(`  Raw model attempts unsupported      : ${gate.rawModelAttemptsUnsupported}`);
  lines.push(`  Regeneration attempts consumed      : ${gate.regenerationsRequested}`);
  lines.push(
    `  CLAIMS THAT LEAKED PAST THE GATE    : ${gate.leakedClaims}` +
      (gate.leakedClaims === 0 ? '   (must be 0)' : '   <- MUST BE 0. A customer was told something false.'),
  );
  lines.push('');
  // WHAT THAT ZERO IS WORTH, STATED WHERE IT IS PRINTED.
  //
  // INV-18's independent oracle reads the released text with the SAME
  // `detectMaterialClaims` the gate reads it with, so a claim the DETECTOR cannot
  // see is a claim this line cannot count. That is not hypothetical: independent
  // QA released eight unsupported claims end to end, against an empty ledger,
  // while this line printed 0 - a negator in a leading clause suppressed the whole
  // sentence and the detector returned nothing to judge. The gap is closed
  // (`src/agent/claimGate/detector.ts` scopes negation to the clause) and the
  // bound is printed anyway, because the next detector gap will be invisible here
  // in exactly the same way and a reader is entitled to know that before quoting
  // the zero.
  lines.push('  WHAT THIS ZERO IS BOUNDED BY');
  lines.push('    THIS ZERO WAS WRONG FIVE TIMES, AND THE REASON DIFFERED EACH TIME: fixtures one punctuation');
  lines.push('    mark wide, an escape check filtered through the detector it was policing, specs that did not');
  lines.push('    name a wording of the failing shape, a GENERATED matrix whose joiner axis never included the');
  lines.push('    empty joiner, and - the fifth time - a generated matrix whose FILLER axis had 26 values and');
  lines.push('    not one of them built only out of tokens the locale declares as crossable. See');
  lines.push('    docs/MISSION_2D_CLAIM_GATE.md sections 15.2, 15.4, 16.4, 17.2 and 18.2.');
  lines.push('    The common cause was one thing: INV-18 found its claims with the gate\'s OWN detector, so a');
  lines.push('    sentence the detector could not see was a sentence this line could not count.');
  lines.push('');
  lines.push('    SINCE SECTION 17.5 THERE ARE TWO WITNESSES, AND THIS ONE IS NOT THE DETECTOR.');
  lines.push('    Every scripted model text in this sweep DECLARES, as hand-authored test data beside the');
  lines.push('    sentence, whether it asserts a material effect and of which kind. The declaration consults');
  lines.push('    nothing under src/agent/claimGate - tests/invariants/claimOracleBoundary.test.ts walks the');
  lines.push('    transitive import closure and fails if it ever does - and INV-18 judges it against what this');
  lines.push('    sweep actually persisted and dispatched. So a declared claim released over an empty ledger');
  lines.push('    fails REGARDLESS OF WHAT THE DETECTOR SAYS.');
  lines.push('    tests/invariants/claimOracleCatchesPastFindings.test.ts drives all five findings above');
  lines.push('    through INV-18 with detectMaterialClaims stubbed to return nothing, and every one fails.');
  lines.push('');
  lines.push('    WHAT IS STILL BOUNDED. The oracle is not a second detector: it can only judge a sentence');
  lines.push('    somebody declared. For the sweep that is every sentence - an UNDECLARED released text is an');
  lines.push('    INV-18 violation, counted below - but it is a real limit on what this mechanism generalises');
  lines.push('    to, and docs/MISSION_2D_CLAIM_GATE.md sections 17.8 and 18.7 state it rather than implying');
  lines.push('    more. Section 18 is the case in point: DETECTOR_BLIND read 0 on the tree that leaked it,');
  lines.push('    honestly, because nobody had declared the sentence.');
  lines.push('      - tests/claimGate/claimGateCorpus.ts is still the thing that proves the DETECTOR sees a');
  lines.push('        class at all: MUST_FLAG, MUST_NOT_FLAG, DOCUMENTED_MISSES, DOCUMENTED_OVERREACH, a');
  lines.push('        1,870-row cross-clause matrix, a 144-row adverb-by-frame matrix, a 3,891-row suppression');
  lines.push('        matrix carrying both directions, and a 1,262-row generated honest corpus.');
  lines.push('        Read it beside this number, not after it.');
  lines.push('');
  lines.push(
    `  Released sentences with NO declaration : ${gate.releasesUndeclared}` +
      (gate.releasesUndeclared === 0
        ? '   (must be 0)'
        : '   <- each is an INV-18 VIOLATION; the oracle had no ground truth for it'),
  );
  lines.push('  HOW THE TWO WITNESSES COMPARED, per released sentence');
  for (const agreement of ['BOTH_SILENT', 'BOTH_SAW_A_CLAIM', 'DETECTOR_BLIND', 'DETECTOR_OVER_READ'] as const) {
    lines.push(`    ${agreement.padEnd(20)} ${String(gate.witnessAgreement[agreement]).padStart(6)}`);
  }
  if (gate.witnessDisagreements.length === 0) {
    lines.push('    The declaration and the detector agreed on every sentence this sweep released.');
  } else {
    lines.push('    THEY DISAGREED, WHICH IS INFORMATION RATHER THAN A FAILURE:');
    for (const row of gate.witnessDisagreements.slice(0, 12)) {
      lines.push(`      [${row.agreement} x${row.count}] ${JSON.stringify(row.text.slice(0, 90))}`);
    }
    if (gate.witnessDisagreements.length > 12) {
      lines.push(`      ... and ${gate.witnessDisagreements.length - 12} more distinct sentence(s)`);
    }
    for (const agreement of ['DETECTOR_BLIND', 'DETECTOR_OVER_READ'] as const) {
      if (gate.witnessAgreement[agreement] > 0) {
        lines.push(`      ${agreement}: ${WITNESS_AGREEMENT_MEANING[agreement]}`);
      }
    }
  }
  lines.push('');
  lines.push('  gate outcome');
  for (const row of gate.byOutcome) {
    lines.push('  ' + bar(row.outcome, row.count, Math.max(gate.releases, 1)));
  }
  lines.push('');
  if (gate.byUnsupportedReason.length === 0) {
    lines.push('  No claim was ever rejected, so no rejection reason has been seen to work.');
    lines.push('  tests/claimGate/claimGateCorpus.ts is the corpus that proves each one individually.');
  } else {
    lines.push('  why a claim was rejected (across every attempt, released or not)');
    const rejected = gate.byUnsupportedReason.reduce((sum, row) => sum + row.count, 0);
    for (const row of gate.byUnsupportedReason) {
      lines.push('  ' + bar(row.reason, row.count, Math.max(rejected, 1)));
    }
  }
  lines.push('');

  // ---- outcomes ----------------------------------------------------------
  lines.push('-'.repeat(78));
  lines.push('OUTCOME DISTRIBUTION');
  lines.push('-'.repeat(78));
  lines.push('');
  for (const row of outcomeDistribution(sweep.observations)) {
    lines.push('  ' + bar(row.outcome, row.count, sweep.scenarios.length));
  }
  lines.push('');

  // ---- error codes -------------------------------------------------------
  lines.push('-'.repeat(78));
  lines.push('VALIDATION ERROR CODES EXERCISED');
  lines.push('-'.repeat(78));
  lines.push('');
  const distribution = errorCodeDistribution(sweep.observations);
  const rejections = distribution.reduce((sum, row) => sum + row.count, 0);
  for (const row of distribution) {
    lines.push('  ' + bar(row.code, row.count, Math.max(rejections, 1)) + (row.count === 0 ? '  (not exercised)' : ''));
  }
  const untouched = distribution.filter((row) => row.count === 0);
  lines.push('');
  lines.push(
    `  ${distribution.length - untouched.length} of ${distribution.length} declared ValidationErrorCodes ` +
      'were exercised by this sweep.',
  );
  if (untouched.length > 0) {
    lines.push(`  NOT exercised: ${untouched.map((row) => row.code).join(', ')}`);
  }
  lines.push('');

  // ---- families ----------------------------------------------------------
  lines.push('-'.repeat(78));
  lines.push('SCENARIO FAMILIES');
  lines.push('-'.repeat(78));
  lines.push('');
  lines.push('  family                      total  persisted  rejected  other');
  for (const row of familyTable(sweep.scenarios, sweep.observations)) {
    lines.push(
      `  ${row.family.padEnd(26)}${String(row.total).padStart(5)}${String(row.persisted).padStart(11)}` +
        `${String(row.rejected).padStart(10)}${String(row.other).padStart(7)}`,
    );
  }
  lines.push('');
  for (const [family, purpose] of Object.entries(FAMILY_PURPOSE)) {
    lines.push(`  ${family}`);
    lines.push(`    ${purpose}`);
  }
  lines.push('');

  // ---- axes --------------------------------------------------------------
  lines.push('-'.repeat(78));
  lines.push('AXIS COVERAGE');
  lines.push('-'.repeat(78));
  lines.push('');
  for (const { axis, values } of axisCoverage(sweep.scenarios)) {
    lines.push(`  ${axis} (${values.length})`);
    lines.push(`    ${values.join(', ')}`);
  }
  lines.push('');

  // ---- violations --------------------------------------------------------
  lines.push('-'.repeat(78));
  lines.push('VIOLATIONS');
  lines.push('-'.repeat(78));
  lines.push('');
  if (sweep.violations.length === 0) {
    lines.push('  None. Every applicable invariant held for every scenario.');
  } else {
    for (const violation of sweep.violations) {
      lines.push(`  [${violation.invariant}] ${violation.scenarioId}`);
      lines.push(`      ${violation.detail}`);
    }
  }
  lines.push('');

  // ---- gaps --------------------------------------------------------------
  lines.push('-'.repeat(78));
  lines.push('COVERAGE THIS SWEEP DOES NOT PROVIDE');
  lines.push('-'.repeat(78));
  lines.push('');
  for (const gap of KNOWN_COVERAGE_GAPS) {
    const wrapped = gap.match(/.{1,74}(\s|$)/g) ?? [gap];
    lines.push(`  - ${wrapped[0]?.trim()}`);
    for (const line of wrapped.slice(1)) lines.push(`    ${line.trim()}`);
  }
  lines.push('');

  lines.push('='.repeat(78));
  lines.push(
    sweep.violations.length === 0 && sweep.networkAttempts.length === 0 && failedInvariants.length === 0
      ? 'RESULT: PASS'
      : 'RESULT: FAIL',
  );
  lines.push('='.repeat(78));

  return lines.join('\n');
}

/** The same facts as JSON, for a machine to diff between runs. */
export function renderJson(sweep: SweepResult, options: RenderOptions = {}): string {
  return JSON.stringify(
    {
      scenarioCount: sweep.scenarios.length,
      filtered: options.filtered === true,
      totalAvailable: options.totalAvailable ?? sweep.scenarios.length,
      elapsedMs: sweep.elapsedMs,
      violations: sweep.violations,
      networkAttempts: sweep.networkAttempts.map((attempt) => ({ via: attempt.via, target: attempt.target })),
      invariants: summarizeInvariants(sweep.results),
      claimGate: claimGateSummary(sweep.observations),
      outcomes: outcomeDistribution(sweep.observations),
      errorCodes: errorCodeDistribution(sweep.observations),
      families: familyTable(sweep.scenarios, sweep.observations),
      axes: axisCoverage(sweep.scenarios),
      determinism: options.determinism ?? { ran: false },
      knownCoverageGaps: KNOWN_COVERAGE_GAPS,
    },
    null,
    2,
  );
}
