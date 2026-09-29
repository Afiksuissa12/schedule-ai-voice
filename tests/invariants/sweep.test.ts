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
 * The corpus is several hundred scenarios and the invariant list is sixteen, so
 * this is thousands of checks. Emitting one vitest case per check would bury
 * every other test in the repository and make the run unreadable. Instead the
 * sweep runs once and every violation is reported together, each quoting its
 * scenario id - which is stable, generated from fixed data, and sufficient to
 * reproduce the case on its own:
 *
 *     npm run qa:sweep -- --family B
 *
 * The non-vacuity assertions below are the guard against the obvious failure
 * mode of that design: a sweep where everything is refused, or nothing is
 * checked, would otherwise pass in silence.
 */
import { describe, expect, it } from 'vitest';

import { claimGateSummary, summarizeInvariants } from '../qa/report.js';
import { executeSweep } from './sweep.js';
import { generateScenarios } from './scenarios.js';

// The corpus is several hundred scenarios against real SQLite databases. It is
// the slowest thing in the suite by design; the budget is generous so a loaded
// CI machine does not produce a flaky failure that looks like a real one.
const SWEEP_TIMEOUT_MS = 900_000;

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

      // --- the locale work is actually exercised ---------------------------
      // Structural invariants can pass on an all-English corpus, so the
      // presence of Hebrew in the matrix is asserted rather than assumed. A
      // future edit that dropped family L, or that stopped `seedSliceWorld`
      // accepting Asia/Jerusalem, would otherwise leave INV-16 quietly
      // inapplicable and everything still green.
      const hebrewLetters = /[֐-׿]/;
      const localeScenarios = sweep.scenarios.filter((scenario) => scenario.family === 'L-locale-parity');
      expect(localeScenarios.length, 'family L must be in the corpus').toBeGreaterThan(50);
      expect(
        localeScenarios.filter((scenario) => hebrewLetters.test(JSON.stringify(scenario.args))).length,
        'half of family L must actually carry Hebrew in the tool arguments',
      ).toBeGreaterThan(20);
      expect(
        new Set(sweep.scenarios.map((scenario) => scenario.world.contactTimezone)),
        'Asia/Jerusalem - the zone the defect was found in - must be swept',
      ).toContain('Asia/Jerusalem');

      const localePersisted = sweep.observations.filter(
        (observation) => observation.family === 'L-locale-parity' && observation.outcome === 'PERSISTED',
      );
      expect(
        localePersisted.length,
        'family L that refused everything would satisfy INV-15 and INV-17 vacuously',
      ).toBeGreaterThan(30);

      // --- INV-18: the claim gate was actually exercised -------------------
      // Every scenario in the corpus releases text, so INV-18 is applicable
      // almost everywhere - which is how it could look busy while proving
      // nothing. Families A-L release two sentences that assert NOTHING
      // material, so without family M the invariant would report well over a
      // thousand green checks having never examined a single claim. These
      // assertions are the guard against precisely that, and they are stated in
      // terms of claims examined rather than checks passed.
      const gate = claimGateSummary(sweep.observations);
      expect(
        gate.scenariosWithoutAGate,
        'every scenario is built by buildAgentRuntime, which always wires a claim gate and offers no way ' +
          'to disable it. A scenario without one means the production composition root changed.',
      ).toBe(0);
      expect(
        gate.leakedClaims,
        'a claim the gate itself flagged as unsupported, on the very attempt whose text it released. This ' +
          'is a customer being told something false, and it is the one number here that must be zero.',
      ).toBe(0);
      expect(
        gate.releasesWithAClaim,
        'INV-18 must have examined real assertions, not only the two neutral sentences families A-L release. ' +
          'If this is low, family M has been dropped or its wording no longer asserts anything.',
      ).toBeGreaterThan(30);
      expect(
        gate.releasesWithheld,
        'the designed exhaustion outcome must actually be reached by the corpus; a withholding path that is ' +
          'never driven is a path nobody has seen work',
      ).toBeGreaterThan(0);
      expect(
        gate.byOutcome.map((row) => row.outcome).sort(),
        'all four claim-gate outcomes must occur in the corpus. A gate that only ever reports ' +
          'NO_MATERIAL_CLAIM has not been tested; one that never reports SUPPORTED would mean it blocks ' +
          'every true sentence too.',
      ).toEqual(['CORRECTED_AFTER_REGENERATION', 'NO_MATERIAL_CLAIM', 'SUPPORTED', 'WITHHELD_HANDED_OFF']);
      // And the rejection reasons have to have been produced by real turns, not
      // only by the pure-function corpus in tests/claimGate/.
      for (const reason of [
        'NO_MATCHING_EFFECT',
        'EFFECT_WAS_REFUSED',
        'WRONG_DAY',
        'WRONG_TIME',
        'INVENTED_IDENTIFIER',
        'NO_TOOL_FOR_PROMISE',
      ]) {
        expect(
          gate.byUnsupportedReason.map((row) => row.reason),
          `no turn in the sweep ever produced ${reason}, so the sweep has not seen that rejection work ` +
            'end to end',
        ).toContain(reason);
      }

      // --- INV-18's SECOND witness must not go vacuous either ---------------
      // The detector-based half above can look busy while proving nothing, and
      // for four rounds it did (docs/MISSION_2D_CLAIM_GATE.md § 17.2). The
      // independent oracle added in § 17.5 can fail the same way, one level up:
      // if every released sentence were declared to assert nothing, it would
      // report perfect agreement having judged no claim at all. These three
      // assertions are the guard, and they are on what was JUDGED rather than on
      // what passed.
      expect(
        gate.releasesUndeclared,
        'a released sentence that no hand-authored declaration covers. INV-18 fails each one, so this being ' +
          'non-zero means the sweep is already red - it is asserted here as well so the reason is legible: ' +
          'every scripted model text must be declared in tests/invariants/releaseTexts.ts beside the sentence.',
      ).toBe(0);
      expect(
        gate.witnessAgreement.BOTH_SAW_A_CLAIM,
        'the independent oracle must have judged real assertions, not only sentences declared to assert ' +
          'nothing. If this is zero the declarations have been emptied and the oracle is agreeing with the ' +
          'detector about silence, which is exactly the vacuity it was built to remove.',
      ).toBeGreaterThan(20);
      expect(
        gate.witnessAgreement.BOTH_SILENT,
        'and it must have judged the honest sentences too - a corpus in which everything asserts something ' +
          'would make the oracle a machine for failing every release',
      ).toBeGreaterThan(100);

      // --- INV-19: THE LAYERED PIPELINE, AND IT HAS ITS OWN VACUITY MODE ----
      //
      // INV-19 is applicable to nearly every scenario, because nearly every
      // scenario releases text - which is exactly how it could look busy while
      // proving nothing. Its vacuity mode is specific and worth naming: if the
      // sweep's verifier were never wired, EVERY attempt would report `ABSENT`,
      // every one would be a violation, and the sweep would be red rather than
      // vacuously green. The real risk is the opposite - a verifier wired but never
      // varied, so that every attempt reports CLASSIFIED and the dimension the
      // Founder asked for is a label on nothing. § 21.9 is the record of exactly
      // that happening to the `contracted` axis. These floors are the guard.
      expect(
        gate.layered.scenariosWithoutAVerifier,
        'every scenario is built by buildAgentRuntime, which always resolves a semantic claim verifier and ' +
          'offers no way to remove one. A scenario without one means the production composition root changed, ' +
          'and INV-19 fails each one.',
      ).toBe(0);
      expect(
        gate.layered.scenariosWithWiringNotReported,
        'a scenario whose report did not SAY whether a verifier was wired. Unstated is not the same as wired: ' +
          'defaulting an unknown to safe is the silence § 17.5 exists to remove.',
      ).toBe(0);
      expect(
        gate.layered.releasedWhileFailClosed,
        'TEXT REACHED A CALLER ON AN ATTEMPT WHOSE SECOND LAYER PRODUCED NOTHING USABLE. Malformed, ' +
          'timed-out, unavailable, empty and absent verifier output is UNSUPPORTED and never clean - a check ' +
          'that did not happen is not a check that passed. This is the fail-open direction and it is the one ' +
          'thing the second layer was added to make impossible.',
      ).toBe(0);
      expect(
        gate.layered.unionsSmallerThanDeterministic,
        'the union is a SUPERSET of the deterministic claim set by construction, so a smaller one means the ' +
          'semantic layer removed a claim the first layer found - the one thing it may never do',
      ).toBe(0);

      // Now the non-vacuity half: the dimension must really have been varied.
      expect(
        gate.layered.attemptsTheSecondLayerAnswered,
        'the second layer never ANSWERED anywhere in the sweep, so INV-19 checked the shape of a pipeline ' +
          'that never ran. Counted as answers and never as claims - a CLASSIFIED verdict with an empty claim ' +
          'list is an answer, and that distinction is the whole point of the ABSENT outcome existing.',
      ).toBeGreaterThan(1_000);
      expect(
        gate.layered.attemptsFailClosed,
        'THE FAIL-CLOSED PATH MUST ACTUALLY BE DRIVEN. A path nobody has seen work is a path nobody has ' +
          'seen work, and this one is the whole of the Founder\'s fail-safe direction: specs r77-r80 and r86 ' +
          'exist to reach it.',
      ).toBeGreaterThan(20);
      expect(
        gate.layered.semanticOnlyClaims,
        'no claim anywhere in the sweep was found by the SEMANTIC layer alone, so cross-layer proof (a) was ' +
          'not exercised end to end. Specs r81 and r82 exist to produce these, and each one is a claim that ' +
          'would have leaked before this mission.',
      ).toBeGreaterThan(0);

      // ALL FOUR FAILURE VARIANTS, BY NAME. A fail-closed count of 20 could be one
      // variant twenty times, and an operator asking "why did last night hand off
      // four hundred turns" needs to tell a dead provider from a model emitting
      // prose from a host under load - which have completely different fixes.
      const outcomesSeen = gate.layered.attemptsBySemanticOutcome.map((row) => row.outcome);
      for (const variant of ['CLASSIFIED', 'MALFORMED', 'TIMED_OUT', 'UNAVAILABLE', 'EMPTY']) {
        expect(
          outcomesSeen,
          `no attempt in the sweep reported ${variant}, so that state of the second layer has not been seen ` +
            'to work end to end',
        ).toContain(variant);
      }
      expect(
        outcomesSeen,
        'ABSENT is the declared TEST-ONLY seam. If it appears in the sweep, a path that skips the second ' +
          'layer is reachable through the composition root.',
      ).not.toContain('ABSENT');

      // ALL THREE SOURCE TAGS. The report prints "which layer caught each claim",
      // and a report offering three answers over a corpus that only ever produced
      // two is the half-crossed axis § 21.9 is about, arriving in the report.
      const sourcesSeen = gate.layered.claimsBySource.map((row) => row.source);
      expect(
        sourcesSeen.slice().sort(),
        'all three ClaimSource values must be produced by real turns: DETERMINISTIC (the first layer alone), ' +
          'SEMANTIC (the second alone - a claim that would have leaked before), and BOTH (they agreed). ' +
          'Specs r81/r82 and r87 exist to produce the second and third.',
      ).toEqual(['BOTH', 'DETERMINISTIC', 'SEMANTIC']);

      // And the reason code has to have been produced by a real turn, not only by
      // the pure-function corpus in tests/claimGate/.
      expect(
        gate.byUnsupportedReason.map((row) => row.reason),
        'no turn in the sweep ever produced SEMANTIC_CHECK_UNAVAILABLE, so the fail-closed rejection has not ' +
          'been seen to work end to end',
      ).toContain('SEMANTIC_CHECK_UNAVAILABLE');

      const claimFamily = sweep.scenarios.filter((scenario) => scenario.family === 'M-claim-release');
      expect(claimFamily.length, 'family M must be in the corpus').toBeGreaterThan(40);
      const hebrewClaims = claimFamily.filter((scenario) => /[֐-׿]/.test(JSON.stringify(scenario.release ?? {})));
      expect(
        hebrewClaims.length,
        'family M must carry Hebrew claim texts - Hebrew is the path with no recommended model',
      ).toBeGreaterThan(8);

      // --- no invariant may be vacuous -------------------------------------
      const summaries = summarizeInvariants(sweep.results);
      const vacuous = summaries.filter((summary) => summary.vacuous);
      expect(
        vacuous.map((summary) => summary.id),
        'an invariant with nothing to check is not evidence; it must not be reported as passing',
      ).toEqual([]);

      // And the three locale invariants in particular must have had real work
      // to do, not one applicable check each.
      for (const id of [
        'INV-15-no-accepted-resolution-ignores-a-token',
        'INV-16-hebrew-and-english-parity',
        'INV-17-resolved-day-is-the-day-the-phrase-named',
        // INV-19 is applicable to almost every scenario, so a LOW number here
        // would mean the layer report had stopped being populated rather than
        // that the invariant was narrow.
        'INV-19-every-customer-facing-text-passed-both-claim-layers',
      ]) {
        const summary = summaries.find((candidate) => candidate.id === id);
        expect(summary, `${id} is not registered in INVARIANTS`).toBeDefined();
        expect(summary?.checked, `${id} examined too little to be evidence`).toBeGreaterThan(50);
      }
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
