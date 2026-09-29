/**
 * Guards on the LATENCY HARNESS, not on the latencies.
 *
 * WHY THERE IS NO TIMING ASSERTION HERE
 * ---------------------------------------------------------------------------
 * A wall-clock assertion would be flaky on a host that also runs an 879-scenario
 * sweep, and a flaky merge gate gets the whole gate switched off - which is the
 * failure mode this mission exists to fix. The measured run for
 * `npm run qa:claim-gate-latency` on this host produced a NEGATIVE end-to-end
 * overhead on one pass (-7.0 ms, which is physically impossible), so the noise
 * floor is empirically comparable to the quantity being measured. Asserting a
 * threshold on that would be asserting noise.
 *
 * WHAT CAN GO WRONG SILENTLY, AND IS THEREFORE ASSERTED
 * ---------------------------------------------------------------------------
 * The published table in `docs/MISSION_2D_CLAIM_GATE_ASSURANCE.md` says things
 * about its INPUTS - that the worst-case sample is the length of the worst real
 * turn, that the Hebrew sample is really Hebrew, that the no-claim control really
 * asserts nothing. Every one of those could stop being true through an innocent
 * edit, and then the table would describe a measurement nobody took. Those are
 * cheap, deterministic and worth pinning.
 */
import { describe, expect, it } from 'vitest';

import { detectMaterialClaims } from '../../src/agent/claimGate/detector.js';
import { NEUTRAL_SWEEP_TEXT } from '../invariants/runner.js';
import { TEXT_SAMPLES } from './claimGateLatency.js';

describe('the claim-gate latency harness measures what it says it measures', () => {
  it('keeps the worst-case sample at the size of the worst real turn', () => {
    const worst = TEXT_SAMPLES.find((sample) => sample.key === 'mixed-worst-case-7402');
    expect(worst, 'the worst-case sample is the headline cell of the published table').toBeDefined();
    // docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md § 6.2 records a real
    // qwen2.5:7b-instruct turn of 7,402 characters. Exactly, not approximately -
    // the point of the sample is that a reader can match it to that figure.
    expect(worst?.text.length).toBe(7402);
    expect(
      detectMaterialClaims(worst?.text ?? '').length,
      'the worst case must be claim-DENSE, so it over-states rather than under-states the cost',
    ).toBeGreaterThan(50);
  });

  it('keeps the no-claim control asserting nothing', () => {
    const control = TEXT_SAMPLES.find((sample) => sample.key === 'en-short-no-claim');
    expect(control).toBeDefined();
    expect(
      detectMaterialClaims(control?.text ?? '').length,
      'the whole point of this cell is the free path: no claim, so no ledger and no database read. If a ' +
        'lexicon form ever starts firing on it, the published "gate is free on an ordinary turn" row is wrong.',
    ).toBe(0);
    // And it must stay the sentence the sweep itself releases 879 times, or the
    // two measurements stop describing the same thing.
    expect(control?.text).toBe(NEUTRAL_SWEEP_TEXT);
  });

  it('keeps every sample the language it claims to be, and every claiming sample claiming', () => {
    const hebrew = /[֐-׿]/;
    for (const sample of TEXT_SAMPLES) {
      if (sample.language === 'he') {
        expect(hebrew.test(sample.text), `${sample.key} is declared Hebrew but carries no Hebrew letter`).toBe(true);
        expect(/[a-z]{4,}/i.test(sample.text), `${sample.key} is declared he, not mixed`).toBe(false);
      }
      if (sample.language === 'mixed') {
        expect(hebrew.test(sample.text), `${sample.key} is declared mixed but carries no Hebrew`).toBe(true);
        expect(/[a-z]{4,}/i.test(sample.text), `${sample.key} is declared mixed but carries no English`).toBe(true);
      }
      if (sample.language === 'en') {
        expect(hebrew.test(sample.text), `${sample.key} is declared English but carries Hebrew`).toBe(false);
      }

      // `asserts` drives the claim about whether the ledger is built at all, so
      // it has to agree with the detector rather than with somebody's memory.
      expect(
        detectMaterialClaims(sample.text).length > 0,
        `${sample.key} declares asserts=${sample.asserts} but the detector disagrees`,
      ).toBe(sample.asserts);
    }
  });

  it('covers every language and both ends of the size range', () => {
    const languages = new Set(TEXT_SAMPLES.map((sample) => sample.language));
    expect([...languages].sort()).toEqual(['en', 'he', 'mixed']);
    const lengths = TEXT_SAMPLES.map((sample) => sample.text.length);
    expect(Math.min(...lengths), 'a short turn must be measured').toBeLessThan(60);
    expect(Math.max(...lengths), 'a long turn must be measured').toBeGreaterThan(7000);
  });
});
