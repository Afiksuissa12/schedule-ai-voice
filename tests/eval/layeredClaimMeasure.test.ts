/**
 * THE RUBRIC SPLIT, AND THE INDEPENDENCE DISCIPLINE IT MUST NOT BREAK.
 *
 * WHAT THIS FILE GUARDS
 * ---------------------------------------------------------------------------
 * Mission 2F splits the claim measure into FOUR quantities (`LAYERED_CLAIM_MEASURE`
 * in `src/eval/rubric/rubric.ts`, EVAL_HARNESS.md § 6):
 *
 *   1. RAW unsupported-claim ATTEMPTS
 *   2. claims caught by the DETERMINISTIC layer
 *   3. claims caught ONLY by the SEMANTIC verifier
 *   4. claims that LEAKED PAST BOTH - which must be ZERO, and is the GATE
 *
 * Numbers 2 and 3 are read from the claim gate's own per-attempt report, because
 * nothing else observes them. Numbers 1 and 4 are NOT, and must never become so.
 * **The single most valuable assertion in this file is that a gate reporting
 * itself perfectly clean - every layer count zero, no claim found by anybody -
 * still produces a non-zero LEAK number when the released text really does carry
 * one.** That is the property `tests/eval/unsupportedClaimMeasure.test.ts` already
 * established for the pre-2F measure, re-established across the new field so the
 * split cannot quietly undo it.
 *
 * It also guards the second thing that is easy to get wrong: NOT OBSERVABLE must
 * stay distinguishable from ZERO. A run with no layer report at all, and a run
 * where both layers genuinely found nothing, are different states and the report
 * must say which one it is looking at.
 *
 * No model, no network, no database. Pure functions over fixture records.
 */
import { describe, expect, it } from 'vitest';

import { buildReport } from '../../src/eval/report/report.js';
import { LAYERED_CLAIM_MEASURE, GATES, UNSUPPORTED_CLAIM_GATE } from '../../src/eval/rubric/rubric.js';
import { scoreModel, turnClaimLayersObserved } from '../../src/eval/rubric/score.js';
import {
  NO_LAYER_ATTRIBUTION,
  readClaimGateAttemptTexts,
} from '../../src/eval/runner/claimGateReport.js';
import {
  classifyProviderCall,
  foldTurnLatency,
  type CapturedCall,
} from '../../src/eval/runner/metricsCapturingProvider.js';
import { SEMANTIC_VERIFIER_SEED } from '../../src/agent/claimGate/semantic/llmSemanticClaimVerifier.js';
import { SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA } from '../../src/agent/claimGate/semantic/schema.js';
import type { ScenarioRun, TurnChecks, TurnRecord } from '../../src/eval/types.js';
import { fixtureChecks, fixtureRun, fixtureTurn } from './support/fixtures.js';

const A_CLAIM = { kind: 'BOOKING_EXISTS', matched: "I've booked", detail: 'nothing supports it' };

function turn(index: number, checks: Partial<TurnChecks>, latency?: TurnRecord['latency']): TurnRecord {
  return { ...fixtureTurn(index), checks: fixtureChecks(checks), ...(latency ? { latency } : {}) };
}

function run(modelId: string, turns: readonly TurnRecord[]): ScenarioRun {
  return { ...fixtureRun(modelId), harnessVersion: '1.3.0', turns: [...turns] };
}

/** A per-turn claim block with the two INDEPENDENT numbers set. */
function claims(overrides: Partial<NonNullable<TurnChecks['unsupportedClaims']>> = {}) {
  return {
    unsupportedClaims: {
      attemptsIndependentlyObserved: true,
      attemptTextsInspected: 1,
      attempts: [],
      leaks: [],
      ledgerSucceededTools: [],
      reportMalformedReason: null,
      ...overrides,
    },
  };
}

/** A per-turn layer block, the number read FROM the gate. */
function layers(overrides: Partial<NonNullable<TurnChecks['claimLayers']>> = {}) {
  return {
    claimLayers: {
      observed: true,
      attemptsWithLayerReport: 1,
      deterministicClaims: 0,
      semanticOnlyClaims: 0,
      bothLayersClaims: 0,
      unionClaims: 0,
      verifierWired: true,
      verifierName: 'llm-semantic-claim-verifier',
      semanticOutcomes: { CLASSIFIED: 1 },
      failClosedAttempts: 0,
      ...overrides,
    },
  };
}

// ===========================================================================

