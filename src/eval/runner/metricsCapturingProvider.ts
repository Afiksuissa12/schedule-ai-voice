/**
 * A transparent `LlmProvider` that remembers what each call cost.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `AgentTurnService` is the real thing being benchmarked, and it deliberately
 * returns an `AgentTurnResult` - correlation ids, assistant messages, tool
 * outcomes - and not the provider's `CompleteTurnResult`. That is correct
 * design: nothing in the application is allowed to depend on provider
 * telemetry. But it means the metrics the mission requires (time to first
 * token, tokens/second, prompt and completion counts, context utilisation)
 * are produced inside the turn and discarded by the time the harness sees it.
 *
 * Rather than ask the provider to expose a mutable `lastMetrics` - which would
 * put benchmark-shaped state on a production class - this decorator sits on the
 * PORT. It implements `LlmProvider`, forwards every call verbatim, returns the
 * result untouched, and keeps a copy of `result.metrics` on the way past.
 *
 * It therefore has no opinion, changes no behaviour, and would keep working
 * against any other provider. One agent turn can make several provider calls
 * (the tool loop), so calls are recorded individually and the harness sums or
 * takes the first as each metric requires - a mean that silently mixed the
 * first call of a turn with its third would be meaningless.
 *
 * STREAMING IS FORWARDED, NOT SIMULATED. `supportsStreaming` answers whatever
 * the inner provider answers, so `isStreamingLlmProvider` keeps telling the
 * truth through the wrapper.
 */
import type {
  CompleteTurnRequest,
  CompleteTurnResult,
  LlmProvider,
  LlmStreamHandler,
  LlmTurnMetrics,
} from '../../ports/llm.js';
import { SEMANTIC_VERIFIER_SEED } from '../../agent/claimGate/semantic/llmSemanticClaimVerifier.js';
import { SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA } from '../../agent/claimGate/semantic/schema.js';

/**
 * WHO MADE THIS PROVIDER CALL - MISSION 2F.
 *
 * WHY THE HARNESS NEEDS THIS AT ALL. The mission requires every benchmarked turn
 * to record VERIFIER latency, TOTAL TURN latency and the IMPACT ON TIME TO USER
 * RESPONSE. Since Mission 2F a single turn can make three DIFFERENT kinds of
 * provider call - the agent generating, the semantic verifier classifying, and
 * the gate asking for the turn again - and `AgentTurnResult` exposes none of that
 * breakdown, deliberately: nothing in the application is allowed to depend on
 * provider telemetry.
 *
 * WHY IT IS CLASSIFIED FROM THE REQUEST AND NOT ASKED FOR. The alternative was a
 * `callerTag` field on `CompleteTurnRequest`, which would put benchmark-shaped
 * state on a port three providers implement - the exact thing this decorator
 * exists to avoid. The request ALREADY carries the distinguishing evidence,
 * because the verifier's determinism controls are load-bearing in production and
 * not decoration.
 */
export const PROVIDER_CALL_SHAPES = ['AGENT', 'CLAIM_VERIFIER', 'GATE_REGENERATION'] as const;

export type ProviderCallShape = (typeof PROVIDER_CALL_SHAPES)[number];

/**
 * Classify one request.
 *
 * THE RULES, IN ORDER, AND WHAT EACH ONE RELIES ON:
 *
 *  1. TOOLS OFFERED -> `AGENT`. Only the agent turn loop offers tools. The gate's
 *     regeneration is offered an empty list so it cannot cause an effect, and the
 *     verifier is offered an empty list for the same reason - "not `no dangerous
 *     tools`, none at all".
 *  2. NO TOOLS, AND BOTH THE VERIFIER'S JSON SCHEMA AND ITS PINNED SEED ->
 *     `CLAIM_VERIFIER`. Both constants are IMPORTED from
 *     `src/agent/claimGate/semantic/`, not copied. Duplicating the number
 *     `20260928` into a second file would be a classification that silently stops
 *     matching the day somebody changes the seed - which is exactly the kind of
 *     drift this repository has spent eight QA rounds on.
 *  3. NO TOOLS AND NEITHER OF THOSE -> `GATE_REGENERATION`.
 *
 * THE HONEST BOUND, STATED RATHER THAN DISCOVERED: this is a STRUCTURAL
 * classification of a request, not an identity check on a caller. A future caller
 * that sent the verifier's exact schema AND its exact seed with no tools would be
 * counted as a verifier call. Nothing in the repository does, `AgentTurnService`
 * is the only thing that drives this wrapper, and the misattribution would move a
 * latency number rather than a correctness one - but it is a classification and
 * not a proof, and the mission document says so in those words.
 */
