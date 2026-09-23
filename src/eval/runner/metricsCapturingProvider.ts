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
    return this.record(() => this.inner.completeTurn(req));
  }

  supportsStreaming(): boolean {
    return this.inner.supportsStreaming?.() ?? false;
  }

  async completeTurnStreaming(req: CompleteTurnRequest, onDelta: LlmStreamHandler): Promise<CompleteTurnResult> {
    const stream = this.inner.completeTurnStreaming;
    if (!stream) {
      throw new Error(`${this.inner.name()} does not implement completeTurnStreaming.`);
    }
    return this.record(() => stream.call(this.inner, req, onDelta));
  }

  private async record(call: () => Promise<CompleteTurnResult>): Promise<CompleteTurnResult> {
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
      });
      throw error;
    }
  }
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

  const health = present.reduce(
    (acc, m) => ({
      native: acc.native + (m.toolCallHealth?.native ?? 0),
      recoveredFromText: acc.recoveredFromText + (m.toolCallHealth?.recoveredFromText ?? 0),
      malformed: acc.malformed + (m.toolCallHealth?.malformed ?? 0),
    }),
    { native: 0, recoveredFromText: 0, malformed: 0 },
  );

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
