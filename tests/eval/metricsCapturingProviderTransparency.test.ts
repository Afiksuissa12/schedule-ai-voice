/**
 * THE DECORATOR IS TRANSPARENT, INCLUDING ABOUT WHAT IT CAN DO.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * `MetricsCapturingProvider` is the only thing in the repository that wraps an
 * `LlmProvider`, and the benchmark (`src/eval/runner/runModel.ts`) hands the
 * WRAPPER - never the inner provider - to `buildAgentRuntime` as `options.llm`.
 * That makes the wrapper's answers to the two capability questions load-bearing
 * in a way a decorator's usually are not, because the composition root BRANCHES
 * on one of them:
 *
 *   `resolveClaimVerifier` gives a runtime the real `LlmSemanticClaimVerifier`
 *   only when `isStructuredOutputLlmProvider(options.llm)` is true. Otherwise it
 *   falls through to `RuleDrivenSemanticClaimVerifier` - the rule-less offline
 *   double that "ADDS NO SUSPICION WHATSOEVER".
 *
 * For a while the wrapper forwarded `supportsStreaming` and NOT
 * `supportsStructuredOutput`, so it answered `false` where its
 * `LocalLlmProvider` answered `true`, and the entire benchmark ran with Mission
 * 2F's semantic layer switched off. Nothing reported it: a verifier object WAS
 * constructed, so `verifierWired` stayed true, the report's unwired warning never
 * fired, INV-19's unwired count stayed 0, and `verifierMs` was null on every turn
 * for a reason that reads identically to "the model was never asked".
 *
 * `tests/agent/claimVerifierComposition.test.ts` asserts rung 3 for a BARE
 * `LocalLlmProvider`, which is the shape `src/app/localBrainDemo.ts` passes and
 * not the shape the benchmark passes - which is why that file was green
 * throughout. The two assertions here are deliberately at different altitudes:
 * the UNIT one would catch any future decorator with the same trap, and the
 * END-TO-END one pins the property the mission actually needs - that the
 * verifier's calls are the METERED provider's calls, and therefore measurable.
 *
 * No model and no network. The inner provider is a local fake; the end-to-end
 * test needs a database only because `buildAgentRuntime` requires one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MetricsCapturingProvider } from '../../src/eval/runner/metricsCapturingProvider.js';
import { buildAgentRuntime } from '../../src/app/composition.js';
import {
  LlmSemanticClaimVerifier,
  RuleDrivenSemanticClaimVerifier,
} from '../../src/agent/claimGate/semantic/index.js';
import { LocalLlmProvider } from '../../src/llm/localLlmProvider.js';
import { ScriptedLlmProvider } from '../../src/llm/scriptedLlmProvider.js';
import {
  isStreamingLlmProvider,
  isStructuredOutputLlmProvider,
  type CompleteTurnRequest,
  type CompleteTurnResult,
  type LlmProvider,
} from '../../src/ports/llm.js';
import { FixedClock } from '../../src/ports/clock.js';
import type { IsoUtcString } from '../../src/ports/clock.js';
import { createTestDatabase, type TestDatabase } from '../helpers/testDb.js';

const NOW = '2026-03-04T15:00:00.000Z' as IsoUtcString;

/**
 * An inner provider whose two optional capabilities are set INDEPENDENTLY.
 *
 * Both are set per instance rather than hardcoded, because the bug being guarded
 * is a wrapper that answers one capability correctly while inventing the other -
 * which a fake that always said `true` to both could not distinguish from a
 * wrapper that always said `true` to both.
 */
class CapabilityFake implements LlmProvider {
  readonly requests: CompleteTurnRequest[] = [];

  constructor(
    private readonly capabilities: { streaming: boolean; structured: boolean },
    private readonly answer = '{"claims":[]}',
  ) {}

  name(): string {
    return 'capability-fake';
  }

  supportsStreaming(): boolean {
    return this.capabilities.streaming;
  }

  supportsStructuredOutput(): boolean {
    return this.capabilities.structured;
  }

  async completeTurn(req: CompleteTurnRequest): Promise<CompleteTurnResult> {
    this.requests.push(req);
    return { assistantText: this.answer, toolCalls: [] };
  }

  async completeTurnStreaming(req: CompleteTurnRequest): Promise<CompleteTurnResult> {
    return this.completeTurn(req);
  }
}

/** An inner provider that declares NEITHER optional method. */
class BareFake implements LlmProvider {
  name(): string {
    return 'bare-fake';
  }

  async completeTurn(): Promise<CompleteTurnResult> {
    return { assistantText: null, toolCalls: [] };
  }
}