export function classifyProviderCall(request: CompleteTurnRequest): ProviderCallShape {
  if (request.tools.length > 0) return 'AGENT';
  const usesVerifierSchema = request.responseJsonSchema === SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA;
  const usesVerifierSeed = request.determinism?.seed === SEMANTIC_VERIFIER_SEED;
  return usesVerifierSchema && usesVerifierSeed ? 'CLAIM_VERIFIER' : 'GATE_REGENERATION';
}

export interface CapturedCall {
  /** Provider call index within the current turn window, from 0. */
  readonly index: number;
  readonly metrics: LlmTurnMetrics | null;
  /** Measured by this wrapper, so a provider that reports nothing still has one. */
  readonly wallClockMs: number;
  readonly toolCallCount: number;
  readonly hadText: boolean;
  /** Set when the provider threw. The error is re-thrown after recording. */
  readonly error: string | null;
  /** MISSION 2F. Which of the three callers this request came from. */
  readonly shape: ProviderCallShape;
}

export class MetricsCapturingProvider implements LlmProvider {
  private readonly inner: LlmProvider;
  private window: CapturedCall[] = [];

  constructor(inner: LlmProvider) {
    this.inner = inner;
  }

  name(): string {
    return this.inner.name();
  }

  /** Start a fresh recording window. Call once per benchmark turn. */
  beginTurn(): void {
    this.window = [];
  }

  /** Everything recorded since the last `beginTurn`. */
  calls(): readonly CapturedCall[] {
    return this.window;
  }

  async completeTurn(req: CompleteTurnRequest): Promise<CompleteTurnResult> {
    return this.record(classifyProviderCall(req), () => this.inner.completeTurn(req));
  }

  supportsStreaming(): boolean {
    return this.inner.supportsStreaming?.() ?? false;
  }

  async completeTurnStreaming(req: CompleteTurnRequest, onDelta: LlmStreamHandler): Promise<CompleteTurnResult> {
    const stream = this.inner.completeTurnStreaming;
    if (!stream) {
      throw new Error(`${this.inner.name()} does not implement completeTurnStreaming.`);
    }
    return this.record(classifyProviderCall(req), () => stream.call(this.inner, req, onDelta));
  }

  private async record(
    shape: ProviderCallShape,
    call: () => Promise<CompleteTurnResult>,
  ): Promise<CompleteTurnResult> {
    const index = this.window.length;
    const started = Date.now();
    try {
      const result = await call();
      this.window.push({
        index,
        metrics: result.metrics ?? null,
        wallClockMs: Date.now() - started,
        toolCallCount: result.toolCalls.length,
        hadText: (result.assistantText ?? '').length > 0,
        error: null,
        shape,
      });
      return result;
    } catch (error) {
      // Recorded BEFORE re-throwing, so a failed provider call still appears in
      // the evidence instead of vanishing into the turn's catch block.
      this.window.push({
        index,
        metrics: null,
        wallClockMs: Date.now() - started,
        toolCallCount: 0,
        hadText: false,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        shape,
      });
      throw error;
    }
  }
}

