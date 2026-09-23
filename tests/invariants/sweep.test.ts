/**
 * THE INVARIANT SWEEP, as part of the repository's own test suite.
 *
 * The Founder asked for the legacy harness's invariant-sweep philosophy to be
 * carried into this mission's test suite, not bolted on beside it. So the same
 * corpus `npm run qa:sweep` reports on is asserted here, and a violation fails
 * `npm run test` like any other bug.
 *
 * ONE `it` FOR THE WHOLE CORPUS, ON PURPOSE
 * ---------------------------------------------------------------------------
 * 509 scenarios x 11 invariants is 5,599 checks. Emitting one vitest case per
 * check would bury every other test in the repository and make the run
 * unreadable. Instead the sweep runs once and every violation is reported
 * together, each quoting its scenario id - which is stable, generated from
 * fixed data, and sufficient to reproduce the case on its own:
 *
 *     npm run qa:sweep -- --family B
 *
 * The non-vacuity assertions below are the guard against the obvious failure
 * mode of that design: a sweep where everything is refused, or nothing is
 * checked, would otherwise pass in silence.
 */
import { describe, expect, it } from 'vitest';

import { summarizeInvariants } from '../qa/report.js';
import { executeSweep } from './sweep.js';
import { generateScenarios } from './scenarios.js';

// The corpus is ~509 scenarios against real SQLite databases. It is the slowest
// thing in the suite by design; the budget is generous so a loaded CI machine
// does not produce a flaky failure that looks like a real one.
const SWEEP_TIMEOUT_MS = 600_000;

describe('the invariant sweep', () => {
  it(
    'holds every invariant across the whole generated matrix',
    async () => {
      const sweep = await executeSweep({ label: 'inv-sweep', concurrency: 4, chunkSize: 32 });

      // --- the corpus is the size the mission asked for --------------------
      expect(
        sweep.scenarios.length,
        'the mission asks for a matrix of at least 300 distinct scenarios',
      ).toBeGreaterThanOrEqual(300);

      // --- no violation ----------------------------------------------------
      const report = sweep.violations
        .map((violation) => `  [${violation.invariant}] ${violation.scenarioId}\n      ${violation.detail}`)
        .join('\n');
      expect(
        sweep.violations,
        sweep.violations.length === 0
          ? ''
          : `\n${sweep.violations.length} invariant violation(s).\n` +
            `Reproduce one with: npm run qa:sweep\n\n${report}\n`,
      ).toEqual([]);

      // --- INV-13: nothing threw -------------------------------------------
      const threw = sweep.observations.filter((observation) => observation.outcome === 'ERROR');
      expect(
        threw.map((observation) => `${observation.scenarioId}: ${observation.error}`),
        'no turn may escape as an exception; refusals are values',
      ).toEqual([]);

      // --- INV-10: nothing reached the network -----------------------------
      expect(
        sweep.networkAttempts.map((attempt) => `${attempt.via} -> ${attempt.target}`),
        'the sweep must perform no network I/O at all',
      ).toEqual([]);

      // --- non-vacuity: the sweep actually exercised both directions -------
      // Without these, a sweep in which every single scenario was refused
      // would satisfy every conditional invariant above and report green.
      const persisted = sweep.observations.filter((observation) => observation.outcome === 'PERSISTED');
      const rejected = sweep.observations.filter((observation) => observation.outcome === 'REJECTED');
      expect(persisted.length, 'a sweep that persists nothing proves nothing about persistence').toBeGreaterThan(
        100,
      );
      expect(rejected.length, 'a sweep that refuses nothing proves nothing about refusal').toBeGreaterThan(100);

      const meetings = sweep.observations.reduce((sum, o) => sum + o.meetings.length, 0);
      const futureActions = sweep.observations.reduce((sum, o) => sum + o.futureActions.length, 0);
      const qualifications = sweep.observations.reduce((sum, o) => sum + o.qualificationStates.length, 0);
      expect(meetings, 'no Meeting rows were produced, so INV-02/03 examined nothing').toBeGreaterThan(20);
      expect(futureActions, 'no FutureAction rows were produced, so INV-01 examined nothing').toBeGreaterThan(20);
      expect(qualifications, 'no QualificationState rows, so INV-08 examined nothing').toBeGreaterThan(10);

      // --- no invariant may be vacuous -------------------------------------
      const vacuous = summarizeInvariants(sweep.results).filter((summary) => summary.vacuous);
      expect(
        vacuous.map((summary) => summary.id),
        'an invariant with nothing to check is not evidence; it must not be reported as passing',
      ).toEqual([]);
    },
    SWEEP_TIMEOUT_MS,
  );

  it('generates a stable, duplicate-free corpus from fixed data alone', () => {
    const first = generateScenarios();
    const second = generateScenarios();

    expect(first.length).toBe(second.length);
    expect(first.map((scenario) => scenario.id)).toEqual(second.map((scenario) => scenario.id));
    // Deep equality: the arguments, the policy and the `now` must be identical
    // too, not just the ids.
    expect(first).toEqual(second);

    const ids = new Set(first.map((scenario) => scenario.id));
    expect(ids.size, 'scenario ids must be unique - they are the reproduction handle').toBe(first.length);

    // Ids go into `seedSliceWorld({ suffix })`, and from there into a calendar
    // ref and an email local-part. Keep them boring.
    for (const scenario of first) {
      expect(scenario.id, `scenario id "${scenario.id}" is not safe as a seed suffix`).toMatch(
        /^[A-Za-z0-9-]+$/,
      );
    }
  });
});
