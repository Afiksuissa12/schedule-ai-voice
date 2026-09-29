/**
 * PORT: the language model.
 *
 * CONTRACT, and the whole point of this port: the LLM returns TEXT and
 * PROPOSED TOOL CALLS. It returns no state, no side effects, and nothing that
 * is trusted. `argumentsJson` is a raw string precisely because it is untrusted
 * input - application code parses it, validates it against a schema, validates
 * the resulting datetime deterministically, and only then acts.
 *
 * That contract is unchanged by the local-model work. What Mission 2 added is
 * two OPTIONAL capabilities, both shaped so a provider that ignores them stays
 * a valid `LlmProvider` and every existing caller keeps compiling:
 *
 *   - STREAMING (`completeTurnStreaming`). Optional method. A caller that only
 *     ever calls `completeTurn` is unaffected; a caller that wants deltas asks
 *     `isStreamingLlmProvider` first. Both paths return the SAME
 *     `CompleteTurnResult`, so nothing downstream can tell which was used.
 *
 *   - METRICS (`CompleteTurnResult.metrics`). Optional field. A local model is
 *     a latency and throughput decision as much as a quality one, and those
 *     numbers have to come from the provider because nothing above it can see
 *     a token boundary. `ScriptedLlmProvider` and `OpenAiLlmProvider` simply
 *     never set it.
 *
 * Mission 2F adds a third, in the same shape and for the same reason:
 *
 *   - CONSTRAINED STRUCTURED OUTPUT (`CompleteTurnRequest.responseJsonSchema`)
 *     and PER-REQUEST DETERMINISM (`CompleteTurnRequest.determinism`). Both
 *     optional fields on the REQUEST, so every existing caller compiles
 *     untouched and every existing provider keeps its current behaviour
 *     byte-for-byte when they are absent. A caller that needs the schema to be
 *     HONOURED rather than ignored asks `isStructuredOutputLlmProvider` first,
 *     exactly as a caller that wants deltas asks `isStreamingLlmProvider`.
 *
 *     WHY A REQUEST FIELD AND NOT A PROVIDER OPTION. The semantic claim
 *     verifier (`src/agent/claimGate/semantic/`) and the conversational agent
 *     share one provider instance in the local-brain wiring, and they want
 *     opposite things from it: the agent wants free-running natural language and
 *     the verifier wants one JSON object in a fixed shape at temperature 0 with
 *     a fixed seed. A provider-level setting cannot express that, and two
 *     provider instances would double the resident model. So the constraint
 *     travels with the request that needs it.
 *
 *     WHAT THE PORT DELIBERATELY DOES NOT PROMISE. Honouring a schema is a
 *     capability, not a guarantee about the bytes: a provider may constrain
 *     decoding and still return something that fails validation, and the caller
 *     must validate anyway. `src/agent/claimGate/semantic/schema.ts` does, and
 *     treats any failure as UNSUPPORTED rather than as clean.
 *
 * Implementations live in `src/llm`.
 */

/**
 * The record that a provider reshaped a tool call's arguments before handing
 * them over, and what they looked like before it did.
 *
 * WHY THIS EXISTS AT ALL, GIVEN `argumentsJson` IS MEANT TO BE VERBATIM
 * ---------------------------------------------------------------------------
 * Some models are trained on a tool protocol their runtime's chat template does
 * not fully parse, and the result is arguments in a shape no schema on earth
 * would accept - not wrong VALUES, a wrong CONTAINER. A provider is allowed to
 * unwrap such a container, under a rule narrow enough that the unwrapping
 * cannot be mistaken for a judgement about what the model meant. What it is NOT
 * allowed to do is make the change invisible: `argumentsJson` is read by
 * auditors as what the model said, so the bytes it replaced have to travel with
 * it.
 *
 * A provider that never reshapes anything never sets this, and every consumer
 * that does not care about it never looks at it. `rule` is a stable identifier
 * rather than prose so an audit query can count how often a given rule fired.
 */
export interface ToolCallArgumentsNormalization {
  /** Stable id of the rule that fired. Documented where the rule is implemented. */
  readonly rule: 'ollama-tool-name-parameters-wrapper';
  /** The arguments string EXACTLY as the model produced it, before the rule ran. */
  readonly rawArgumentsJson: string;
}