/**
 * THE LATENCY DECOMPOSITION - MISSION 2F.
 *
 * WHAT EACH NUMBER IS, AND WHICH ONES THE RUNNER CANNOT SEE
 * ---------------------------------------------------------------------------
 * The mission requires the impact on TIME TO USER RESPONSE: gate plus verifier
 * overhead versus generation alone. That is a subtraction, and a subtraction is
 * only honest if both terms are observed rather than assumed. So:
 *
 *  - `generationMs`, `verifierMs` and `regenerationMs` are SUMS OF WALL CLOCK
 *    measured by this wrapper around calls it classified. Each is `null` when NO
 *    call of that shape was made, never `0` - a turn with no verifier call has an
 *    unmeasured verifier cost, not a free one, and `src/ports/llm.ts` states the
 *    rule this follows: "`null` means NOT MEASURED. It never means zero."
 *  - `overheadMs` is `totalTurnMs` minus everything above it. It is NOT "the
 *    gate's cost": it is everything the turn did that was not a provider call -
 *    the deterministic detector, the union, the ledger's five repository reads,
 *    every audit insert, the conversation rebuild and the transcript writes. The
 *    field is named for what it measures rather than for what a reader might hope
 *    it measures, and `MISSION_2D_CLAIM_GATE_ASSURANCE.md` § 4.3 is the reason
 *    that matters: the pre-2F gate's real per-turn cost was ONE DURABLE AUDIT
 *    INSERT (~15-30 ms on the mission host), not the detector (~0.05 ms).
 *  - `impactOnTimeToUserResponseMs` is `totalTurnMs - generationMs`: what the
 *    caller waits for beyond the generation they would have waited for anyway.
 *    `null` when there was no generation call to compare against.
 *
 * WHAT THIS CANNOT SEE, AND IT IS WORTH NAMING: the verifier's own VALIDATION and
 * GROUNDING cost, and the union, both of which happen inside `ClaimGate` between
 * provider calls. They are inside `overheadMs` and cannot be separated from the
 * audit inserts by anything the runner can observe. AUTO-VERIFIER-CORE measured
 * them directly with a double at p50 0.0065 ms for validation-plus-grounding and
 * 0.0004 ms for the union - four orders below one audit insert - so the
 * inseparability costs a reader nothing they could act on.
 */
export interface TurnLatencyBreakdown {
  /** The whole turn, wall clock, as the runner measured it. Always present. */
  readonly totalTurnMs: number;
  /** Summed wall clock of calls classified `AGENT`. `null` when there were none. */
  readonly generationMs: number | null;
  readonly generationCalls: number;
  /** Summed wall clock of calls classified `CLAIM_VERIFIER`. `null` when there were none. */
  readonly verifierMs: number | null;
  readonly verifierCalls: number;
  /** Summed wall clock of calls classified `GATE_REGENERATION`. `null` when there were none. */
  readonly regenerationMs: number | null;
  readonly regenerationCalls: number;
  /** Everything that was not a provider call. See the header - NOT "the gate's cost". */
  readonly overheadMs: number | null;
  /** `totalTurnMs - generationMs`. What the caller waits for beyond the generation. */
  readonly impactOnTimeToUserResponseMs: number | null;
  /** `totalTurnMs / generationMs`. A ratio, so turns of different sizes compare. */
  readonly impactRatio: number | null;
  /**
   * Was ANY provider call observed this turn?
   *
   * `false` means the turn threw before reaching the provider, or the provider
   * was never called. Every field above except `totalTurnMs` is then `null`, and
   * this flag is what tells a reader those nulls are "nothing happened" rather
   * than "the wrapper stopped working".
   */
  readonly observed: boolean;
}

export function foldTurnLatency(calls: readonly CapturedCall[], totalTurnMs: number): TurnLatencyBreakdown {
  const sumOf = (shape: ProviderCallShape): { ms: number | null; n: number } => {
    const matching = calls.filter((call) => call.shape === shape);
    return {
      ms: matching.length === 0 ? null : matching.reduce((total, call) => total + call.wallClockMs, 0),
      n: matching.length,
    };
  };

  const generation = sumOf('AGENT');
  const verifier = sumOf('CLAIM_VERIFIER');
  const regeneration = sumOf('GATE_REGENERATION');
  const providerMs = calls.reduce((total, call) => total + call.wallClockMs, 0);

  return {
    totalTurnMs,
    generationMs: generation.ms,
    generationCalls: generation.n,
    verifierMs: verifier.ms,
    verifierCalls: verifier.n,
    regenerationMs: regeneration.ms,
    regenerationCalls: regeneration.n,
    // Clamped at zero. The two clocks are both `Date.now()` and the provider sum
    // cannot exceed the turn it happened inside, but a negative number here would
    // be a measurement artefact printed as a finding, and a floor is cheaper than
    // explaining one.
    overheadMs: calls.length === 0 ? null : Math.max(0, totalTurnMs - providerMs),
    impactOnTimeToUserResponseMs: generation.ms === null ? null : Math.max(0, totalTurnMs - generation.ms),
    impactRatio: generation.ms === null || generation.ms === 0 ? null : totalTurnMs / generation.ms,
    observed: calls.length > 0,
  };
}

