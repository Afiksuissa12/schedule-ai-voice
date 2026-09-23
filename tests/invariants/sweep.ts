/**
 * The sweep, end to end: generate -> run -> check -> summarize.
 *
 * One function, used by BOTH `tests/invariants/sweep.test.ts` (which asserts
 * the result is clean) and `tests/qa/sweepCli.ts` (which prints and writes the
 * report). Having one implementation is what stops `npm run test` and
 * `npm run qa:sweep` from ever disagreeing about what was covered.
 */
import { checkAll, INVARIANTS, violations, type InvariantResult } from './invariants.js';
import { withNetworkTrap, type NetworkAttempt } from './networkTrap.js';
import { runSweep, type RunSweepOptions, type ScenarioObservation } from './runner.js';
import { generateScenarios, type Scenario } from './scenarios.js';

export interface SweepResult {
  readonly scenarios: readonly Scenario[];
  readonly observations: readonly ScenarioObservation[];
  readonly results: readonly InvariantResult[];
  readonly violations: readonly InvariantResult[];
  /** Outbound network attempts recorded while the sweep ran. Must be empty. */
  readonly networkAttempts: readonly NetworkAttempt[];
  readonly elapsedMs: number;
}

export interface ExecuteSweepOptions extends RunSweepOptions {
  /** Restrict the corpus, for a fast smoke run. Omit to run all of it. */
  readonly filter?: (scenario: Scenario) => boolean;
}

/**
 * Run the whole corpus under the network trap and check every invariant.
 *
 * Deliberately returns rather than asserts: the CLI wants to print a report
 * even when something failed, and the test wants to fail with the detail.
 */
export async function executeSweep(options: ExecuteSweepOptions = {}): Promise<SweepResult> {
  const all = generateScenarios();
  const scenarios = options.filter ? all.filter(options.filter) : all;

  const startedAt = performance.now();
  const { result: observations, attempts } = await withNetworkTrap(() => runSweep(scenarios, options));
  const elapsedMs = Math.round(performance.now() - startedAt);

  const results = checkAll(observations, scenarios);

  return {
    scenarios,
    observations,
    results,
    violations: violations(results),
    networkAttempts: attempts,
    elapsedMs,
  };
}

/**
 * A classification per scenario id: the thing invariant 9 compares.
 *
 * Deliberately NOT the whole observation. Row ids are cuids and differ between
 * runs by design, so comparing them would report a false difference on every
 * run and the determinism check would be worthless. What must be stable is the
 * DECISION: what the system did, and why.
 */
export function classificationOf(observations: readonly ScenarioObservation[]): Record<string, string> {
  const classification: Record<string, string> = {};
  for (const observation of observations) {
    classification[observation.scenarioId] = [
      observation.outcome,
      observation.errorCode ?? '-',
      `m${observation.meetings.length}`,
      `f${observation.futureActions.length}`,
      `q${observation.qualificationStates.length}`,
      // The instants themselves, so a zone bug that changed WHEN something was
      // booked without changing WHETHER would still be caught.
      observation.meetings.map((meeting) => `${meeting.startUtc}/${meeting.endUtc}`).join(','),
      observation.futureActions.map((action) => action.scheduledForUtc).join(','),
      observation.auditTypes.join('>'),
    ].join('|');
  }
  return classification;
}

export { INVARIANTS };
