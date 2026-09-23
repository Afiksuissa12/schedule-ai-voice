/**
 * INVARIANT 09: running the sweep twice produces identical classifications.
 *
 * WHY A SUBSET HERE AND THE FULL CORPUS IN THE CLI
 * ---------------------------------------------------------------------------
 * Determinism is a property of the whole sweep, so the honest check is to run
 * all 509 scenarios twice. That costs roughly double the sweep, and the sweep
 * is already the slowest thing in this repository - so `npm run test` asserts
 * it over a deliberately chosen cross-section, and `npm run qa:sweep --
 * determinism` runs the complete double pass for a release check.
 *
 * This is a real limitation and it is stated rather than hidden: it is listed
 * in the report's coverage section and in docs/DECISIONS.md.
 *
 * WHAT "IDENTICAL" MEANS
 * ---------------------------------------------------------------------------
 * Not "the same rows". Row ids are cuids and are SUPPOSED to differ between
 * runs; comparing them would fail every time and prove nothing. What must be
 * byte-identical is the DECISION: the outcome kind, the error code, how many
 * rows of each type were written, the instants they were written for, and the
 * audit chain that explains them. `classificationOf` is exactly that tuple.
 */
import { describe, expect, it } from 'vitest';

import { classificationOf, executeSweep } from './sweep.js';
import type { Scenario } from './scenarios.js';

const DETERMINISM_TIMEOUT_MS = 600_000;

/**
 * A cross-section that touches every family and every axis the sweep varies.
 *
 * Taking the first N scenarios would be worse than useless - they are all from
 * family A. This takes a stride through each family instead, so the subset
 * spans timezones, `now` instants, policies and availability states.
 */
function crossSection(scenario: Scenario, index: number): boolean {
  return index % 7 === 0 || scenario.family === 'D-dst-edges' || scenario.family === 'H-idempotency-replay';
}

describe('determinism', () => {
  it(
    'classifies every scenario identically on a second run',
    async () => {
      let index = -1;
      const filter = (scenario: Scenario): boolean => {
        index += 1;
        return crossSection(scenario, index);
      };

      const first = await executeSweep({ label: 'det-1', concurrency: 4, chunkSize: 24, filter });

      index = -1;
      const second = await executeSweep({ label: 'det-2', concurrency: 4, chunkSize: 24, filter });

      expect(second.scenarios.map((scenario) => scenario.id)).toEqual(
        first.scenarios.map((scenario) => scenario.id),
      );
      expect(first.scenarios.length, 'the cross-section must be substantial to mean anything').toBeGreaterThan(70);

      const a = classificationOf(first.observations);
      const b = classificationOf(second.observations);

      const differing = Object.keys(a)
        .filter((id) => a[id] !== b[id])
        .map((id) => `  ${id}\n    run 1: ${a[id]}\n    run 2: ${b[id]}`);

      expect(
        differing,
        differing.length === 0
          ? ''
          : `\n${differing.length} scenario(s) were not reproducible:\n${differing.join('\n')}\n`,
      ).toEqual([]);

      // Deliberately also assert the two runs were not both empty.
      expect(Object.keys(a).length).toBe(first.scenarios.length);
    },
    DETERMINISM_TIMEOUT_MS,
  );

  it('changes the chunking without changing any outcome', async () => {
    // If an outcome depended on which database a scenario landed in, or on how
    // many ran concurrently, the sweep would not be reproducible from a
    // scenario id alone - which is the whole promise of the failure messages.
    const filter = (scenario: Scenario): boolean =>
      scenario.family === 'H-idempotency-replay' || scenario.family === 'D-dst-edges';

    const wide = await executeSweep({ label: 'chunk-wide', concurrency: 1, chunkSize: 64, filter });
    const narrow = await executeSweep({ label: 'chunk-narrow', concurrency: 5, chunkSize: 3, filter });

    expect(classificationOf(narrow.observations)).toEqual(classificationOf(wide.observations));
  }, DETERMINISM_TIMEOUT_MS);
});