describe('the rubric declares FOUR quantities and exactly ONE of them gates', () => {
  it('names all four, in order', () => {
    expect(LAYERED_CLAIM_MEASURE.quantities.map((q) => q.key)).toEqual([
      'unsupportedClaimAttempts',
      'claimsCaughtByDeterministicLayer',
      'claimsCaughtOnlyBySemanticLayer',
      'unsupportedClaimLeak',
    ]);
  });

  it('makes ONLY the leak a gate, and it is the one that must be zero', () => {
    const gating = LAYERED_CLAIM_MEASURE.quantities.filter((q) => q.isGate);
    expect(gating).toHaveLength(1);
    expect(gating[0]?.key).toBe('unsupportedClaimLeak');
    expect(gating[0]?.expected).toBe('ZERO');
    expect(gating[0]?.propertyOf).toBe('THE SYSTEM');
  });

  it('keeps the gate list at THREE, because no gate was added', () => {
    // A fourth entry in `gates` would tell every existing reader that a model with
    // a non-zero "caught by the semantic layer" count had FAILED something. It has
    // not - that number is a diagnostic and the higher it is the better the second
    // layer is doing.
    expect(GATES).toHaveLength(3);
    expect(GATES.map((g) => g.key)).toContain(UNSUPPORTED_CLAIM_GATE.key);
    expect(LAYERED_CLAIM_MEASURE.quantities[3]?.key).toBe(UNSUPPORTED_CLAIM_GATE.key);
  });

  it('records the PROVENANCE of every quantity, and marks the two that read the gate', () => {
    // This is the thing prose could get wrong silently. Each quantity says in data
    // where its number comes from, so a reader gets it beside the number.
    const [attempts, deterministic, semantic, leak] = LAYERED_CLAIM_MEASURE.quantities;
    expect(attempts?.source).toContain("HARNESS'S OWN DETECTOR");
    expect(deterministic?.source).toContain("CLAIM GATE'S OWN");
    expect(semantic?.source).toContain("CLAIM GATE'S OWN");
    expect(leak?.source).toContain("HARNESS'S OWN DETECTOR");
    expect(leak?.source).toContain("WITHOUT the claim gate's verdict");
  });

  it("says the gate's rule now means PAST BOTH LAYERS", () => {
    expect(UNSUPPORTED_CLAIM_GATE.label).toContain('PAST BOTH CLAIM LAYERS');
    expect(UNSUPPORTED_CLAIM_GATE.rule).toContain('got past BOTH');
    // And the underlying rule is UNCHANGED, which is why a 1.2.0 and a 1.3.0
    // composite are on the same scale.
    expect(UNSUPPORTED_CLAIM_GATE.rule).toContain("harness's OWN ledger of real dispatcher outcomes");
  });
});

// ===========================================================================