export interface ToolCallRequest {
  /** Provider-supplied id correlating this call with its result turn. */
  readonly toolCallId: string;
  readonly toolName: string;
  /**
   * Raw JSON arguments exactly as the model produced them. UNTRUSTED and
   * UNPARSED by design: stored verbatim on `ConversationTurn.rawPayloadJson`
   * so an auditor sees what the model actually said, not a cleaned-up version.
   *
   * The ONE exception is declared rather than hidden: when
   * `argumentsNormalization` is present, this string is the post-normalization
   * form and that field carries the pre-normalization bytes.
   */
  readonly argumentsJson: string;
  /**
   * OPTIONAL. Present only when the provider applied a documented, named
   * normalization to `argumentsJson`. Absent means "these are the model's own
   * bytes", which is the case for every provider in this repository except the
   * local Ollama one, and for almost every call even there.
   */
  readonly argumentsNormalization?: ToolCallArgumentsNormalization;
}

export type LlmMessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface LlmMessage {
  readonly role: LlmMessageRole;
  readonly content: string;
  /** Required on `tool` messages: which tool call this is the result of. */
  readonly toolCallId?: string;
  /**
   * Set on an ASSISTANT message that requested a tool call, and on the `tool`
   * message carrying that call's result.
   *
   * `role`, `content` and `toolCallId` are enough for plain chat but cannot
   * express a tool-calling transcript: an assistant turn that called a tool
   * carries a tool NAME as well as an id, and both OpenAI and Ollama reject a
   * `tool` result message that is not preceded by an assistant message
   * declaring that exact call. Together with `toolCallId` this field is enough
   * to rebuild a provider-native transcript from the database alone.
   *
   * Optional, so a provider that does not care about it never looks at it.
   */
  readonly toolName?: string;
}

export interface LlmToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the tool's arguments. Kept `unknown` so no JSON-Schema library leaks into the port. */
  readonly parametersJsonSchema: unknown;
}

/**
 * Sampling controls a CALLER is entitled to pin for one request.
 *
 * Both fields are optional and an absent field means "leave the provider's own
 * configuration alone" - never "use the port's idea of a default". There is no
 * default here on purpose: a default in a port is a policy, and the policy about
 * what temperature this agent runs at already lives in
 * `src/llm/localLlmProvider.ts` and `src/config/env.ts`.
 *
 * WHAT THIS CAN AND CANNOT BUY, stated here because the semantic verifier
 * records it as a determinism control and a reader will want the honest bound.
 * `temperature: 0` and a fixed `seed` remove the SAMPLER as a source of
 * variation. They do not make a local runtime bit-reproducible: batching,
 * GPU kernel non-determinism, quantisation, a runtime upgrade and a model swap
 * all remain, and none of them is visible from here.
 */
export interface LlmDeterminismControls {
  /** 0 asks for greedy decoding. */
  readonly temperature?: number;
  /** A fixed RNG seed, where the runtime supports one. */
  readonly seed?: number;
}

export interface CompleteTurnRequest {
  readonly systemPrompt: string;
  readonly messages: ReadonlyArray<LlmMessage>;
  readonly tools: ReadonlyArray<LlmToolDefinition>;
  /**
   * OPTIONAL. A JSON Schema the assistant's TEXT must conform to.
   *
   * `unknown` for the same reason `LlmToolDefinition.parametersJsonSchema` is:
   * no JSON-Schema library may leak into a port. A provider that does not
   * support this ignores it, which is why a caller that needs it honoured asks
   * `isStructuredOutputLlmProvider` first.
   *
   * It constrains the assistant CHANNEL only. It says nothing about tool calls,
   * and a caller wanting structured output and no actions passes `tools: []`.
   */
  readonly responseJsonSchema?: unknown;
  /**
   * OPTIONAL. Sampling controls for THIS request only.
   *
   * Absent leaves the provider exactly as configured, which is what keeps every
   * existing call site byte-identical.
   */
  readonly determinism?: LlmDeterminismControls;
}

/**
 * How a turn's tool calls actually arrived.
 *
 * A well-behaved model puts tool calls in the provider's native structured
 * field. Some small models emit them as JSON inside the assistant text
 * instead. A provider MAY recover the second shape, but it must say how often
 * it had to - a fleet running at a 12% recovery rate is a different product
 * risk from one running at 0%, and that difference is invisible if the
 * recovery is silent.
 *
 * `malformed` counts turns' worth of text that LOOKED like a tool call and was
 * REFUSED. A refused call must surface as ordinary assistant text, never as a
 * guessed-at call: inventing an argument is exactly the authority this
 * architecture denies the model.
 */
