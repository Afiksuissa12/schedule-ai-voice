/**
 * `docs/ARCHITECTURE.md`'s sweep numbers, guarded against going stale.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `docs/MISSION_2D_CLAIM_GATE_ASSURANCE.md` § 7 records an unresolved deliverable:
 * two lines in `docs/ARCHITECTURE.md` stated **15** per-scenario invariants and
 * **823** generated scenarios when the truth was 16 and 887. The assurance task
 * would not edit a file it did not own, asked twice through the mailbox, got no
 * answer, and said so rather than letting it pass. It also said what the real fix
 * was:
 *
 * > a guard test that reads `docs/ARCHITECTURE.md` and fails when the stated
 * > invariant count disagrees with `INVARIANTS.length` [...] This is the second
 * > mission in a row where a count in that table went stale, so the guard is
 * > worth more than the correction.
 *
 * It did not land it then, because against the text as it stood the test would
 * have been red on arrival and "shipping a red test to prove a documentation
 * point is the wrong trade". The lines are correct now, so this is that guard.
 *
 * WHAT IT ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------------------------------
 * Only the two NUMBERS, re-derived from the code they describe. Not the prose,
 * not the table's shape, not which invariants are named - those change
 * legitimately on every revision, and a test that pinned them would be a tax on
 * editing the document rather than a guard on its integrity, which is the line
 * `founderReviewReferences.test.ts` already draws for the founder review.
 *
 * `generateScenarios()` is pure and has no clock and no I/O, so calling it here
 * costs a few milliseconds and no isolation.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { INVARIANTS } from './invariants.js';
import { generateScenarios } from './scenarios.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARCHITECTURE = readFileSync(join(REPO_ROOT, 'docs/ARCHITECTURE.md'), 'utf8');

/** `1,027` -> 1027. The document writes thousands with a comma and the code does not. */
function asNumber(written: string): number {
  return Number(written.replace(/[,*]/g, ''));
}

describe('docs/ARCHITECTURE.md states the sweep numbers the code produces', () => {
  const scenarioCount = generateScenarios().length;

  it('finds the two statements it is guarding, so it cannot pass vacuously', () => {
    // If somebody rewords the table, this fails FIRST and says the guard needs
    // re-pointing - rather than the count checks silently matching nothing.
    expect(ARCHITECTURE, 'the "N generated scenarios x M per-scenario invariants" line has moved').toMatch(
      /([\d,]+) generated scenarios x ([\d,]+) per-scenario invariants/,
    );
    expect(ARCHITECTURE, 'the "The N per-scenario properties" line has moved').toMatch(
      /The ([\d,]+) per-scenario properties/,
    );
    expect(ARCHITECTURE, 'the scenarios.ts row has moved').toMatch(/Crosses them into \*\*([\d,]+)\*\* scenarios/);
  });

  it('states the invariant count that INVARIANTS.length actually is', () => {
    const inline = /([\d,]+) generated scenarios x ([\d,]+) per-scenario invariants/.exec(ARCHITECTURE);
    const properties = /The ([\d,]+) per-scenario properties/.exec(ARCHITECTURE);

    expect(asNumber(inline?.[2] ?? ''), 'the suite table names the wrong invariant count').toBe(INVARIANTS.length);
    expect(asNumber(properties?.[1] ?? ''), 'the invariants.ts row names the wrong invariant count').toBe(
      INVARIANTS.length,
    );
  });

  it('states the scenario count that generateScenarios() actually produces', () => {
    const inline = /([\d,]+) generated scenarios x/.exec(ARCHITECTURE);
    const crosses = /Crosses them into \*\*([\d,]+)\*\* scenarios/.exec(ARCHITECTURE);

    expect(asNumber(inline?.[1] ?? ''), 'the suite table names the wrong scenario count').toBe(scenarioCount);
    expect(asNumber(crosses?.[1] ?? ''), 'the scenarios.ts row names the wrong scenario count').toBe(scenarioCount);
  });

  it('names the right number of scenario FAMILIES', () => {
    // The third number in the same table, and it moved twice without anybody
    // noticing: family M made it 13 and the document still said 12.
    const families = new Set(generateScenarios().map((scenario) => scenario.family));
    const stated = /scenarios in ([\d]+) named families/.exec(ARCHITECTURE);
    expect(stated, 'the "N named families" phrase has moved').not.toBeNull();
    expect(Number(stated?.[1] ?? ''), 'the scenarios.ts row names the wrong family count').toBe(families.size);
  });
});