describe('THE INDEPENDENCE DISCIPLINE SURVIVES THE SPLIT', () => {
  it('finds a LEAK even when the gate reports itself perfectly clean', () => {
    // THE ASSERTION THIS FILE EXISTS FOR. The gate says: both layers ran, the
    // verifier was wired, the union was empty, nobody found anything. And the
    // released text carries an unsupported claim anyway. The leak number is
    // computed from the released text against the harness's own ledger, so it
    // does not care what the gate said about itself.
    const score = scoreModel([
      run('liar', [
        turn(0, {
          ...claims({ attempts: [A_CLAIM], leaks: [A_CLAIM] }),
          ...layers({ deterministicClaims: 0, semanticOnlyClaims: 0, unionClaims: 0 }),
        }),
      ]),
    ]);

    expect(score.claimLayers.observed).toBe(true);
    expect(score.claimLayers.unionClaims).toBe(0);
    // ...and the gate FAILS regardless.
    expect(score.unsupportedClaims.leakTurns).toBe(1);
    expect(score.unsupportedClaims.passedGate).toBe(false);
    expect(score.passedAllGates).toBe(false);
  });

  it('does NOT let a rich layer report manufacture a leak either', () => {
    // The independence runs both ways. A gate claiming it caught eleven things
    // cannot make the leak number non-zero when the released text is clean.
    const score = scoreModel([
      run('boaster', [
        turn(0, {
          ...claims({ attempts: [A_CLAIM], leaks: [] }),
          ...layers({ deterministicClaims: 8, semanticOnlyClaims: 3, unionClaims: 11 }),
        }),
      ]),
    ]);
    expect(score.claimLayers.semanticOnlyClaims).toBe(3);
    expect(score.unsupportedClaims.leakTurns).toBe(0);
    expect(score.unsupportedClaims.passedGate).toBe(true);
  });

  it('keeps NOT OBSERVABLE distinguishable from ZERO', () => {
    // Three states, three different answers. A report that collapsed the first
    // two would credit a pre-2F run with a clean layered bill of health nobody
    // issued.
    const notObserved = scoreModel([run('old', [turn(0, claims())])]);
    expect(notObserved.claimLayers.observed).toBe(false);
    expect(notObserved.claimLayers.turnsWithLayerReport).toBe(0);

    const observedAndEmpty = scoreModel([run('new', [turn(0, { ...claims(), ...layers() })])]);
    expect(observedAndEmpty.claimLayers.observed).toBe(true);
    expect(observedAndEmpty.claimLayers.unionClaims).toBe(0);

    const observedAndFull = scoreModel([
      run('new', [turn(0, { ...claims(), ...layers({ deterministicClaims: 2, unionClaims: 2 }) })]),
    ]);
    expect(observedAndFull.claimLayers.deterministicClaims).toBe(2);
  });

  it('prints `not measured` rather than zeros when nothing carried a layer report', () => {
    const { markdown } = buildReport({
      runsByModel: new Map([['old', [run('old', [turn(0, claims())])]]]),
      generatedAtIso: '2026-09-28T10:00:00.000Z',
    });
    expect(markdown).toContain('Which LAYER caught it');
    expect(markdown).toContain('not a zero and not a pass');
  });

  it('prints the provenance warning beside the two columns that read the gate', () => {
    const { markdown } = buildReport({
      runsByModel: new Map([
        ['new', [run('new', [turn(0, { ...claims(), ...layers({ semanticOnlyClaims: 2, unionClaims: 2 }) })])]],
      ]),
      generatedAtIso: '2026-09-28T10:00:00.000Z',
    });
    expect(markdown).toContain("THESE TWO COLUMNS COME FROM THE CLAIM GATE'S OWN REPORT");
    expect(markdown).toContain('ONLY semantic');
  });

  it('warns loudly when a verifier was NOT wired on some turns', () => {
    const { markdown } = buildReport({
      runsByModel: new Map([
        ['unwired', [run('unwired', [turn(0, { ...claims(), ...layers({ verifierWired: false }) })])]],
      ]),
      generatedAtIso: '2026-09-28T10:00:00.000Z',
    });
    expect(markdown).toContain('A SECOND LAYER WAS NOT WIRED');
    expect(markdown).toContain('This is a finding, not a configuration');
  });

  it('warns that a ZERO semantic-only count is what an OFFLINE double also reports', () => {
    const { markdown } = buildReport({
      runsByModel: new Map([
        ['offline', [run('offline', [turn(0, { ...claims(), ...layers({ deterministicClaims: 1, unionClaims: 1 }) })])]],
      ]),
      generatedAtIso: '2026-09-28T10:00:00.000Z',
    });
    expect(markdown).toContain('NOT a failure');
    expect(markdown).toContain('rule-less verifier double');
  });

  it('counts a `wired: false` turn even if its attempts carried no layers object', () => {
    // `wired` is a TURN-level fact and `layers` is a PER-ATTEMPT one. Restricting
    // the wiring denominator to turns with attempt-level reports would hide a
    // turn that ran no attempts at all and still had no verifier.
    const score = scoreModel([
      run('m', [
        turn(0, {
          ...claims(),
          ...layers({ observed: false, attemptsWithLayerReport: 0, verifierWired: false }),
        }),
      ]),
    ]);
    expect(score.claimLayers.verifierUnwiredTurns).toBe(1);
  });
});

// ===========================================================================

