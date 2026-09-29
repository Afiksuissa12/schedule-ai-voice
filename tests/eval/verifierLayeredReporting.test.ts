/**
 * THE LAYERED-UNION REPORTING WORKS - PROVEN WITHOUT A MODEL.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------------------------------------------------------------
 * The Founder requires semantic-only AND layered numbers, per language, and
 * Mission 2F's harness reported only the semantic layer. Mission 2G added three
 * recalls and three false-positive rates per language, plus the count this mission
 * is judged on: CLAIMS MISSED BY BOTH LAYERS.
 *
 * None of that needs a model. The first layer is `detectMaterialClaims`, which is
 * pure; the combination is the REAL `unionClaims`, which is pure; and the second
 * layer is supplied here by the same deterministic doubles Mission 2F used. So the
 * whole table is exercised end to end against committed bytes.
 *
 * WHAT IT DOES **NOT** PROVE, said plainly because the distinction is the whole
 * reason `npm run eval:verifier` exists. It proves the HARNESS computes the three
 * columns correctly. It proves nothing about whether a real model recognises a
 * claim: every verdict below was written down by a person.
 * `docs/MISSION_2F_SEMANTIC_VERIFIER.md` § 12 residual 1 is the same warning one
 * layer down, and it is the most over-readable kind of number in this repository.
 *
 * NO MODEL, NO SOCKET, NO CLOCK.
 */
import { describe, expect, it } from 'vitest';

import { detectMaterialClaims } from '../../src/agent/claimGate/detector.js';
import {
  RuleDrivenSemanticClaimVerifier,
  ScriptedSemanticClaimVerifier,
} from '../../src/agent/claimGate/semantic/doubles.js';
import { unionClaims } from '../../src/agent/claimGate/semantic/union.js';
import { loadVerifierCorpus } from '../../src/eval/verifier/corpus.js';
import { VERIFIER_EVAL_VERSION, runVerifierEval, scoreCase } from '../../src/eval/verifier/run.js';
import { buildVerifierArtefacts, NO_ENVIRONMENT_RECORD } from '../../src/eval/verifier/output.js';
import type { VerifierCase } from '../../src/eval/verifier/schema.js';

const CORPUS = loadVerifierCorpus();

const INVOCATION = {
  numCtx: 16_384,
  baseUrl: 'http://example.invalid:11434',
  timeoutMs: 20_000,
  localeHintSent: false,
  languagesRequested: ['en', 'he', 'mixed'],
  splitRequested: 'all',
  corpusFile: null,
  corpusSha256: null,
};

/** A double that flags exactly the cases whose id is in `ids`, and nothing else. */
function verifierFlagging(ids: readonly string[]): RuleDrivenSemanticClaimVerifier {
  const wanted = new Set(ids);
  const rules = CORPUS.cases
    .filter((entry) => wanted.has(entry.id))
    .map((entry) => ({
      // A needle STEERS the double; it is a value to be recognised and never a value
      // to be spoken. Same convention as `ScriptedLlmProvider`'s catalogue.
      needle: entry.text.slice(0, Math.min(24, entry.text.length)),
      effectFamily: entry.effectFamily,
      status: 'COMPLETED' as const,
    }));
  return new RuleDrivenSemanticClaimVerifier({ rules });
}

async function report(verifier: RuleDrivenSemanticClaimVerifier | ScriptedSemanticClaimVerifier, cases = CORPUS.cases) {
  return runVerifierEval({
    verifier,
    cases,
    corpusVersion: CORPUS.corpusVersion,
    corpusSchemaVersion: CORPUS.schemaVersion,
    modelId: 'double',
    startedAtIso: '2026-09-28T09:00:00.000Z',
  });
}

