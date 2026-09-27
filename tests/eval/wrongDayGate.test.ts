/**
 * The wrong-day gate, at the scoring layer.
 *
 * WHAT THIS FILE IS FOR, NOW THAT THE RESOLVER IS FIXED
 * ---------------------------------------------------------------------------
 * The gate was added because `src/scheduling/naturalLanguage.ts` was
 * English-only and a Hebrew `when` with the clock time in digits resolved to
 * the WRONG CALENDAR DAY instead of being refused. That defect is gone: the
 * resolver now understands Hebrew and, more importantly, refuses anything it
 * cannot account for (`docs/DECISIONS.md` § 9). `tests/e2e/hebrewDigitClockTime.test.ts`
 * used to record the wrong instant against the real dispatcher and now asserts
 * the right one.
 *
 * **This file did not become less sharp, and must not.** A gate is only worth
 * having if it still fires, and the only place that can now be demonstrated is
 * here - because no real run in the suite produces a wrong day to feed it. So
 * every fixture below is SYNTHETIC by design: a hand-built recorded run whose
 * `resolvedDay` check already says "wrong", fed straight to the scorer. What is
 * proved is the CONSEQUENCE - that such a turn zeroes the tool-and-structural
 * category, moves the composite, and ranks the model below every clean one,
 * rather than being recorded as the mild "expected failure DID NOT OCCUR"
 * non-event `expectsToolFailure` would have produced.
 *
 * If a future change to the resolver reintroduces a wrong-day booking, these
 * tests are what makes the benchmark say so out loud.
 *
 * Everything here is a pure function of a recorded run, so no database and no
 * model are involved.
 */
import { describe, expect, it } from 'vitest';

import { loadCorpus } from '../../src/eval/corpus/index.js';
import { checkResolvedDay, type ResolvedInstant } from '../../src/eval/rubric/programmatic.js';
import type { BenchmarkTurn } from '../../src/eval/corpus/schema.js';
import { scoreModel, scoreScenario, turnResolvedWrongDay } from '../../src/eval/rubric/score.js';
import { WRONG_DAY_RESOLUTION_GATE } from '../../src/eval/rubric/rubric.js';
import type { ScenarioRun, TurnChecks, TurnRecord } from '../../src/eval/types.js';

// ---------------------------------------------------------------------------
// Minimal recorded-run fixtures. Only the fields the scorer reads are set.
// ---------------------------------------------------------------------------

function checks(overrides: Partial<TurnChecks> = {}): TurnChecks {
  return {
    fabricatedTimestamps: [],
    toolSelection: { applicable: true, passed: true, failures: [], assertionsChecked: 1, assertionsPassed: 1 },
    unnecessaryCalls: [],
    toolCalls: [
      {
        toolName: 'schedule_meeting',
        known: true,
        jsonParsed: true,
        schemaValid: true,
        schemaErrors: [],
        hallucinatedContactId: false,
        hallucinatedMeetingId: false,
      },
    ],
    passthrough: { applicable: true, passed: true, detail: '' },
    text: {
      applicable: false,
      passed: true,
      failures: [],
      lengthChars: 10,
      lengthWords: 2,
      lengthScore: null,
      concreteDatesAsserted: [],
    },
    repetition: { maxSimilarity: 0, verbatimRepeat: false, score: 1 },
    language: { expected: 'he', hebrewLetterRatio: 1, matched: true, detail: '' },
    schedulingIntent: { applicable: true, recognised: true, detail: '' },
    toolFailure: { expected: false, occurred: false, codes: [] },
    ...overrides,
  };
}

function turn(index: number, resolvedDay?: TurnChecks['resolvedDay']): TurnRecord {
  return {
    index,
    utterance: 'תתקשר אליי מחר ב-15:00',
    note: 'fixture',
    assistantMessages: ['סגרנו.'],
    assistantText: 'סגרנו.',
    toolCalls: [{ toolCallId: `c${index}`, toolName: 'schedule_meeting', argumentsJson: '{}' }],
    toolOutcomes: [],
    iterations: 1,
    stopReason: 'MODEL_FINISHED',
    metrics: null,
    turnLatencyMs: 1,
    providerCalls: 1,
    checks: checks(resolvedDay ? { resolvedDay } : {}),
    error: null,
  };
}