describe('the wrapper forwards capabilities instead of answering for itself', () => {
  it('forwards BOTH capabilities when the inner provider has both', () => {
    const meter = new MetricsCapturingProvider(new CapabilityFake({ streaming: true, structured: true }));
    expect(meter.supportsStreaming()).toBe(true);
    expect(meter.supportsStructuredOutput()).toBe(true);
    expect(isStreamingLlmProvider(meter)).toBe(true);
    expect(isStructuredOutputLlmProvider(meter)).toBe(true);
  });

  it('forwards them INDEPENDENTLY, so one true does not imply the other', () => {
    const streamsOnly = new MetricsCapturingProvider(new CapabilityFake({ streaming: true, structured: false }));
    expect(streamsOnly.supportsStreaming()).toBe(true);
    expect(streamsOnly.supportsStructuredOutput()).toBe(false);

    const structuredOnly = new MetricsCapturingProvider(new CapabilityFake({ streaming: false, structured: true }));
    expect(structuredOnly.supportsStreaming()).toBe(false);
    expect(structuredOnly.supportsStructuredOutput()).toBe(true);
  });

  it('answers FALSE for an inner provider that declares neither, rather than throwing', () => {
    // `?? false`, not `?.() === true` by accident: the guard in `src/ports/llm.ts`
    // is already conservative, but a wrapper that threw on an undeclared method
    // would turn a capability question into a crash.
    const meter = new MetricsCapturingProvider(new BareFake());
    expect(meter.supportsStreaming()).toBe(false);
    expect(meter.supportsStructuredOutput()).toBe(false);
    expect(isStructuredOutputLlmProvider(meter)).toBe(false);
  });

  it('never upgrades a provider - a wrapped SCRIPTED provider still cannot do structured output', () => {
    // The other direction of the same property, and the one that keeps the
    // offline suite honest: if the wrapper invented the capability, every
    // scripted-provider test would start wanting a model.
    const meter = new MetricsCapturingProvider(new ScriptedLlmProvider());
    expect(meter.supportsStructuredOutput()).toBe(false);
  });

  it('tells the truth for the provider the benchmark actually wraps', () => {
    // `LocalLlmProvider` is inert on construction - no byte leaves until the first
    // `completeTurn`, which this test does not make.
    const inner = new LocalLlmProvider({ model: 'qwen2.5:7b-instruct' });
    expect(inner.supportsStructuredOutput()).toBe(true);
    expect(isStructuredOutputLlmProvider(new MetricsCapturingProvider(inner))).toBe(true);
  });
});

describe("the benchmark's wiring gets the real verifier, over the metered provider", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase({ label: 'metrics-capturing-transparency' });
  });

  afterAll(async () => {
    await testDb?.cleanup();
  });

  const runtimeFor = (llm: LlmProvider) => buildAgentRuntime({ clock: new FixedClock(NOW), db: testDb.db, llm });

  it('reproduces runModel.ts exactly: wrapper around a local provider -> LlmSemanticClaimVerifier', () => {
    const meter = new MetricsCapturingProvider(new LocalLlmProvider({ model: 'qwen2.5:7b-instruct' }));
    const verifier = runtimeFor(meter).claimGate.semanticVerifier;
    expect(verifier).toBeInstanceOf(LlmSemanticClaimVerifier);
    expect(verifier).not.toBeInstanceOf(RuleDrivenSemanticClaimVerifier);
    expect(verifier?.verifierName).toBe('llm-semantic-claim-verifier');
  });

  it('and the verifier CALLS THROUGH THE METER, which is what makes verifierMs observable', async () => {
    // The property the mission's latency decomposition rests on. A real verifier
    // holding some OTHER provider instance would classify perfectly well and still
    // leave `verifierMs` null on every turn, because this wrapper is the only
    // thing that observes a provider call.
    const inner = new CapabilityFake({ streaming: true, structured: true });
    const meter = new MetricsCapturingProvider(inner);
    const verifier = runtimeFor(meter).claimGate.semanticVerifier;
    expect(verifier).toBeInstanceOf(LlmSemanticClaimVerifier);
    if (verifier === null) throw new Error('unreachable - asserted above');

    meter.beginTurn();
    const verdict = await verifier.classify({
      text: 'Your meeting is booked for Thursday at 2pm.',
      correlationId: 'transparency-test',
    });

    expect(verdict.kind).toBe('CLASSIFIED');
    expect(inner.requests).toHaveLength(1);

    const calls = meter.calls();
    expect(calls).toHaveLength(1);
    // Classified from the request's own shape - no tools, the verifier's schema,
    // the verifier's seed - which is exactly how the benchmark attributes latency.
    expect(calls[0]?.shape).toBe('CLAIM_VERIFIER');
  });
});