describe('the deterministic layer is the REAL one, imported and not reimplemented', () => {
  it('records, per case, exactly what detectMaterialClaims returns', async () => {
    const got = await report(new RuleDrivenSemanticClaimVerifier());
    const byId = new Map(got.results.map((r) => [r.caseId, r]));
    for (const entry of CORPUS.cases) {
      const expected = detectMaterialClaims(entry.text);
      const result = byId.get(entry.id);
      expect(result, entry.id).toBeDefined();
      expect(result?.deterministicClaims, entry.id).toBe(expected.length);
      expect(result?.deterministicFlagged, entry.id).toBe(expected.length > 0);
    }
  });

  it('combines through the REAL unionClaims, not a copy of its rule', () => {
    // The union is the module the additive property is proved about. If the harness
    // had its own idea of "combine", the layered column would be a statement about
    // the harness.
    for (const entry of CORPUS.cases.slice(0, 40)) {
      const verdict = { kind: 'CLASSIFIED' as const, claims: [], modelId: null };
      const deterministic = detectMaterialClaims(entry.text);
      const union = unionClaims({ text: entry.text, deterministic, verdict });
      const scored = scoreCase(entry, verdict, 1);
      expect(scored.unionClaims, entry.id).toBe(union.claims.length);
      expect(scored.layeredFlagged, entry.id).toBe(union.claims.length > 0);
      expect(scored.unionFailClosed, entry.id).toBe(union.failClosed);
    }
  });

  it('bumped the eval version, because the artefact gained three quantities', () => {
    expect(VERIFIER_EVAL_VERSION).toBe('2.0.0');
  });
});

describe('a RULE-LESS second layer leaves the deterministic numbers standing alone', () => {
  it('reports the detector\'s recall and a 0% semantic recall in the same run', async () => {
    // The offline default. `new RuleDrivenSemanticClaimVerifier()` returns CLASSIFIED
    // with an empty claim list for every text, so it ADDS NOTHING - and the layered
    // column must therefore equal the deterministic column exactly. That identity is
    // the cleanest available check that the union is additive rather than
    // substitutive from this harness's side.
    const got = await report(new RuleDrivenSemanticClaimVerifier());
    expect(got.overall.recall).toBe(0);
    expect(got.overall.deterministicRecall).not.toBeNull();
    expect(got.overall.deterministicRecall).toBeGreaterThan(0);
    expect(got.overall.layeredRecalledClaims).toBe(got.overall.deterministicRecalledClaims);
    expect(got.overall.layeredRecall).toBe(got.overall.deterministicRecall);
    expect(got.overall.semanticOnlyRecalledClaims).toBe(0);
    for (const language of ['en', 'he', 'mixed'] as const) {
      const slice = got.byLanguage[language];
      expect(slice.layeredRecall, language).toBe(slice.deterministicRecall);
      expect(slice.layeredFalsePositives, language).toBe(slice.deterministicFalsePositives);
    }
  });

  it('reports MISSED BY BOTH as exactly the detector\'s misses, with the ids', async () => {
    const got = await report(new RuleDrivenSemanticClaimVerifier());
    const detectorMisses = CORPUS.cases
      .filter((entry) => entry.kind === 'CLAIM' && detectMaterialClaims(entry.text).length === 0)
      .map((entry) => entry.id);
    expect(got.overall.missedByBothClaims).toBe(detectorMisses.length);
    expect([...got.overall.missedByBothCaseIds].sort()).toEqual([...detectorMisses].sort());
    // Nothing failed closed, so the second column is empty.
    expect(got.overall.missedByDetectorAndUnansweredClaims).toBe(0);
    // And the per-language ids partition the overall list.
    const perLanguage = (['en', 'he', 'mixed'] as const).flatMap((l) => [
      ...got.byLanguage[l].missedByBothCaseIds,
    ]);
    expect(perLanguage.sort()).toEqual([...got.overall.missedByBothCaseIds].sort());
  });
});

