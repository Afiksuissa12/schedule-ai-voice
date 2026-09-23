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
import { VALIDATION_ERROR_CODES } from '../../src/ports/validation.js';
import { INVARIANTS } from '../invariants/invariants.js';
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
    'suites in tests/e2e and tests/agent, not by this sweep.',
  'The sweep stops at persistence. `DueActionRunner` execution - claim, lease, dispatch, retry, backoff - ' +
    'is proved by tests/scheduling/dueActionRunner*.test.ts and is NOT re-swept per scenario here, so no ' +
    'scenario in this corpus places a call through the telephony double at all.',
  'Concurrency is not swept. Two agents racing the same idempotency key is covered by a dedicated test ' +
    'in tests/scheduling/meetingSchedulingService.test.ts, not across the matrix.',
  'The live OpenAI provider is not exercised. Every scenario runs against ScriptedLlmProvider, which is ' +
    'the point - but it means the sweep says nothing about whether a real model emits well-formed calls.',
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