function run(modelId: string, turns: readonly TurnRecord[]): ScenarioRun {
  return {
    harnessVersion: '1.1.0',
    corpusVersion: '1.1.0',
    rubricVersion: '1.1.0',
    judgePromptVersion: '1.0.0',
    modelId,
    providerName: 'fixture',
    contextMode: 'baseline-v1',
    systemPromptRef: null,
    scenarioId: 'hebrew-digit-clock-time',
    title: 'fixture',
    objective: 'fixture',
    language: 'he',
    coverage: ['language-hebrew'],
    status: 'OK',
    error: null,
    contactId: 'contact-1',
    conversationId: 'conversation-1',
    nowUtc: '2026-03-04T08:00:00.000Z',
    priorConversation: [],
    turns,
    judges: {},
    startedAtIso: '2026-03-04T08:00:00.000Z',
    durationMs: 1,
    providerStats: null,
  };
}

/**
 * A SYNTHETIC wrong-day result. No code path produces this any more, which is
 * exactly why it is written by hand: the gate has to be exercised on the
 * outcome it exists to catch, whether or not anything currently causes it.
 */
const WRONG_DAY = {
  applicable: true,
  passed: false,
  expectedLocalDate: '2026-03-05',
  observedLocalDates: ['2026-03-04'],
  detail: 'the contact said "מחר ב-15:00" (= 2026-03-05) ... a validated booking on the wrong calendar day',
} as const;

const RIGHT_DAY = {
  applicable: true,
  passed: true,
  expectedLocalDate: '2026-03-05',
  observedLocalDates: ['2026-03-05'],
  detail: 'resolved to 2026-03-05',
} as const;

// ---------------------------------------------------------------------------

describe('the wrong-day gate', () => {
  it('zeroes the tool-and-structural category for a scenario that booked the wrong day', () => {
    const clean = scoreScenario(run('m', [turn(0, RIGHT_DAY)]));
    const wrong = scoreScenario(run('m', [turn(0, WRONG_DAY)]));

    expect(clean.categories['toolAndStructural']?.score).toBeGreaterThan(0);
    expect(wrong.categories['toolAndStructural']?.score).toBe(0);
    expect(wrong.wrongDayGate.failedTurns).toBe(1);
    expect(wrong.wrongDayGate.findings[0]).toContain('wrong calendar day');

    // And the composite really moves - a gate nobody can feel is not a gate.
    expect(wrong.composite).toBeLessThan(clean.composite ?? 1);
  });

  it('ranks a model that booked the wrong day as having failed a gate, with the fabrication gate still clean', () => {
    const score = scoreModel([run('m', [turn(0, WRONG_DAY)])]);

    expect(score.timestampFabrication.passedGate).toBe(true);
    expect(score.wrongDayResolution.passedGate).toBe(false);
    expect(score.wrongDayResolution.failedTurns).toBe(1);
    expect(score.wrongDayResolution.applicableTurns).toBe(1);
    expect(score.wrongDayResolution.rate).toBe(1);
    expect(score.passedAllGates).toBe(false);
  });

  it('measures the rate over turns where the question could be asked, not over every turn', () => {
    // Two turns say nothing about a day; one asserts one and gets it wrong.
    const score = scoreModel([run('m', [turn(0), turn(1), turn(2, WRONG_DAY)])]);

    expect(score.wrongDayResolution.applicableTurns).toBe(1);
    expect(score.wrongDayResolution.rate).toBe(1);
    // A denominator of 3 would have reported 33% and read like a minor blemish.
  });

  it('reports `null`, not a pass, when no turn could exercise it', () => {
    const score = scoreModel([run('m', [turn(0), turn(1)])]);

    expect(score.wrongDayResolution.applicableTurns).toBe(0);
    expect(score.wrongDayResolution.rate).toBeNull();
    expect(score.passedAllGates).toBe(true);
  });

  it('treats a results file written before harness 1.1.0 as not applicable, never as passed or failed', () => {
    const legacy = turn(0);
    expect(legacy.checks.resolvedDay).toBeUndefined();
    expect(turnResolvedWrongDay(legacy)).toBe(false);
    expect(scoreModel([run('m', [legacy])]).wrongDayResolution.applicableTurns).toBe(0);
  });

  it('states that it grades application code rather than the model', () => {
    // The consequence text is what a reader sees next to the number, so it is
    // asserted rather than left to drift away from the rule it explains.
    expect(WRONG_DAY_RESOLUTION_GATE.consequence).toContain('APPLICATION CODE, NOT THE MODEL');
    expect(WRONG_DAY_RESOLUTION_GATE.rule).toContain('A refusal is NOT a failure here');
  });
});