/**
 * Fold a turn's provider calls into one metrics record.
 *
 * The rules are chosen so each number keeps meaning what it says:
 *  - `timeToFirstTokenMs` is the FIRST call's, because that is the latency a
 *    caller on a phone actually perceives. Averaging in a later call of the
 *    same turn would flatter a model that answered instantly and then thought
 *    for six seconds.
 *  - `generatedTokens` and `totalLatencyMs` are SUMMED, because the whole turn
 *    is what the turn produced and what it cost.
 *  - `promptTokens` is the MAXIMUM, NOT the sum. Each call in a turn re-sends
 *    the same system prompt and tool schemas plus a little more transcript, so
 *    summing would trebly count a 3,714-token fixed prefix and produce a figure
 *    that reads like near-overflow when no single call came close. The max is
 *    the largest prompt this turn actually presented to the model, which is the
 *    number that means something - and it is the only choice consistent with
 *    `contextUtilization` below, since the two must agree about which call they
 *    are describing.
 *  - `tokensPerSecond` is recomputed from the summed generated tokens over the
 *    summed generation time implied by each call, rather than averaged, so a
 *    one-token call cannot drag the rate around.
 *  - `contextUtilization` is the MAXIMUM, because it is a safety number: the
 *    question is whether this turn ever came close to front-truncation, not
 *    what it averaged.
 */
export function foldTurnMetrics(calls: readonly CapturedCall[]): LlmTurnMetrics | null {
  const present = calls.map((c) => c.metrics).filter((m): m is LlmTurnMetrics => m !== null);
  if (present.length === 0) return null;

  const first = present[0] as LlmTurnMetrics;
  const sum = (pick: (m: LlmTurnMetrics) => number | null): number | null => {
    const values = present.map(pick).filter((v): v is number => typeof v === 'number');
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
  };

  const generatedTokens = sum((m) => m.generatedTokens);

  // Reconstruct generation seconds per call from its own rate, then re-divide.
  let generationSeconds = 0;
  let rateKnown = false;
  for (const metrics of present) {
    if (metrics.generatedTokens !== null && metrics.tokensPerSecond !== null && metrics.tokensPerSecond > 0) {
      generationSeconds += metrics.generatedTokens / metrics.tokensPerSecond;
      rateKnown = true;
    }
  }

  const max = (pick: (m: LlmTurnMetrics) => number | null): number | null =>
    present
      .map(pick)
      .filter((v): v is number => typeof v === 'number')
      .reduce<number | null>((acc, v) => (acc === null || v > acc ? v : acc), null);

  const maxUtilization = max((m) => m.contextUtilization);

  // One agent turn can issue SEVERAL provider calls, so the reasons are
  // concatenated in call order across the turn - the same order the counts are
  // summed in, which keeps `malformed` and `refusalReasons` describing the same
  // events. Omitted when empty so a turn that refused nothing is unchanged.
  const refusalReasons = present.flatMap((m) => m.toolCallHealth?.refusalReasons ?? []);
  const health = {
    ...present.reduce(
      (acc, m) => ({
        native: acc.native + (m.toolCallHealth?.native ?? 0),
        recoveredFromText: acc.recoveredFromText + (m.toolCallHealth?.recoveredFromText ?? 0),
        malformed: acc.malformed + (m.toolCallHealth?.malformed ?? 0),
      }),
      { native: 0, recoveredFromText: 0, malformed: 0 },
    ),
    ...(refusalReasons.length > 0 ? { refusalReasons } : {}),
  };

  return {
    modelId: first.modelId,
    streamed: first.streamed,
    timeToFirstTokenMs: first.timeToFirstTokenMs,
    totalLatencyMs: sum((m) => m.totalLatencyMs) ?? 0,
    promptTokens: max((m) => m.promptTokens),
    generatedTokens,
    tokensPerSecond:
      rateKnown && generationSeconds > 0 && generatedTokens !== null ? generatedTokens / generationSeconds : null,
    contextUtilization: maxUtilization,
    toolCallHealth: health,
    ...(first.runtime ? { runtime: first.runtime } : {}),
  };
}