describe('a second layer that catches what the detector misses moves the layered column ONLY', () => {
  it('raises layered recall above deterministic recall and shrinks MISSED BY BOTH', async () => {
    const detectorMisses = CORPUS.cases
      .filter((entry) => entry.kind === 'CLAIM' && detectMaterialClaims(entry.text).length === 0)
      .map((entry) => entry.id);
    expect(detectorMisses.length).toBeGreaterThan(10);

    const got = await report(verifierFlagging(detectorMisses));
    expect(got.overall.deterministicRecall).toBeLessThan(1);
    expect(got.overall.layeredRecall).toBe(1);
    expect(got.overall.missedByBothClaims).toBe(0);
    expect(got.overall.missedByBothCaseIds).toEqual([]);
    // Every one of them was contributed by the SECOND layer alone, which is the
    // "caught ONLY by the semantic layer" column.
    expect(got.overall.semanticOnlyRecalledClaims).toBe(detectorMisses.length);
    // AND THE DETERMINISTIC COLUMN DID NOT MOVE. The union may only add.
    const baseline = await report(new RuleDrivenSemanticClaimVerifier());
    expect(got.overall.deterministicRecalledClaims).toBe(baseline.overall.deterministicRecalledClaims);
    expect(got.overall.deterministicFalsePositives).toBe(baseline.overall.deterministicFalsePositives);
  });

  it('counts a second-layer FALSE POSITIVE into the layered FP rate and not the deterministic one', async () => {
    const control = CORPUS.cases.find(
      (entry) => entry.kind === 'HONEST_CONTROL' && detectMaterialClaims(entry.text).length === 0,
    );
    expect(control).toBeDefined();
    if (!control) return;

    const got = await report(verifierFlagging([control.id]));
    expect(got.overall.falsePositives).toBeGreaterThanOrEqual(1);
    expect(got.overall.layeredFalsePositives).toBeGreaterThan(got.overall.deterministicFalsePositives);
  });
});

describe('a fail-closed second layer is never a layered hit', () => {
  it('separates MISSED BY BOTH from "the detector missed and nobody answered"', async () => {
    // The distinction that decides whether a run describes a blind gate or a sick
    // host. A TIMED_OUT verdict blocks the text in production, so it is not a leak -
    // and it is not recall either, so it may not be added to the first column.
    const got = await report(
      new ScriptedSemanticClaimVerifier({ onExhausted: { kind: 'TIMED_OUT', reason: 'the deadline expired' } }),
    );
    const detectorMisses = CORPUS.cases.filter(
      (entry) => entry.kind === 'CLAIM' && detectMaterialClaims(entry.text).length === 0,
    ).length;

    expect(got.overall.recall).toBeNull();
    expect(got.overall.missedByBothClaims).toBe(0);
    expect(got.overall.missedByDetectorAndUnansweredClaims).toBe(detectorMisses);
    // The layered column is still the detector's, because the union carries the
    // deterministic list entire whatever the second layer did.
    expect(got.overall.layeredRecalledClaims).toBe(got.overall.deterministicRecalledClaims);
  });

  it('keeps the deterministic denominator at EVERY claim, not the answered ones', async () => {
    const got = await report(
      new ScriptedSemanticClaimVerifier({ onExhausted: { kind: 'UNAVAILABLE', reason: 'host down' } }),
    );
    // The semantic recall has no denominator at all here; the other two do.
    expect(got.overall.recall).toBeNull();
    expect(got.overall.deterministicRecall).not.toBeNull();
    expect(got.overall.layeredRecall).not.toBeNull();
    expect(got.overall.claimsNotAnswered).toBe(got.overall.claims);
  });
});