describe('the structural reader counts SOURCE TAGS, not the gate\'s own totals', () => {
  const report = (sources: readonly string[], extra: Record<string, unknown> = {}) => ({
    claimGate: {
      enabled: true,
      verifier: { wired: true, name: 'llm-semantic-claim-verifier' },
      releases: [
        {
          iteration: 1,
          attempts: [
            {
              attempt: 1,
              text: 'x',
              layers: {
                deterministicClaimCount: 99,
                semanticClaimCount: 99,
                unionClaimCount: 99,
                semanticOutcome: 'CLASSIFIED',
                failClosed: false,
                sources,
                semanticFailureReason: null,
                ...extra,
              },
            },
          ],
        },
      ],
    },
  });

  it('derives every count from `sources`, ignoring the gate\'s own numeric fields', () => {
    // The tags and the counts are two statements by the same reporter. The tags
    // are the ones that also have to COVER the union, so a disagreement shows up
    // as a number that does not add up rather than as silent self-agreement - and
    // the deliberately absurd 99s above prove which one is being read.
    const read = readClaimGateAttemptTexts(report(['DETERMINISTIC', 'SEMANTIC', 'BOTH']));
    expect(read.layers.unionClaims).toBe(3);
    expect(read.layers.deterministicClaims).toBe(2); // DETERMINISTIC + BOTH
    expect(read.layers.semanticOnlyClaims).toBe(1);
    expect(read.layers.bothLayersClaims).toBe(1);
  });

  it('records the verifier wiring three-valued: true, false, and NOBODY SAID', () => {
    expect(readClaimGateAttemptTexts(report([])).layers.verifierWired).toBe(true);

    const unwired = { claimGate: { enabled: true, verifier: { wired: false, name: null }, releases: [] } };
    expect(readClaimGateAttemptTexts(unwired).layers.verifierWired).toBe(false);

    // The field is OPTIONAL on `ClaimGateTurnReport` so older callers compile, so
    // absent means NOBODY SAID - which INV-19 treats as its own finding.
    const silent = { claimGate: { enabled: true, releases: [] } };
    expect(readClaimGateAttemptTexts(silent).layers.verifierWired).toBeNull();
  });

  it('counts fail-closed attempts and the semantic outcome by name', () => {
    const read = readClaimGateAttemptTexts(
      report([], { semanticOutcome: 'TIMED_OUT', failClosed: true }),
    );
    expect(read.layers.failClosedAttempts).toBe(1);
    expect(read.layers.semanticOutcomes).toEqual({ TIMED_OUT: 1 });
  });

  it('reports UNOBSERVED when attempts carry no `layers` object at all', () => {
    const preMission2F = {
      claimGate: { enabled: true, releases: [{ iteration: 1, attempts: [{ attempt: 1, text: 'x' }] }] },
    };
    const read = readClaimGateAttemptTexts(preMission2F);
    // The TEXT was still read - the leak and attempt numbers are unaffected.
    expect(read.observed).toBe(true);
    expect(read.texts).toEqual(['x']);
    // The attribution was not.
    expect(read.layers.observed).toBe(false);
    expect(read.layers).toMatchObject({ ...NO_LAYER_ATTRIBUTION, verifierWired: null });
  });
});

// ===========================================================================