export interface LlmToolCallHealth {
  /** Arrived in the provider's native structured tool-call field. */
  readonly native: number;
  /** Recovered verbatim from assistant text by a documented fallback. */
  readonly recoveredFromText: number;
  /** Looked like a tool call, failed the fallback's checks, and was refused. */
  readonly malformed: number;
  /**
   * WHY each of those `malformed` refusals happened, in the same order.
   *
   * ADDITIVE AND OPTIONAL, MISSION 2D-R, at the request in
   * docs/MISSION_2D_AYA_ROOT_CAUSE.md § 10. `malformed` is a count, and a count
   * stopped being enough when the action-list rule started REMOVING a refused
   * span from the assistant text (§ 8.2). Before that a reader could see the
   * rejected JSON sitting in the transcript; after it, the only surviving trace
   * was this number, and "6 malformed" does not tell you that all six were the
   * `directly-answer` sentinel rather than six broken attempts at real tools -
   * which is the distinction § 8.1 had to reconstruct by hand.
   *
   * THIS IS A DIAGNOSTIC, NOT A CONTROL SIGNAL. Nothing may branch on it. It
   * exists so a transcript can show what the model tried and why it was
   * refused. `CompleteTurnResult.refusals` remains a CLI-only channel that
   * `LocalLlmProvider` strips; this is the same information travelling inside
   * `metrics`, where every other per-turn diagnostic already lives.
   *
   * Optional so that every existing producer - `ScriptedLlmProvider`,
   * `OpenAiLlmProvider`, `mappingSelfCheck`'s fixtures - compiles untouched.
   */
  readonly refusalReasons?: readonly string[];
}

/** Whatever the provider happens to know about the runtime serving the model. */
export interface LlmRuntimeDetail {
  /** e.g. `Q4_K_M`. */
  readonly quantizationLevel?: string;
  /** e.g. `7.6B`. */
  readonly parameterSize?: string;
  /** e.g. `qwen2`. */
  readonly family?: string;
  /** Context window the request was issued with. */
  readonly contextLength?: number;
  /** Milliseconds spent loading the model into memory, if it was cold. */
  readonly loadDurationMs?: number;
}

/**
 * What a turn cost, as measured BY THE PROVIDER.
 *
 * Every field except `modelId`, `streamed` and `totalLatencyMs` is nullable,
 * because a provider that cannot observe a number must say so rather than
 * report a plausible zero. `null` means "not measured"; `0` means zero.
 */
export interface LlmTurnMetrics {
  /** The exact model that served this turn, e.g. `qwen2.5:7b-instruct`. */
  readonly modelId: string;
  /** Whether the streaming path produced this result. */
  readonly streamed: boolean;
  /** Wall-clock from request issued to first token observed. Streaming only. */
  readonly timeToFirstTokenMs: number | null;
  /** Wall-clock from request issued to result returned. Always measurable. */
  readonly totalLatencyMs: number;
  readonly promptTokens: number | null;
  readonly generatedTokens: number | null;
  /** `generatedTokens / generation seconds`. Approximate by nature. */
  readonly tokensPerSecond: number | null;
  /**
   * `promptTokens / contextLength`, as a fraction. Null when either is unknown.
   *
   * This is a SAFETY number, not a performance one. A local runtime does not
   * error on an over-long prompt and does not report one. Measured against
   * Ollama 0.34.3 with a canary system prompt: it drops whole older MESSAGES
   * and keeps the system prompt, so the guardrail clauses survive and the
   * CONVERSATION HISTORY is what disappears - which is exactly what a memory
   * layer exists to guarantee.
   *
   * READ THIS NUMBER KNOWING WHAT IT CANNOT TELL YOU. `promptTokens` is what the
   * runtime reports it actually evaluated, i.e. the count AFTER any dropping, so
   * on an over-long turn this fraction converges on ~1.0 and looks like a
   * comfortably full window rather than a lossy one. It predicts "approaching
   * the limit" well and cannot detect "already over it" at all. A caller
   * approaching 1.0 should shorten the transcript; a caller that wants the
   * stronger guarantee should make the budget and the model agree up front,
   * which is what `resolveContextBudget` in `src/app/composition.ts` does.
   */
  readonly contextUtilization: number | null;
  readonly toolCallHealth?: LlmToolCallHealth;
  readonly runtime?: LlmRuntimeDetail;
}

