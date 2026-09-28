/**
 * THE WIRING HAS NO HOLE.
 *
 * `buildAgentRuntime` is the only supported way to get an `AgentTurnService`, and
 * the requirement is absolute: no path through it releases customer-facing text
 * without either a verifier verdict or a fail-closed treatment. That means
 * `resolveClaimVerifier` must never return null, on any combination of options -
 * and it means the offline path must get a DETERMINISTIC double rather than a real
 * one, or `npm test`, the sweep and `slice:demo` would start wanting a model.
 *
 * Nothing here opens a database or calls a model. `buildAgentRuntime` needs a
 * `Database`, so these tests use the shared test harness for that and touch
 * nothing else; the assertions are all about which objects were constructed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildAgentRuntime } from '../../src/app/composition.js';
import {
  LlmSemanticClaimVerifier,
  RuleDrivenSemanticClaimVerifier,
  ScriptedSemanticClaimVerifier,
} from '../../src/agent/claimGate/semantic/index.js';
import { LocalLlmProvider } from '../../src/llm/localLlmProvider.js';
import { ScriptedLlmProvider } from '../../src/llm/scriptedLlmProvider.js';
import { MetricsCapturingProvider } from '../../src/eval/runner/metricsCapturingProvider.js';
import { ConfigurationError } from '../../src/shared/errors.js';
import { FixedClock } from '../../src/ports/clock.js';
import type { IsoUtcString } from '../../src/ports/clock.js';
import { createTestDatabase, type TestDatabase } from '../helpers/testDb.js';

const NOW = '2026-03-04T15:00:00.000Z' as IsoUtcString;

/**
 * One database for the whole file, and nothing writes to it.
 *
 * It exists only because `buildAgentRuntime` requires one. Every assertion below
 * is about WHICH OBJECTS the composition root constructed, so no turn is run, no
 * row is written and no provider is called.
 */
let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase({ label: 'claim-verifier-composition' });
});

afterAll(async () => {
  await testDb?.cleanup();
});

const runtimeFor = (options: Parameters<typeof buildAgentRuntime>[0] = {}) =>
  buildAgentRuntime({ clock: new FixedClock(NOW), db: testDb.db, ...options });

describe('every wiring path gets a verifier - there is no null rung', () => {
  it('the DEFAULT runtime - scripted provider - gets the deterministic double', () => {
    const runtime = runtimeFor();
    const verifier = runtime.claimGate.semanticVerifier;
    expect(verifier).toBeInstanceOf(RuleDrivenSemanticClaimVerifier);
    expect(verifier).not.toBeNull();
  });

  it('and that double has NO rules, so the offline pipeline adds nothing', () => {
    // The property every other test file in this repository depends on: with the
    // layer wired, the union equals the deterministic claim set and nothing
    // offline changed. Stated here rather than inferred from 1,791 green tests.
    const verifier = runtimeFor().claimGate.semanticVerifier as RuleDrivenSemanticClaimVerifier;
    expect(verifier.ruleCount).toBe(0);
  });

  it('an explicitly passed SCRIPTED provider still gets the double', () => {
    expect(runtimeFor({ llm: new ScriptedLlmProvider() }).claimGate.semanticVerifier).toBeInstanceOf(
      RuleDrivenSemanticClaimVerifier,
    );
  });

  it('a LOCAL provider built from config gets the REAL verifier', () => {
    // Rung 2. Nothing dials anything: `LocalLlmProvider` is inert on construction
    // and the first byte leaves on the first `completeTurn`, which no test makes.
    const runtime = runtimeFor({ llmProviderConfig: { kind: 'local' } });
    expect(runtime.claimGate.semanticVerifier).toBeInstanceOf(LlmSemanticClaimVerifier);
  });

  it('a LOCAL provider handed in as an INSTANCE also gets the real verifier', () => {
    // Rung 3, and it is the one that closes the hole: `src/app/localBrainDemo.ts`
    // passes its provider as `options.llm`, so a rule that only looked at
    // `llmProviderConfig` would have given the local-brain demo a no-op double.
    const runtime = runtimeFor({ llm: new LocalLlmProvider() });
    expect(runtime.claimGate.semanticVerifier).toBeInstanceOf(LlmSemanticClaimVerifier);
  });

  it('and so does a local provider WRAPPED IN A DECORATOR - the benchmark shape', () => {
    // Rung 3 again, but through the shape `src/eval/runner/runModel.ts` actually
    // passes, which is NOT a bare provider: the benchmark wraps its
    // `LocalLlmProvider` in `MetricsCapturingProvider` before handing it over as
    // `options.llm`.
    //
    // This assertion is separate from the bare-provider one above because for a
    // while it did not hold. The wrapper forwarded `supportsStreaming` but not
    // `supportsStructuredOutput`, so `isStructuredOutputLlmProvider` answered
    // false for it, rung 3 was skipped and the benchmark fell all the way to rung
    // 4 - the rule-less double. The whole of Mission 2F was switched off on the
    // one run that exists to measure it, and nothing said so: a verifier WAS
    // constructed, so `verifierWired` stayed true and the report's unwired warning
    // never fired. The test above could not catch it, because a bare provider is
    // not the shape the benchmark uses.
    const runtime = runtimeFor({ llm: new MetricsCapturingProvider(new LocalLlmProvider()) });
    expect(runtime.claimGate.semanticVerifier).toBeInstanceOf(LlmSemanticClaimVerifier);
    expect(runtime.claimGate.semanticVerifier).not.toBeInstanceOf(RuleDrivenSemanticClaimVerifier);
  });

  it('an explicit verifier instance wins over everything', () => {
    const double = new ScriptedSemanticClaimVerifier();
    const runtime = runtimeFor({ claimVerifier: double, llmProviderConfig: { kind: 'local' } });
    expect(runtime.claimGate.semanticVerifier).toBe(double);
  });

  it('and the regeneration bound is still the only claim-gate knob', () => {
    // There is no option that turns the second layer off, exactly as there is none
    // that turns the gate off. Lowering the bound makes the gate stricter.
    const runtime = runtimeFor({ claimGate: { maxRegenerationAttempts: 1 } });
    expect(runtime.claimGate.regenerationBound).toBe(1);
    expect(runtime.claimGate.semanticVerifier).not.toBeNull();
  });
});

describe('the verifier model defaults to the configured local model', () => {
  it('accepts a model override when this call owns the provider construction', () => {
    const runtime = runtimeFor({
      llmProviderConfig: { kind: 'local', model: 'qwen2.5:7b-instruct' },
      claimVerifierConfig: { model: 'some-other-tag:latest', timeoutMs: 5_000 },
    });
    const verifier = runtime.claimGate.semanticVerifier as LlmSemanticClaimVerifier;
    expect(verifier).toBeInstanceOf(LlmSemanticClaimVerifier);
    expect(verifier.deadlineMs).toBe(5_000);
  });

  it('but REFUSES a model override it cannot honour, rather than accepting and ignoring it', () => {
    // A configuration key that is accepted and silently ignored is worse than one
    // that does not exist - which is the same reasoning `resolveContextBudget`
    // applies to a `modelNumCtx` that disagrees with the provider.
    expect(() =>
      runtimeFor({ llm: new LocalLlmProvider(), claimVerifierConfig: { model: 'some-other-tag:latest' } }),
    ).toThrow(ConfigurationError);
  });

  it('and REFUSES to promise a real verifier over a provider that cannot serve one', () => {
    expect(() => runtimeFor({ claimVerifierConfig: { timeoutMs: 1_000 } })).toThrow(ConfigurationError);
  });
});