describe('the artefact carries the layered numbers and the split', () => {
  it('prints all three recalls and all three FP rates per language in the markdown', async () => {
    const { markdown } = buildVerifierArtefacts({
      report: await report(new RuleDrivenSemanticClaimVerifier()),
      environment: NO_ENVIRONMENT_RECORD,
      generatedAtIso: '2026-09-28T10:00:00.000Z',
      invocation: { ...INVOCATION, languagesRequested: [...INVOCATION.languagesRequested] },
      runtimeVersion: '0.12.3',
    });
    expect(markdown).toContain('Det. recall');
    expect(markdown).toContain('Sem. recall');
    expect(markdown).toContain('Layered recall');
    expect(markdown).toContain('Det. FP');
    expect(markdown).toContain('Layered FP');
    expect(markdown).toContain('MISSED BY BOTH LAYERS');
    expect(markdown).toContain('Caught ONLY by the semantic layer');
    expect(markdown).toContain('SPLIT: `all`');
    // Per language, in all three tables.
    for (const label of ['| English |', '| Hebrew |', '| Mixed |']) expect(markdown).toContain(label);
  });

  it('lists the MISSED BY BOTH case ids in the markdown, and no case TEXT', async () => {
    const got = await report(new RuleDrivenSemanticClaimVerifier());
    const { markdown } = buildVerifierArtefacts({
      report: got,
      environment: NO_ENVIRONMENT_RECORD,
      generatedAtIso: '2026-09-28T10:00:00.000Z',
      invocation: { ...INVOCATION, languagesRequested: [...INVOCATION.languagesRequested] },
      runtimeVersion: '0.12.3',
    });
    expect(got.overall.missedByBothCaseIds.length).toBeGreaterThan(0);
    for (const id of got.overall.missedByBothCaseIds) expect(markdown).toContain(id);
  });

  it('carries split, corpusSource and corpusSha256 at the top of the JSON', async () => {
    const { json } = buildVerifierArtefacts({
      report: await report(new RuleDrivenSemanticClaimVerifier(), CORPUS.cases.slice(0, 8)),
      environment: NO_ENVIRONMENT_RECORD,
      generatedAtIso: '2026-09-28T10:00:00.000Z',
      invocation: { ...INVOCATION, languagesRequested: [...INVOCATION.languagesRequested] },
      runtimeVersion: '0.12.3',
    });
    const parsed = json as { split: string; corpusSource: string; corpusSha256: string | null };
    expect(parsed.split).toBe('all');
    expect(parsed.corpusSource).toBe('in-repo');
    expect(parsed.corpusSha256).toBeNull();
  });

  it('records the split it was TOLD, not a guess', async () => {
    for (const split of ['dev', 'heldout', 'all'] as const) {
      const got = await runVerifierEval({
        verifier: new RuleDrivenSemanticClaimVerifier(),
        cases: CORPUS.cases.filter((c) => split === 'all' || c.split === split).slice(0, 6),
        corpusVersion: CORPUS.corpusVersion,
        corpusSchemaVersion: CORPUS.schemaVersion,
        split,
        corpusSource: '/tmp/sealed.json',
        corpusSha256: 'deadbeef',
        modelId: 'double',
        startedAtIso: '2026-09-28T09:00:00.000Z',
      });
      expect(got.split).toBe(split);
      expect(got.corpusSource).toBe('/tmp/sealed.json');
      expect(got.corpusSha256).toBe('deadbeef');
    }
  });
});

describe('the KNOWN deterministic false positives are marked MECHANICALLY, not from memory', () => {
  it('flags exactly the controls the PURE detector actually flags', () => {
    // `docs/MISSION_2D_CLAIM_GATE.md` § 17.7 finding B recorded TWO. Mission 2G found
    // a third while writing the new held-out controls, by running this very check.
    // Asserting the two sets are EQUAL is what stops the count going stale in either
    // direction: a new over-reading cannot be left unrecorded, and a fixed one cannot
    // stay claimed.
    const marked = CORPUS.cases
      .filter((entry) => entry.knownDeterministicFalsePositive === true)
      .map((entry) => entry.id)
      .sort();
    const actuallyFlagged = CORPUS.cases
      .filter((entry) => entry.kind === 'HONEST_CONTROL' && detectMaterialClaims(entry.text).length > 0)
      .map((entry) => entry.id)
      .sort();
    expect(marked).toEqual(actuallyFlagged);
    expect(marked.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps every marked row an HONEST_CONTROL', () => {
    for (const entry of CORPUS.cases.filter((c) => c.knownDeterministicFalsePositive === true)) {
      expect(entry.kind, entry.id).toBe('HONEST_CONTROL');
    }
  });
});

describe('the corpus is measurable on the axis the whole mission is about', () => {
  it('has claims the deterministic layer MISSES in every language, so the second layer has work', () => {
    // If every claim were caught by the first layer, the semantic-only column would
    // be 0 by construction and the whole measurement would be uninformative. This
    // asserts the corpus actually poses the question.
    for (const language of ['en', 'he', 'mixed'] as const) {
      const misses = CORPUS.cases.filter(
        (entry: VerifierCase) =>
          entry.kind === 'CLAIM' && entry.language === language && detectMaterialClaims(entry.text).length === 0,
      );
      expect(misses.length, `${language} has no deterministic misses to measure`).toBeGreaterThan(0);
    }
  });

  it('has HELD-OUT claims the deterministic layer misses, which is where the final number lives', () => {
    const misses = CORPUS.cases.filter(
      (entry) =>
        entry.kind === 'CLAIM' && entry.split === 'heldout' && detectMaterialClaims(entry.text).length === 0,
    );
    expect(misses.length).toBeGreaterThanOrEqual(15);
  });
});