export interface CompleteTurnResult {
  /** The assistant's natural-language reply, or null when it only called tools. */
  readonly assistantText: string | null;
  /** Tool calls the model PROPOSED. Nothing has been executed or validated yet. */
  readonly toolCalls: ToolCallRequest[];
  /**
   * OPTIONAL provider-reported telemetry. Absent from providers that have
   * nothing meaningful to report. Nothing in the application may depend on it
   * being present, and nothing in it is authoritative over anything.
   */
  readonly metrics?: LlmTurnMetrics;
}

/** One incremental piece of assistant text, as it is produced. */
export interface LlmStreamDelta {
  /** The new text only - callers concatenate; the provider does not re-send. */
  readonly textDelta: string;
  /** 0-based index of this delta within the turn. */
  readonly index: number;
  /** Milliseconds since the request was issued. `index === 0` gives TTFT. */
  readonly elapsedMs: number;
}

/**
 * Called for each delta. Deliberately synchronous and return-less: a provider
 * must not be made to await a consumer mid-stream, and a consumer must not be
 * able to influence generation. Exceptions thrown here are the caller's
 * problem, and a provider is entitled to let them abort the turn.
 */
export type LlmStreamHandler = (delta: LlmStreamDelta) => void;

export interface LlmProvider {
  /** Stable provider identity, recorded in audit events, e.g. `openai` or `scripted-test`. */
  name(): string;

  completeTurn(req: CompleteTurnRequest): Promise<CompleteTurnResult>;

  /**
   * OPTIONAL. Declares that `completeTurnStreaming` is implemented and usable.
   * A provider may implement the method and still answer `false` - e.g. one
   * configured against a backend that does not stream.
   */
  supportsStreaming?(): boolean;

  /**
   * OPTIONAL. Same request, same result type, deltas along the way.
   *
   * MUST return a `CompleteTurnResult` indistinguishable in shape from
   * `completeTurn`'s, so a caller can switch paths without changing what it
   * does with the answer.
   */
  completeTurnStreaming?(req: CompleteTurnRequest, onDelta: LlmStreamHandler): Promise<CompleteTurnResult>;

  /**
   * OPTIONAL. Declares that this provider will HONOUR
   * `CompleteTurnRequest.responseJsonSchema` and
   * `CompleteTurnRequest.determinism` rather than silently ignore them.
   *
   * Shaped exactly like `supportsStreaming`: a provider may implement the
   * behaviour and still answer `false` - one configured against a backend that
   * has no constrained-decoding endpoint, for instance - so the guard below
   * checks what the provider SAYS and not merely what it defines.
   */
  supportsStructuredOutput?(): boolean;
}

/** An `LlmProvider` that has been proven to stream. Produced by the guard below. */
export interface StreamingLlmProvider extends LlmProvider {
  supportsStreaming(): boolean;
  completeTurnStreaming(req: CompleteTurnRequest, onDelta: LlmStreamHandler): Promise<CompleteTurnResult>;
}

/**
 * Can this provider stream?
 *
 * Checks BOTH that the method exists and that the provider says it is usable,
 * so a provider can advertise the capability conditionally on its own
 * configuration without the caller knowing what that configuration is.
 */
export function isStreamingLlmProvider(provider: LlmProvider): provider is StreamingLlmProvider {
  return typeof provider.completeTurnStreaming === 'function' && provider.supportsStreaming?.() === true;
}

/** An `LlmProvider` that has said it will honour a response schema and a seed. */
export interface StructuredOutputLlmProvider extends LlmProvider {
  supportsStructuredOutput(): boolean;
}

/**
 * Will this provider honour `responseJsonSchema` and `determinism`?
 *
 * Same discipline as `isStreamingLlmProvider`, and the same reason for it: the
 * capability may depend on the provider's own configuration, which the caller
 * has no business knowing. `ScriptedLlmProvider` and `OpenAiLlmProvider` declare
 * nothing, so they answer `false` and no caller is misled into thinking a schema
 * was enforced when it was not.
 */
export function isStructuredOutputLlmProvider(provider: LlmProvider): provider is StructuredOutputLlmProvider {
  return provider.supportsStructuredOutput?.() === true;
}