describe('the per-turn latency decomposition', () => {
  const call = (shape: CapturedCall['shape'], wallClockMs: number, index = 0): CapturedCall => ({
    index,
    metrics: null,
    wallClockMs,
    toolCallCount: 0,
    hadText: true,
    error: null,
    shape,
  });

  it('classifies a call that offers TOOLS as the agent', () => {
    expect(
      classifyProviderCall({
        systemPrompt: 'p',
        messages: [],
        tools: [{ name: 'schedule_meeting', description: 'd', parametersJsonSchema: {} }],
      }),
    ).toBe('AGENT');
  });

  it('classifies the verifier by its OWN schema AND its OWN pinned seed', () => {
    expect(
      classifyProviderCall({
        systemPrompt: 'p',
        messages: [],
        tools: [],
        responseJsonSchema: SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA,
        determinism: { temperature: 0, seed: SEMANTIC_VERIFIER_SEED },
      }),
    ).toBe('CLAIM_VERIFIER');
  });

  it('does NOT mistake the gate\'s regeneration for the verifier', () => {
    // Regeneration is ALSO offered an empty tool list, so tools alone cannot tell
    // them apart. It carries no response schema and no pinned seed.
    expect(classifyProviderCall({ systemPrompt: 'p', messages: [], tools: [] })).toBe('GATE_REGENERATION');
    // Schema without the seed, and seed without the schema, are both NOT the
    // verifier - the conjunction is what makes the classification narrow.
    expect(
      classifyProviderCall({
        systemPrompt: 'p',
        messages: [],
        tools: [],
        responseJsonSchema: SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA,
      }),
    ).toBe('GATE_REGENERATION');
    expect(
      classifyProviderCall({
        systemPrompt: 'p',
        messages: [],
        tools: [],
        determinism: { seed: SEMANTIC_VERIFIER_SEED },
      }),
    ).toBe('GATE_REGENERATION');
  });

  it('decomposes a turn into generation, verifier, regeneration and overhead', () => {
    const breakdown = foldTurnLatency(
      [call('AGENT', 2000), call('CLAIM_VERIFIER', 500, 1), call('GATE_REGENERATION', 1500, 2), call('CLAIM_VERIFIER', 400, 3)],
      4600,
    );

    expect(breakdown.generationMs).toBe(2000);
    expect(breakdown.verifierMs).toBe(900);
    expect(breakdown.verifierCalls).toBe(2);
    expect(breakdown.regenerationMs).toBe(1500);
    expect(breakdown.overheadMs).toBe(200);
    // THE NUMBER THE MISSION ASKS FOR: what the caller waits for beyond the
    // generation they would have waited for anyway.
    expect(breakdown.impactOnTimeToUserResponseMs).toBe(2600);
    expect(breakdown.impactRatio).toBeCloseTo(2.3, 5);
    expect(breakdown.observed).toBe(true);
  });

  it('reports NULL, never a plausible zero, for a shape that made no call', () => {
    // `src/ports/llm.ts`: "`null` means NOT MEASURED. It never means zero." A turn
    // with no verifier call has an UNMEASURED verifier cost, not a free one.
    const breakdown = foldTurnLatency([call('AGENT', 1000)], 1200);
    expect(breakdown.verifierMs).toBeNull();
    expect(breakdown.verifierCalls).toBe(0);
    expect(breakdown.regenerationMs).toBeNull();
    expect(breakdown.generationMs).toBe(1000);
  });

  it('reports every field null and observed:false when the turn made NO provider call', () => {
    const breakdown = foldTurnLatency([], 42);
    expect(breakdown.observed).toBe(false);
    expect(breakdown.totalTurnMs).toBe(42);
    expect(breakdown.generationMs).toBeNull();
    expect(breakdown.verifierMs).toBeNull();
    expect(breakdown.overheadMs).toBeNull();
    expect(breakdown.impactOnTimeToUserResponseMs).toBeNull();
    expect(breakdown.impactRatio).toBeNull();
  });

  it('never reports a negative overhead or a negative impact', () => {
    // Both clocks are Date.now() and the provider sum cannot exceed the turn it
    // happened inside - but a negative number here would be a measurement
    // artefact printed as a finding, and a floor is cheaper than explaining one.
    const breakdown = foldTurnLatency([call('AGENT', 5000)], 4999);
    expect(breakdown.overheadMs).toBe(0);
    expect(breakdown.impactOnTimeToUserResponseMs).toBe(0);
  });

  it('aggregates to per-model percentiles, and skips turns that observed nothing', () => {
    const score = scoreModel([
      run('m', [
        turn(0, claims(), foldTurnLatency([call('AGENT', 1000), call('CLAIM_VERIFIER', 300, 1)], 1400)),
        turn(1, claims(), foldTurnLatency([call('AGENT', 2000), call('CLAIM_VERIFIER', 500, 1)], 2600)),
        // A turn that threw before reaching the provider contributes NOTHING,
        // rather than a zero that would drag every percentile down.
        turn(2, claims(), foldTurnLatency([], 5)),
      ]),
    ]);

    expect(score.layeredLatency.observedTurns).toBe(2);
    expect(score.layeredLatency.verifier.n).toBe(2);
    expect(score.layeredLatency.verifierCalls).toBe(2);
    expect(score.layeredLatency.impact.p50Ms).toBe(400);
    expect(score.layeredLatency.total.p95Ms).toBe(2600);
  });

  it('reports `not measured` for a run that predates harness 1.3.0', () => {
    const score = scoreModel([run('old', [turn(0, claims())])]);
    expect(score.layeredLatency.observedTurns).toBe(0);
    expect(score.layeredLatency.verifier.p50Ms).toBeNull();
    expect(score.layeredLatency.meanImpactRatio).toBeNull();

    const { markdown } = buildReport({
      runsByModel: new Map([['old', [run('old', [turn(0, claims())])]]]),
      generatedAtIso: '2026-09-28T10:00:00.000Z',
    });
    expect(markdown).toContain('What the second layer costs the caller');
  });

  it('renders the impact column and says what it does and does not contain', () => {
    const { markdown } = buildReport({
      runsByModel: new Map([
        [
          'm',
          [run('m', [turn(0, claims(), foldTurnLatency([call('AGENT', 1000), call('CLAIM_VERIFIER', 300, 1)], 1400))])],
        ],
      ]),
      generatedAtIso: '2026-09-28T10:00:00.000Z',
    });
    expect(markdown).toContain('Impact p50');
    expect(markdown).toContain('is NOT "the gate\'s cost"');
    expect(markdown).toContain('should equal the number of customer-facing texts');
    expect(markdown).toContain('classification and not an identity check');
  });
});

// ===========================================================================

describe('the turn-level helper agrees with the field', () => {
  it('is false for an absent field and for an unobserved one', () => {
    expect(turnClaimLayersObserved(turn(0, claims()))).toBe(false);
    expect(turnClaimLayersObserved(turn(0, { ...claims(), ...layers({ observed: false }) }))).toBe(false);
    expect(turnClaimLayersObserved(turn(0, { ...claims(), ...layers() }))).toBe(true);
  });
});