describe('checkResolvedDay', () => {
  const expectation: BenchmarkTurn = {
    utterance: 'fixture',
    note: 'fixture',
    resolvedDay: { mustResolveToLocalDate: '2026-03-05', contactSaid: 'מחר ב-15:00' },
  };

  const resolved = (localStart: string | null, ok = true): ResolvedInstant => ({
    toolName: 'schedule_meeting',
    ok,
    resolvedStartLocal: localStart,
    resolvedTimezone: 'Asia/Jerusalem',
  });

  it('asserts nothing on a turn that does not state an expected day', () => {
    const verdict = checkResolvedDay({ utterance: 'x', note: 'x' }, [resolved('2026-03-04T15:00')]);
    expect(verdict.applicable).toBe(false);
    expect(verdict.passed).toBe(true);
  });

  it('ignores the time of day and compares only the calendar date', () => {
    expect(checkResolvedDay(expectation, [resolved('2026-03-05T09:00')]).passed).toBe(true);
    expect(checkResolvedDay(expectation, [resolved('2026-03-05T23:45')]).passed).toBe(true);
  });

  it('fails when ANY resolved instant on the turn landed on another day', () => {
    // check_availability then schedule_meeting: one right, one wrong is wrong.
    const verdict = checkResolvedDay(expectation, [
      { ...resolved('2026-03-05T15:00'), toolName: 'check_availability' },
      resolved('2026-03-04T15:00'),
    ]);
    expect(verdict.passed).toBe(false);
    expect(verdict.observedLocalDates).toEqual(['2026-03-05', '2026-03-04']);
  });

  it('is not applicable when the call was refused, because a refusal books nothing', () => {
    expect(checkResolvedDay(expectation, [resolved(null, false)]).applicable).toBe(false);
  });
});

describe('the corpus', () => {
  /**
   * These two scenarios were added because the resolver got this input class
   * wrong. It no longer does - the product now RESOLVES `מחר ב-15:00` onto the
   * day the contact named - so what they measure has changed from "does the
   * product commit to the wrong day" to "does it still commit to the right
   * one". The corpus shape that makes either question askable is the same, and
   * it is what is asserted here.
   */
  it('carries a Hebrew AND a mixed scenario whose `when` has a digit-bearing clock time', () => {
    const scenarios = loadCorpus().scenarios.filter((s) =>
      s.turns.some((t) => t.resolvedDay !== undefined && /\d{1,2}:\d{2}/.test(t.utterance)),
    );

    const languages = new Set(scenarios.map((s) => s.language));
    expect(languages.has('he')).toBe(true);
    expect(languages.has('mixed')).toBe(true);

    for (const scenario of scenarios) {
      for (const t of scenario.turns) {
        if (!t.resolvedDay) continue;
        // Still the whole point, and still true after the fix: this class of
        // turn must NOT be filed as an expected failure. `expectsToolFailure`
        // can only ever say "a refusal is expected", so it could not have told
        // a wrong-day booking from a good one - and it would now misreport the
        // correct booking as an unmet expectation.
        expect(t.expectsToolFailure, `${scenario.id} must not mark a wrong-day probe as an expected failure`)
          .not.toBe(true);
        // And it must contain Hebrew, or it is not exercising the path that
        // used to be English-only.
        expect(/[֐-׿]/.test(t.utterance)).toBe(true);
      }
    }
  });
});
